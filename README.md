
# Zuvio 自動簽到系統

這是一個基於 Playwright 開發的 Zuvio 自動點名腳本。本專案透過無頭瀏覽器模擬真實使用者的網頁環境，另用 `node-cron` 進行本地端的時間排程，以實現於指定課程時段內自動完成 Zuvio 簽到的功能。

~~**另有提供付費架設包含通訊軟體點名狀態通知之服務 - DISCORD DM**~~

## ⚠️ 免責聲明

**使用本專案程式碼前，請務必了解並承擔後續所有風險。作者不對任何因使用本程式碼而導致的後果負責。**
**本專案僅供程式語言學習、Playwright 測試與排程邏輯研究之用。請勿將其用於任何影響學術公平性之真實場域。**

---

## 系統需求

* **作業系統**：Windows / macOS / Linux
* **環境依賴**：[Node.js](https://nodejs.org/) (建議 v18 以上版本)

## 安裝步驟

1. 複製本專案至本地端，並在專案根目錄下開啟命令提示字元 (CMD / PowerShell / Terminal)。

2. 安裝依賴套件（版本已鎖定於 `package.json`）：

    ```bash
    npm install
    ```

3. 安裝 Playwright 所需的 Chromium 瀏覽器核心：

    ```bash
    npx playwright install chromium
    ```

4. 複製 `.env.example` 為 `.env`，填入自己的學校信箱：

    ```bash
    cp .env.example .env
    ```

    `.env` 已被 `.gitignore` 排除。若不設定也可以，登入時自行在瀏覽器輸入即可。

## 檔案結構說明

* `config.ts`：課表、教室座標、掃描間隔等所有設定集中於此。**要調整課表只需要改這個檔案。**
* `session.ts`：憑證的載入與最小化過濾（詳見下方「關於憑證」）。
* `auth.ts`：互動式登入，完成 SSO 後產生 `auth_state.json`。
* `core.ts`：核心功能封裝 —— 抓取課程列表（`getMyCourses`）與執行簽到（`checkIn`），藉由 Playwright 注入 GPS 座標並呼叫前端原生 `makeRollcall` 函式。全程共用單一瀏覽器實例。
* `runner.ts`：單次掃描流程，由 `index.ts` 與 `schedule.ts` 共用。
* `schedule.ts`：排程常駐程式，每分鐘檢查目前是否落在課堂時段內。
* `index.ts`：單次掃描，用於手動測試。

## 關於憑證

`auth_state.json` 只會存下 **一個** cookie：`irs.zuvio.com.tw` 的 `PHPSESSID`。

這是 Zuvio 唯一有功能的登入憑證。完整的瀏覽器狀態會存下 55 個 cookie，其中 40 個是 Google / YouTube 的主帳號 cookie（`SID`、`__Secure-1PSID`、`LSID`、`__Host-GAPS` …），**等同 Google 帳號的接管憑證**，其餘則是 GA、Facebook Pixel 等分析用途。這些對本專案功能上完全沒用 —— 存下來只會把萬一外洩的損失，從「教室系統 session 被冒用」放大成「Google 帳號被接管」。

因此登入器在存檔前就會把其餘 54 個全部丟棄。

> **警告：`auth_state.json` 仍是你的登入憑證，請勿分享或上傳至公開網路。**
> 該檔案（以及 `.env`）已列入 `.gitignore`，正常操作下不會被 `git` 追蹤。

## 使用教學

### 第一步：獲取登入憑證

首次執行時，必須手動登入以獲取 Session。

```bash
npm run login
```

1. 程式會開啟一個可見的瀏覽器視窗。
2. 請在視窗內完成學校的 Google 或 SSO 登入流程。
3. 登入成功並跳轉至課程列表後，程式會自動關閉視窗，並生成 `auth_state.json`。

Session 過期時重跑一次即可。

### 第二步：設定課表與座標

開啟 `config.ts` 修改：

1. **GPS 座標**：`DEFAULT_LAT` / `DEFAULT_LNG` 改為目標建築物的真實經緯度。個別課程可在 `TIMETABLE` 中單獨指定 `lat` / `lng`（不同課在不同棟時）。
2. **課表**：在 `TIMETABLE` 中填入真實的上課起訖時間即可，不需要自己換算 cron 表達式：

    ```ts
    { name: '統計學', weekday: 3, start: '09:10', end: '12:00' },
    ```

    `weekday` 為 0（週日）到 6（週六）。程式會在該時段內每 `SCAN_INTERVAL_MINUTES` 分鐘掃描一次。

### 第三步：先做一次手動測試

```bash
npm run scan
```

執行單次掃描，用來確認憑證有效、課表抓得到。憑證失效時會明確告知並以非零狀態碼結束。

### 第四步：啟動自動排程

```bash
npm start
```

請保持此命令列視窗開啟。程式將會在設定的時段內自動喚醒，抓取課程列表並嘗試簽到。按 `Ctrl+C` 結束。

## 疑難排解

**憑證失效**
排程偵測到被導回登入頁時會立刻暫停並提示，不會繼續空轉。重跑 `npm run login` 後重啟程式即可。

**想確認簽到請求的實際內容**
在 `.env` 設定 `ZUVIO_DEBUG_NET=1`，程式會把點名頁上所有 XHR / fetch 的請求與回應印出來。

**型別檢查**

```bash
npm run typecheck
```

---
