import { useEffect, useState } from "react";
import { Button } from "../studio";
import { CROP_KEY } from "./live-preview-layout.js";
import { billAcceptor, billSupported, readBillConfig, saveBillConfig } from "./bill-acceptor.js";

const money = (n) => `${Number(n).toLocaleString("vi-VN")} đ`;

export function KioskDevices({ zoom, setZoom, roomInfo, toast }) {
  const [bill, setBill] = useState(readBillConfig);
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
  const saveBill = (next) => { setBill(next); saveBillConfig(next); };
  const run = async (action, success) => {
    try { await action(); if (success) toast.success(success); }
    catch (e) { if (e.name !== "NotFoundError") toast.error(e.message); }
  };
  return (
    <div className="kiosk-devices">
      <label className="kiosk-range">
        <span>Cắt viền hình trực tiếp <b>{Math.round(zoom * 100)}%</b></span>
        <input type="range" min="0" max="30" value={Math.round(zoom * 100)}
          onChange={(e) => { const value = Number(e.target.value) / 100; setZoom(value); localStorage.setItem(CROP_KEY, String(value)); }} />
        <small>Hãy tắt các thông tin hiển thị trong tín hiệu HDMI của máy ảnh; thanh này chỉ cắt mép.</small>
      </label>
      {roomInfo?.kind !== "polaroid" && <fieldset className="kiosk-device-box">
        <legend>Máy đọc tiền (ICT)</legend>
        <p className="kiosk-device-note">
          Loại phòng:{" "}
          <b>
            Phòng Photobooth
            {roomInfo?.paymentTest ? " · chế độ thử: có nút giả lập đút tiền" : ""}
          </b>{" "}
          — đổi ở Quản trị → Quản lý máy.
        </p>
        <label>
          Kiểu kết nối
          <select value={bill.protocol} onChange={(e) => saveBill({ ...bill, protocol: e.target.value })}>
            <option value="pulse">Xung qua Arduino Pro Micro — cổng COM (khuyên dùng)</option>
            <option value="keyboard">Xung qua Pro Micro giả lập bàn phím</option>
            <option value="ict">RS232 của máy ICT (cáp USB-RS232)</option>
          </select>
        </label>
        {bill.protocol === "keyboard" && (
          <div className="kiosk-device-row">
            <label>
              Phím mạch gõ mỗi xung
              <input maxLength={1} value={bill.key} onChange={(e) => saveBill({ ...bill, key: e.target.value || "1" })} />
            </label>
            <label>
              Mỗi xung (đ)
              <input type="number" step="1000" min="1000" value={bill.pulseValue}
                onChange={(e) => saveBill({ ...bill, pulseValue: Number(e.target.value) || 10000 })} />
            </label>
          </div>
        )}
        {bill.protocol === "ict" && (
          <label>
            Mệnh giá kênh 1, 2, 3… (đ, cách nhau dấu phẩy)
            <input
              value={bill.channels.join(", ")}
              onChange={(e) => saveBill({
                ...bill,
                channels: e.target.value.split(/[,\s]+/).map(Number).filter((n) => n > 0),
              })}
            />
          </label>
        )}
        <div className="kiosk-device-row">
          {bill.protocol !== "keyboard" && (
            <Button type="button" className="outline small" disabled={!billSupported}
              onClick={() => run(async () => {
                await billAcceptor.disconnect();
                await billAcceptor.connect(true);
              }, "Đã kết nối máy đọc tiền.")}>
              Chọn cổng máy đọc tiền
            </Button>
          )}
          <Button type="button" className="outline small"
            onClick={() => run(async () => {
              await billAcceptor.connect(false);
              setReceived([]);
              setTesting((on) => !on);
            })}>
            {testing ? "Dừng thử" : "Thử nhận tiền"}
          </Button>
        </div>
        <p className="kiosk-device-note" role="status">
          {billStatus}
          {testing && (received.length ? ` · vừa nhận: ${received.map(money).join(", ")}` : " · mời đút thử một tờ tiền")}
        </p>
      </fieldset>}
    </div>
  );
}
