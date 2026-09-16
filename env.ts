/**
 * 載入 .env（若存在）。
 *
 * 舊版 README 與 .env.example 都說可以在 .env 設 ZUVIO_EMAIL，但程式裡從來沒有
 * 任何東西去讀它 —— tsx 不會自動載入 .env。這裡用 Node 內建的 loadEnvFile，
 * 不另外引入 dotenv。各進入點（auth / index / schedule）需最先 import 本模組。
 */
try {
  process.loadEnvFile('.env');
} catch {
  // 沒有 .env 是正常情況，直接用現有環境變數
}
