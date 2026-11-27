// Album Selfbooth — bước 03 Ghép ảnh (cả bộ khung) và 04 Kết quả (chọn tờ muốn in, gửi in).
import {
  PiArrowLeftBold, PiCheckBold, PiPrinterBold, PiPrinterDuotone,
} from "react-icons/pi";
import { assetUrl } from "../../api";
import { Button, useToast } from "../../studio";
import { FrameEditor } from "./FrameEditor.jsx";
import { isFilled } from "./album-helpers.js";

// ─── 03 Ghép ảnh: cả bộ — mọi khung đã có ảnh, chuyển tab để chỉnh (như PackEditor của web Selfbooth) ─────────
export function PackEditor({ token, pack, layouts, index, photos, small, photoOf, adjustOf, frozen, onIndex, onSlots, onReshuffle, onBack, onNext }) {
  const toast = useToast();
  const at = Math.min(index, pack.frames.length - 1);
  const frame = pack.frames[at];
  function next() {
    const empty = pack.frames.findIndex((f) => !isFilled(f, layouts[f._id]));
    if (empty < 0) return onNext();
    onIndex(empty);
    toast.warning(`Khung “${pack.frames[empty].name}” còn ô chưa có ảnh.`);
  }
  return (
    <>
      {pack.frames.length > 1 && (
        <div className="frame-tabs" role="tablist" aria-label="Các khung trong bộ">
          {pack.frames.map((f, i) => (
            <button key={f._id} type="button" role="tab" aria-selected={i === at} aria-label={f.name}
              className={isFilled(f, layouts[f._id]) ? "" : "missing"} onClick={() => onIndex(i)}>
              <img src={assetUrl(f.thumb || f.image)} alt="" />
              <span>{f.name}</span>
            </button>
          ))}
        </div>
      )}
      <FrameEditor key={frame._id} token={token} frame={frame}
        title={pack.frames.length > 1 ? `${frame.name} · ${at + 1}/${pack.frames.length}` : frame.name}
        slots={layouts[frame._id] || []} photos={photos} small={small} photoOf={photoOf} adjustOf={adjustOf} frozen={frozen}
        onSlots={(slots) => onSlots(frame._id, slots)} onReshuffle={onReshuffle} onBack={onBack} onNext={next} />
    </>
  );
}

// ─── 04 Kết quả: mỗi khung một tờ 20 × 30, chọn tờ muốn in ─────────────────────
export function Result({ sheets, error, waiting, picked, remaining, quota, printing, failed, unit, word, onToggle, onPrint, onBack, onRetry }) {
  const overQuota = picked.size > remaining;
  return (
    <>
      <div className="studio-head result-head">
        <div>
          <h2>Thành phẩm của bạn</h2>
          <p>{sheets.length && remaining > 0 ? `Chọn ${word} bạn muốn in, rồi bấm Gửi in.` : "Xem ảnh ghép trước khi gửi đến quầy."}</p>
        </div>
      </div>
      <p className={`print-quota ${remaining ? "" : "empty"}`} role="status">
        <PiPrinterDuotone aria-hidden="true" />
        <span>
          <b>{remaining ? `Vé còn ${remaining}/${quota} ${unit} cm` : "Vé đã dùng hết số tờ in"}</b>
          <small>{!remaining ? "Bạn có thể mua thêm tờ in tại quầy."
            : overQuota ? `Bỏ chọn ${picked.size - remaining} ${word} để gửi in.` : `Đã chọn ${picked.size} ${word}`}</small>
        </span>
      </p>
      {error && (
        <div className="error-box" role="alert">
          <p>{error}</p>
          <Button className="outline" onClick={onRetry}>Thử lại</Button>
        </div>
      )}
      {!sheets.length && !error && <p className="empty-state" role="status">
        {waiting ? "Ảnh gốc đang tải lên. Bản in sẽ tự xuất hiện khi ảnh đã sẵn sàng." : "Đang chuẩn bị ảnh in chất lượng cao…"}
      </p>}
      <div className="sheet-strip">
        {sheets.map((s, i) => (
          <figure key={s.frameId} className={picked.has(i) ? "is-picked" : "is-skipped"}>
            <button type="button" aria-pressed={picked.has(i)} aria-label={`Tấm in ${i + 1}: ${s.name}`}
              disabled={printing || failed || (!remaining && !picked.has(i))} onClick={() => onToggle(i)}>
              <img src={s.preview} alt={`Tấm in ${i + 1}`} />
              <span className="sheet-pick">{picked.has(i) ? <><PiCheckBold aria-hidden="true" /> Đã chọn</> : remaining ? "Chọn để in" : "Xem trước"}</span>
            </button>
            <figcaption>{s.name}</figcaption>
          </figure>
        ))}
      </div>
      <div className="studio-actions">
        <Button className="outline" disabled={printing} onClick={onBack}><PiArrowLeftBold aria-hidden="true" /> Sửa khung</Button>
        <Button disabled={printing || failed || overQuota || !picked.size || !sheets.length} onClick={onPrint}>
          <PiPrinterBold aria-hidden="true" /> {printing ? "Đang gửi in…" : `Gửi in (${picked.size} ${word})`}
        </Button>
      </div>
    </>
  );
}
