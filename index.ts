import { ZuvioCore } from './core.js';

const CLASSROOM_LAT = 25.042345;
const CLASSROOM_LNG = 121.525350;

async function main() {
  const zuvio = new ZuvioCore('auth_state.json');

  try {

    const courses = await zuvio.getMyCourses();

    if (courses.length === 0) {
      console.log('⚠️ 未找到課程，請檢查 Session 是否過期或檔案路徑是否正確。');
      return;
    }

    console.log(`--- [START] 開始逐一檢查 ${courses.length} 門課程的點名狀態 ---`);

    
    for (const course of courses) {
      console.log(`\n> 正在處理: ${course.name} (${course.id})`);
      
      const success = await zuvio.checkIn(course.id, CLASSROOM_LAT, CLASSROOM_LNG);

      if (success) {
        console.log(`${course.name} 簽到流程執行完畢。`);
      }
    }

    console.log('\n--- [FINISH] 所有掃描任務已結束 ---');

  } catch (error: any) {
    console.error('[CRITICAL] 執行時發生未預期錯誤:', error.message);
  }
}

main();