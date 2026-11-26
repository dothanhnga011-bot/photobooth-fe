import assert from "node:assert/strict";
import { test } from "node:test";

// Trang máy chụp lưu cấu hình máy nhận tiền trong localStorage; Node không có sẵn.
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};
const { billAcceptor, describePort, DEFAULT_BILL, PORT_BUSY_MESSAGE, probeBillPort } = await import("../src/kiosk/bill-acceptor.js");

// Cổng USB giả lập Web Serial: respond(byte đã ghi, cách mở cổng) trả các byte thiết bị gửi lại.
class FakePort {
  constructor(respond, info = {}) {
    this.respond = respond;
    this.info = info;
    this.opens = [];
    this.isOpen = false;
  }
  getInfo() { return this.info; }
  async open(options) {
    if (this.isOpen) throw new Error("The port is already open.");
    this.isOpen = true;
    this.opens.push(options);
    let controller;
    this.readable = new ReadableStream({ start: (c) => { controller = c; } });
    this.writable = new WritableStream({
      write: (chunk) => {
        const reply = this.respond([...chunk], options);
        if (reply?.length) setTimeout(() => { try { controller.enqueue(new Uint8Array(reply)); } catch {} }, 5);
      },
    });
  }
  async close() {
    if (this.readable?.locked) throw new Error("Cannot close a locked stream.");
    this.isOpen = false;
    this.readable = null;
    this.writable = null;
  }
  async setSignals() {}
}
const text = (bytes) => new TextDecoder().decode(new Uint8Array(bytes));
const ascii = (s) => [...new TextEncoder().encode(s)];
const fast = { pulseMs: 400, ictMs: 300 };

// Mạch Arduino bản mới (hardware/bill-acceptor-pulse): trả lời PING ở 8N1, không chẵn lẻ.
const arduino = (bytes, options) =>
  options.parity === "none" && /PING/.test(text(bytes)) ? ascii("PONG pulse=10000\r\n") : null;
// Máy ICT qua RS232: chỉ hiểu 9600 8E1, trả 0x5E (đang khóa) cho lệnh hỏi trạng thái 0x0C.
const ict = (bytes, options) => (options.parity === "even" && bytes.includes(0x0c) ? [0x5e] : null);

test("the kiosk recognises the Arduino pulse circuit by itself and learns how much one pulse is worth", async () => {
  const port = new FakePort(arduino, { usbVendorId: 0x2341, usbProductId: 0x8037 });
  assert.deepEqual(await probeBillPort(port, DEFAULT_BILL, fast), { protocol: "pulse", pulseValue: 10000 });
  assert.equal(port.isOpen, false, "the probe always closes the port again");
  assert.equal(describePort(port), "Arduino (2341:8037)");
});

test("an ICT acceptor on RS232 is recognised from its status reply (9600 8E1)", async () => {
  const port = new FakePort(ict, { usbVendorId: 0x1a86, usbProductId: 0x7523 });
  assert.deepEqual(await probeBillPort(port, DEFAULT_BILL, fast), { protocol: "ict" });
  assert.deepEqual(port.opens.map((o) => o.parity), ["none", "even"], "the Arduino is asked first, then the ICT");
  assert.equal(port.isOpen, false);
  assert.equal(describePort(port), "cáp USB-Serial CH340 (1A86:7523)");
});

test("a device that answers nothing is reported as not recognised, and the port is left closed", async () => {
  const port = new FakePort(() => null);
  assert.equal(await probeBillPort(port, DEFAULT_BILL, fast), null);
  assert.equal(port.isOpen, false);
  assert.equal(describePort(port), "cổng COM");
});

test("a port held by the kiosk tab is reported as busy, not as a device that does not answer", async () => {
  // Chrome báo NetworkError khi hệ điều hành không mở được cổng (tab máy chụp đang giữ nó).
  const port = new FakePort(arduino);
  port.open = async () => { throw Object.assign(new Error("Failed to open serial port."), { name: "NetworkError" }); };
  await assert.rejects(probeBillPort(port, DEFAULT_BILL, fast), (error) => error.busy === true && error.message === PORT_BUSY_MESSAGE);
});

test("the check button asks the open circuit and reads its pulse value; disconnect frees the port", async () => {
  store.set("kiosk-bill", JSON.stringify({ ...DEFAULT_BILL, protocol: "pulse" }));
  const port = new FakePort(arduino, { usbVendorId: 0x2341, usbProductId: 0x8037 });
  await port.open({ baudRate: 9600, parity: "none" });
  billAcceptor.port = port;
  billAcceptor.readLoop(DEFAULT_BILL);
  assert.equal(await billAcceptor.check(400), true);
  assert.equal(billAcceptor.circuitPulse, 10000);
  assert.ok(billAcceptor.lastReply > 0);
  // Trước đây vòng đọc lấy lại trình đọc ngay sau khi huỷ: cổng bị giữ, chọn lại cùng cổng báo "already open".
  await billAcceptor.disconnect();
  assert.equal(port.isOpen, false, "disconnect really closes the port");
  await port.open({ baudRate: 9600, parity: "none" });
  await port.close();
});

test("a silent circuit fails the check instead of hanging", async () => {
  const port = new FakePort(() => null);
  await port.open({ baudRate: 9600, parity: "none" });
  billAcceptor.port = port;
  billAcceptor.lastReply = 0;
  billAcceptor.readLoop(DEFAULT_BILL);
  assert.equal(await billAcceptor.check(200), false);
  await billAcceptor.disconnect();
  assert.equal(port.isOpen, false);
});
