// Âm thanh hiệu ứng cho máy chụp Kiosk sử dụng Web Audio API:
// - Không phụ thuộc tệp âm thanh bên ngoài (không delay, không sợ lỗi tải 404/CORS, chạy mượt trên mọi máy).
// - Đếm ngược "3, 2, 1": tiếng bíp thanh thoát giúp khách kịp chuẩn bị tư thế.
// - Khoảnh khắc chụp: tiếng màn trập cơ học ("tách") chân thực như máy ảnh DSLR.

const SOUND_KEY = "kiosk-sound";
let audioCtx = null;

function getContext() {
  if (typeof window === "undefined") return null;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  if (!audioCtx) {
    audioCtx = new AudioContext();
    const unlock = () => {
      if (audioCtx?.state === "suspended") {
        audioCtx.resume();
      }
    };
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock, { passive: true });
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export function isAudioEnabled() {
  try {
    return localStorage.getItem(SOUND_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setAudioEnabled(enabled) {
  try {
    localStorage.setItem(SOUND_KEY, enabled ? "1" : "0");
  } catch {}
}

// Tiếng bíp đếm ngược: 3, 2 bíp âm vừa (800Hz); 1 bíp âm cao hơn (1200Hz).
export function playCountdownBeep(count) {
  if (!isAudioEnabled()) return;
  const ctx = getContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    const isLast = Number(count) === 1;
    osc.type = "sine";
    osc.frequency.setValueAtTime(isLast ? 1200 : 800, now);

    const duration = isLast ? 0.12 : 0.08;
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + duration);
  } catch {}
}

// Tiếng màn trập máy ảnh (Shutter click) hai pha cơ học ("tách-clack")
export function playShutterSound() {
  if (!isAudioEnabled()) return;
  const ctx = getContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;

    // Tạo buffer nhiễu trắng cho âm thanh cơ khí
    const bufferSize = Math.floor(ctx.sampleRate * 0.04);
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    // Pha 1: Mở màn trập (t = now)
    const noise1 = ctx.createBufferSource();
    noise1.buffer = noiseBuffer;
    const filter1 = ctx.createBiquadFilter();
    filter1.type = "bandpass";
    filter1.frequency.setValueAtTime(1400, now);
    filter1.Q.setValueAtTime(3, now);

    const gain1 = ctx.createGain();
    gain1.gain.setValueAtTime(0.3, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.025);

    noise1.connect(filter1);
    filter1.connect(gain1);
    gain1.connect(ctx.destination);
    noise1.start(now);

    // Xung trầm nhẹ mô phỏng gương lật
    const thud = ctx.createOscillator();
    const thudGain = ctx.createGain();
    thud.type = "triangle";
    thud.frequency.setValueAtTime(180, now);
    thud.frequency.exponentialRampToValueAtTime(40, now + 0.03);
    thudGain.gain.setValueAtTime(0.4, now);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
    thud.connect(thudGain);
    thudGain.connect(ctx.destination);
    thud.start(now);
    thud.stop(now + 0.03);

    // Pha 2: Đóng màn trập (t = now + 50ms)
    const t2 = now + 0.05;
    const noise2 = ctx.createBufferSource();
    noise2.buffer = noiseBuffer;
    const filter2 = ctx.createBiquadFilter();
    filter2.type = "bandpass";
    filter2.frequency.setValueAtTime(2200, t2);
    filter2.Q.setValueAtTime(2.5, t2);

    const gain2 = ctx.createGain();
    gain2.gain.setValueAtTime(0.35, t2);
    gain2.gain.exponentialRampToValueAtTime(0.001, t2 + 0.03);

    noise2.connect(filter2);
    filter2.connect(gain2);
    gain2.connect(ctx.destination);
    noise2.start(t2);
  } catch {}
}

