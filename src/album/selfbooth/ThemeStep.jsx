// Album Selfbooth — bước 02 Chủ đề: chọn một bộ khung; hỏi khi chưa đủ ảnh yêu thích.
import {
  PiArrowLeftBold, PiArrowRightBold, PiCheckBold, PiHeartDuotone, PiHeartFill, PiImagesDuotone, PiStackDuotone, PiXBold,
} from "react-icons/pi";
import { assetUrl } from "../../api";
import { Button } from "../../studio";
import { capacityOf } from "./album-helpers.js";

// ─── 02 Chủ đề: chọn một bộ khung ───────────────────────────────────────────────────────────────────────
export function ThemePicker({ packs, selected, favorites, frozen, unit, onSelect, onBack, onNext }) {
  const pack = packs.find((p) => p.id === selected);
  const capacity = capacityOf(pack);
  const missing = pack ? Math.max(0, capacity - favorites) : 0;
  return (
    <>
      <div className="studio-head theme-catalog-head">
        <div>
          <h2>Chọn bộ khung</h2>
          <p>Chọn một bộ bạn thích. Mỗi khung là một {unit} cm.</p>
        </div>
        <span className="theme-total">{packs.length} bộ khung</span>
      </div>
      <div className={`theme-catalog${packs.length === 1 ? " is-single" : ""}`}>
        {packs.map((p) => (
          <button key={p.id} type="button" className={p.id === selected ? "active" : ""} aria-pressed={p.id === selected}
            disabled={frozen} aria-label={`Chọn bộ ${p.name}, ${p.frames.length} khung, ${capacityOf(p)} ô ảnh`}
            onClick={() => onSelect(p.id)}>
            <span className="theme-big-preview" aria-hidden="true" style={{
              "--preview-columns": Math.min(3, p.frames.length),
              "--preview-rows": Math.ceil(p.frames.length / 3),
            }}>
              {p.frames.map((f, index) => (
                <span className="theme-preview-frame" key={f._id}>
                  <img src={assetUrl(f.thumb || f.image)} alt="" loading={p === packs[0] && index === 0 ? "eager" : "lazy"} decoding="async" />
                </span>
              ))}
            </span>
            <span className="theme-list-info">
              <span className="theme-card-title">
                <strong>{p.name}</strong>
                {p.id === selected && <span className="theme-choice"><PiCheckBold aria-hidden="true" /> Đã chọn</span>}
              </span>
              <span className="theme-card-meta">
                <span><PiStackDuotone aria-hidden="true" /> {p.frames.length} khung</span>
                <span><PiImagesDuotone aria-hidden="true" /> {capacityOf(p)} ô ảnh</span>
              </span>
            </span>
          </button>
        ))}
      </div>
      {!packs.length && <div className="empty-state">Studio chưa có bộ khung in {unit}. Vui lòng liên hệ lễ tân.</div>}
      <div className="studio-actions theme-action-bar">
        <Button className="outline" onClick={onBack}><PiArrowLeftBold aria-hidden="true" /> Quay lại</Button>
        <span className="theme-action-summary" role="status">
          {pack && <PiHeartFill aria-hidden="true" />}
          {pack ? (missing ? `Còn thiếu ${missing} ảnh yêu thích. Bạn có thể ghép tự động.`
            : "Đủ ảnh yêu thích để ghép.") : packs.length > 0 ? "Chạm vào một bộ khung để tiếp tục." : ""}
        </span>
        <Button disabled={!pack || !capacity || frozen} onClick={onNext}>Ghép ảnh <PiArrowRightBold aria-hidden="true" /></Button>
      </div>
    </>
  );
}

export function ShortageDialog({ pack, required, favorites, totalPhotos, onMore, onAutomatic, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal favorite-shortage" role="dialog" aria-modal="true" aria-label="Chưa đủ ảnh yêu thích"
        onClick={(e) => e.stopPropagation()}>
        <button type="button" className="icon-button modal-close" aria-label="Đóng" onClick={onClose}><PiXBold /></button>
        <span className="favorite-shortage-icon" aria-hidden="true"><PiHeartDuotone /></span>
        <h2>Chưa đủ ảnh yêu thích</h2>
        <p>Bộ “{pack.name}” có {required} ô. Bạn đã thích {favorites} ảnh.</p>
        <p>
          {totalPhotos < required
            ? `Thư viện có ${totalPhotos} ảnh cho ${required} ô. Tự động ghép sẽ dùng lại một số ảnh để lấp đầy các ô.`
            : "Ghép tự động sẽ dùng ảnh bạn thích trước và lấy thêm ảnh từ thư viện."}
        </p>
        <div className="favorite-shortage-actions">
          <Button onClick={onAutomatic} disabled={!totalPhotos}>Tự động ghép</Button>
          <Button className="outline" onClick={onMore} autoFocus>Chọn thêm ảnh</Button>
        </div>
      </section>
    </div>
  );
}
