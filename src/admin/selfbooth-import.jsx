import { useEffect, useMemo, useState } from "react";
import { Check, CloudDownload, X } from "lucide-react";
import { api } from "../api";
import { Button, ErrorBox } from "../studio";

// Khung ảnh → "Chép khung từ Selfbooth": danh sách khung đang có trên web Selfbooth của tiệm, chọn khung
// rồi chép sang làm khung Instax của phòng Polaroid (giữ ảnh, chủ đề và các ô, cả ô nghiêng). Khung đã
// chép rồi thì không chép lại.
export function SelfboothImport({ onClose, onDone }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api("/admin/selfbooth-frames", { timeout: 120000 }).then((data) => {
      setList(data.frames);
      setPicked(new Set(data.frames.filter((f) => !f.copied).map((f) => f.id)));
    }, (e) => setError(e.message));
  }, []);
  // Gom theo chủ đề như bên Selfbooth.
  const groups = useMemo(() => {
    const map = new Map();
    for (const frame of list || []) {
      const key = frame.themeName || "Khung lẻ";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(frame);
    }
    return [...map.entries()];
  }, [list]);
  const toggle = (id) => setPicked((old) => {
    const next = new Set(old);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  async function copy() {
    if (!picked.size || busy) return;
    setBusy(true);
    setError("");
    try {
      onDone(await api("/admin/selfbooth-frames", { method: "POST", body: { ids: [...picked] }, timeout: 300000 }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section className="modal selfbooth-import" role="dialog" aria-modal="true" aria-label="Chép khung từ Selfbooth">
        <div className="modal-header">
          <h2>Chép khung từ Selfbooth</h2>
          <button type="button" className="icon-button" aria-label="Đóng" onClick={onClose} disabled={busy}><X /></button>
        </div>
        <p className="muted">
          Khung chép sang dùng cho phòng Polaroid (in máy Instax Wide, khung dọc tự xoay cho vừa tấm), giữ nguyên ảnh,
          chủ đề và các ô ảnh. Sau khi chép vẫn sửa / tắt được ở Khung ảnh.
        </p>
        <ErrorBox error={error} />
        {!list && !error && (
          <p className="muted" role="status">Đang đọc khung trên web Selfbooth… (máy chủ Selfbooth đang nghỉ thì mất khoảng 1 phút)</p>
        )}
        {list && !list.length && <p className="muted">Web Selfbooth chưa có khung nào đang bật.</p>}
        <div className="selfbooth-import-groups">
          {groups.map(([theme, frames]) => (
            <fieldset key={theme}>
              <legend>{theme}</legend>
              <div className="selfbooth-import-grid">
                {frames.map((frame) => (
                  <label key={frame.id} className={`selfbooth-import-card${frame.copied ? " is-copied" : ""}`}>
                    <input type="checkbox" checked={picked.has(frame.id)} disabled={frame.copied || busy}
                      onChange={() => toggle(frame.id)} aria-label={`Chép khung ${frame.name}`} />
                    <img src={frame.preview} alt="" loading="lazy" />
                    <strong>{frame.name}</strong>
                    <small>
                      {frame.slots} ô ảnh{frame.angled ? " · có ô nghiêng" : ""}
                      {frame.copied && <> · <Check size={12} aria-hidden="true" /> đã chép</>}
                    </small>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        <div className="resource-editor-footer">
          <span className="muted">{list ? `Chọn ${picked.size}/${list.filter((f) => !f.copied).length} khung chưa chép` : ""}</span>
          <div>
            <Button type="button" className="outline" onClick={onClose} disabled={busy}>Huỷ</Button>
            <Button onClick={copy} disabled={busy || !picked.size}>
              <CloudDownload size={16} aria-hidden="true" /> {busy ? "Đang chép…" : `Chép ${picked.size} khung`}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
