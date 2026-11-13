import { useEffect, useRef, useState } from "react";
import { Monitor } from "lucide-react";
import { api } from "../api";
import { Button } from "../studio";

// Mở nhanh máy chụp của một phòng ngay trên trang Đơn hàng, không phải sang Quản lý máy: lấy liên kết đã ký
// của phòng (cùng API với "Cài máy chụp", quyền rooms:setup) rồi mở máy chụp ở tab mới. Tab mở ngay lúc bấm
// (trình duyệt không chặn cửa sổ bật lên), có liên kết thì chuyển tới.
export function QuickKiosk({ toast }) {
  const [open, setOpen] = useState(false);
  const [rooms, setRooms] = useState(null);
  const [busy, setBusy] = useState("");
  const box = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (event) => {
      if (event.type === "keydown" ? event.key === "Escape" : !box.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  async function toggle() {
    if (open) return setOpen(false);
    setOpen(true);
    try {
      const list = await api("/admin/rooms");
      setRooms(list.filter((room) => room.active !== false));
    } catch (e) {
      setOpen(false);
      toast.error(e.message);
    }
  }
  async function launch(room) {
    const tab = window.open("", "_blank");
    setBusy(room._id);
    try {
      const d = await api(`/admin/rooms/${room._id}/device`, { method: "POST", body: {} });
      const url = `${window.location.origin}/kiosk?device=${encodeURIComponent(d.token)}`;
      if (tab) tab.location.href = url;
      else window.location.assign(url);
      setOpen(false);
    } catch (e) {
      tab?.close();
      toast.error(e.message);
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="quick-kiosk" ref={box}>
      <Button className="outline small" aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
        <Monitor size={15} aria-hidden="true" /> Mở máy chụp
      </Button>
      {open && (
        <div className="quick-kiosk-menu" role="menu" aria-label="Mở máy chụp của phòng">
          {!rooms ? <p role="status">Đang tải danh sách phòng…</p>
            : !rooms.length ? <p>Chưa có phòng nào đang hoạt động.</p>
              : rooms.map((room) => (
                <button key={room._id} type="button" role="menuitem" disabled={busy === room._id} onClick={() => launch(room)}>
                  <strong>{room.name}</strong>
                  <small>
                    {room.kind === "polaroid" ? "Polaroid · Selfbooth" : "Photobooth"}
                    {room.branch ? ` · ${room.branch}` : ""}
                    {busy === room._id ? " · đang mở…" : ""}
                  </small>
                </button>
              ))}
        </div>
      )}
    </div>
  );
}
