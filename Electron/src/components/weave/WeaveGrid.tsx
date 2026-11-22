// Ortak SALT-OKUNUR kare ızgara (desen kâğıdı): armür, atkı seçici, tahar, kumaş görünümü, çözgü tel düzeni.
// Büyük ızgara (32 × 512) DOM'u boğmasın diye hücreler renk başına TEK `<path>`te, çizgiler tek `<path>`te
// çizilir. `direction` yalnız görünümü çevirir: "bottom-up"ta 0. satır en altta, sütun başlıkları altta.
import { cn } from "@/lib/utils";
import type { WeaveDirection } from "./weave-direction";

export interface WeaveGridProps {
  rows: number;
  cols: number;
  /** Hücre rengi (CSS); null = boş hücre. */
  fill: (row: number, col: number) => string | null;
  /** Boş hücrelerin altında sütun zemini (ör. döner çerçeve tonu). */
  colTint?: (col: number) => string | null;
  /** Önüne blok aralığı konacak sütun indeksleri (ör. döner | zemin | seçici blokları). */
  colGapsBefore?: readonly number[];
  /** Sütun başlığı; null/undefined = yazılmaz. Verilmezse başlık satırı yok. */
  colLabel?: (col: number) => string | null | undefined;
  colLabelColor?: (col: number) => string | undefined;
  /** Satır başlığı; varsayılan 1-tabanlı no (küçük hücrede her 10. satır); false = sütun yok. */
  rowLabel?: ((row: number) => string | null) | false;
  /** Satır başlığı sütun genişliği (px) — üst üste hizalanan ızgaralarda AYNI verilir. */
  rowLabelWidth?: number;
  /** Her N satırda / sütunda kalın rapor çizgisi. */
  rowBandEvery?: number;
  colBandEvery?: number;
  direction?: WeaveDirection;
  /** Hücre kenarı (px). */
  cell?: number;
  /** Hücre çizgileri; varsayılan hücre ≥ 6 px iken açık. */
  gridLines?: boolean;
  ariaLabel: string;
  className?: string;
}

const LINE = "hsl(var(--border))";
const BAND = "hsl(var(--foreground) / 0.55)";
const LABEL = "hsl(var(--muted-foreground))";

/** Sütunların x konumları (blok aralıkları dahil) ve blok sınırları — testte de ölçülür. */
export function columnLayout(cols: number, cell: number, gapsBefore: readonly number[] = []) {
  const gaps = new Set(gapsBefore.filter((g) => g > 0 && g < cols));
  const gap = Math.max(4, Math.round(cell * 0.75));
  const xs: number[] = [];
  const blocks: Array<[number, number]> = [];
  let x = 0;
  let start = 0;
  for (let c = 0; c < cols; c++) {
    if (gaps.has(c)) {
      blocks.push([start, c]);
      start = c;
      x += gap;
    }
    xs.push(x);
    x += cell;
  }
  if (cols > 0) blocks.push([start, cols]);
  return { xs, blocks, width: x };
}

function pushRect(map: Map<string, string[]>, color: string, r: { x: number; y: number; w: number; h: number }) {
  const list = map.get(color) ?? [];
  list.push(`M${r.x} ${r.y}h${r.w}v${r.h}h${-r.w}z`);
  map.set(color, list);
}

interface GridPathInput {
  blocks: Array<[number, number]>; xs: number[]; x0: number; top: number; rows: number; cell: number;
  lines: boolean; dir: WeaveDirection; rowBandEvery?: number; colBandEvery?: number;
}

/** Hücre çizgileri (tek path) ve rapor bantları (tek path); blok dış kenarı çizgisiz ızgarada da çizilir. */
function gridPaths({ blocks, xs, x0, top, rows, cell, lines, dir, rowBandEvery, colBandEvery }: GridPathInput) {
  let grid = "";
  let bands = "";
  const bottom = top + rows * cell;
  for (const [a, b] of blocks) {
    const left = x0 + xs[a]!;
    const right = x0 + xs[b - 1]! + cell;
    for (let r = 0; r <= rows; r++) {
      const y = top + r * cell;
      const edge = r === 0 || r === rows;
      const band = !!rowBandEvery && !edge && (dir === "top-down" ? r : rows - r) % rowBandEvery === 0;
      if (band) bands += `M${left} ${y}H${right}`;
      else if (lines || edge) grid += `M${left} ${y}H${right}`;
    }
    for (let c = a; c <= b; c++) {
      const x = c === b ? right : x0 + xs[c]!;
      const edge = c === a || c === b;
      const band = !!colBandEvery && !edge && c % colBandEvery === 0;
      if (band) bands += `M${x} ${top}V${bottom}`;
      else if (lines || edge) grid += `M${x} ${top}V${bottom}`;
    }
  }
  return { grid, bands };
}

export function WeaveGrid(props: WeaveGridProps) {
  const { rows, cols, fill, colTint, colGapsBefore, colLabel, colLabelColor, rowBandEvery, colBandEvery, ariaLabel, className } = props;
  const cell = props.cell ?? 12;
  const dir = props.direction ?? "top-down";
  const lines = props.gridLines ?? cell >= 6;
  const font = Math.max(7, Math.min(10, Math.round(cell * 0.75)));
  const rowLabel = props.rowLabel === false ? null : (props.rowLabel ?? ((r: number) => (cell >= 10 || r === 0 || (r + 1) % 10 === 0 ? String(r + 1) : null)));
  const labelW = rowLabel ? (props.rowLabelWidth ?? Math.max(18, String(rows).length * font * 0.65 + 6)) : 0;
  const headH = colLabel ? font + 6 : 0;
  const { xs, blocks, width } = columnLayout(cols, cell, colGapsBefore);
  const bodyTop = dir === "top-down" ? headH : 0;
  const yOf = (r: number) => bodyTop + (dir === "top-down" ? r : rows - 1 - r) * cell;
  const svgW = labelW + width + 1;
  const svgH = headH + rows * cell + 1;
  const x0 = labelW + 0.5;

  const tints = new Map<string, string[]>();
  const byColor = new Map<string, string[]>();
  for (let c = 0; c < cols; c++) {
    const tint = colTint?.(c);
    if (tint) pushRect(tints, tint, { x: x0 + xs[c]!, y: bodyTop + 0.5, w: cell, h: rows * cell });
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const color = fill(r, c);
      if (color) pushRect(byColor, color, { x: x0 + xs[c]!, y: yOf(r) + 0.5, w: cell, h: cell });
    }
  }
  const { grid, bands } = gridPaths({ blocks, xs, x0, top: bodyTop + 0.5, rows, cell, lines, dir, rowBandEvery, colBandEvery });

  const headY = dir === "top-down" ? font + 1 : rows * cell + font + 3;
  return (
    <svg role="img" aria-label={ariaLabel} width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`}
      className={cn("block shrink-0 select-none", className)} shapeRendering="crispEdges" fontFamily="inherit">
      <title>{ariaLabel}</title>
      {[...tints.entries()].map(([color, d]) => <path key={`t-${color}`} data-tint="" d={d.join("")} fill={color} />)}
      {[...byColor.entries()].map(([color, d]) => <path key={color} data-fill="" d={d.join("")} fill={color} />)}
      {grid && <path d={grid} stroke={LINE} strokeWidth={1} fill="none" />}
      {bands && <path d={bands} stroke={BAND} strokeWidth={2} fill="none" data-band="" />}
      {colLabel && (
        <g fontSize={font} textAnchor="middle" fill={LABEL} className="tabular-nums">
          {Array.from({ length: cols }, (_, c) => {
            const text = colLabel(c);
            return text ? <text key={c} x={x0 + xs[c]! + cell / 2} y={headY} fill={colLabelColor?.(c) ?? LABEL}>{text}</text> : null;
          })}
        </g>
      )}
      {rowLabel && (
        <g fontSize={font} textAnchor="end" fill={LABEL} className="tabular-nums">
          {Array.from({ length: rows }, (_, r) => {
            const text = rowLabel(r);
            return text ? <text key={r} x={labelW - 3} y={yOf(r) + cell / 2 + font * 0.36}>{text}</text> : null;
          })}
        </g>
      )}
    </svg>
  );
}
