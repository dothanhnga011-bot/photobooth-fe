// Mạch Arduino Pro Micro của máy chụp photobooth — một mạch làm 2 việc:
//   1. Đếm xung máy nhận tiền giấy (ICT A7 / V7 ở chế độ PULSE).
//   2. Bấm máy ảnh như dây bấm (nhấn nửa lấy nét, nhấn hết chụp) → máy ảnh chụp thật, flash nổ,
//      ảnh gốc về thư mục X Acquire như khi khách tự bấm dây.
// Pro Micro (ATmega32U4; Nano / Uno / ESP32 cũng được) cắm USB vào máy tính của máy chụp; trang
// máy chụp đọc / gửi lệnh qua cổng COM (Cài đặt máy chụp → Máy đọc tiền → "Xung qua Arduino (COM)";
// Tự chụp khi chọn "Đếm giờ" → "Bấm máy qua Arduino").
// Pro Micro: chân ngắt dùng được 0, 1, 2, 3, 7 — dùng chân 2 như dưới.
//
// ── Máy nhận tiền (kiểm tra lại sơ đồ chân trong tài liệu model đã mua) ──
//   Máy nhận tiền 12V DC (nguồn ≥ 2A, xem tem máy: có bản 24V / AC) lấy nguồn riêng;
//   GND của nguồn 12V nối chung GND Arduino. KHÔNG nối 12V vào Arduino.
//   Chân PULSE (xung ra, cực thu hở) → chân D2 Arduino (dùng điện trở kéo lên nội).
//   Chân INHIBIT (cấm nhận tiền)    → chân D4 Arduino (qua transistor / opto nếu máy cần 12V).
// Trên máy nhận tiền: DIP switch chọn chế độ Pulse (không dùng RS232 / MDB), mỗi xung =
// PULSE_VALUE đồng (vd. 10.000 đ: tờ 10k = 1 xung, 20k = 2 xung, 50k = 5 xung). Máy phải có
// firmware tiền Việt (polymer).
//
// ── Bấm máy ảnh (Fujifilm X-S10: cổng mic ø3,5 mm dùng chung cho dây bấm) ──
//   2 opto PC817 (hoặc 1 con PC827 đôi), mỗi con một điện trở 330 Ω:
//     D5 → 330 Ω → chân 1 (anode) opto LẤY NÉT, chân 2 (cathode) → GND Arduino.
//     D6 → 330 Ω → chân 1 (anode) opto CHỤP,    chân 2 (cathode) → GND Arduino.
//   Đầu ra opto (chân 4 = collector, chân 3 = emitter) nối song song với nút của dây bấm:
//     opto LẤY NÉT: collector → vòng (RING) của jack, emitter → thân (SLEEVE / GND máy ảnh).
//     opto CHỤP:    collector → đầu (TIP) của jack,  emitter → thân (SLEEVE).
//   Dùng jack chia 1 ra 2 (hoặc đấu chung trong hộp) để dây bấm của khách vẫn dùng được. Opto
//   cách ly hoàn toàn máy ảnh khỏi Arduino / nguồn máy nhận tiền. Đo lại bằng cách chạm tay: chạm
//   RING–SLEEVE máy lấy nét, chạm cả TIP–SLEEVE máy chụp (dây Fujifilm RR-90 / RR-100 như vậy).
//   Trên máy ảnh: MIC/REMOTE RELEASE = REMOTE (nếu có mục này), SHUTTER TYPE = MECHANICAL (màn
//   trập điện tử không nháy flash), RELEASE/FOCUS PRIORITY = RELEASE (không lấy nét được vẫn chụp).
//
// Nạp chương trình: Arduino IDE → Tools → Board: "Arduino Leonardo" (Pro Micro 5V / 16 MHz;
// Nano / Uno chọn đúng tên board) → Port: cổng của mạch → Upload. Đổi PULSE_VALUE nếu DIP switch máy
// ICT đặt mỗi xung khác 10.000 đ.
//
// Lệnh (mỗi lệnh một dòng):
//   máy chụp → mạch: ENABLE / DISABLE (mở / khóa nhận tiền), PING (kiểm tra mạch còn chạy),
//                    FOCUS (nhấn nửa, tự nhả sau FOCUS_HOLD_MS), SHOOT (nhấn hết rồi nhả).
//   mạch → máy chụp: "READY pulse=<PULSE_VALUE>" khi khởi động và mỗi lần máy chụp mở cổng,
//                    "PONG pulse=<PULSE_VALUE>" trả lời PING, "BILL <số tiền>" khi nhận xong một tờ,
//                    SHOT sau khi bấm. Máy chụp dùng READY / PONG để tự nhận ra mạch này (bấm
//                    "Kết nối máy nhận tiền" trong Cài đặt máy chụp) và báo mỗi xung bao nhiêu tiền.

const byte PULSE_PIN = 2;
const byte INHIBIT_PIN = 4;
const byte FOCUS_PIN = 5;
const byte SHUTTER_PIN = 6;
const long PULSE_VALUE = 10000;       // số tiền mỗi xung (đồng)
const unsigned long BILL_GAP_MS = 400; // không có xung mới quá khoảng này = xong một tờ
const bool INHIBIT_ACTIVE_HIGH = true; // mức điện để CẤM nhận tiền (xem tài liệu máy)
const unsigned long FOCUS_MS = 350;      // nhấn nửa bao lâu trước khi chụp (khi chưa FOCUS trước)
const unsigned long PRESS_MS = 250;      // giữ nút chụp
const unsigned long FOCUS_HOLD_MS = 4000; // FOCUS mà không có SHOOT: tự nhả sau khoảng này

volatile unsigned int pulses = 0;
volatile unsigned long lastPulse = 0;
String line;
bool focusing = false;
unsigned long focusSince = 0;
bool hostOpen = false; // máy chụp đang mở cổng (DTR) — Pro Micro không tự khởi động lại khi mở cổng

void announce(const char* word) {
  Serial.print(word);
  Serial.print(" pulse=");
  Serial.println(PULSE_VALUE);
}

void onPulse() {
  unsigned long now = millis();
  // Bỏ nhiễu dội tiếp điểm (xung thật dài ~50 ms, cách nhau ~50–100 ms).
  if (now - lastPulse > 20) {
    pulses++;
    lastPulse = now;
  }
}

void setInhibit(bool inhibit) {
  digitalWrite(INHIBIT_PIN, inhibit == INHIBIT_ACTIVE_HIGH ? HIGH : LOW);
}

void focus() {
  digitalWrite(FOCUS_PIN, HIGH);
  if (!focusing) focusSince = millis();
  focusing = true;
}

void release() {
  digitalWrite(SHUTTER_PIN, LOW);
  digitalWrite(FOCUS_PIN, LOW);
  focusing = false;
}

// Nhấn hết như dây bấm: đang nhấn nửa thì chụp ngay, chưa thì lấy nét FOCUS_MS trước. Xung tiền
// vẫn được đếm trong lúc chờ (đếm bằng ngắt).
void shoot() {
  if (!focusing) {
    focus();
    delay(FOCUS_MS);
  }
  digitalWrite(SHUTTER_PIN, HIGH);
  delay(PRESS_MS);
  release();
  Serial.println("SHOT");
}

void setup() {
  Serial.begin(9600);
  pinMode(PULSE_PIN, INPUT_PULLUP);
  pinMode(INHIBIT_PIN, OUTPUT);
  pinMode(FOCUS_PIN, OUTPUT);
  pinMode(SHUTTER_PIN, OUTPUT);
  release();
  setInhibit(true); // mặc định không nhận tiền cho tới khi máy chụp gửi ENABLE
  attachInterrupt(digitalPinToInterrupt(PULSE_PIN), onPulse, FALLING);
  announce("READY");
  hostOpen = (bool)Serial; // Uno / Nano: luôn true — không báo READY lần hai ở vòng lặp đầu
}

void loop() {
  // Máy chụp vừa mở cổng: báo READY để nó biết mạch đang chạy (Uno / Nano đã báo lúc khởi động lại).
  bool hostNow = (bool)Serial;
  if (hostNow && !hostOpen) announce("READY");
  hostOpen = hostNow;
  noInterrupts();
  unsigned int count = pulses;
  unsigned long last = lastPulse;
  interrupts();
  if (count > 0 && millis() - last > BILL_GAP_MS) {
    noInterrupts();
    pulses = 0;
    interrupts();
    Serial.print("BILL ");
    Serial.println((long)count * PULSE_VALUE);
  }
  if (focusing && millis() - focusSince > FOCUS_HOLD_MS) release();
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      line.trim();
      if (line == "ENABLE") setInhibit(false);
      else if (line == "DISABLE") setInhibit(true);
      else if (line == "PING") announce("PONG");
      else if (line == "FOCUS") focus();
      else if (line == "SHOOT") shoot();
      line = "";
    } else if (line.length() < 32) {
      line += c;
    }
  }
}
