import { useEffect, useState } from "react";
import { Button } from "../studio";
import { Guide } from "../guide.jsx";
import { CROP_KEY } from "./live-preview-layout.js";
import {
  billAcceptor,
  BILL_PROTOCOLS,
  billSupported,
  readBillConfig,
  saveBillConfig,
} from "./bill-acceptor.js";

const money = (n) => `${Number(n).toLocaleString("vi-VN")} đ`;
export const BILL_SKETCH_URL = "/downloads/bill-acceptor-pulse.ino";

// Một dòng của bảng tự kiểm tra: ✓ xong · ✗ lỗi · … đang chờ · ○ chưa làm. Luôn có chữ đi kèm dấu.
function Check({ state, children }) {
  const mark = { ok: "✓", fail: "✗", wait: "…", todo: "○" }[state];
  return (
    <li className={`bill-check is-${state}`}>
      <b aria-hidden="true">{mark}</b>
      <span>{children}</span>
    </li>
  );
}

// Lắp máy nhận tiền: 2 cách nối, cách nào cũng chỉ cần bấm "Kết nối máy nhận tiền" ở bước cuối.
const BILL_GUIDE = [
  <>
    <b>Chuẩn bị:</b> máy nhận tiền ICT (A7 / V7) có firmware tiền Việt (polymer) và nguồn 12V ≥ 2A riêng
    cho máy. Cách nối dễ nhất là <b>cáp USB của máy ICT (cổng RS232)</b> — không phải hàn mạch; hỏi nơi bán
    “cáp USB/RS232 cho đầu đọc tiền ICT”. Không có cáp đó thì dùng mạch Arduino Pro Micro (bước 3).
  </>,
  <>
    <b>Cách 1 — cáp USB (RS232):</b> gạt DIP switch của máy ICT sang chế độ <b>RS232 / Serial</b> (xem tem
    hoặc giấy đi kèm máy), cắm nguồn 12V, nối cáp vào máy, đầu USB cắm vào máy tính của phòng chụp. Windows
    tự nhận cổng COM (cáp CH340 đôi khi cần cài driver “CH340” trên mạng).
  </>,
  <>
    <b>Cách 2 — mạch Arduino Pro Micro (xung):</b> gạt DIP switch sang <b>Pulse</b>, mỗi xung 10.000 đ.
    Tải <a href={BILL_SKETCH_URL} download>chương trình cho mạch (bill-acceptor-pulse.ino)</a>, mở bằng
    Arduino IDE → Tools → Board: <b>Arduino Leonardo</b> → Port: cổng của mạch → bấm Upload. Đấu dây:
    <ul className="bill-wiring">
      <li>Nguồn 12V (+) → chân 12V máy ICT. <b>Không</b> nối 12V vào Arduino.</li>
      <li>GND nguồn 12V → GND máy ICT <b>và</b> GND Arduino (nối chung).</li>
      <li>Chân PULSE (xung) máy ICT → chân <b>2</b> Arduino.</li>
      <li>Chân INHIBIT (khóa nhận tiền) máy ICT → chân <b>4</b> Arduino (máy cần 12V thì qua transistor / opto).</li>
    </ul>
    Xong cắm USB của Pro Micro vào máy tính phòng chụp.
  </>,
  <>
    <b>Kết nối:</b> bấm <b>“Kết nối máy nhận tiền”</b> ở trên → chọn đúng cổng trong cửa sổ trình duyệt (tên
    có “Arduino” hoặc “USB-Serial”). Máy chụp tự nhận ra cách nối và lưu lại; lần sau bật máy, rút cắm cáp
    hay mất điện, máy chụp tự mở lại cổng này sau vài giây.
  </>,
  <>
    <b>Thử:</b> bấm “Thử nhận tiền” rồi đút một tờ 10.000 đ. Bảng kiểm tra hiện đủ 4 dấu ✓ là xong. Ngoài lúc
    thử, máy chỉ nhận tiền ở màn trả tiền của khách (các màn khác máy tự trả lại tờ tiền).
  </>,
];

const BILL_TROUBLES = [
  ["Cửa sổ chọn cổng trống / không thấy thiết bị",
    "Đổi cáp USB khác (cáp chỉ để sạc không có dây dữ liệu), cắm cổng USB khác trên máy tính; cáp CH340 thì cài driver CH340 rồi cắm lại."],
  ["“Thiết bị chưa trả lời”",
    "Mạch Arduino: nạp lại chương trình tải ở bước 3 (bản cũ không trả lời lệnh kiểm tra) và chọn đúng cổng của mạch. Cáp RS232: đèn máy ICT phải sáng (đã cắm nguồn 12V), DIP switch đúng RS232; vẫn không được thì mở “Cài đặt nâng cao” đổi Chẵn lẻ rồi Kết nối lại."],
  ["Đút tiền vào máy nhả ra ngay",
    "Máy đang khóa: chỉ nhận ở màn trả tiền hoặc khi bấm “Thử nhận tiền”. Nếu vẫn nhả: tờ tiền nhăn / gấp, hoặc máy chưa nạp firmware tiền Việt (hỏi nơi bán)."],
  ["Nhận sai số tiền (vd. tờ 20.000 đ báo 10.000 đ)",
    "Mạch Arduino: DIP switch “số xung mỗi tờ” của máy phải khớp “1 xung = … đ” ở dòng thứ 3 của bảng kiểm tra. Cáp RS232: mở “Cài đặt nâng cao” sửa mệnh giá từng kênh cho đúng máy."],
  ["Có tiền vào khi chưa tới màn trả tiền",
    "Dây INHIBIT chưa nối hoặc máy dùng mức ngược: trong chương trình đổi INHIBIT_ACTIVE_HIGH (true ↔ false) rồi Upload lại."],
];

export function KioskDevices({ zoom, setZoom, roomInfo, toast }) {
  const [bill, setBill] = useState(readBillConfig);
  const [billStatus, setBillStatus] = useState(billAcceptor.status);
  const [testing, setTesting] = useState(false);
  const [received, setReceived] = useState([]);
  // Kết quả lần hỏi gần nhất: null chưa hỏi · "checking" · true / false.
  const [reply, setReply] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => billAcceptor.onStatus(setBillStatus), []);
  useEffect(() => {
    if (!testing) return;
    billAcceptor.setEnabled(true).catch(() => {});
    const off = billAcceptor.onBill((amount) => setReceived((list) => [amount, ...list].slice(0, 6)));
    return () => { off(); billAcceptor.setEnabled(false).catch(() => {}); };
  }, [testing]);
  // Mở cài đặt khi máy đã kết nối: hỏi thiết bị một lần để bảng kiểm tra đúng tình trạng hiện tại.
  useEffect(() => {
    if (!billAcceptor.connected || billAcceptor.keyboard || billAcceptor.lastReply) return;
    let live = true;
    setReply("checking");
    billAcceptor.check().then((ok) => live && setReply(ok), () => live && setReply(false));
    return () => { live = false; };
  }, []);
  const saveBill = (next) => { setBill(next); saveBillConfig(next); };
  const run = async (action) => {
    setBusy(true);
    try { await action(); }
    catch (e) { if (e.name !== "NotFoundError") toast.error(e.message); }
    finally { setBusy(false); }
  };
  const connectBill = () => run(async () => {
    setTesting(false);
    setReply("checking");
    const found = await billAcceptor.setup().catch((e) => { setReply(null); throw e; });
    setBill(readBillConfig());
    setReply(Boolean(found));
    if (found) toast.success(`Đã kết nối ${BILL_PROTOCOLS[found.protocol]} — bấm “Thử nhận tiền” rồi đút một tờ.`);
    else toast.warning("Đã mở cổng nhưng thiết bị chưa trả lời. Xem “Gỡ lỗi thường gặp” bên dưới.");
  });
  const checkBill = () => run(async () => {
    setReply("checking");
    setReply(await billAcceptor.check());
  });

  const keyboard = bill.protocol === "keyboard";
  const connected = billAcceptor.connected;
  const replied = Boolean(billAcceptor.lastReply);
  const replyState = keyboard ? "todo" : reply === "checking" ? "wait" : replied || reply === true ? "ok"
    : reply === false ? "fail" : "todo";
  return (
    <div className="kiosk-devices">
      <label className="kiosk-range">
        <span>Cắt viền hình trực tiếp <b>{Math.round(zoom * 100)}%</b></span>
        <input type="range" min="0" max="30" value={Math.round(zoom * 100)}
          onChange={(e) => { const value = Number(e.target.value) / 100; setZoom(value); localStorage.setItem(CROP_KEY, String(value)); }} />
        <small>Hãy tắt các thông tin hiển thị trong tín hiệu HDMI của máy ảnh; thanh này chỉ cắt mép.</small>
      </label>
      {roomInfo?.kind !== "selfbooth" && <fieldset className="kiosk-device-box bill-setup">
        <legend>Máy nhận tiền (ICT)</legend>
        <p className="kiosk-device-note">
          Loại phòng:{" "}
          <b>
            Phòng Photobooth
            {roomInfo?.paymentTest ? " · chế độ thử: có nút giả lập đút tiền" : ""}
          </b>{" "}
          — đổi ở Quản trị → Quản lý máy.
        </p>
        <ol className="bill-checks" aria-label="Kiểm tra máy nhận tiền">
          <Check state={billSupported ? "ok" : "fail"}>
            {billSupported
              ? "Trình duyệt đọc được cổng USB (Chrome / Edge)"
              : "Trình duyệt này không đọc được cổng USB — mở máy chụp bằng Chrome hoặc Edge trên máy tính"}
          </Check>
          <Check state={keyboard || connected ? "ok" : "todo"}>
            {keyboard ? "Kiểu giả lập bàn phím — không cần chọn cổng"
              : connected ? <>Đã mở cổng: <b>{billAcceptor.portName || "cổng COM"}</b></>
                : "Chưa kết nối — bấm “Kết nối máy nhận tiền”"}
          </Check>
          <Check state={replyState}>
            {keyboard ? "Kiểu bàn phím không tự kiểm tra được — dùng “Thử nhận tiền”"
              : replyState === "wait" ? "Đang hỏi thiết bị…"
                : replyState === "ok" ? <>
                  {BILL_PROTOCOLS[bill.protocol] || "Thiết bị"} đang trả lời
                  {bill.protocol === "pulse" && billAcceptor.circuitPulse > 0 && <> · mạch tính <b>1 xung = {money(billAcceptor.circuitPulse)}</b></>}
                </>
                  : replyState === "fail" ? "Thiết bị chưa trả lời — xem “Gỡ lỗi thường gặp” bên dưới"
                    : "Chưa hỏi thiết bị"}
          </Check>
          <Check state={received.length ? "ok" : testing ? "wait" : "todo"}>
            {received.length ? <>Đút thử: đã nhận <b>{received.map(money).join(", ")}</b></>
              : testing ? "Mời đút một tờ tiền vào máy…"
                : "Bấm “Thử nhận tiền” rồi đút một tờ"}
          </Check>
        </ol>
        <div className="kiosk-device-row">
          {!keyboard && (
            <Button type="button" className="small" disabled={!billSupported || busy} onClick={connectBill}>
              {connected ? "Kết nối lại / đổi cổng" : "Kết nối máy nhận tiền"}
            </Button>
          )}
          {!keyboard && connected && (
            <Button type="button" className="outline small" disabled={busy} onClick={checkBill}>Kiểm tra lại</Button>
          )}
          <Button type="button" className="outline small" disabled={busy || (!keyboard && !connected)}
            onClick={() => run(async () => {
              await billAcceptor.connect(false);
              setReceived([]);
              setTesting((on) => !on);
            })}>
            {testing ? "Dừng thử" : "Thử nhận tiền"}
          </Button>
        </div>
        <p className="kiosk-device-note" role="status">{billStatus}</p>
        <Guide id="kiosk-bill" dark title="lắp & kết nối máy nhận tiền" steps={BILL_GUIDE}
          note="Máy nhận tiền không trả tiền thừa: khách đút dư thì Đơn hàng hiện “cần thối lại” để nhân viên thối ở quầy." />
        <details className="kiosk-shutter-advanced bill-troubles">
          <summary>Gỡ lỗi thường gặp</summary>
          <dl>
            {BILL_TROUBLES.map(([problem, fix]) => (
              <div key={problem}><dt>{problem}</dt><dd>{fix}</dd></div>
            ))}
          </dl>
        </details>
        <details className="kiosk-shutter-advanced">
          <summary>Cài đặt nâng cao (chọn kiểu nối thủ công)</summary>
          <label>
            Kiểu kết nối
            <select value={bill.protocol} onChange={(e) => saveBill({ ...bill, protocol: e.target.value })}>
              <option value="pulse">Xung qua Arduino Pro Micro — cổng COM</option>
              <option value="ict">RS232 của máy ICT (cáp USB-RS232)</option>
              <option value="keyboard">Xung qua Pro Micro giả lập bàn phím</option>
            </select>
          </label>
          {keyboard && (
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
          {bill.protocol === "ict" && <>
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
            <label>
              Chẵn lẻ (parity) của cổng RS232
              <select value={bill.parity} onChange={(e) => saveBill({ ...bill, parity: e.target.value })}>
                <option value="even">Chẵn — even (mặc định máy ICT)</option>
                <option value="none">Không — none</option>
                <option value="odd">Lẻ — odd</option>
              </select>
            </label>
          </>}
          {!keyboard && (
            <Button type="button" className="outline small" disabled={!billSupported || busy}
              onClick={() => run(async () => {
                await billAcceptor.disconnect();
                await billAcceptor.connect(true);
                toast.success("Đã mở cổng theo kiểu nối đã chọn.");
              })}>
              Chọn cổng (không tự nhận diện)
            </Button>
          )}
        </details>
      </fieldset>}
    </div>
  );
}
