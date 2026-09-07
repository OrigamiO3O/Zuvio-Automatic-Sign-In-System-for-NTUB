import { chromium, type Browser, type BrowserContext, type Page, type Response } from 'playwright';
import {
  AUTH_PATH,
  COURSE_INDEX_URL,
  DEFAULT_LAT,
  DEFAULT_LNG,
  rollcallUrl,
} from './config.js';
import { loadSession, SessionExpiredError, type StoredState } from './session.js';

export interface Course {
  id: string;
  name: string;
}

export type CoursesResult =
  | { kind: 'OK'; courses: Course[] }
  | { kind: 'SESSION_EXPIRED'; message: string }
  | { kind: 'ERROR'; message: string };

export type CheckInResult =
  | { kind: 'SUCCESS'; rollcallId: string; detail: string }
  | { kind: 'ALREADY_DONE'; rollcallId: string }
  | { kind: 'NO_ROLLCALL' }
  | { kind: 'SESSION_EXPIRED'; message: string }
  | { kind: 'ERROR'; message: string };

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

/** 分析／廣告類請求，判斷簽到結果時要排除 */
const NOISE_HOST =
  /google-analytics|googletagmanager|doubleclick|facebook|scorecardresearch|gstatic|googlesyndication/i;

/** 回應內容出現這些字樣視為失敗 */
const FAILURE_HINT = /(fail|error|invalid|expired|錯誤|失敗|逾時|過期|超出|範圍)/i;

export class ZuvioCore {
  private browser: Browser | null = null;
  /** 以座標為 key 快取 context —— geolocation 是 context 層級的設定 */
  private contexts = new Map<string, BrowserContext>();
  private state: StoredState;
  private readonly debugNet = process.env.ZUVIO_DEBUG_NET === '1';

  /** 已成功處理過的 rollcall_id，避免同一場點名每 3 分鐘重複送出 */
  private handled = new Set<string>();

  constructor(authPath: string = AUTH_PATH) {
    // 載入時就驗證並過濾，憑證有問題立刻拋錯，不會拖到抓課程才發現
    this.state = loadSession(authPath);
  }

  /** 重新載入憑證（重新登入後呼叫），並清掉所有既有 context */
  async reloadSession(authPath: string = AUTH_PATH): Promise<void> {
    this.state = loadSession(authPath);
    for (const ctx of this.contexts.values()) await ctx.close().catch(() => {});
    this.contexts.clear();
  }

  private async getBrowser(): Promise<Browser> {
    // 舊版每門課都 chromium.launch()，6 門課等於每次掃描開關 7 個瀏覽器。
    // 現在整個程序共用一個。
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true });
    }
    return this.browser;
  }

  private async getContext(lat: number, lng: number): Promise<BrowserContext> {
    const key = `${lat},${lng}`;
    const cached = this.contexts.get(key);
    if (cached) return cached;

    const browser = await this.getBrowser();
    const ctx = await browser.newContext({
      storageState: this.state,
      geolocation: { latitude: lat, longitude: lng },
      permissions: ['geolocation'],
      viewport: { width: 375, height: 812 },
      userAgent: MOBILE_UA,
    });
    this.contexts.set(key, ctx);
    return ctx;
  }

  /** 被導回登入頁就代表 session 失效 */
  private static isLoggedOut(page: Page): boolean {
    return /\/irs\/login/.test(page.url());
  }

  /**
   * 等頁面安定後再判斷是否被登出。
   *
   * 導向登入頁是在 domcontentloaded 之後才發生的，goto 一回來就檢查 URL 會
   * 太早 —— 那會讓失效的 session 被誤判成「查無點名活動」，正是本次要消除的
   * 那種靜默失敗。
   */
  private static async settleAndCheckLogout(page: Page, ms: number): Promise<boolean> {
    await page.waitForTimeout(ms);
    return ZuvioCore.isLoggedOut(page);
  }

  async getMyCourses(): Promise<CoursesResult> {
    let page: Page | null = null;
    try {
      const ctx = await this.getContext(DEFAULT_LAT, DEFAULT_LNG);
      page = await ctx.newPage();
      await page.goto(COURSE_INDEX_URL, { waitUntil: 'domcontentloaded' });

      // 先讓轉址發生，避免呆等 15 秒的選擇器逾時才發現其實是被登出
      if (await ZuvioCore.settleAndCheckLogout(page, 1500)) {
        return { kind: 'SESSION_EXPIRED', message: '抓取課表時被導回登入頁' };
      }

      await page.waitForSelector('.i-m-p-c-a-c-l-course-box', { timeout: 15_000 });

      const courses = await page.$$eval('.i-m-p-c-a-c-l-course-box', (els) =>
        els.map((el) => ({
          id: el.getAttribute('data-course-id') || '',
          name:
            el.querySelector('.i-m-p-c-a-c-l-c-b-t-course-name')?.textContent?.trim() ||
            '未知課程',
        })),
      );

      return { kind: 'OK', courses: courses.filter((c) => c.id) };
    } catch (err: unknown) {
      // 舊版一律 catch 成 []，把「session 失效」和「網路抖動」混為一談，
      // 導致憑證過期後整學期靜默空轉。現在分開回報。
      if (page && ZuvioCore.isLoggedOut(page)) {
        return { kind: 'SESSION_EXPIRED', message: '抓取課表時被導回登入頁' };
      }
      if (err instanceof SessionExpiredError) {
        return { kind: 'SESSION_EXPIRED', message: err.message };
      }
      return { kind: 'ERROR', message: err instanceof Error ? err.message : String(err) };
    } finally {
      await page?.close().catch(() => {});
    }
  }

  async checkIn(
    courseId: string,
    lat: number = DEFAULT_LAT,
    lng: number = DEFAULT_LNG,
  ): Promise<CheckInResult> {
    let page: Page | null = null;
    try {
      const ctx = await this.getContext(lat, lng);
      page = await ctx.newPage();

      if (this.debugNet) this.attachNetLogger(page);

      await page.goto(rollcallUrl(courseId), { waitUntil: 'domcontentloaded' });

      // 同一段等待兼顧兩件事：讓轉址發生，以及讓頁面腳本把 rollcall_id 掛上 window。
      // 必須在讀 rollcall_id「之前」判斷登出，否則失效的 session 會被誤報成
      // NO_ROLLCALL —— 看起來像「今天沒點名」，實際上是根本沒登入。
      if (await ZuvioCore.settleAndCheckLogout(page, 1500)) {
        return { kind: 'SESSION_EXPIRED', message: `課程 ${courseId} 簽到頁被導回登入頁` };
      }

      const rid = await page.evaluate(() => {
        const w = window as unknown as { rollcall_id?: unknown };
        return w.rollcall_id == null ? '' : String(w.rollcall_id);
      });

      if (!rid) return { kind: 'NO_ROLLCALL' };
      if (this.handled.has(rid)) return { kind: 'ALREADY_DONE', rollcallId: rid };

      // 送出前先掛好監聽，否則會錯過 makeRollcall 觸發的請求
      const responsePromise = page
        .waitForResponse(
          (r) => {
            const t = r.request().resourceType();
            return (t === 'xhr' || t === 'fetch') && !NOISE_HOST.test(r.url());
          },
          { timeout: 15_000 },
        )
        .catch(() => null);

      const invoked = await page.evaluate((id) => {
        const w = window as unknown as { makeRollcall?: (v: string) => unknown };
        if (typeof w.makeRollcall !== 'function') return false;
        w.makeRollcall(id);
        return true;
      }, rid);

      if (!invoked) {
        return { kind: 'ERROR', message: `頁面上找不到 makeRollcall 函式（rollcall ${rid}）` };
      }

      const verdict = await this.verify(await responsePromise);

      if (verdict.ok) {
        this.handled.add(rid);
        return { kind: 'SUCCESS', rollcallId: rid, detail: verdict.detail };
      }
      return { kind: 'ERROR', message: `簽到未獲確認（rollcall ${rid}）：${verdict.detail}` };
    } catch (err: unknown) {
      if (page && ZuvioCore.isLoggedOut(page)) {
        return { kind: 'SESSION_EXPIRED', message: `課程 ${courseId} 簽到頁被導回登入頁` };
      }
      return { kind: 'ERROR', message: err instanceof Error ? err.message : String(err) };
    } finally {
      await page?.close().catch(() => {});
    }
  }

  /**
   * 判讀伺服器是否真的接受了簽到。
   *
   * 舊版 makeRollcall 之後 sleep 3 秒就 return true，從不確認結果 ——
   * 失敗時使用者會看到成功訊息。
   *
   * 註：makeRollcall 的實際端點與回應格式尚未實地確認過。這裡以「攔到非分析類
   * XHR + HTTP 2xx + 內容無失敗字樣」判定，並且一律把原始回應印出來。
   * 首次在真實點名時跑過一次（或設 ZUVIO_DEBUG_NET=1）即可看到實際格式，
   * 屆時再把判定收斂成精確比對。
   */
  private async verify(res: Response | null): Promise<{ ok: boolean; detail: string }> {
    if (!res) {
      return { ok: false, detail: '15 秒內未攔截到任何簽到請求，無法確認是否送達' };
    }

    const status = res.status();
    let body = '';
    try {
      body = (await res.text()).slice(0, 500);
    } catch {
      body = '(無法讀取回應內容)';
    }

    const detail = `HTTP ${status} ${res.url()} → ${body.replace(/\s+/g, ' ').trim()}`;
    console.log(`   [驗證] ${detail}`);

    if (status < 200 || status >= 300) return { ok: false, detail };
    if (FAILURE_HINT.test(body)) return { ok: false, detail };
    return { ok: true, detail };
  }

  /** ZUVIO_DEBUG_NET=1 時傾印所有請求，用來確認實際端點 */
  private attachNetLogger(page: Page): void {
    page.on('response', async (r) => {
      const t = r.request().resourceType();
      if ((t !== 'xhr' && t !== 'fetch') || NOISE_HOST.test(r.url())) return;
      let body = '';
      try {
        body = (await r.text()).slice(0, 300).replace(/\s+/g, ' ');
      } catch {
        body = '(unreadable)';
      }
      console.log(`   [NET] ${r.request().method()} ${r.status()} ${r.url()}\n         ${body}`);
    });
  }

  async close(): Promise<void> {
    for (const ctx of this.contexts.values()) await ctx.close().catch(() => {});
    this.contexts.clear();
    await this.browser?.close().catch(() => {});
    this.browser = null;
  }
}
