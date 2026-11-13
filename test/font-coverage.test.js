// Chữ khách gõ lên khung không bao giờ ra ô vuông: mọi ký tự trong bảng ký tự trang trí và mọi chữ cái tiếng
// Việt có dấu đều nằm trong font đi kèm web (đọc thẳng bảng cmap của các file font mà decor-fonts.js nạp).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { inflateSync } from "node:zlib";
import { DECOR_FONTS } from "../src/album/decorations.js";
import { TEXT_MARKS, TEXT_PRESETS, TEXT_SYMBOLS } from "../src/kiosk/decor.js";

// Các điểm mã có glyph trong một file WOFF (bảng cmap dạng 4 hoặc 12).
function woffCodepoints(file) {
  const b = readFileSync(file);
  let cmap = null;
  for (let i = 0; i < b.readUInt16BE(12); i++) {
    const e = 44 + i * 20;
    if (b.toString("latin1", e, e + 4) !== "cmap") continue;
    const offset = b.readUInt32BE(e + 4), comp = b.readUInt32BE(e + 8), orig = b.readUInt32BE(e + 12);
    const raw = b.subarray(offset, offset + comp);
    cmap = comp < orig ? inflateSync(raw) : raw;
  }
  assert.ok(cmap, `${file}: no cmap`);
  const set = new Set();
  for (let i = 0; i < cmap.readUInt16BE(2); i++) {
    const sub = cmap.readUInt32BE(4 + i * 8 + 4), format = cmap.readUInt16BE(sub);
    if (format === 4) {
      const segX2 = cmap.readUInt16BE(sub + 6), ends = sub + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
      for (let s = 0; s < segX2 / 2; s++) {
        const end = cmap.readUInt16BE(ends + s * 2), start = cmap.readUInt16BE(starts + s * 2);
        const delta = cmap.readInt16BE(deltas + s * 2), ro = cmap.readUInt16BE(ranges + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let glyph = ro ? cmap.readUInt16BE(ranges + s * 2 + ro + (c - start) * 2) : c;
          if (glyph) glyph = (glyph + delta) & 0xffff;
          if (glyph) set.add(c);
        }
      }
    } else if (format === 12) {
      for (let g = 0; g < cmap.readUInt32BE(sub + 12); g++) {
        const o = sub + 16 + g * 12, start = cmap.readUInt32BE(o), end = cmap.readUInt32BE(o + 4), gid = cmap.readUInt32BE(o + 8);
        for (let c = start; c <= end; c++) if (gid + (c - start)) set.add(c);
      }
    }
  }
  return set;
}

// Font đi kèm: đúng các tệp mà src/kiosk/decor-fonts.js nạp ("@fontsource/<gói>/<bảng chữ>-400.css").
const FAMILY = { "great-vibes": "Great Vibes", "dancing-script": "Dancing Script", pacifico: "Pacifico", "noto-sans-symbols-2": "Noto Sans Symbols 2" };
const bundled = new Map();
for (const [, pkg, subset] of readFileSync(new URL("../src/kiosk/decor-fonts.js", import.meta.url), "utf8")
  .matchAll(/import "@fontsource\/([a-z0-9-]+)\/([a-z-]+)-400\.css";/g)) {
  const set = bundled.get(FAMILY[pkg]) || new Set();
  for (const c of woffCodepoints(new URL(`../node_modules/@fontsource/${pkg}/files/${pkg}-${subset}-400-normal.woff`, import.meta.url)))
    set.add(c);
  bundled.set(FAMILY[pkg], set);
}
const SCRIPTS = ["Great Vibes", "Dancing Script", "Pacifico"];
const has = (family, ch) => bundled.get(family).has(ch.codePointAt(0));
const chars = (text) => [...text].filter((ch) => ch !== " ");

test("every decoration mark, symbol and preset has a glyph in a bundled font", () => {
  assert.deepEqual([...bundled.keys()].sort(), [...SCRIPTS, "Noto Sans Symbols 2"].sort());
  for (const mark of [...TEXT_MARKS, ...TEXT_SYMBOLS, ...TEXT_PRESETS])
    for (const ch of chars(mark))
      // Ký hiệu: trong font ký hiệu (đứng ngay sau font chính ở mọi kiểu chữ). Dấu chữ (. _ @ · — ˚):
      // có sẵn trong cả ba font viết tay.
      assert.ok(has("Noto Sans Symbols 2", ch) || SCRIPTS.every((family) => has(family, ch)),
        `“${ch}” (U+${ch.codePointAt(0).toString(16).toUpperCase()}) in “${mark}” has no bundled glyph`);
});

test("the script fonts write every Vietnamese letter with every tone mark", () => {
  const vowels = "aăâeêioôơuưy", tones = ["", "̀", "́", "̃", "̉", "̣"];
  const lower = [...vowels].flatMap((v) => tones.map((tone) => (v + tone).normalize("NFC"))).join("") + "bcdđghklmnpqrstvx0123456789";
  const alphabet = lower + lower.toUpperCase();
  for (const family of SCRIPTS) {
    const missing = chars(alphabet).filter((ch) => !has(family, ch));
    assert.deepEqual(missing, [], `${family} lacks ${missing.join("")}`);
  }
});

test("every text style falls back to the bundled symbol font, and the new soft styles use the bundled scripts", () => {
  for (const [id, font] of Object.entries(DECOR_FONTS)) assert.match(font.css, /'Noto Sans Symbols 2'/, id);
  assert.match(DECOR_FONTS.vibes.css, /^'Great Vibes'/);
  assert.match(DECOR_FONTS.dancing.css, /^'Dancing Script'/);
  assert.match(DECOR_FONTS.pacifico.css, /^'Pacifico'/);
});
