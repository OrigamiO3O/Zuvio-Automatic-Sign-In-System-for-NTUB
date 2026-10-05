import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyRollcallResponse, type RollcallResponseLike } from '../core.js';

const fake = (status: number, body: string): RollcallResponseLike => ({
  status: () => status,
  text: () => Promise.resolve(body),
});

/**
 * 真實回應會夾一包廣告資料（image1/2/3 各一條 S3 圖片 URL），長度遠超 500 字元。
 * verify 曾經先截斷 500 字元才 JSON.parse，於是成功回應被判成「不是 JSON」。
 */
const withAd = (payload: Record<string, unknown>): string =>
  JSON.stringify({
    ...payload,
    ad: { answer: { id: '320', image1: 'https://s3.example.net/' + 'a'.repeat(600) } },
  });

test('verifyRollcallResponse 成功回應夾了超長廣告資料仍判為 ACCEPTED', async () => {
  const body = withAd({ status: true });
  assert.ok(body.length > 500, '測試前提：body 需超過 500 字元');

  const verdict = await verifyRollcallResponse(fake(200, body));
  assert.equal(verdict.kind, 'ACCEPTED');
});

test('verifyRollcallResponse 已簽過的超長回應判為 ANSWERED', async () => {
  const body = withAd({ status: false, msg: 'ROLLCALL IS ANSWERED' });
  assert.ok(body.length > 500);

  const verdict = await verifyRollcallResponse(fake(200, body));
  assert.equal(verdict.kind, 'ANSWERED');
});

test('verifyRollcallResponse 日誌訊息會截斷，不會塞進整包廣告', async () => {
  const verdict = await verifyRollcallResponse(fake(200, withAd({ status: true })));
  assert.ok(verdict.detail.length < 400, `detail 應被截短，實際 ${verdict.detail.length}`);
});

test('verifyRollcallResponse 其他失敗 msg 判為 REJECTED', async () => {
  const body = JSON.stringify({ status: false, msg: 'LOSE THE GPS LOCATION' });
  const verdict = await verifyRollcallResponse(fake(200, body));
  assert.equal(verdict.kind, 'REJECTED');
});

test('verifyRollcallResponse 回應真的不是 JSON 時判為 REJECTED', async () => {
  const verdict = await verifyRollcallResponse(fake(200, '<html>maintenance</html>'));
  assert.equal(verdict.kind, 'REJECTED');
  assert.match(verdict.detail, /不是 JSON/);
});

test('verifyRollcallResponse 非 2xx 判為 REJECTED', async () => {
  const verdict = await verifyRollcallResponse(fake(500, JSON.stringify({ status: true })));
  assert.equal(verdict.kind, 'REJECTED');
});

test('verifyRollcallResponse 沒攔截到請求時判為 REJECTED', async () => {
  const verdict = await verifyRollcallResponse(null);
  assert.equal(verdict.kind, 'REJECTED');
  assert.match(verdict.detail, /未攔截到/);
});

test('verifyRollcallResponse 讀不到回應內容時判為 REJECTED 而非當成空字串', async () => {
  const verdict = await verifyRollcallResponse({
    status: () => 200,
    text: () => Promise.reject(new Error('body already consumed')),
  });
  assert.equal(verdict.kind, 'REJECTED');
  assert.match(verdict.detail, /無法讀取回應內容/);
});
