import { readFileSync } from 'node:fs';

/**
 * 憑證的最小化處理。
 *
 * 只有 irs.zuvio.com.tw 的 PHPSESSID 是真正的登入憑證。完整的 storageState
 * 會存下 55 個 cookie，其中 43 個是 Google / YouTube 的主帳號 cookie
 * （SID / __Secure-1PSID / LSID / __Host-GAPS ...），等同 Google 帳號接管憑證；
 * 其餘是 GA、Facebook Pixel、廣告同意等分析用途。
 *
 * 這些對本專案功能上完全沒用 —— 存下來只是白白把外洩損失從
 * 「教室系統 session 被冒用」放大成「Google 帳號被接管」。
 *
 * 本模組刻意不含任何副作用，方便單獨測試。
 */

export const SESSION_DOMAIN = 'irs.zuvio.com.tw';
export const SESSION_COOKIE = 'PHPSESSID';

export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

export interface StoredState {
  cookies: StoredCookie[];
  origins: never[];
}

/** 從任意 cookie 陣列中，只留下 Zuvio 的 session cookie */
export function filterToZuvioSession<T extends { name: string; domain: string }>(
  cookies: T[],
): T[] {
  return cookies.filter(
    (c) => c.domain === SESSION_DOMAIN && c.name === SESSION_COOKIE,
  );
}

export class SessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

/**
 * 讀取憑證檔並驗證。
 *
 * 舊版直接把檔案路徑丟給 Playwright，憑證壞掉時要等到抓不到課程才會發現；
 * 這裡先驗證再回傳物件，壞掉就立刻給出明確錯誤。
 */
export function loadSession(authPath: string): StoredState {
  let raw: string;
  try {
    raw = readFileSync(authPath, 'utf-8');
  } catch {
    throw new SessionExpiredError(
      `找不到憑證檔 ${authPath}，請先執行：npx tsx auth.ts`,
    );
  }

  let parsed: { cookies?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SessionExpiredError(`憑證檔 ${authPath} 不是合法 JSON，請重新登入。`);
  }

  const cookies = Array.isArray(parsed.cookies)
    ? (parsed.cookies as StoredCookie[])
    : [];
  const kept = filterToZuvioSession(cookies);

  if (kept.length === 0) {
    throw new SessionExpiredError(
      `憑證檔 ${authPath} 中找不到 ${SESSION_DOMAIN} 的 ${SESSION_COOKIE}，請重新登入。`,
    );
  }

  // 即使檔案是舊版存的完整 storageState，這裡也會再過濾一次，
  // 確保多餘的 Google cookie 絕不會被送進瀏覽器
  return { cookies: kept, origins: [] };
}
