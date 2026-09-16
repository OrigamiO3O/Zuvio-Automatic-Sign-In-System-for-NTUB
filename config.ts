/**
 * 全專案共用設定。
 * 座標與課表原本重複散落在 index.ts / schedule.ts，統一收斂到這裡。
 */

/** 已過濾的憑證檔路徑（只含 PHPSESSID，見 auth.ts） */
export const AUTH_PATH = 'auth_state.json';

export const ZUVIO_BASE = 'https://irs.zuvio.com.tw';
export const LOGIN_URL = `${ZUVIO_BASE}/irs/login`;
export const COURSE_INDEX_URL = `${ZUVIO_BASE}/student5/irs/index`;
export const rollcallUrl = (courseId: string) =>
  `${ZUVIO_BASE}/student5/irs/rollcall/${courseId}`;
/** 頁面上 makeRollcall() 實際送出的端點（自頁面原始碼確認） */
export const MAKE_ROLLCALL_PATH = '/app_v2/makeRollcall';

/** 預設教室座標，個別課程可於 TIMETABLE 覆寫 */
export const DEFAULT_LAT = 25.042345;
export const DEFAULT_LNG = 121.525350;

/** 課堂時段內每隔幾分鐘掃描一次 */
export const SCAN_INTERVAL_MINUTES = 3;

export interface ClassWindow {
  name: string;
  /** 0=週日, 1=週一, ... 6=週六 */
  weekday: number;
  /** "HH:MM" 24 小時制，含頭 */
  start: string;
  /** "HH:MM" 24 小時制，含尾 */
  end: string;
  /** 該堂課教室座標，省略則用 DEFAULT_* */
  lat?: number;
  lng?: number;
}

/**
 * 課表。
 *
 * 注意：舊版用手寫 cron 時數區間（例如 '*​/3 10-11 * * 2'），實際只涵蓋
 * 10:00–11:59，與註解寫的 10:10–12:00 對不上 —— 12 點後不掃、10:00 起白掃。
 * 現在直接寫真實的起訖時間，由 scheduler 換算。
 */
export const TIMETABLE: ClassWindow[] = [
  // 週二
  { name: '體育一(下)',       weekday: 2, start: '10:10', end: '12:00' },
  { name: '資訊倫理與法律',   weekday: 2, start: '13:30', end: '15:15' },

  // 週三
  { name: '統計學',           weekday: 3, start: '09:10', end: '12:00' },

  // 週四
  { name: '會計學',           weekday: 4, start: '13:30', end: '16:15' },

  // 週五
  { name: '程式設計(二)',     weekday: 5, start: '09:10', end: '12:00' },
  { name: '服務學習(大學部)', weekday: 5, start: '15:25', end: '17:10' },
];

/** 將 "HH:MM" 轉為當日起算的分鐘數 */
export function toMinutes(hhmm: string): number {
  const parts = hhmm.split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (
    parts.length !== 2 ||
    !Number.isInteger(h) || h < 0 || h > 23 ||
    !Number.isInteger(m) || m < 0 || m > 59
  ) {
    throw new Error(`時間格式錯誤（應為 HH:MM）：${hhmm}`);
  }
  return h * 60 + m;
}

/**
 * 回傳當下正在進行中的課堂時段。
 * timetable 可注入，方便測試，也預留之後改由外部來源提供課表。
 */
export function openWindows(
  now: Date = new Date(),
  timetable: readonly ClassWindow[] = TIMETABLE,
): ClassWindow[] {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return timetable.filter(
    (w) =>
      w.weekday === now.getDay() &&
      nowMin >= toMinutes(w.start) &&
      nowMin <= toMinutes(w.end),
  );
}
