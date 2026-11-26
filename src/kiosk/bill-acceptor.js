// Máy nhận tiền giấy (ICT A7 / V7 và loại tương tự) cắm vào máy tính của máy chụp qua cổng
// USB-serial; trang máy chụp (Chrome / Edge) nói chuyện trực tiếp bằng Web Serial, không cần cài
// phần mềm riêng. Ba kiểu kết nối (chọn trong Cài đặt máy chụp):
// - "pulse" (mặc định): máy ICT để chế độ xung (DIP switch: Pulse, vd. 1 xung = 10.000 đ), mạch
//   Arduino Pro Micro đếm xung và gửi dòng "BILL <số tiền>" qua cổng COM; máy chụp gửi lại
//   ENABLE / DISABLE để mở / khóa máy đọc tiền (chân Inhibit). Mã mạch mẫu:
//   hardware/bill-acceptor-pulse/bill-acceptor-pulse.ino.
// - "keyboard": mạch Pro Micro giả lập bàn phím, mỗi xung gõ một phím (vd. "1") — không cần cấp
//   quyền cổng nhưng không khóa được máy đọc tiền.
// - "ict": cổng RS232 của máy ICT (qua cáp USB-RS232), máy giữ tờ tiền chờ máy chụp đồng ý.
// Mã lệnh ICT theo tài liệu giao thức RS232 phổ biến của ICT; khi lắp máy thật hãy đối chiếu tài
// liệu đi kèm model đã mua (tốc độ, chẵn lẻ, mệnh giá từng kênh chỉnh được trong cài đặt).
import { choosePort, savedPort } from "./serial-ports.js";

export const BILL_KEY = "kiosk-bill";
export const DEFAULT_BILL = {
  protocol: "pulse",
  // Kiểu bàn phím: phím mạch gõ cho mỗi xung và số tiền mỗi xung.
  key: "1",
  pulseValue: 10000,
  baud: 9600,
  parity: "even",
  // Mệnh giá theo kênh tiền của máy (kênh 1, 2, 3…) — theo firmware tiền Việt đã nạp vào máy.
  channels: [10000, 20000, 50000, 100000, 200000, 500000],
};
export const billSupported =
  typeof navigator !== "undefined" && "serial" in navigator;
export function readBillConfig() {
  try {
    return { ...DEFAULT_BILL, ...JSON.parse(localStorage.getItem(BILL_KEY)) };
  } catch {
    return { ...DEFAULT_BILL };
  }
}
export const saveBillConfig = (config) =>
  localStorage.setItem(BILL_KEY, JSON.stringify(config));

const ICT = {
  POWER_UP: 0x80,
  POWER_UP_2: 0x8f,
  ESCROW: 0x81,
  STACKED: 0x10,
  ACCEPT: 0x02,
  REJECT: 0x0f,
  ENABLE: 0x3e,
  INHIBIT: 0x5e,
  STATUS: 0x0c,
};
const ICT_ERRORS = {
  0x20: "Lỗi động cơ máy nhận tiền",
  0x21: "Lỗi kiểm tra tiền",
  0x22: "Kẹt tiền trong máy",
  0x23: "Tờ tiền bị rút ra",
  0x24: "Hộp đựng tiền đang mở",
  0x25: "Lỗi cảm biến",
  0x27: "Lỗi hộp đựng tiền",
  0x28: "Tờ tiền bị kéo ngược",
  0x29: "Máy trả lại tờ tiền",
  0x2a: "Lệnh không hợp lệ",
};
// Máy ICT trả lời lệnh hỏi trạng thái (0x0C): đang mở / đang khóa nhận tiền.
const ICT_STATUS_REPLIES = [0x3e, 0x5e];

export const BILL_PROTOCOLS = {
  pulse: "mạch Arduino đếm xung",
  ict: "máy ICT nối thẳng cổng RS232",
  keyboard: "mạch giả lập bàn phím",
};

// Tên dễ hiểu của cổng USB theo mã hãng (USB vendor id): nhân viên biết đã chọn đúng thiết bị.
const USB_VENDORS = {
  0x2341: "Arduino", 0x2a03: "Arduino", 0x1b4f: "Arduino Pro Micro (SparkFun)", 0x239a: "Arduino (Adafruit)",
  0x1a86: "cáp USB-Serial CH340", 0x067b: "cáp USB-Serial PL2303", 0x0403: "cáp USB-Serial FTDI",
  0x10c4: "cáp USB-Serial CP210x",
};
const hex4 = (n) => Number(n).toString(16).padStart(4, "0").toUpperCase();
export function describePort(port) {
  const { usbVendorId: vendor, usbProductId: product } = port?.getInfo?.() || {};
  if (vendor === undefined) return "cổng COM";
  return `${USB_VENDORS[vendor] || "thiết bị USB"} (${hex4(vendor)}:${hex4(product ?? 0)})`;
}

const PULSE_SERIAL = { baudRate: 9600, dataBits: 8, stopBits: 1, parity: "none" };
const ictSerial = (config) => ({
  baudRate: Number(config.baud) || 9600, dataBits: 8, stopBits: 1, parity: config.parity || "even",
});
const decode = (bytes) => new TextDecoder().decode(new Uint8Array(bytes));

// Mở cổng, gửi các lệnh (mỗi lệnh sau `at` ms) rồi đọc tới khi accept(các byte đã nhận) đúng hoặc hết ms.
// Trả các byte đã nhận, hoặc null khi không ai trả lời. Luôn đóng cổng lại.
async function exchange(port, options, sends, accept, ms) {
  await port.open(options);
  let reader;
  const timers = [];
  try {
    await port.setSignals?.({ dataTerminalReady: true, requestToSend: true })?.catch?.(() => {});
    const write = async (bytes) => {
      const writer = port.writable.getWriter();
      try { await writer.write(bytes); } finally { writer.releaseLock(); }
    };
    reader = port.readable.getReader();
    const received = [];
    const timeout = new Promise((resolve) => timers.push(setTimeout(() => resolve(false), ms)));
    for (const [at, bytes] of sends) timers.push(setTimeout(() => write(bytes).catch(() => {}), at));
    const reading = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return false;
        received.push(...value);
        if (accept(received)) return true;
      }
    })().catch(() => false);
    return (await Promise.race([reading, timeout])) ? received : null;
  } finally {
    timers.forEach(clearTimeout);
    await reader?.cancel().catch(() => {});
    try { reader?.releaseLock(); } catch { /* đã nhả */ }
    await port.close().catch(() => {});
  }
}

// Nhân viên chỉ chọn cổng; máy chụp tự nhận ra thiết bị cắm vào:
// - mạch Arduino (chương trình hardware/bill-acceptor-pulse) trả "PONG pulse=<số tiền mỗi xung>" cho
//   lệnh PING (Arduino Uno / Nano tự khởi động lại ~2 s khi mở cổng rồi báo READY: gửi PING lần nữa);
// - máy ICT qua RS232 trả 0x3E / 0x5E cho lệnh hỏi trạng thái 0x0C (vừa bật nguồn thì báo 0x80 / 0x8F).
// Trả { protocol, pulseValue? } hoặc null khi không có gì trả lời.
export async function probeBillPort(port, config = readBillConfig(), { pulseMs = 3000, ictMs = 1500 } = {}) {
  const ping = new TextEncoder().encode("\nPING\n");
  const pulse = await exchange(port, PULSE_SERIAL, [[50, ping], [Math.min(2000, pulseMs * 0.6), ping]],
    (bytes) => /READY|PONG/.test(decode(bytes)), pulseMs).catch(() => null);
  if (pulse) {
    const value = Number(/pulse=(\d+)/.exec(decode(pulse))?.[1]);
    return { protocol: "pulse", ...(value > 0 && { pulseValue: value }) };
  }
  const status = new Uint8Array([ICT.STATUS]);
  const ict = await exchange(port, ictSerial(config), [[50, status], [ictMs * 0.4, status]],
    (bytes) => bytes.some((b) => ICT_STATUS_REPLIES.includes(b) || b === ICT.POWER_UP || b === ICT.POWER_UP_2 || ICT_ERRORS[b]),
    ictMs).catch(() => null);
  return ict ? { protocol: "ict" } : null;
}

// Một máy nhận tiền cho cả trang. onBill(amount) khi một tờ tiền đã vào hộp; onStatus(text) báo
// trạng thái / lỗi cho nhân viên. accepting() quyết định có nhận tờ tiền đang chờ hay trả lại.
class BillAcceptor {
  port = null;
  reader = null;
  listeners = new Set();
  statusListeners = new Set();
  enabled = false;
  accepting = () => this.enabled;
  status = "Chưa kết nối";
  pendingEscrow = null;
  connecting = null;
  // Cho trang cài đặt: cổng đang mở, lần cuối mạch / máy trả lời, số tiền mỗi xung mạch báo về.
  portName = "";
  lastReply = 0;
  circuitPulse = 0;
  waitReply = null;
  probing = false;

  onBill(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  onStatus(listener) {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }
  setStatus(text) {
    this.status = text;
    for (const listener of this.statusListeners) listener(text);
  }
  emit(amount) {
    for (const listener of this.listeners) listener(amount);
  }
  get connected() {
    return this.keyboard ? true : Boolean(this.port?.readable);
  }
  // Kiểu bàn phím: mỗi lần mạch gõ phím đã chọn = một xung. Các xung liền nhau (≤ 400 ms) gộp
  // thành một tờ tiền.
  listenKeyboard(config) {
    if (this.keyboard) return;
    let pulses = 0, timer = null;
    this.keyboard = (event) => {
      // Chỉ nghe ở màn trả tiền: ngoài lúc đó phím vẫn gõ bình thường (vd. ô nhập mã).
      if (!this.enabled || event.key !== String(config.key || "1") || event.repeat) return;
      event.preventDefault();
      pulses++;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const amount = pulses * (Number(config.pulseValue) || 10000);
        pulses = 0;
        this.setStatus(`Đã nhận ${amount.toLocaleString("vi-VN")} đ`);
        this.emit(amount);
      }, 400);
    };
    window.addEventListener("keydown", this.keyboard, true);
    this.setStatus("Đang nghe mạch giả lập bàn phím");
  }

  // ask = true: nhân viên chọn cổng (cần bấm nút). Không hỏi: mở lại cổng đã cho phép trước đó.
  async connect(ask = false) {
    if (this.connecting) return this.connecting;
    this.connecting = this.openConnection(ask);
    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }
  async openConnection(ask = false) {
    if (!billSupported) throw new Error("Trình duyệt không hỗ trợ cổng USB (Web Serial). Dùng Chrome hoặc Edge.");
    const config = readBillConfig();
    if (config.protocol === "keyboard") {
      this.listenKeyboard(config);
      return true;
    }
    if (this.connected) return true;
    // Đang nhận diện thiết bị (setup): vòng tự kết nối lại của máy chụp không được chiếm cổng giữa chừng.
    if (this.probing && !ask) return false;
    const port = ask ? await choosePort("bill") : await savedPort("bill");
    if (!port) return false;
    await port.open({
      baudRate: Number(config.baud) || 9600,
      dataBits: 8,
      stopBits: 1,
      parity: config.protocol === "ict" ? config.parity || "even" : "none",
    });
    this.port = port;
    this.portName = describePort(port);
    this.lastReply = 0;
    this.setStatus("Đã kết nối máy nhận tiền");
    this.readLoop(config);
    if (config.protocol === "ict") await this.write([this.enabled ? ICT.ENABLE : ICT.INHIBIT]);
    else await this.writeText(this.enabled ? "ENABLE" : "DISABLE");
    return true;
  }
  // Một nút cho nhân viên ("Kết nối máy nhận tiền"): chọn cổng trong cửa sổ trình duyệt → máy chụp tự
  // nhận ra kiểu nối (mạch xung / ICT RS232), lưu lại rồi mở cổng. Lần sau bật máy tự mở lại cổng này.
  // Trả { protocol, pulseValue? } khi nhận ra, null khi thiết bị chưa trả lời (vẫn mở theo kiểu đã lưu).
  async setup() {
    if (!billSupported) throw new Error("Trình duyệt không hỗ trợ cổng USB (Web Serial). Dùng Chrome hoặc Edge.");
    const port = await choosePort("bill"); // hỏi trước tiên: cần thao tác bấm của nhân viên
    this.probing = true;
    let found = null;
    try {
      await this.disconnect();
      this.setStatus("Đang nhận diện máy nhận tiền…");
      const config = readBillConfig();
      found = await probeBillPort(port, config).catch(() => null);
      if (found) saveBillConfig({ ...config, ...found });
      if (found?.pulseValue) this.circuitPulse = found.pulseValue;
    } finally {
      this.probing = false;
    }
    await this.connect(false);
    if (found) this.lastReply = Date.now();
    this.setStatus(found
      ? `Đã kết nối: ${BILL_PROTOCOLS[found.protocol]} · ${this.portName}`
      : `Đã mở ${this.portName} nhưng thiết bị chưa trả lời — xem “Gỡ lỗi” trong hướng dẫn`);
    return found;
  }
  // Hỏi mạch / máy còn trả lời không (nút "Kiểm tra lại"): true / false; kiểu bàn phím: null (không hỏi được).
  async check(ms = 2500) {
    if (this.keyboard) return null;
    if (!this.port?.writable) return false;
    const answered = new Promise((resolve) => {
      this.waitReply = resolve;
      setTimeout(() => resolve(false), ms);
    });
    if (readBillConfig().protocol === "ict") await this.write([ICT.STATUS]);
    else await this.writeText("PING");
    const ok = await answered;
    this.waitReply = null;
    this.setStatus(ok ? "Máy nhận tiền đang trả lời bình thường" : "Máy nhận tiền chưa trả lời — xem “Gỡ lỗi” trong hướng dẫn");
    return ok;
  }
  replied() {
    this.lastReply = Date.now();
    this.waitReply?.(true);
  }
  async disconnect() {
    if (this.keyboard) {
      window.removeEventListener("keydown", this.keyboard, true);
      this.keyboard = null;
    }
    // Bỏ tham chiếu cổng TRƯỚC khi huỷ trình đọc: vòng đọc (readLoop) thấy cổng đã đổi thì dừng, không
    // lấy trình đọc mới — trước đây nó lấy lại ngay, port.close() thất bại âm thầm và cổng bị giữ
    // ("port is already open" khi chọn lại đúng cổng đó).
    const port = this.port;
    this.port = null;
    try {
      await this.reader?.cancel();
    } catch {}
    try {
      await port?.close();
    } catch {}
    this.setStatus("Chưa kết nối");
  }
  async write(bytes) {
    if (!this.port?.writable) return;
    const writer = this.port.writable.getWriter();
    try {
      await writer.write(new Uint8Array(bytes));
    } finally {
      writer.releaseLock();
    }
  }
  writeText(line) {
    return this.write([...new TextEncoder().encode(`${line}\n`)]);
  }
  // Chỉ nhận tiền khi đang ở màn trả tiền; ngoài lúc đó máy từ chối mọi tờ tiền.
  async setEnabled(on) {
    this.enabled = on;
    if (this.keyboard || !this.port?.writable) return;
    if (readBillConfig().protocol === "ict") await this.write([on ? ICT.ENABLE : ICT.INHIBIT]);
    else await this.writeText(on ? "ENABLE" : "DISABLE");
  }

  async readLoop(config) {
    const port = this.port;
    let text = "";
    while (port.readable && this.port === port) {
      this.reader = port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (config.protocol === "ict") for (const byte of value) await this.ictByte(byte, config);
          else {
            text += new TextDecoder().decode(value);
            let newline;
            while ((newline = text.indexOf("\n")) >= 0) {
              this.pulseLine(text.slice(0, newline).trim());
              text = text.slice(newline + 1);
            }
            // Nhiễu trên dây (không có xuống dòng) không được làm bộ đệm phình mãi.
            if (text.length > 256) text = text.slice(-64);
          }
        }
      } catch (error) {
        this.setStatus(`Mất kết nối máy nhận tiền: ${error.message}`);
        break;
      } finally {
        this.reader.releaseLock();
      }
    }
    if (this.port === port) {
      this.port = null;
      this.setStatus("Máy nhận tiền đã ngắt kết nối");
    }
  }

  async ictByte(byte, config) {
    if (this.expectBillType) {
      this.expectBillType = false;
      const channel = byte - 0x40;
      const amount = config.channels[channel];
      if (!amount || !this.accepting(amount)) {
        await this.write([ICT.REJECT]);
        this.setStatus(amount ? "Đã trả lại tờ tiền (chưa tới bước trả tiền)" : `Tờ tiền kênh ${channel + 1} chưa cài mệnh giá — đã trả lại`);
        return;
      }
      this.pendingEscrow = amount;
      await this.write([ICT.ACCEPT]);
      // Máy báo đã nuốt tờ tiền (0x10); một số máy không báo — sau 5 giây coi như đã nhận.
      clearTimeout(this.escrowTimer);
      this.escrowTimer = setTimeout(() => this.stacked(), 5000);
      return;
    }
    if (byte === ICT.POWER_UP || byte === ICT.POWER_UP_2) {
      // Máy vừa bật: trả lời để máy hoạt động, rồi đặt lại trạng thái nhận / không nhận.
      this.replied();
      await this.write([ICT.ACCEPT]);
      await this.write([this.enabled ? ICT.ENABLE : ICT.INHIBIT]);
      this.setStatus("Máy nhận tiền sẵn sàng");
    } else if (byte === ICT.ESCROW) this.expectBillType = true;
    else if (byte === ICT.STACKED) this.stacked();
    else if (ICT_STATUS_REPLIES.includes(byte)) this.replied(); // trả lời lệnh hỏi trạng thái
    else if (ICT_ERRORS[byte]) this.setStatus(ICT_ERRORS[byte]);
  }
  stacked() {
    clearTimeout(this.escrowTimer);
    if (!this.pendingEscrow) return;
    const amount = this.pendingEscrow;
    this.pendingEscrow = null;
    this.setStatus(`Đã nhận ${amount.toLocaleString("vi-VN")} đ`);
    this.emit(amount);
  }

  pulseLine(line) {
    const bill = /^BILL\s+(\d+)$/i.exec(line);
    if (bill) {
      const amount = Number(bill[1]);
      if (this.enabled) this.emit(amount);
      else this.setStatus("Có tiền vào khi chưa tới bước trả tiền — kiểm tra dây INHIBIT (xem “Gỡ lỗi” trong hướng dẫn).");
    } else if (/^(READY|PONG)/i.test(line)) {
      // Mạch bản mới báo kèm số tiền mỗi xung: "READY pulse=10000" / "PONG pulse=10000".
      const pulse = Number(/pulse=(\d+)/i.exec(line)?.[1]);
      if (pulse > 0) this.circuitPulse = pulse;
      this.replied();
      if (/^READY/i.test(line)) this.setStatus("Máy nhận tiền sẵn sàng");
    } else if (/^ERROR/i.test(line)) this.setStatus(line);
  }
}

export const billAcceptor = new BillAcceptor();
