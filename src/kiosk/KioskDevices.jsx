import { useEffect, useState } from "react";
import { Button } from "../studio";
import { CROP_KEY } from "./live-preview-layout.js";
import { billAcceptor, billSupported } from "./bill-acceptor.js";

const money = (n) => `${Number(n).toLocaleString("vi-VN")} đ`;

// Máy nhận tiền ở máy chụp: chỉ trạng thái và thử nhanh. Kết nối, tự kiểm tra, hướng dẫn lắp và gỡ lỗi nằm ở
// Quản trị → Thiết lập → Máy nhận tiền (mở trên chính máy tính này; máy chụp dùng lại cổng chọn ở đó).
export function KioskDevices({ zoom, setZoom, roomInfo }) {
  const [billStatus, setBillStatus] = useState(billAcceptor.status);
  const [testing, setTesting] = useState(false);
  const [received, setReceived] = useState([]);
  useEffect(() => billAcceptor.onStatus(setBillStatus), []);
  useEffect(() => {
    if (!testing) return;
    billAcceptor.setEnabled(true).catch(() => {});
    const off = billAcceptor.onBill((amount) => setReceived((list) => [amount, ...list].slice(0, 6)));
    return () => { off(); billAcceptor.setEnabled(false).catch(() => {}); };
  }, [testing]);
  const connected = billAcceptor.connected;
  return (
    <div className="kiosk-devices">
      <label className="kiosk-range">
        <span>Cắt viền hình trực tiếp <b>{Math.round(zoom * 100)}%</b></span>
        <input type="range" min="0" max="30" value={Math.round(zoom * 100)}
          onChange={(e) => { const value = Number(e.target.value) / 100; setZoom(value); localStorage.setItem(CROP_KEY, String(value)); }} />
        <small>Hãy tắt các thông tin hiển thị trong tín hiệu HDMI của máy ảnh; thanh này chỉ cắt mép.</small>
      </label>
      {roomInfo?.kind !== "selfbooth" && <fieldset className="kiosk-device-box bill-kiosk">
        <legend>Máy nhận tiền (ICT)</legend>
        <p className="kiosk-device-note">
          Loại phòng:{" "}
          <b>
            Phòng Photobooth
            {roomInfo?.paymentTest ? " · chế độ thử: có nút giả lập đút tiền" : ""}
          </b>{" "}
          — đổi ở Quản trị → Quản lý máy.
        </p>
        <p className={`bill-kiosk-status${connected ? " is-ok" : ""}`} role="status">
          {connected
            ? <>Đã kết nối{billAcceptor.portName ? <> · <b>{billAcceptor.portName}</b></> : ""} · {billStatus}</>
            : billSupported ? `Chưa kết nối · ${billStatus}` : "Trình duyệt này không đọc được cổng USB — mở máy chụp bằng Chrome / Edge."}
          {testing && (received.length ? ` · vừa nhận: ${received.map(money).join(", ")}` : " · mời đút thử một tờ tiền")}
        </p>
        {connected && (
          <Button type="button" className="outline small" onClick={() => { setReceived([]); setTesting((on) => !on); }}>
            {testing ? "Dừng thử" : "Thử nhận tiền"}
          </Button>
        )}
        <p className="kiosk-device-note">
          Kết nối, kiểm tra, hướng dẫn lắp và gỡ lỗi: <b>Quản trị → Thiết lập → Máy nhận tiền</b> — mở trên chính máy tính
          này (đóng tab máy chụp trong lúc kết nối). Máy chụp tự mở lại cổng đã chọn sau vài giây.
        </p>
      </fieldset>}
    </div>
  );
}
