import { useEffect, useRef, useState } from 'react';
import { Button } from '../studio';
import { cameraProblem, openLiveVideo } from './camera.js';

// Staff can verify HDMI before selling/using a code. Leaving the settings
// screen or changing the chosen camera always releases the test stream.
export function LiveCameraCheck({ cameraId, webcamTest, onDevices }) {
  const video = useRef(null), stream = useRef(null), turn = useRef(0);
  const [busy, setBusy] = useState(false), [live, setLive] = useState(false), [message, setMessage] = useState('');
  const stop = () => {
    turn.current++;
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  };
  useEffect(() => {
    setLive(false); setBusy(false); setMessage('');
    return stop;
  }, [cameraId, webcamTest]);
  async function check() {
    if (busy) return;
    if (live) { stop(); setLive(false); setMessage('Đã tắt hình thử.'); return; }
    const current = ++turn.current;
    setBusy(true); setMessage('');
    try {
      const opened = await openLiveVideo({ id: cameraId, webcam: webcamTest });
      if (current !== turn.current || !video.current) { opened.stream.getTracks().forEach(track => track.stop()); return; }
      stream.current = opened.stream;
      onDevices?.(opened.cameras);
      video.current.srcObject = opened.stream;
      await video.current.play();
      if (current !== turn.current) return;
      setLive(true);
      setMessage(`Đã mở ${opened.stream.getVideoTracks()[0]?.label || 'nguồn hình'}. Kiểm tra hình và góc máy trước khi đón khách.`);
      opened.stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (current !== turn.current) return;
        stop(); setLive(false); setBusy(false);
        setMessage('Nguồn hình vừa ngắt. Cắm lại USB của thẻ ghi hình rồi kiểm tra lại.');
      }, { once: true });
    } catch (error) {
      if (current !== turn.current) return;
      stop(); setLive(false); setBusy(false); setMessage(cameraProblem(error).message);
    } finally { if (current === turn.current) setBusy(false); }
  }
  return <div className="kiosk-live-check">
    <Button type="button" className="outline small" disabled={busy} onClick={check}>
      {busy ? 'Đang mở hình trực tiếp…' : live ? 'Tắt xem thử' : 'Kiểm tra hình trực tiếp'}
    </Button>
    <video ref={video} className={live ? 'is-live' : ''} autoPlay playsInline muted aria-label="Hình trực tiếp thử máy" />
    {message && <p className={`kiosk-check-result ${live ? 'is-ok' : 'is-warn'}`} role="status">{message}</p>}
  </div>;
}
