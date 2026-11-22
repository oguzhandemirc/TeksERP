// Çözgü talimatı basımının görsel parçaları (saf HTML string): tel düzeni şeridi + tarak planı. Siyah-beyaz
// yazıcı için GRİ TON + HARF (karar 3a); inline SVG, birimler mm, CSS'te calc()/var() yok. Açılım sunucudan
// (`endsSequence`); burada yalnız kaç rapor çizileceği ve tarak örneği seçilir (paneldeki `warp-ends` ile aynı).
import { reedSample, repeatsToShow, type WarpEndsSequenceView } from "@/components/weave/warp-ends";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Basılı şeridin genişliği (mm, A4 14 mm kenar boşluğuyla sığar). */
const STRIP_MM = 178;
/** Tek raporda çizilecek tel tavanı; uzun raporun başı basılır, gerisi notla. */
const MAX_PRINT_ENDS = 120;
const GRAYS = ["#1a1a1a", "#8c8c8c", "#d0d0d0", "#555555", "#ffffff", "#b0b0b0"];
const SELVEDGE_GRAY = "#efefef";

/** 1-tabanlı iplik no → gri ton + üstündeki harfin rengi. */
export function printGray(n: number): { fill: string; ink: string } {
  const fill = GRAYS[(Math.max(1, n) - 1) % GRAYS.length]!;
  const dark = fill === "#1a1a1a" || fill === "#555555" || fill === "#8c8c8c";
  return { fill, ink: dark ? "#ffffff" : "#111111" };
}

const letterOf = (n: number) => String.fromCharCode(64 + n);
const fmt = (n: number) => String(Math.round(n * 100) / 100);

interface Cell { yarn: number; selvedge?: boolean }

/** Tek satır kare şerit SVG'si; `bandEvery` her N hücrede kalın çizgi, `gapsBefore` diş aralığı. */
function stripSvg(cells: readonly Cell[], cellMm: number, label: string, opts: { bandEvery?: number; gapsBefore?: readonly number[] } = {}): string {
  const { bandEvery, gapsBefore = [] } = opts;
  const gaps = new Set(gapsBefore.filter((g) => g > 0));
  const gap = gaps.size > 0 ? Math.max(0.8, cellMm * 0.5) : 0;
  let x = 0;
  const xs = cells.map((_, i) => {
    if (gaps.has(i)) x += gap;
    const at = x;
    x += cellMm;
    return at;
  });
  const w = x + 0.4;
  const h = cellMm + 0.4;
  const showLetter = cellMm >= 3.2;
  const parts = cells.map((c, i) => {
    const g = c.selvedge ? { fill: SELVEDGE_GRAY, ink: "#666666" } : printGray(c.yarn);
    const rect = `<rect x="${fmt(xs[i]! + 0.2)}" y="0.2" width="${fmt(cellMm)}" height="${fmt(cellMm)}" fill="${g.fill}" stroke="#444" stroke-width="0.15"/>`;
    const text = showLetter && !c.selvedge
      ? `<text x="${fmt(xs[i]! + 0.2 + cellMm / 2)}" y="${fmt(0.2 + cellMm * 0.68)}" font-size="${fmt(cellMm * 0.55)}" text-anchor="middle" fill="${g.ink}">${letterOf(c.yarn)}</text>`
      : "";
    return rect + text;
  });
  const bands = bandEvery && bandEvery < cells.length
    ? cells.map((_, i) => (i > 0 && i % bandEvery === 0 ? `<line x1="${fmt(xs[i]! + 0.2)}" y1="0" x2="${fmt(xs[i]! + 0.2)}" y2="${fmt(h)}" stroke="#000" stroke-width="0.6"/>` : "")).join("")
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(label)}" width="${fmt(w)}mm" height="${fmt(h)}mm" viewBox="0 0 ${fmt(w)} ${fmt(h)}" font-family="Arial,sans-serif">${parts.join("")}${bands}</svg>`;
}

function swatch(fill: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="3.2mm" height="3.2mm" viewBox="0 0 3.2 3.2" class="sw"><rect x="0.2" y="0.2" width="2.8" height="2.8" fill="${fill}" stroke="#444" stroke-width="0.2"/></svg>`;
}

export interface PrintYarn { letter: string; name: string; code: string }

/** Tel düzeni bloğu: şerit + "rapor × tekrar = toplam" + gri ton lejantı. Açılım yoksa boş string. */
export function warpEndsStripHtml(seq: WarpEndsSequenceView | null | undefined, yarns: readonly PrintYarn[]): string {
  if (!seq || seq.repeat.length === 0) return "";
  const len = seq.repeat.length;
  const drawLen = Math.min(len, MAX_PRINT_ENDS);
  const shown = len > MAX_PRINT_ENDS ? 1 : repeatsToShow(len, 60);
  const cells: Cell[] = [];
  for (let r = 0; r < shown; r++) for (let i = 0; i < drawLen; i++) cells.push({ yarn: seq.repeat[i]! });
  const cellMm = Math.max(1.2, Math.min(6, STRIP_MM / cells.length));
  const svg = stripSvg(cells, cellMm, `Tel düzeni: ${len} tellik rapor`, { bandEvery: shown > 1 ? len : undefined });
  const sum = `Rapor ${len} tel × ${seq.repeatCount} tekrar${seq.remainder > 0 ? ` + ${seq.remainder} tel` : ""} = ${seq.totalEnds} tel`
    + (shown > 1 ? ` · şeritte ${shown} rapor` : "")
    + (len > MAX_PRINT_ENDS ? ` · raporun ilk ${MAX_PRINT_ENDS} teli basıldı` : "");
  const used = [...new Set(seq.repeat)].sort((a, b) => a - b);
  const legend = used.map((n) => {
    const y = yarns[n - 1];
    return `<span class="lg">${swatch(printGray(n).fill)} <b>${esc(y?.letter ?? letterOf(n))}</b> ${esc(y ? y.name || y.code : "")}</span>`;
  }).join("");
  const warn = seq.matchesYarnEnds ? "" : `<div class="warn">Dizilim iplik satırlarındaki telleri tutmuyor — kartı kontrol edin.</div>`;
  return `<div class="viz"><div class="vt">Tel düzeni (çözgü raporu, soldan sağa)</div>${svg}<div class="vs">${esc(sum)}</div><div class="vl">${legend}</div>${warn}</div>`;
}

/** Tarak planı metni ("dişe 2 tel · kenar her yanda 16 tel (8 diş) · ≈ 1766 diş"); diş bilgisi yoksa null. */
export function reedPlanText(endsPerDent: number | null, totalEnds: number, selvedgeEnds: number | null | undefined): string | null {
  const s = reedSample({ endsPerDent, totalEnds, selvedgeEnds });
  if (!s) return null;
  return [
    `Dişe ${endsPerDent} tel`,
    s.selvedgePerSide > 0 ? `kenar her yanda ${s.selvedgePerSide} tel (${s.selvedgeDents} diş)` : null,
    `≈ ${s.totalDents} diş`,
  ].filter(Boolean).join(" · ");
}

/** Tarak planı örneği (sol kenardan birkaç diş; kenar teli açık gri). Diş bilgisi yoksa boş string. */
export function reedPlanHtml(endsPerDent: number | null, totalEnds: number, selvedgeEnds: number | null | undefined, seq: WarpEndsSequenceView | null | undefined): string {
  const text = reedPlanText(endsPerDent, totalEnds, selvedgeEnds);
  const s = reedSample({ endsPerDent, totalEnds, selvedgeEnds, repeat: seq?.repeat, groundDentsShown: 10 });
  if (!text || !s) return "";
  const cells: Cell[] = s.cells.map((v) => (v === 0 ? { yarn: 1, selvedge: true } : { yarn: v }));
  const svg = stripSvg(cells, 4, `Tarak planı örneği: dişe ${endsPerDent} tel`, { gapsBefore: s.dentStarts });
  const legend = s.shownSelvedgeDents > 0 ? `<div class="vl"><span class="lg">${swatch(SELVEDGE_GRAY)} Kenar teli</span></div>` : "";
  return `<div class="viz"><div class="vt">Tarak planı (sol kenardan ilk ${s.dentStarts.length} diş)</div>${svg}<div class="vs">${esc(text)}</div>${legend}</div>`;
}

export const VISUAL_CSS = `.viz{border:1px solid #999;padding:2mm 3mm;margin-bottom:3mm;page-break-inside:avoid}.viz svg{display:block}.vt{font-weight:600;font-size:9.5pt;margin-bottom:1.5mm}
.vs{font-size:9.5pt;margin-top:1.5mm;font-variant-numeric:tabular-nums}.vl{font-size:9pt;margin-top:1mm}.lg{display:inline-block;margin-right:5mm;white-space:nowrap}.lg .sw{display:inline-block;vertical-align:-0.5mm}
.warn{font-size:9pt;margin-top:1mm;font-weight:600}`;
