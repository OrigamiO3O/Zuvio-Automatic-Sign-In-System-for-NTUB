import './env.js';
import cron from 'node-cron';
import { statSync } from 'node:fs';
import { ZuvioCore } from './core.js';
import { scanOnce } from './runner.js';
import {
  AUTH_PATH,
  SCAN_INTERVAL_MINUTES,
  TIMETABLE,
  openWindows,
  type ClassWindow,
} from './config.js';
import { SessionExpiredError } from './session.js';

/**
 * 排程常駐程式。
 *
 * 舊版為每門課註冊一條 cron，時數區間是手寫的（例如 '*​/3 10-11 * * 2'），
 * 與註解的 10:10–12:00 對不上 —— 12 點後不掃、10:00 起白掃。
 *
 * 改為每分鐘 tick 一次，由 config.ts 的真實起訖時間判斷哪些時段正在進行中，
 * 再依 SCAN_INTERVAL_MINUTES 節流。課表變成資料，不再是手算的 cron 字串。
 */

const key = (w: ClassWindow) => `${w.weekday}-${w.start}-${w.name}`;
const lastScan = new Map<string, number>();

let zuvio: ZuvioCore;
let scanning = false;
/**
 * 憑證失效後暫停掃描，避免每 3 分鐘對著登入頁空轉。
 * 記下暫停當時憑證檔的 mtime，之後每分鐘比對，檔案一更新就自動 reload 並恢復。
 */
let pausedAtMtime: number | null = null;

function authMtime(): number {
  try {
    return statSync(AUTH_PATH).mtimeMs;
  } catch {
    return 0;
  }
}

/** 暫停中：偵測到重新登入後自動恢復，不必重啟程式 */
async function tryResume(): Promise<void> {
  const mtime = authMtime();
  if (mtime === pausedAtMtime) return;

  try {
    await zuvio.reloadSession();
  } catch (err: unknown) {
    // 檔案變了但內容仍無效（例如登入到一半），記下 mtime 免得每分鐘重複報錯
    pausedAtMtime = mtime;
    const msg = err instanceof SessionExpiredError ? err.message : String(err);
    console.error(`🔑 憑證檔已更新但仍無法使用：${msg}`);
    return;
  }

  pausedAtMtime = null;
  // 清掉節流紀錄，讓進行中的時段立刻補掃一次
  lastScan.clear();
  console.log(`\n[${new Date().toLocaleString('zh-TW')}] ✅ 偵測到新憑證，排程已恢復。`);
}

async function tick(): Promise<void> {
  if (scanning) return;

  if (pausedAtMtime !== null) {
    await tryResume();
    if (pausedAtMtime !== null) return;
  }

  const now = new Date();
  const open = openWindows(now);
  if (open.length === 0) return;

  // 節流：同一時段每 SCAN_INTERVAL_MINUTES 分鐘才掃一次
  const due = open.filter((w) => {
    const last = lastScan.get(key(w)) ?? 0;
    return now.getTime() - last >= SCAN_INTERVAL_MINUTES * 60_000;
  });
  if (due.length === 0) return;

  for (const w of due) lastScan.set(key(w), now.getTime());

  scanning = true;
  try {
    console.log(
      `\n[${now.toLocaleString('zh-TW')}] 進行中時段：${due.map((w) => w.name).join('、')}`,
    );
    const outcome = await scanOnce(zuvio, due);

    if (outcome.sessionExpired) {
      pausedAtMtime = authMtime();
      console.error('\n⛔ 已暫停排程。請在另一個視窗執行 npm run login，完成後會自動恢復。');
    }
  } catch (err: unknown) {
    console.error('[錯誤] 掃描發生未預期異常:', err instanceof Error ? err.message : err);
  } finally {
    scanning = false;
  }
}

async function main(): Promise<void> {
  try {
    zuvio = new ZuvioCore();
  } catch (err: unknown) {
    if (err instanceof SessionExpiredError) {
      console.error(`🔑 ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  console.log('--- [Zuvio 自動簽到排程已啟動] ---');
  console.log(`已載入 ${TIMETABLE.length} 個課堂時段，時段內每 ${SCAN_INTERVAL_MINUTES} 分鐘掃描一次：`);
  for (const w of TIMETABLE) {
    const day = '日一二三四五六'[w.weekday];
    console.log(`  週${day} ${w.start}–${w.end}  ${w.name}`);
  }
  console.log('\n提示：請保持此視窗開啟以維持排程運作（Ctrl+C 結束）\n');

  const task = cron.schedule('* * * * *', () => {
    void tick();
  });

  const shutdown = async () => {
    console.log('\n正在關閉...');
    task.stop();
    await zuvio.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err: unknown) => {
  console.error('[CRITICAL]', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
