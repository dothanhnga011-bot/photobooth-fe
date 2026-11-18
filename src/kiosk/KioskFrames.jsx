import { useState } from 'react';
import { PiArrowRightBold, PiCheckBold } from 'react-icons/pi';
import { Button } from '../studio.jsx';
import { useKioskText } from './use-kiosk-text.js';
import { useFitGrid } from './use-fit-grid.js';

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

export function KioskFrames({ frames, needs, index, onPick, onContinue, secondsLeft, busy = false }) {
  const t = useKioskText(), [theme, setTheme] = useState('');
  const themeOf = frame => frame.themeName?.trim() || 'Khác';
  const themes = [...new Set(frames.map(themeOf))];
  const shown = frames.map((frame, i) => ({ frame, i })).filter(({ frame }) => !theme || themeOf(frame) === theme);
  const chosen = frames[index];
  const grid = useFitGrid(shown.length, { aspect: .8, frame: 0, min: 120 });
  return <section className="kiosk-flow ptb-frames-screen">
    <header className="flow-head">
      <span className="ptb-flow-step">BƯỚC 1 / 2 · CHỌN KHUNG</span>
      <h1>{t('select.frameTitle', { s: secondsLeft })}</h1>
      <p>{t('select.frameSubtitle')}</p>
    </header>
    {themes.length > 1 && <div className="frame-themes" role="group" aria-label="Chủ đề khung">
      {['', ...themes].map(name => <button key={name || '*'} type="button" aria-pressed={theme === name} disabled={busy} onClick={() => setTheme(name)}>{name || 'Tất cả'}</button>)}
    </div>}
    {frames.length ? <div className={`ptb-frames-grid${grid.fitted ? ' is-fitted' : ''}`} ref={grid.ref} style={grid.style} role="radiogroup" aria-label="Chọn khung">
      {shown.map(({ frame, i }) => <FrameChoice key={frame._id} frame={frame} number={i + 1}
        need={needs[i]} active={i === index} busy={busy} onPick={() => onPick(i)} />)}
    </div> : <p className="ptb-frames-empty" role="status">Tiệm chưa có khung ảnh. Bấm Tiếp tục để chọn và nhận ảnh đã chụp.</p>}
    <footer className="flow-foot ptb-frames-foot">
      <p>{chosen ? <>Đã chọn: <strong>{chosen.name || chosen.themeName || `Khung ${index + 1}`}</strong>{needs[index] > 0 && <> · {needs[index]} ảnh</>}</> : 'Ảnh của bạn vẫn được lưu vào album.'}</p>
      <Button className="kiosk-next" disabled={busy} onClick={onContinue}>Tiếp tục <PiArrowRightBold aria-hidden="true" /></Button>
    </footer>
  </section>;
}
