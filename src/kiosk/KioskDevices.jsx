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
        <small>Hãy tắt các thông tin hiển thị trong tín hiệu HDMI của Fujifilm; thanh này chỉ cắt mép.</small>
      </label>
      <fieldset className="kiosk-device-box">
        <legend>Fujifilm X-T3 / X-S10 / X-S20 · phòng Photobooth & Polaroid · chụp bằng dây bấm</legend>
        <ol className="kiosk-device-steps">
          <li>Đặt IMAGE QUALITY thành FINE hoặc FINE + RAW; X-S20 chọn SELECT JPEG/HEIF → JPEG. Chọn Single shooting, tắt self-timer và AUTO POWER OFF.</li>
          <li>Trên máy ảnh chọn CONNECTION MODE → USB TETHER SHOOTING AUTO. X-S10 cần firmware 2.00 trở lên.</li>
          <li>Cắm USB dữ liệu vào PC; mở FUJIFILM X Acquire và đặt thư mục tải JPEG là C:\PhotoBooth\Fujifilm.</li>
          <li>Dùng dây bấm tương thích RR-100: X-T3 cổng 2,5 mm; X-S10/X-S20 cần đầu chuyển remote 2,5 mm cái → 3,5 mm đực loại 3 cực và chọn REMOTE nếu máy hỏi.</li>
          <li>Trong kiosk, chọn cùng thư mục ảnh ở phía trên. Bấm “Thử nhận ảnh từ máy ảnh”, rồi nhấn dây bấm để kiểm tra JPEG gốc.</li>
        </ol>
        <p className="kiosk-device-note"><a href="https://www.fujifilm-x.com/global/support/download/software/x-acquire/" target="_blank" rel="noreferrer">FUJIFILM X Acquire chính hãng</a> đã cài trên máy kiosk. Chỉ để một chương trình giữ cổng USB máy ảnh. Kiosk tự đọc ảnh sau khi X Acquire tải ảnh xuống.</p>
        <p className="kiosk-device-note">Flash: dùng chế độ chụp ảnh, chọn màn trập và tốc độ đồng bộ phù hợp với X-T3/X-S10/X-S20 cùng bộ flash đang dùng. Thử flash và dây bấm trước khi nhận khách.</p>
        <p className="kiosk-device-note">Hình trực tiếp dùng micro-HDMI → thẻ ghi hình USB. Bấm INFO để kiểm tra hiển thị; nếu vẫn còn ô AF ở chế độ ảnh, có thể dùng MF và chỉnh nét vào vị trí khách đứng. Kiểm tra ảnh thử trước khi đón khách.</p>
      </fieldset>
      )}
      <fieldset className="kiosk-device-box">
        <legend>Máy đọc tiền (ICT)</legend>
        <p className="kiosk-device-note">
          Loại phòng:{" "}
          <b>
            {roomInfo?.kind === "polaroid" ? "Phòng Polaroid (không thu tiền tại máy, máy đọc tiền không dùng)" : "Phòng Photobooth"}
            {roomInfo?.kind !== "polaroid" && roomInfo?.paymentTest ? " · chế độ thử: có nút giả lập đút tiền" : ""}
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
      </fieldset>
    </div>
  );
}
