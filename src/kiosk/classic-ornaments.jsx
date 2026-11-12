// Hoạ tiết cổ điển Pháp (baroque) cho phòng Polaroid: góc hoa văn cuộn lá acanthus mạ vàng cổ và hoa
// văn chia dòng (fleuron). Vẽ bằng SVG (không dùng ảnh): nét vàng chuyển sắc, viền nâu mảnh cho nổi khối.
// Một góc vẽ cho góc trên-trái; các góc khác lật bằng CSS (ClassicCorners).
import { useId } from "react";

function Gold({ id }) {
  return (
    <defs>
      <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#8a6328" />
        <stop offset="0.35" stopColor="#e9cf8e" />
        <stop offset="0.55" stopColor="#c39a52" />
        <stop offset="0.8" stopColor="#f3dfa6" />
        <stop offset="1" stopColor="#7a5524" />
      </linearGradient>
    </defs>
  );
}

// Một nhánh hoa văn chạy dọc mép trên, kết thúc bằng đường xoắn ốc; nhánh mép trái là ảnh phản chiếu
// qua đường chéo. Lá acanthus mọc ra hai bên thân.
const ARM = [
  // Thân cuộn chữ S chạy ra xa góc rồi cuộn xoắn ốc.
  "M34 30 C62 14 92 40 126 26 C150 16 176 10 196 24 C212 35 208 58 190 60 C174 62 168 46 178 40 C186 35 194 42 190 49",
  // Nhánh phụ cong vào trong.
  "M78 30 C88 50 112 58 126 50 C136 44 132 32 122 34",
];
const LEAVES = [
  "M52 22 C60 6 78 4 86 14 C74 12 64 16 52 22 Z",
  "M98 34 C104 48 122 52 132 44 C118 46 106 42 98 34 Z",
  "M140 20 C150 6 168 4 176 14 C164 12 152 14 140 20 Z",
  "M160 26 C166 40 182 46 192 38 C180 38 168 34 160 26 Z",
  "M64 30 C64 42 72 52 84 52 C76 46 70 40 64 30 Z",
];

export function OrnamentCorner({ className = "" }) {
  const id = useId().replace(/:/g, "");
  const stroke = `url(#${id}-gold)`;
  const arm = (
    <g>
      {ARM.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={stroke} strokeWidth={i ? 3.2 : 4.6} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {LEAVES.map((d, i) => <path key={i} d={d} fill={stroke} stroke="#5c3d1c" strokeOpacity="0.45" strokeWidth="0.8" />)}
      <circle cx="190" cy="49" r="3.4" fill={stroke} />
      <circle cx="122" cy="34" r="2.6" fill={stroke} />
    </g>
  );
  return (
    <svg className={`ornament-corner ${className}`} viewBox="0 0 220 220" aria-hidden="true" focusable="false">
      <Gold id={id} />
      <g filter="none">
        {arm}
        {/* Nhánh mép trái: phản chiếu qua đường chéo (x ↔ y). */}
        <g transform="matrix(0 1 1 0 0 0)">{arm}</g>
        {/* Cuộn chữ C ở giữa góc, hướng vào trong. */}
        <path d="M40 40 C58 44 74 60 78 78 C80 90 70 96 62 90 C56 85 60 76 67 78" fill="none" stroke={stroke} strokeWidth="3.6" strokeLinecap="round" />
        <path d="M54 54 C70 54 84 66 88 82 C76 76 64 68 54 54 Z" fill={stroke} stroke="#5c3d1c" strokeOpacity="0.45" strokeWidth="0.8" />
        {/* Hoa bốn cánh ở góc. */}
        <g transform="translate(24 24)">
          {[0, 90, 180, 270].map((angle) => (
            <path key={angle} transform={`rotate(${angle})`} d="M0 0 C6 -4 14 -4 16 0 C14 4 6 4 0 0 Z" fill={stroke} stroke="#5c3d1c" strokeOpacity="0.5" strokeWidth="0.8" />
          ))}
          <circle r="4.2" fill="#f6e7b8" stroke="#7a5524" strokeWidth="1.2" />
        </g>
      </g>
    </svg>
  );
}

// Bốn góc hoa văn phủ lên một khung (cha cần position: relative). Không nhận chạm.
export function ClassicCorners({ className = "" }) {
  return (
    <div className={`classic-corners ${className}`} aria-hidden="true">
      <OrnamentCorner className="is-tl" />
      <OrnamentCorner className="is-tr" />
      <OrnamentCorner className="is-bl" />
      <OrnamentCorner className="is-br" />
    </div>
  );
}

// Hoa văn chia dòng dưới tiêu đề: hai nhánh cuộn đối xứng quanh một bông hoa nhỏ.
export function Fleuron({ className = "" }) {
  const id = useId().replace(/:/g, "");
  const stroke = `url(#${id}-gold)`;
  const half = "M118 20 C100 8 80 30 60 20 C46 13 30 14 22 22 C16 28 22 36 28 32";
  return (
    <svg className={`ornament-fleuron ${className}`} viewBox="0 0 280 40" aria-hidden="true" focusable="false">
      <Gold id={id} />
      <path d={half} fill="none" stroke={stroke} strokeWidth="2.6" strokeLinecap="round" />
      <path d={half} transform="matrix(-1 0 0 1 280 0)" fill="none" stroke={stroke} strokeWidth="2.6" strokeLinecap="round" />
      <path d="M86 18 C92 8 104 8 108 14 C100 13 92 15 86 18 Z" fill={stroke} />
      <path d="M194 18 C188 8 176 8 172 14 C180 13 188 15 194 18 Z" fill={stroke} />
      <g transform="translate(140 20)">
        {[0, 90, 180, 270].map((angle) => (
          <path key={angle} transform={`rotate(${angle})`} d="M0 0 C4 -3 10 -3 12 0 C10 3 4 3 0 0 Z" fill={stroke} />
        ))}
        <circle r="3.2" fill="#f6e7b8" stroke="#7a5524" strokeWidth="1" />
      </g>
    </svg>
  );
}
