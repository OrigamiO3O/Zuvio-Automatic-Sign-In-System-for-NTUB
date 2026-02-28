import axios, { AxiosInstance } from 'axios';
import fs from 'fs';
import { chromium, BrowserContext, Page } from 'playwright';

export interface Course {
  id: string;
  name: string;
}

export class ZuvioCore {
  private client: AxiosInstance;
  private authPath: string;
  private BASE_LAT = 25.0441;
  private BASE_LNG = 121.5321;

  constructor(authPath: string = 'auth_state_origami.json') {
    this.authPath = authPath;
    const authData = JSON.parse(fs.readFileSync(authPath, 'utf-8'));

    // 淨化 Cookie
    const cleanCookieString = authData.cookies
      .filter((c: any) => 
        c.domain.includes('zuvio.com.tw') &&
        !c.name.startsWith('_g')
      )
      .map((c: any) => `${c.name}=${c.value}`)
      .join('; ');

    this.client = axios.create({
      baseURL: 'https://irs.zuvio.com.tw',
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
        'Cookie': cleanCookieString,
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
  }


  async getMyCourses(): Promise<Course[]> {
    console.log('--- [SCAN] 正在啟動瀏覽器抓取課表 ---');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState: this.authPath });
    const page = await context.newPage();

    try {
      await page.goto('https://irs.zuvio.com.tw/student5/irs/index');
      await page.waitForSelector('.i-m-p-c-a-c-l-course-box', { timeout: 10000 });

      const courses = await page.$$eval('.i-m-p-c-a-c-l-course-box', (els) => 
        els.map(el => ({
          id: el.getAttribute('data-course-id') || '',
          name: el.querySelector('.i-m-p-c-a-c-l-c-b-t-course-name')?.textContent?.trim() || '未知課程'
        }))
      );

      console.log(`[DATA] 成功抓取到 ${courses.length} 門課程。`);
      return courses;
    } catch (e) {
      console.error('[ERROR] 無法抓取課程列表，Session 可能已失效。');
      return [];
    } finally {
      await browser.close();
    }
  }

  // 針對特定課程執行簽到 (模擬 Student 5 原生腳本行為)

  async checkIn(courseId: string, lat?: number, lng?: number) {
    const targetLat = lat || this.BASE_LAT + (Math.random() * 0.0001);
    const targetLng = lng || this.BASE_LNG + (Math.random() * 0.0001);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      storageState: this.authPath,
      geolocation: { latitude: targetLat, longitude: targetLng },
      permissions: ['geolocation'], //授權定位權限
      viewport: { width: 375, height: 812 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
    });

    const page = await context.newPage();

    try {
      console.log(`[ACTION] 進入課程 ${courseId} 簽到頁面...`);
      await page.goto(`https://irs.zuvio.com.tw/student5/irs/rollcall/${courseId}`);
      await page.waitForTimeout(2000);

      const rollcallInfo = await page.evaluate(() => {
        return {
          rid: (window as any).rollcall_id,
          hasBtn: document.querySelector('#submit-make-rollcall') !== null
        };
      });

      if (rollcallInfo.rid && rollcallInfo.rid !== "") {
        console.log(`[MATCH] 偵測到點名活動 (ID: ${rollcallInfo.rid})，執行簽到...`);
        
        await page.evaluate((rid) => {
          (window as any).makeRollcall(rid);
        }, rollcallInfo.rid);
        
        console.log(`✅ [SUCCESS] 簽到指令已送出。`);
        await page.waitForTimeout(3000);
        return true;
        } 

      else {
        console.log(`[SKIP] 課程 ${courseId} 目前無點名活動。`);
        return false;
      }
    } 
    
    catch (error: any) {
      console.error(`❌ [FAIL] 課程 ${courseId} 簽到失敗:`, error.message);
      return false;
    } 
    
    finally {
      await browser.close();
    }
  }
}