import { ZuvioCore, type CheckInResult } from './core.js';
import { DEFAULT_LAT, DEFAULT_LNG, type ClassWindow } from './config.js';

/**
 * 一次完整掃描的結果。
 * schedule.ts 與 index.ts 共用，避免兩邊各寫一份迴圈。
 */
export interface ScanOutcome {
  sessionExpired: boolean;
  succeeded: string[];
  failed: string[];
}

/** 每門課之間的隨機間隔（毫秒） */
const GAP_MIN_MS = 2_000;
const GAP_MAX_MS = 5_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function describe(course: string, result: CheckInResult): string {
  switch (result.kind) {
    case 'SUCCESS':
      return `✅ ${course} 簽到成功（rollcall ${result.rollcallId}）`;
    case 'ALREADY_DONE':
      return `↩️  ${course} 本次點名已簽過（rollcall ${result.rollcallId}），略過`;
    case 'NO_ROLLCALL':
      return `·   ${course} 目前無點名活動`;
    case 'SESSION_EXPIRED':
      return `🔑 ${course} —— ${result.message}`;
    case 'ERROR':
      return `❌ ${course} —— ${result.message}`;
  }
}

/**
 * 掃描所有課程並嘗試簽到。
 *
 * 遇到 session 失效會立刻中止並回報，不再對剩餘課程做無謂的嘗試 ——
 * 舊版是靜默回傳空陣列，憑證過期後可以整學期空轉而不被發現。
 */
export async function scanOnce(
  zuvio: ZuvioCore,
  windows: ClassWindow[] = [],
): Promise<ScanOutcome> {
  const outcome: ScanOutcome = { sessionExpired: false, succeeded: [], failed: [] };

  const courses = await zuvio.getMyCourses();

  if (courses.kind === 'SESSION_EXPIRED') {
    console.error(`🔑 憑證已失效：${courses.message}`);
    console.error('   請重新執行：npm run login');
    outcome.sessionExpired = true;
    return outcome;
  }

  if (courses.kind === 'ERROR') {
    console.error(`❌ 抓取課表失敗：${courses.message}`);
    outcome.failed.push('(抓取課表)');
    return outcome;
  }

  if (courses.courses.length === 0) {
    console.warn('⚠️  課表為空 —— 憑證有效但沒有任何課程。');
    return outcome;
  }

  console.log(`共 ${courses.courses.length} 門課程待檢查。`);

  // 若當下有進行中的課堂時段，用該時段的座標；否則用預設值
  const win = windows[0];
  const lat = win?.lat ?? DEFAULT_LAT;
  const lng = win?.lng ?? DEFAULT_LNG;

  for (const course of courses.courses) {
    const result = await zuvio.checkIn(course.id, lat, lng);
    console.log(`> ${describe(course.name, result)}`);

    if (result.kind === 'SESSION_EXPIRED') {
      console.error('   憑證於掃描途中失效，中止本次掃描。請重新執行：npm run login');
      outcome.sessionExpired = true;
      return outcome;
    }
    if (result.kind === 'SUCCESS') outcome.succeeded.push(course.name);
    if (result.kind === 'ERROR') outcome.failed.push(course.name);

    await sleep(GAP_MIN_MS + Math.random() * (GAP_MAX_MS - GAP_MIN_MS));
  }

  return outcome;
}
