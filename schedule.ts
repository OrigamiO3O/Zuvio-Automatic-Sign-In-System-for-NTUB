import cron from 'node-cron';
import { ZuvioCore } from './core.js';

const CLASSROOM_LAT = 25.042345;
const CLASSROOM_LNG = 121.525350;

async function scanAllCourses() {
  const now = new Date();
  console.log(`\n[${now.toLocaleString()}] 觸發點名掃描...`);
  const zuvio = new ZuvioCore('auth_state.json');

  try {

    const courses = await zuvio.getMyCourses();
    if (courses.length === 0) {
      console.log('⚠️ 未找到課程，請確認登入憑證是否有效。');
      return;
    }

    for (const course of courses) {
      console.log(`> 檢查課程: ${course.name} (${course.id})`);
      const success = await zuvio.checkIn(course.id, CLASSROOM_LAT, CLASSROOM_LNG);
      
      if (success) {
        console.log(`[成功] ${course.name} 簽到完成。`);
      }
      
      await new Promise(resolve => setTimeout(resolve, Math.random() * 3000 + 2000));
    }
  } catch (error: any) {
    console.error('[錯誤] 掃描發生異常:', error.message);
  }
}

// 依照課表設定排程 (每 3 分鐘掃描一次)
const schedules = [
  // 星期一
  //{ name: 'null', cronTime: '*/3 10-11 * * 2' }

  // 星期二
  { name: '體育一(下)', cronTime: '*/3 10-11 * * 2' },        // 10:10 - 12:00
  { name: '資訊倫理與法律', cronTime: '*/3 13-15 * * 2' },      // 13:30 - 15:15
  
  // 星期三
  { name: '統計學', cronTime: '*/3 9-11 * * 3' },           // 09:10 - 12:00

  // 星期四
  { name: '會計學', cronTime: '*/3 13-16 * * 4' },          // 13:30 - 16:15

  // 星期五
  { name: '程式設計(二)', cronTime: '*/3 9-11 * * 5' },       // 09:10 - 12:00
  { name: '服務學習(大學部)', cronTime: '*/3 15-17 * * 5' }   // 15:25 - 17:10
];

console.log('--- [Zuvio 自動簽到排程已啟動] ---');
console.log('提示：請保持此視窗開啟以維持排程運作\n');

schedules.forEach(schedule => {
  cron.schedule(schedule.cronTime, () => {
    scanAllCourses();
  });
  console.log(`📍 已載入時段: ${schedule.name}`);
});