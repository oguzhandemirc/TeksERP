// Tezgah figürü (SVG): levent kalınlığı kalan ipliği, bez rengi dokunan kumaşı
// gösterir; çalışırken mekik/çerçeve/tarak oynar, durunca hepsi donar.
import { useId, type CSSProperties } from "react";
import { beatSeconds, hsl } from "./palette";

interface Props {
  running: boolean;
  rpm: number;
  /** 0..1 — levent üzerindeki kalan iplik. */
  beamRatio: number;
  fabricColor: string;
  /** Duran tezgahta çözgünün boyandığı durum rengi. */
  statusColor: string;
  className?: string;
}

const WARP_X = Array.from({ length: 14 }, (_, i) => 21 + i * 6);

export function LoomFigure({ running, rpm, beamRatio, fabricColor, statusColor, className }: Props) {
  const uid = useId().replace(/:/g, "");
  const beamThickness = 3 + 9 * Math.max(0, Math.min(1, beamRatio));
  const style = { "--ds-beat": `${beatSeconds(rpm)}s` } as CSSProperties;
  const warpColor = running ? hsl("var(--ds-warp)") : hsl(statusColor, 0.55);
  return (
    <svg viewBox="0 0 120 84" className={`ds-loom ${className ?? ""}`} data-state={running ? "run" : "stop"} style={style} aria-hidden="true">
      <defs>
        <pattern id={`w${uid}`} width="4" height="4" patternUnits="userSpaceOnUse">
          <path d="M0 0.5h4" stroke="white" strokeOpacity="0.22" strokeWidth="1" />
        </pattern>
        <clipPath id={`c${uid}`}>
          <rect x="18" y="47" width="84" height="24" />
        </clipPath>
      </defs>
      {/* yan gövde */}
      <rect x="6" y="2" width="6" height="80" rx="2" fill={hsl("var(--ds-ink)")} />
      <rect x="108" y="2" width="6" height="80" rx="2" fill={hsl("var(--ds-ink)")} />
      {/* levent: kalınlığı kalan iplik */}
      <rect x="14" y={10 - beamThickness / 2} width="92" height={beamThickness} rx={beamThickness / 2} fill={hsl("var(--ds-warp)")} />
      <rect x="12" y="8" width="96" height="4" rx="2" fill={hsl("var(--ds-ink)")} opacity="0.7" />
      {/* çözgü */}
      {WARP_X.map((x) => (
        <line key={x} x1={x} y1="13" x2={x} y2="46" stroke={warpColor} strokeWidth="0.9" />
      ))}
      {/* çerçeveler (ağızlık) */}
      <rect className="ds-heddle-a" x="15" y="22" width="90" height="2.4" rx="1.2" fill={hsl("var(--ds-ink)")} opacity="0.85" />
      <rect className="ds-heddle-b" x="15" y="28" width="90" height="2.4" rx="1.2" fill={hsl("var(--ds-ink)")} opacity="0.6" />
      {/* mekik */}
      <g className="ds-shuttle">
        <path d="M17 38.5 L21 36 H27 L31 38.5 L27 41 H21 Z" fill={running ? hsl("var(--ds-run)") : hsl("var(--ds-ink)", 0.6)} />
      </g>
      {/* tarak */}
      <rect className="ds-reed" x="14" y="42.5" width="92" height="3" rx="1.5" fill={hsl("var(--ds-ink)")} />
      {/* dokunan bez + akan atkılar */}
      <rect x="18" y="47" width="84" height="24" fill={fabricColor} />
      <g clipPath={`url(#c${uid})`}>
        <rect className="ds-weft" x="18" y="43" width="84" height="28" fill={`url(#w${uid})`} />
      </g>
      {/* top sargısı */}
      <rect x="13" y="71" width="94" height="9" rx="4.5" fill={fabricColor} />
      <rect x="13" y="71" width="94" height="9" rx="4.5" fill="black" opacity="0.18" />
    </svg>
  );
}
