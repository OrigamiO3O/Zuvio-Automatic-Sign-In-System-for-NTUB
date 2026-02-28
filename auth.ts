import { chromium } from 'playwright';
import fs from 'fs';

async function loginAndSaveSession() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('正在前往 Zuvio 登入頁面...');
  await page.goto('https://irs.zuvio.com.tw/irs/login');

  // 輸入 Email
  await page.fill('#email', 'yourmail@ntub.edu.tw');
  
  // 點擊登入 (會自動偵測 OAuth 並跳轉)
  await page.click('#login-btn');

  console.log('請在彈出的視窗中完成 Google/學校 SSO 登入...');
  
  // 等待登入成功後的特徵網址出現 (例如課程列表頁)
  await page.waitForURL('**/student5/irs/index', { timeout: 60000 });

  // 保存存儲狀態 (含 Cookies 和 LocalStorage)
  await context.storageState({ path: 'auth_state.json' });

  console.log('✅ Session 已保存至 auth_state.json');
  await browser.close();
}

loginAndSaveSession();