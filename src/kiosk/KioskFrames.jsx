import { useEffect, useRef, useState } from 'react';
import { PiArrowRightBold, PiCaretLeftBold, PiCaretRightBold, PiCheckBold } from 'react-icons/pi';
import { Button } from '../studio.jsx';
import { useKioskText } from './use-kiosk-text.js';

// Catalog art only: customer bitmaps, colours and QR never enter this screen.
function FrameChoice({ frame, number, need, active, onPick, busy }) {
  const [fallback, setFallback] = useState(false), [failed, setFailed] = useState(false);
  const name = frame.themeName?.trim() || frame.name || 'Khung ảnh';
  return <button type="button" role="radio" aria-checked={active}
    aria-label={`${name} · khung ${number}${need ? ` · ${need} ảnh` : ''}`}
    className="ptb-frame-choice" onClick={onPick} disabled={busy}>
    <span className="ptb-frame-art">
      {!failed ? <img src={!fallback && frame.thumb ? frame.thumb : frame.image} alt="" loading="lazy" decoding="async"
        onError={() => { if (!fallback && frame.thumb) setFallback(true); else setFailed(true); }} />
        : <span className="ptb-frame-failed">{frame.name || name}</span>}
      <b>{number}</b>{active && <span className="ptb-frame-check"><PiCheckBold aria-hidden="true" /></span>}
    </span>
    <span className="ptb-frame-caption"><strong>{frame.name || name}</strong>{need > 0 && <small>{need} ảnh</small>}</span>
  </button>;
}

// counter: nhân viên ghép lại ở quầy (Đơn hàng → In ảnh) — cùng màn chọn khung, không đếm giờ.
export function KioskFrames({ frames, needs, index, onPick, onContinue, secondsLeft, busy = false, counter = false }) {
  const t = useKioskText();
  const chosen = frames[index];
  const [fallback, setFallback] = useState('');
  const rail = useRef(null);
  const move = delta => onPick((index + delta + frames.length) % frames.length);
  useEffect(() => {
    const active = rail.current?.querySelector('[aria-checked="true"]');
    if (!active) return;
    const item = active.getBoundingClientRect(), strip = rail.current.getBoundingClientRect();
    if (item.left < strip.left || item.right > strip.right)
      rail.current.scrollBy({ left: item.left + item.width / 2 - strip.left - strip.width / 2 });
  }, [index, chosen]);
  return <section className="kiosk-flow ptb-frames-screen">
    <header className="flow-head">
      <span className="ptb-flow-step">{counter ? 'GHÉP ẢNH TẠI QUẦY · CHỌN KHUNG' : 'BƯỚC 1 / 2 · CHỌN KHUNG'}</span>
      <h1>{counter ? 'Chọn khung để in' : t('select.frameTitle', { s: secondsLeft })}</h1>
      <p>{counter ? 'Chọn khung rồi bấm Tiếp tục để chọn ảnh, chỉnh ảnh, thêm chữ như ở máy chụp.' : t('select.frameSubtitle')}</p>
    </header>
    {chosen ? <>
      <div className="ptb-frame-carousel">
        <button type="button" className="ptb-frame-arrow" aria-label="Khung trước" disabled={busy || frames.length < 2} onClick={() => move(-1)}><PiCaretLeftBold aria-hidden="true" /></button>
        <div className="ptb-frame-feature" aria-live="polite">
          <img src={fallback === chosen._id ? chosen.thumb || chosen.image : chosen.image}
            alt={chosen.name || chosen.themeName || 'Khung đang chọn'} decoding="async"
            onError={() => setFallback(chosen._id)} />
        </div>
        <button type="button" className="ptb-frame-arrow" aria-label="Khung sau" disabled={busy || frames.length < 2} onClick={() => move(1)}><PiCaretRightBold aria-hidden="true" /></button>
      </div>
      <div className="ptb-frame-rail" ref={rail} role="radiogroup" aria-label="Chọn khung"
        onKeyDown={event => {
          if (busy || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
          event.preventDefault();
          const delta = event.key === 'ArrowLeft' ? -1 : 1;
          move(delta);
          rail.current.children[(index + delta + frames.length) % frames.length]?.focus();
        }}>
        {frames.map((frame, i) => <FrameChoice key={frame._id} frame={frame} number={i + 1}
          need={needs[i]} active={i === index} busy={busy} onPick={() => onPick(i)} />)}
      </div>
    </> : <p className="ptb-frames-empty" role="status">Tiệm chưa có khung ảnh. Bấm Tiếp tục để chọn và nhận ảnh đã chụp.</p>}
    <footer className="flow-foot ptb-frames-foot">
      <p>{chosen ? <><strong>{chosen.name || chosen.themeName || 'Khung ảnh'}</strong> · {index + 1}/{frames.length}{needs[index] > 0 && <> · {needs[index]} ảnh</>}</> : 'Ảnh của bạn vẫn được lưu vào album.'}</p>
      <Button className="kiosk-next" disabled={busy} onClick={onContinue}>Tiếp tục <PiArrowRightBold aria-hidden="true" /></Button>
    </footer>
  </section>;
}
