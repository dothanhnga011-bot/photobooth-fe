import { useEffect, useState } from "react";
import { Cable, Download, LifeBuoy, ListChecks, Wrench } from "lucide-react";
import { Button } from "../studio.jsx";
import {
  billAcceptor,
  BILL_PROTOCOLS,
  billSupported,
  readBillConfig,
  saveBillConfig,
  savedBillPortName,
} from "../kiosk/bill-acceptor.js";
import "./bill-acceptor.css";

// Thiết lập → Máy nhận tiền. Máy nhận tiền cắm vào máy tính của phòng chụp và trình duyệt đọc nó qua
// Web Serial, nên trang này phải mở TRÊN CHÍNH MÁY TÍNH ĐÓ, cùng địa chỉ web với máy chụp: trình duyệt nhớ
// cổng đã cho phép và cài đặt (localStorage) theo địa chỉ web, máy chụp dùng lại đúng như vậy. Một cổng chỉ
// một tab mở được: rời trang này là cổng được trả lại cho tab máy chụp (nó tự mở lại sau vài giây).

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
    <b>Kết nối:</b> trên máy tính phòng chụp, đăng nhập quản trị, mở trang này rồi bấm <b>“Kết nối máy nhận
    tiền”</b> → chọn đúng cổng trong cửa sổ trình duyệt (tên có “Arduino” hoặc “USB-Serial”). Trang tự nhận ra
    cách nối và lưu lại; máy chụp trên máy tính này dùng lại cổng đó, tự mở lại khi bật máy, rút cắm cáp hay mất điện.
  </>,
  <>
    <b>Thử:</b> bấm “Thử nhận tiền” rồi đút một tờ 10.000 đ. Bảng kiểm tra hiện đủ 4 dấu ✓ là xong — rời trang
    này, mở lại tab máy chụp. Ngoài lúc thử, máy chỉ nhận tiền ở màn trả tiền của khách (các màn khác máy tự
    trả lại tờ tiền).
  </>,
];

const BILL_TROUBLES = [
  ["“Cổng đang được tab máy chụp dùng”",
    "Máy chụp đang mở trên máy tính này và giữ cổng. Đóng tab máy chụp (hoặc trình duyệt khác đang mở máy chụp) rồi bấm Kết nối lại; thử xong rời trang này và mở lại máy chụp."],
  ["Cửa sổ chọn cổng trống / không thấy thiết bị",
    "Đổi cáp USB khác (cáp chỉ để sạc không có dây dữ liệu), cắm cổng USB khác trên máy tính; cáp CH340 thì cài driver CH340 rồi cắm lại. Trang này phải mở trên chính máy tính cắm máy nhận tiền."],
  ["“Thiết bị chưa trả lời”",
    "Mạch Arduino: nạp lại chương trình tải ở bước 3 (bản cũ không trả lời lệnh kiểm tra) và chọn đúng cổng của mạch. Cáp RS232: đèn máy ICT phải sáng (đã cắm nguồn 12V), DIP switch đúng RS232; vẫn không được thì mở “Cài đặt nâng cao” đổi Chẵn lẻ rồi Kết nối lại."],
  ["Đút tiền vào máy nhả ra ngay",
    "Máy đang khóa: chỉ nhận ở màn trả tiền hoặc khi bấm “Thử nhận tiền”. Nếu vẫn nhả: tờ tiền nhăn / gấp, hoặc máy chưa nạp firmware tiền Việt (hỏi nơi bán)."],
  ["Nhận sai số tiền (vd. tờ 20.000 đ báo 10.000 đ)",
    "Mạch Arduino: DIP switch “số xung mỗi tờ” của máy phải khớp “1 xung = … đ” ở dòng thứ 3 của bảng kiểm tra. Cáp RS232: mở “Cài đặt nâng cao” sửa mệnh giá từng kênh cho đúng máy."],
  ["Có tiền vào khi chưa tới màn trả tiền",
    "Dây INHIBIT chưa nối hoặc máy dùng mức ngược: trong chương trình đổi INHIBIT_ACTIVE_HIGH (true ↔ false) rồi Upload lại."],
  ["Máy chụp mở trên máy tính khác / địa chỉ khác",
    "Trình duyệt nhớ cổng và cài đặt theo từng máy tính và từng địa chỉ web. Làm lại các bước trên máy tính đó, mở trang quản trị bằng đúng địa chỉ của máy chụp."],
];

export function BillAcceptorManager({ notify }) {
  const [bill, setBill] = useState(readBillConfig);
  const [status, setStatus] = useState(billAcceptor.status);
  const [savedPort, setSavedPort] = useState("");
  const [testing, setTesting] = useState(false);
  const [received, setReceived] = useState([]);
  // Kết quả lần hỏi gần nhất: null chưa hỏi · "checking" · true / false.
  const [reply, setReply] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => billAcceptor.onStatus(setStatus), []);
  // Mở trang: thử mở lại cổng đã lưu và hỏi thiết bị. Rời trang: trả cổng cho tab máy chụp.
  useEffect(() => {
    let live = true;
    savedBillPortName().then((name) => live && setSavedPort(name));
    if (billSupported && readBillConfig().protocol !== "keyboard") {
      billAcceptor.connect(false).then(async (opened) => {
        if (!live || !opened) return;
        setReply("checking");
        const ok = await billAcceptor.check().catch(() => false);
        if (live) setReply(ok);
      }, (cause) => live && setError(cause.message));
    }
    return () => {
      live = false;
      billAcceptor.setEnabled(false).catch(() => {});
      billAcceptor.disconnect().catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (!testing) return;
    billAcceptor.setEnabled(true).catch(() => {});
    const off = billAcceptor.onBill((amount) => setReceived((list) => [amount, ...list].slice(0, 6)));
    return () => { off(); billAcceptor.setEnabled(false).catch(() => {}); };
  }, [testing]);
  const saveBill = (next) => { setBill(next); saveBillConfig(next); };
  const run = async (action) => {
    setBusy(true);
    setError("");
    try { await action(); }
    catch (e) { if (e.name !== "NotFoundError") setError(e.message); }
    finally { setBusy(false); }
  };
  const connectBill = () => run(async () => {
    setTesting(false);
    setReply("checking");
    const found = await billAcceptor.setup().catch((e) => { setReply(null); throw e; });
    setBill(readBillConfig());
    setSavedPort(billAcceptor.portName);
    setReply(Boolean(found));
    if (found) notify?.(`Đã kết nối ${BILL_PROTOCOLS[found.protocol]} — bấm “Thử nhận tiền” rồi đút một tờ.`);
    else setError("Đã mở cổng nhưng thiết bị chưa trả lời. Xem “Gỡ lỗi thường gặp” bên dưới.");
  });
  const checkBill = () => run(async () => {
    setReply("checking");
    setReply(await billAcceptor.check());
  });

  const keyboard = bill.protocol === "keyboard";
  // Kiểu bàn phím không cần cổng; kiểu cổng COM: trang này đang mở cổng.
  const connected = keyboard || Boolean(billAcceptor.port?.readable);
  const replyState = keyboard ? "todo" : reply === "checking" ? "wait" : reply === true || (connected && billAcceptor.lastReply)
    ? "ok" : reply === false ? "fail" : "todo";
  return (
    <div className="bill-page">
      <section className="bill-panel bill-connect" aria-labelledby="bill-connect-title">
        <h3 id="bill-connect-title"><Cable size={18} aria-hidden="true" /> Kết nối trên máy tính này</h3>
        <p className="bill-where">
          Mở trang này <b>trên chính máy tính của phòng chụp</b> (máy cắm máy nhận tiền), bằng Chrome / Edge và cùng địa chỉ
          web với máy chụp (<b>{typeof location !== "undefined" ? location.host : ""}</b>): máy chụp dùng lại cổng và cài đặt chọn
          ở đây. Đóng tab máy chụp trước khi kết nối — rời trang này là cổng được trả lại cho máy chụp.
        </p>
        <ol className="bill-checks" aria-label="Kiểm tra máy nhận tiền">
          <Check state={billSupported ? "ok" : "fail"}>
            {billSupported
              ? "Trình duyệt đọc được cổng USB (Chrome / Edge)"
              : "Trình duyệt này không đọc được cổng USB — mở trang bằng Chrome hoặc Edge trên máy tính phòng chụp (điện thoại, Safari không được)"}
          </Check>
          <Check state={keyboard || connected ? "ok" : "todo"}>
            {keyboard ? "Kiểu giả lập bàn phím — không cần chọn cổng"
              : connected ? <>Đã mở cổng: <b>{billAcceptor.portName || "cổng COM"}</b></>
                : savedPort ? <>Cổng đã lưu: <b>{savedPort}</b> — chưa mở được ở trang này (máy chụp có thể đang dùng)</>
                  : "Chưa chọn cổng — bấm “Kết nối máy nhận tiền”"}
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
        <div className="bill-actions">
          {!keyboard && (
            <Button type="button" disabled={!billSupported || busy} onClick={connectBill}>
              {connected ? "Kết nối lại / đổi cổng" : "Kết nối máy nhận tiền"}
            </Button>
          )}
          {!keyboard && connected && (
            <Button type="button" className="outline" disabled={busy} onClick={checkBill}>Kiểm tra lại</Button>
          )}
          <Button type="button" className="outline" disabled={busy || !connected}
            onClick={() => run(async () => {
              if (keyboard) await billAcceptor.connect(false);
              setReceived([]);
              setTesting((on) => !on);
            })}>
            {testing ? "Dừng thử" : "Thử nhận tiền"}
          </Button>
        </div>
        {error && <p className="bill-error" role="alert">{error}</p>}
        <p className="bill-status" role="status">Trạng thái: {status}</p>
        <details className="bill-advanced">
          <summary><Wrench size={15} aria-hidden="true" /> Cài đặt nâng cao (chọn kiểu nối thủ công)</summary>
          {/* Thẻ <details> không tự giãn cách các phần tử con: bọc trong một khối lưới riêng. */}
          <div className="bill-advanced-body">
          <p className="bill-advanced-hint">
            Chỉ dùng khi nút “Kết nối máy nhận tiền” không tự nhận ra thiết bị: chọn kiểu nối, chỉnh thông số rồi bấm
            “Chọn cổng”.
          </p>
          <label>
            Kiểu kết nối
            <select value={bill.protocol} onChange={(e) => saveBill({ ...bill, protocol: e.target.value })}>
              <option value="pulse">Mạch Arduino (xung)</option>
              <option value="ict">Cáp USB-RS232 (máy ICT)</option>
              <option value="keyboard">Arduino giả lập phím</option>
            </select>
          </label>
          {keyboard && (
            <div className="bill-advanced-row">
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
            <div className="bill-advanced-actions">
              <Button type="button" className="outline small" disabled={!billSupported || busy}
                onClick={() => run(async () => {
                  await billAcceptor.disconnect();
                  await billAcceptor.connect(true);
                  setSavedPort(billAcceptor.portName);
                  notify?.("Đã mở cổng theo kiểu nối đã chọn.");
                })}>
                Chọn cổng (không tự nhận diện)
              </Button>
            </div>
          )}
          </div>
        </details>
      </section>

      <section className="bill-panel bill-guide" aria-labelledby="bill-guide-title">
        <h3 id="bill-guide-title"><ListChecks size={18} aria-hidden="true" /> Hướng dẫn lắp & kết nối</h3>
        <ol className="bill-steps">
          {BILL_GUIDE.map((step, i) => <li key={i}>{step}</li>)}
        </ol>
        <a className="button outline small bill-download" href={BILL_SKETCH_URL} download>
          <Download size={15} aria-hidden="true" /> Tải chương trình mạch Arduino (.ino)
        </a>
        <p className="bill-note">
          Máy nhận tiền không trả tiền thừa: khách đút dư thì Đơn hàng hiện “cần thối lại” để nhân viên thối ở quầy.
        </p>
      </section>

      <section className="bill-panel bill-troubles" aria-labelledby="bill-troubles-title">
        <h3 id="bill-troubles-title"><LifeBuoy size={18} aria-hidden="true" /> Gỡ lỗi thường gặp</h3>
        <dl>
          {BILL_TROUBLES.map(([problem, fix]) => (
            <div key={problem}><dt>{problem}</dt><dd>{fix}</dd></div>
          ))}
        </dl>
      </section>
    </div>
  );
}
