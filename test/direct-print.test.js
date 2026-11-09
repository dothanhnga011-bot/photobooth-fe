import test from 'node:test';
import assert from 'node:assert/strict';
import { sendDirectPrint } from '../src/kiosk/direct-print.js';
const job = { token: 'album-token', requestKey: 'stable-key', frameName: 'Pink', printSize: 'strip', images: ['data:image/png;base64,AQID'] };

test('direct print sends original bytes to loopback with the same request identity', async () => {
  const calls = [];
  const result = await sendDirectPrint(job, { fetcher: async (url, options) => {
    calls.push({ url, options });
    return Response.json(calls.length === 1 ? { directPrint: 2 } : { sent: true });
  } });
  assert.equal(result.sent, true);
  assert.deepEqual(calls.map(c => c.url), ['http://127.0.0.1:8789/health', 'http://127.0.0.1:8789/print']);
  const options = calls[1].options;
  assert.equal(options.headers['X-Print-Key'], job.requestKey);
  assert.equal(options.headers['X-Album-Token'], job.token);
  assert.equal(options.headers['X-Print-Size'], 'strip');
  assert.deepEqual([...new Uint8Array(await options.body.arrayBuffer())], [1, 2, 3]);
});

test('ambiguous local response is never retried or redirected to a cloud queue', async () => {
  let calls = 0;
  await assert.rejects(sendDirectPrint(job, { fetcher: async () => {
    if (++calls === 1) return Response.json({ directPrint: 2 });
    throw new TypeError('Disconnected after printing');
  } }), /không tự gửi lại/);
  assert.equal(calls, 2);
});

test('missing local agent fails before sending any image', async () => {
  let calls = 0;
  await assert.rejects(sendDirectPrint(job, { fetcher: async () => { calls++; throw new TypeError('Offline'); } }), /Chưa kết nối/);
  assert.equal(calls, 1);
});
