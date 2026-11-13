import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cameraProblem, openLiveVideo } from '../src/kiosk/camera.js';

const device = (deviceId, label) => ({ deviceId, label, kind: 'videoinput' });
const makeStream = (id, label) => {
  const track = { label, stopped: false, getSettings: () => ({ deviceId: id }), stop() { this.stopped = true; } };
  return { track, getTracks: () => [track], getVideoTracks: () => [track] };
};
test('a busy named HDMI card never falls back to EOS Webcam Utility', async () => {
  const calls = [];
  const error = Object.assign(new Error('Device busy'), { name: 'NotReadableError' });
  await assert.rejects(openLiveVideo({ devices: {
    enumerateDevices: async () => [device('eos', 'EOS Webcam Utility'), device('hdmi', 'USB Video')],
    getUserMedia: async constraints => { calls.push(constraints.video.deviceId?.exact); throw error; },
  } }), error);
  assert.deepEqual(calls, ['hdmi']);
});
test('after permission reveals labels, an unwanted default stream is stopped before HDMI opens', async () => {
  const eos = makeStream('eos', 'EOS Webcam Utility'), hdmi = makeStream('hdmi', 'USB Video');
  let listed = false;
  const opened = await openLiveVideo({ devices: {
    enumerateDevices: async () => listed ? [device('eos', eos.track.label), device('hdmi', hdmi.track.label)]
      : [device('eos', ''), device('hdmi', '')],
    getUserMedia: async constraints => {
      if (!constraints.video.deviceId) { listed = true; return eos; }
      assert.equal(eos.track.stopped, true);
      assert.equal(constraints.video.deviceId.exact, 'hdmi');
      return hdmi;
    },
  } });
  assert.equal(opened.stream, hdmi);
  assert.equal(hdmi.track.stopped, false);
});
test('a stream is released if refreshing its device list fails', async () => {
  const stream = makeStream('hdmi', 'USB Video');
  let scans = 0;
  await assert.rejects(openLiveVideo({devices:{
    enumerateDevices:async()=>{ if(scans++)throw Error('Enumeration failed');return[device('hdmi','USB Video')]; },
    getUserMedia:async()=>stream,
  }}),/Enumeration failed/);
  assert.equal(stream.track.stopped,true);
});
test('a rejected camera permission is reported once, without trying other devices',async()=>{
  let calls=0;
  const error=Object.assign(new Error('Permission denied'),{name:'NotAllowedError'});
  await assert.rejects(openLiveVideo({devices:{
    enumerateDevices:async()=>[device('one','USB Video'),device('two','HDMI Capture')],
    getUserMedia:async()=>{calls++;throw error},
  }}),error);
  assert.equal(calls,1);
  assert.match(cameraProblem(error).message,/Quyền camera/);
  assert.match(cameraProblem({name:'NotFoundError'}).message,/chưa nhận thiết bị/);
});
