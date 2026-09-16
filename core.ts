import { chromium, type Browser, type BrowserContext, type Page, type Response } from 'playwright';
import {
  AUTH_PATH,
  COURSE_INDEX_URL,
  DEFAULT_LAT,
  DEFAULT_LNG,
  MAKE_ROLLCALL_PATH,
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

/** 分析／廣告類請求，ZUVIO_DEBUG_NET 傾印時排除 */
const NOISE_HOST =
  /google-analytics|googletagmanager|doubleclick|facebook|scorecardresearch|gstatic|googlesyndication/i;

const LOGIN_RE = /\/irs\/login/;

/** 課程列表頁與簽到頁各自的「已渲染」標記，兩者在未登入的轉址殘頁上都不存在 */
const INDEX_READY = '.irs-main-page';
const ROLLCALL_READY = '.irs-rollcall';

const PAGE_READY_TIMEOUT = 15_000;
const GPS_TIMEOUT = 5_000;
const RESPONSE_TIMEOUT = 15_000;

/**
 * makeRollcall 的回應格式（自頁面原始碼確認）：
 *   成功：{ status: true,  ad: { answer: ... } }
 *   失敗：{ status: false, msg: 'ROLLCALL IS ANSWERED' | 'LOSE THE GPS LOCATION'
 *                                | 'ROLLCALL IS NOT ONAIR' | ... }
 */
interface MakeRollcallResponse {
  status?: unknown;
  msg?: unknown;
}

type Verdict =
  | { kind: 'ACCEPTED'; detail: string }
  | { kind: 'ANSWERED'; detail: string }
  | { kind: 'REJECTED'; detail: string };

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
    return LOGIN_RE.test(page.url());
  }

  /**
   * 等到「頁面渲染完成」或「被導回登入頁」，先到者為準。
   *
   * 未登入時伺服器回的是一個殘頁，load 事件之後才由 JS 轉址到 /irs/login
   * （實測約 80 ms）。所以不能只等 load 再看 URL；舊版用固定 sleep 1.5 秒硬等，
   * 既慢又沒有保證。改成 race：殘頁上永遠不會出現 readySelector，轉址一發生
   * 就立刻判定登出；正常頁面則在 selector 出現的瞬間往下走。
   *
   * readySelector 逾時會直接拋錯，交由呼叫端的 catch 分類。
   */
  private static async waitReadyOrLogout(page: Page, readySelector: string): Promise<boolean> {
    // 逾時或頁面關閉時永不 resolve，讓 selector 那一側決定結果與錯誤訊息
    const loggedOut = page
      .waitForURL(LOGIN_RE, { timeout: 0 })
      .then(() => true as const, () => new Promise<never>(() => {}));
    const ready = page
      .waitForSelector(readySelector, { timeout: PAGE_READY_TIMEOUT, state: 'attached' })
      .then(() => false as const);
    return Promise.race([loggedOut, ready]);
  }

  async getMyCourses(): Promise<CoursesResult> {
    let page: Page | null = null;
    try {
      const ctx = await this.getContext(DEFAULT_LAT, DEFAULT_LNG);
      page = await ctx.newPage();
      await page.goto(COURSE_INDEX_URL, { waitUntil: 'domcontentloaded' });

      if (await ZuvioCore.waitReadyOrLogout(page, INDEX_READY)) {
        return { kind: 'SESSION_EXPIRED', message: '抓取課表時被導回登入頁' };
      }

      // 用容器當就緒標記而非課程卡片本身：課表為空時卡片永遠不會出現，
      // 舊版會等到逾時才回 ERROR，其實應該是「憑證有效但沒課」
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

      // 必須在讀 rollcall_id「之前」判斷登出，否則失效的 session 會被誤報成
      // NO_ROLLCALL —— 看起來像「今天沒點名」，實際上是根本沒登入。
      if (await ZuvioCore.waitReadyOrLogout(page, ROLLCALL_READY)) {
        return { kind: 'SESSION_EXPIRED', message: `課程 ${courseId} 簽到頁被導回登入頁` };
      }

      // rollcall_id 是頁面的 inline script 宣告的全域變數，無點名時為 ''
      const rid = await page.evaluate(() => {
        const w = window as unknown as { rollcall_id?: unknown };
        return w.rollcall_id == null ? '' : String(w.rollcall_id);
      });

      if (!rid) return { kind: 'NO_ROLLCALL' };
      if (this.handled.has(rid)) return { kind: 'ALREADY_DONE', rollcallId: rid };

      await ZuvioCore.ensureGps(page, lat, lng);

      // 送出前先掛好監聽，否則會錯過 makeRollcall 觸發的請求
      const responsePromise = page
        .waitForResponse((r) => r.url().includes(MAKE_ROLLCALL_PATH), { timeout: RESPONSE_TIMEOUT })
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

      const verdict = await ZuvioCore.verify(await responsePromise);

      switch (verdict.kind) {
        case 'ACCEPTED':
          this.handled.add(rid);
          return { kind: 'SUCCESS', rollcallId: rid, detail: verdict.detail };
        case 'ANSWERED':
          // 伺服器說這場已經簽過（例如用手機簽的），之後不必再送
          this.handled.add(rid);
          return { kind: 'ALREADY_DONE', rollcallId: rid };
        default:
          return { kind: 'ERROR', message: `簽到未獲確認（rollcall ${rid}）：${verdict.detail}` };
      }
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
   * 確保頁面拿到座標後再送出。
   *
   * makeRollcall() 送的是全域 user_latitude / user_longitude，由 watchPosition
   * 的 callback 填入並把 user_gps 設為 true。舊版固定 sleep 1.5 秒就送，callback
   * 還沒回來時 lat/lng 是 null，伺服器會回 LOSE THE GPS LOCATION。
   * 這裡先等 callback；逾時就直接把 context 的座標（同一組值）寫進全域變數。
   */
  private static async ensureGps(page: Page, lat: number, lng: number): Promise<void> {
    const gotGps = await page
      .waitForFunction(
        () => (window as unknown as { user_gps?: unknown }).user_gps === true,
        undefined,
        { timeout: GPS_TIMEOUT },
      )
      .then(() => true, () => false);

    if (gotGps) return;

    console.warn(`   [GPS] 頁面 ${GPS_TIMEOUT / 1000} 秒內未取得定位，改為直接注入座標`);
    await page.evaluate(
      ([la, ln]) => {
        const w = window as unknown as {
          user_gps?: boolean;
          user_latitude?: number;
          user_longitude?: number;
        };
        w.user_gps = true;
        w.user_latitude = la;
        w.user_longitude = ln;
      },
      [lat, lng] as const,
    );
  }

  /**
   * 判讀 /app_v2/makeRollcall 的回應。
   *
   * 舊版 makeRollcall 之後 sleep 3 秒就 return true，從不確認結果；
   * 上一版改為攔截 XHR 但只能用「2xx + 沒有失敗字樣」猜。現在端點與格式都
   * 已自頁面原始碼確認，直接依 status / msg 判定。原始回應一律印出。
   */
  private static async verify(res: Response | null): Promise<Verdict> {
    if (!res) {
      return {
        kind: 'REJECTED',
        detail: `${RESPONSE_TIMEOUT / 1000} 秒內未攔截到 makeRollcall 請求，無法確認是否送達`,
      };
    }

    const status = res.status();
    let body = '';
    try {
      body = (await res.text()).slice(0, 500);
    } catch {
      body = '(無法讀取回應內容)';
    }

    const detail = `HTTP ${status} → ${body.replace(/\s+/g, ' ').trim()}`;
    console.log(`   [驗證] ${detail}`);

    if (status < 200 || status >= 300) return { kind: 'REJECTED', detail };

    let parsed: MakeRollcallResponse;
    try {
      parsed = JSON.parse(body) as MakeRollcallResponse;
    } catch {
      return { kind: 'REJECTED', detail: `回應不是 JSON：${detail}` };
    }

    if (parsed.status === true) return { kind: 'ACCEPTED', detail };
    if (parsed.msg === 'ROLLCALL IS ANSWERED') return { kind: 'ANSWERED', detail };
    return { kind: 'REJECTED', detail };
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
