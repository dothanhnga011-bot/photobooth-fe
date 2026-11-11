import test from 'node:test';
import assert from 'node:assert/strict';
import { sendDirectPrint, checkDirectPrinter } from '../src/kiosk/direct-print.js';
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
  assert.equal(calls[0].options.targetAddressSpace, 'loopback');
  assert.equal(options.targetAddressSpace, 'loopback');
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

test('printer preflight checks permission/connectivity without submitting an image', async () => {
  const calls = [];
  const health = await checkDirectPrinter({ fetcher: async (url) => { calls.push(url); return Response.json({ directPrint: 2 }); } });
  assert.equal(health.directPrint, 2);
  assert.deepEqual(calls, ['http://127.0.0.1:8789/health']);
});

test('photo regions go only to an agent that announces support (an older agent blocks unknown headers)', async () => {
  const photos = [[0.05, 0.05, 0.9, 0.42], [0.05, 0.53, 0.9, 0.42], [0.123456, 0, 1 / 3, 1]];
  const sent = async (health) => {
    const calls = [];
    await sendDirectPrint({ ...job, photos }, { fetcher: async (url, options) => {
      calls.push(options);
      return Response.json(calls.length === 1 ? health : { sent: true });
    } });
    return calls[1].headers['X-Print-Photos'];
  };
  assert.equal(await sent({ directPrint: 2, photoRegions: true }), '0.05,0.05,0.9,0.42;0.05,0.53,0.9,0.42;0.12346,0,0.33333,1');
  assert.equal(await sent({ directPrint: 2 }), undefined);
});
