
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
2. 初始化並安裝所需的依賴套件：

    ```bash
    
    npm init -y
    
    npm install playwright axios node-cron
    
    npm install -D typescript tsx @types/node @types/node-cron
    
    ```

3. 安裝 Playwright 所需的 Chromium 瀏覽器核心：

    ```bash
    
    npx playwright install chromium
    
    ```

## 檔案結構說明

* `auth.ts`：處理 OAuth/SSO 登入邏輯，並儲存包含 Cookies 與 LocalStorage 的 `auth_state.json` 憑證檔。
* `core.ts`：核心功能封裝，包含獲取課程列表（`getMyCourses`）與執行模擬簽到（`checkIn`），藉由 Playwright 注入 GPS 座標並呼叫前端原生 `makeRollcall` 函式。
* `schedule.ts`：排程執行檔，取代 Redis 佇列，依據設定的 Cron 規則在指定時段進行迴圈掃描。

## 使用教學

### 第一步：獲取登入憑證

首次執行時，必須手動登入以獲取 Session。

```bash

npx tsx auth.ts

```

1. 程式會開啟一個可見的瀏覽器視窗。
2. 請在視窗內完成學校的 Google 或 SSO 登入流程。
3. 登入成功並跳轉至課程列表後，程式會自動關閉視窗，並在目錄下生成 `auth_state.json`。

**_警告:請勿將產生出來的Session分享或上傳至公開網路，本人不負任何資料外洩之責任_**


### 第二步：設定排程與座標

開啟 `schedule.ts`，根據您的實際需求修改以下參數：

1. **GPS 座標**：修改 `CLASSROOM_LAT` 與 `CLASSROOM_LNG` 為目標建築物的真實經緯度。
2. **課表時間**：在 `schedules` 陣列中，依據您的課表修改 `cronTime` (Cron 表達式)。例如：`*/3 9-11 * * 2` 代表星期二的 09:00 到 11:59，每 3 分鐘檢查一次。

### 第三步：啟動自動排程

確認設定無誤後，啟動背景排程：

```bash

npx tsx schedule.ts

```

請保持此命令列視窗開啟。程式將會在您設定的時段內自動喚醒，抓取課程列表，並嘗試進行簽到。

---
