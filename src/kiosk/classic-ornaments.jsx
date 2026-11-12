// Original gilded acanthus asset, shared by all corners; reflections stay in CSS.
import { useId } from "react";
import goldCorner from "./assets/rococo-corner-gold.webp";

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

export function OrnamentCorner({ className = "" }) {
  return (
    <img className={`ornament-corner ${className}`} src={goldCorner} width={512} height={512}
      alt="" aria-hidden="true" draggable="false" decoding="async" />
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
