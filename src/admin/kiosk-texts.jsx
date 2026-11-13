import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { api } from "../api";
import { Button, ErrorBox, useStudio, useToast } from "../studio";
import { KIOSK_TEXT_GROUPS } from "../kiosk/kiosk-texts.js";

// Thời gian khách chọn ảnh & trang trí sau khi chụp xong (giây): máy chụp phòng PTB và điện thoại khách phòng
// Selfbooth cùng đọc settings.selectSeconds. Chưa đặt: 250 giây.
const SELECT_DEFAULT = 250;
const SELECT_PRESETS = [120, 180, 240, 250, 300, 400];
const duration = (seconds) => {
  const minutes = Math.floor(seconds / 60), rest = seconds % 60;
  return [minutes && `${minutes} phút`, rest && `${rest} giây`].filter(Boolean).join(" ");
};
function SelectTime({ notify }) {
  const toast = useToast();
  const { reload } = useStudio();
  const [saved, setSaved] = useState(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api("/admin/settings").then((settings) => {
      const seconds = Number(settings.selectSeconds) || SELECT_DEFAULT;
      setSaved(seconds);
      setValue(String(seconds));
    }, () => { setSaved(SELECT_DEFAULT); setValue(String(SELECT_DEFAULT)); });
  }, []);
  const seconds = Number(value);
  const valid = Number.isInteger(seconds) && seconds >= 30 && seconds <= 900;
  async function save() {
    setBusy(true);
    try {
      const result = await api("/admin/settings/select-time", { method: "PUT", body: { selectSeconds: seconds } });
      setSaved(result.selectSeconds);
      setValue(String(result.selectSeconds));
      reload?.();
      notify(`Đã lưu thời gian chọn ảnh: ${duration(result.selectSeconds)}. Áp dụng từ lượt chụp xong tiếp theo (máy chụp nhận trong tối đa 1 phút).`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel kiosk-content-section select-time" aria-label="Thời gian chọn ảnh">
      <h3>Thời gian chọn ảnh</h3>
      <p className="muted">Chụp xong, khách có bấy nhiêu thời gian để chọn ảnh, khung và trang trí: ở máy chụp phòng PTB, và trên điện thoại sau khi quét QR ở phòng Selfbooth. Hết giờ thì tự chốt các ảnh đang chọn.</p>
      {saved === null ? <p className="muted">Đang tải…</p> : (
        <>
          <div className="select-time-row">
            <label className="kiosk-text-field">
              <span>Số giây (30–900)</span>
              <input type="number" name="selectSeconds" min={30} max={900} step={5} inputMode="numeric"
                value={value} onChange={(e) => setValue(e.target.value)} />
            </label>
            <div className="select-time-presets" role="group" aria-label="Chọn nhanh thời gian">
              {SELECT_PRESETS.map((preset) => (
                <button key={preset} type="button" aria-pressed={seconds === preset} onClick={() => setValue(String(preset))}>
                  {duration(preset)}
                </button>
              ))}
            </div>
            <Button disabled={busy || !valid || seconds === saved} onClick={save}>{busy ? "Đang lưu…" : "Lưu thời gian"}</Button>
          </div>
          <small className={valid ? "muted" : "field-error"} role="status">
            {valid ? `= ${duration(seconds)} · đang dùng: ${duration(saved)}` : "Nhập số giây từ 30 đến 900."}
          </small>
        </>
      )}
    </section>
  );
}

// Thiết lập → Chữ trên máy chụp: thời gian chọn ảnh và mọi dòng chữ chính trên màn hình máy chụp
// (photobooth và Polaroid). Ô để trống = dùng chữ mặc định (hiện mờ trong ô). {n}, {s}: chỗ máy chụp điền số.
export function KioskTextsManager({ notify }) {
  const toast = useToast();
  const { reload } = useStudio();
  const [texts, setTexts] = useState(null);
  const [saved, setSaved] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/admin/settings").then(
      (value) => {
        setTexts(value.kioskTexts || {});
        setSaved(value.kioskTexts || {});
      },
      (e) => setError(e.message),
    );
  }, []);
  const changed = texts && JSON.stringify(texts) !== JSON.stringify(saved);
  async function save() {
    setBusy(true);
    try {
      const clean = Object.fromEntries(Object.entries(texts).map(([key, text]) => [key, text.trim()]).filter(([, text]) => text));
      const value = await api("/admin/settings/kiosk-texts", { method: "PUT", body: { kioskTexts: clean } });
      setTexts(value.kioskTexts || {});
      setSaved(value.kioskTexts || {});
      reload?.();
      notify("Đã lưu chữ trên máy chụp. Máy chụp nhận chữ mới khi tải lại danh mục (tối đa 1 phút).");
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="kiosk-content kiosk-texts">
      <SelectTime notify={notify} />
      <ErrorBox error={error} />
      {!texts ? (
        <p className="muted">Đang tải…</p>
      ) : (
        <>
          {KIOSK_TEXT_GROUPS.map(([group, rows]) => (
            <section key={group} className="panel kiosk-content-section" aria-label={group}>
              <h3>{group}</h3>
              <div className="kiosk-text-fields">
                {rows.map(([key, label, fallback]) => (
                  <label key={key} className="kiosk-text-field">
                    <span>{label}</span>
                    <div>
                      <input
                        name={key}
                        maxLength={200}
                        placeholder={fallback}
                        value={texts[key] || ""}
                        onChange={(e) => setTexts({ ...texts, [key]: e.target.value })}
                      />
                      {texts[key] && (
                        <button type="button" className="icon-button" aria-label={`Dùng chữ mặc định: ${label}`}
                          title="Dùng chữ mặc định" onClick={() => setTexts({ ...texts, [key]: "" })}>
                          <RotateCcw size={15} />
                        </button>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </section>
          ))}
          <div className="kiosk-texts-save">
            <Button disabled={busy || !changed} onClick={save}>{busy ? "Đang lưu…" : "Lưu chữ trên máy chụp"}</Button>
            <small className="muted">Ô để trống dùng chữ mặc định (chữ mờ trong ô).</small>
          </div>
        </>
      )}
    </div>
  );
}
