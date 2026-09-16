import './env.js';
import { ZuvioCore } from './core.js';
import { scanOnce } from './runner.js';
import { openWindows } from './config.js';
import { SessionExpiredError } from './session.js';

/**
 * 單次掃描（不排程），用來手動測試憑證與簽到流程是否正常。
 * 排程常駐請用 schedule.ts。
 */
async function main(): Promise<void> {
  let zuvio: ZuvioCore;
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

  try {
    console.log('--- [START] 單次掃描 ---');
    const outcome = await scanOnce(zuvio, openWindows());

    console.log('\n--- [FINISH] 掃描結束 ---');
    console.log(`成功 ${outcome.succeeded.length} 門` +
      (outcome.succeeded.length ? `：${outcome.succeeded.join('、')}` : ''));
    if (outcome.failed.length) {
      console.log(`失敗 ${outcome.failed.length} 門：${outcome.failed.join('、')}`);
    }
    if (outcome.sessionExpired || outcome.failed.length) process.exitCode = 1;
  } finally {
    await zuvio.close();
  }
}

main().catch((err: unknown) => {
  console.error('[CRITICAL] 執行時發生未預期錯誤:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
