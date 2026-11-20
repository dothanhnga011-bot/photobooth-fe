import { useEffect, useState } from "react";
import { ExternalLink, Monitor } from "lucide-react";
import { api } from "../api";

// Hàng "Mở máy chụp" dưới thanh tìm đơn (như trang Mã chụp của web Selfbooth): mỗi phòng đang hoạt động một
// thẻ (tên phòng, chi nhánh · loại phòng), bấm là mở máy chụp của phòng ở tab mới, không phải sang Quản lý
// máy. Liên kết đã ký lấy lúc bấm (cùng API với "Cài máy chụp", quyền rooms:setup); tab mở ngay lúc bấm nên
// trình duyệt không chặn cửa sổ bật lên, có liên kết thì chuyển tới.
const byName = (a, b) => String(a.name).localeCompare(String(b.name), "vi", { numeric: true });

export function QuickKiosk({ toast }) {
  const [rooms, setRooms] = useState(null);
  const [busy, setBusy] = useState("");
  useEffect(() => {
    let alive = true;
    api("/admin/rooms").then(
      (list) => alive && setRooms(list.filter((room) => room.active !== false).sort(byName)),
      () => alive && setRooms([]),
    );
    return () => { alive = false; };
  }, []);
  async function launch(room) {
    const tab = window.open("", "_blank");
    setBusy(room._id);
    try {
      const d = await api(`/admin/rooms/${room._id}/device`, { method: "POST", body: {} });
      const url = `${window.location.origin}/kiosk?device=${encodeURIComponent(d.token)}`;
      if (tab) tab.location.href = url;
      else window.location.assign(url);
    } catch (e) {
      tab?.close();
      toast.error(e.message);
    } finally {
      setBusy("");
    }
  }
  if (!rooms?.length) return null;
  return (
    <nav className="quick-kiosk" aria-label="Mở máy chụp">
      <span className="quick-kiosk-label">
        <Monitor size={19} aria-hidden="true" /> Mở máy chụp
      </span>
      <div className="quick-kiosk-rooms">
        {rooms.map((room) => (
          <button key={room._id} type="button" className="quick-kiosk-room" disabled={busy === room._id}
            title={`Mở máy chụp ${room.name} ở tab mới`} onClick={() => launch(room)}>
            <span className="quick-kiosk-name">
              <b>{room.name}</b>
              <small>
                {[room.branch, room.kind === "polaroid" ? "Selfbooth" : "Photobooth"].filter(Boolean).join(" · ")}
                {busy === room._id ? " · đang mở…" : ""}
              </small>
            </span>
            <ExternalLink size={17} aria-hidden="true" />
          </button>
        ))}
      </div>
    </nav>
  );
}
