import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { AUTH_PATH, LOGIN_URL } from './config.js';
import { filterToZuvioSession, SESSION_COOKIE, SESSION_DOMAIN } from './session.js';

/**
 * 互動式登入，取得並儲存 Zuvio session。
 *
 * 只會存下 PHPSESSID —— 過濾邏輯見 session.ts 的說明。
 */
async function loginAndSaveSession(): Promise<void> {
  const email = process.env.ZUVIO_EMAIL;

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('正在前往 Zuvio 登入頁面...');
    await page.goto(LOGIN_URL);

    if (email) {
      await page.fill('#email', email);
      await page.click('#login-btn');
      console.log(`已代填 ${email}，請在視窗中完成 Google / 學校 SSO 登入...`);
    } else {
      // 沒設定就讓使用者自己輸入，不把任何人的學號寫死在原始碼裡
      console.log('未設定 ZUVIO_EMAIL（可寫在 .env，參考 .env.example）。');
      console.log('請直接在視窗中輸入信箱並完成 Google / 學校 SSO 登入...');
    }

    // 登入成功後會轉址到課程列表頁
    await page.waitForURL('**/student5/irs/index', { timeout: 180_000 });

    const state = await context.storageState();
    const kept = filterToZuvioSession(state.cookies);

    if (kept.length === 0) {
      throw new Error(
        `登入流程結束，但找不到 ${SESSION_DOMAIN} 的 ${SESSION_COOKIE}，憑證未儲存。`,
      );
    }

    // origins 只有 lastExternalReferrer / google_ama_config 之類的 AdSense 資料，
    // 不含任何憑證，一律捨棄
    writeFileSync(
      AUTH_PATH,
      JSON.stringify({ cookies: kept, origins: [] }, null, 2),
      'utf-8',
    );

    const dropped = state.cookies.length - kept.length;
    console.log(`\n✅ 憑證已儲存至 ${AUTH_PATH}`);
    console.log(`   保留 ${kept.length} 個 cookie（${SESSION_COOKIE}）`);
    console.log(`   捨棄 ${dropped} 個無功能但具風險的 cookie（含 Google 主帳號憑證）`);
    console.log('   此檔已被 .gitignore 排除，請勿分享或上傳。');
  } finally {
    await browser.close();
  }
}

loginAndSaveSession().catch((err: unknown) => {
  console.error('❌ 登入失敗:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
