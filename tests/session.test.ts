import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  filterToZuvioSession,
  loadSession,
  SessionExpiredError,
  SESSION_COOKIE,
  SESSION_DOMAIN,
} from '../session.js';

const zuvio = { name: SESSION_COOKIE, value: 'abc', domain: SESSION_DOMAIN };
const google = { name: 'SID', value: 'g', domain: '.google.com' };
const zuvioOther = { name: '_ga', value: 'x', domain: SESSION_DOMAIN };
const sameNameOtherDomain = { name: SESSION_COOKIE, value: 'y', domain: 'example.com' };

test('filterToZuvioSession 只留下 irs.zuvio.com.tw 的 PHPSESSID', () => {
  const kept = filterToZuvioSession([google, zuvioOther, zuvio, sameNameOtherDomain]);
  assert.deepEqual(kept, [zuvio]);
});

test('filterToZuvioSession 沒有符合的 cookie 時回傳空陣列', () => {
  assert.deepEqual(filterToZuvioSession([google, zuvioOther]), []);
});

function withTempFile(content: string | null, fn: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'zuvio-test-'));
  const path = join(dir, 'auth_state.json');
  try {
    if (content !== null) writeFileSync(path, content, 'utf-8');
    fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('loadSession 會過濾舊版完整 storageState，只留 PHPSESSID 並清空 origins', () => {
  const full = {
    cookies: [google, zuvio, zuvioOther],
    origins: [{ origin: 'https://irs.zuvio.com.tw', localStorage: [{ name: 'k', value: 'v' }] }],
  };
  withTempFile(JSON.stringify(full), (path) => {
    const state = loadSession(path);
    assert.deepEqual(state, { cookies: [zuvio], origins: [] });
  });
});

test('loadSession 找不到檔案時拋 SessionExpiredError', () => {
  withTempFile(null, (path) => {
    assert.throws(() => loadSession(path), SessionExpiredError);
  });
});

test('loadSession 遇到非 JSON 時拋 SessionExpiredError', () => {
  withTempFile('{not json', (path) => {
    assert.throws(() => loadSession(path), SessionExpiredError);
  });
});

test('loadSession 檔案中沒有 PHPSESSID 時拋 SessionExpiredError', () => {
  withTempFile(JSON.stringify({ cookies: [google], origins: [] }), (path) => {
    assert.throws(() => loadSession(path), SessionExpiredError);
  });
});

test('loadSession cookies 欄位缺失或不是陣列時拋 SessionExpiredError', () => {
  withTempFile(JSON.stringify({ cookies: 'nope' }), (path) => {
    assert.throws(() => loadSession(path), SessionExpiredError);
  });
  withTempFile(JSON.stringify({}), (path) => {
    assert.throws(() => loadSession(path), SessionExpiredError);
  });
});
