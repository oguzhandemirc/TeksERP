// =============================================================================
// DESEN KARTI A4 basımı (Seyitoğlu dilim b) — ustaya giden kâğıt, SAF renderer
// =============================================================================
// Fabrikanın bugünkü kâğıdının düzeni: başlık DESEN NO, armür ızgarası (döner çerçeveler ayrı blok),
// sağda atkı seçici bloğu (1./2./3.), altta çözgü, atkı sıklığı, atkı iplikleri; ek olarak varyantlar.
// ANLIK iç belge: donmuş PrintedDocument yok (kart canlı, basım = o anki kart); içerik görünüm modelinden
// (`weave-card.service`), burada hesap yok. Saat yalnız `fmt-date` (fabrika dilimi).
// =============================================================================
import { escapeHtml } from "../helpers/label-html.shared";
import type { WeaveDrawdown } from "../helpers/weave-drawdown.helper";
import { TERIM } from "../../constants/terim";

export interface WeaveCardYarn {
  code: string;
  name: string;
  /** Biçimlenmiş denye ("70"); boşsa null. */
  denier: string | null;
}

export interface WeaveCardView {
  /** Desen no = satılan kumaşın kodu (K1). */
  designNo: string;
  itemName: string;
  design: {
    code: string; name: string; kindLabel: string; familyLabel: string | null; frameCount: number | null;
    repeatCm: string | null; loomFileName: string | null; lenoSetup: string | null;
    /** Jakar: kanca sayısı + rapor eni (yalnız Jakar kartında dolu; null = basılmaz). */
    hookCount?: number | null; repeatWidthCm?: string | null;
    /** Tahar düzeni notu; null = satır basılmaz (bugünkü görünüm). */
    drawingInNote: string | null;
    /** Tahar türü adı (K1: "Sivri"); ikisi de boşsa satır basılmaz. Yok = bugünkü basım. */
    drawingInTypeLabel?: string | null;
  } | null;
  liftPlan: number[][] | null;
  /** 1-tabanlı döner çerçeve no'ları. */
  lenoFrames: number[];
  /** 1-tabanlı kenar çerçeve no'ları ("K" başlıklı ayrı blok); yok/boş = bugünkü basım. */
  selvedgeFrames?: number[];
  /** Atkı başına 1-tabanlı iplik satırı no; null = seçici kodu yok. */
  pickSequence: number[] | null;
  weft: {
    code: string; name: string; picksPerCm: string | null; weftProgramNo: string | null; sequenceCode: string | null;
    /** `colorChannel` (K6): renk seçici kanalı; yok/null = basılmaz (bayt-aynı). */
    yarns: Array<WeaveCardYarn & { no: number; picksInRepeat: number; colorChannel?: number | null }>;
  } | null;
  warps: Array<{ roleLabel: string; code: string; name: string; lines: Array<WeaveCardYarn & { endsCount: number }> }>;
  widthCm: string | null;
  variants: Array<{ variantCode: string | null; name: string; swaps: Array<WeaveCardYarn & { no: number }> }>;
  warnings: string[];
  printedAtText: string;
  /** İş emrinden basımda iş emri no; ürün kartında null/yok (bugünkü başlık). */
  weavingOrderNumber?: string | null;
  /** Kumaş görünümü (servis `computeDrawdown`); LENO = açıklama, null/yok = armür yok (blok basılmaz). */
  fabric?: ({ kind: "DRAWDOWN" } & WeaveDrawdown) | { kind: "LENO" } | null;
}

/** "TAHAR : Sivri · not" — tür ve not ayrı ayrı boş olabilir; ikisi de boşsa satır yok (bugünkü basım bayt-aynı). */
function taharHtml(d: WeaveCardView["design"]): string {
  const parts = [d?.drawingInTypeLabel, d?.drawingInNote].filter((x): x is string => !!x).map(e);
  return parts.length ? `<div class="kv"><b>TAHAR :</b> ${parts.join(" · ")}</div>` : "";
}

/** Basım gri tonları (siyah-beyaz yazıcı): 0 = çözgü üstte, k = k. atkı ipliği. */
const FABRIC_TONES = ["#222", "#fff", "#b8b8b8", "#7a7a7a", "#e0e0e0", "#999", "#d0d0d0", "#5c5c5c"];
const fabricTone = (v: number): string => FABRIC_TONES[v] ?? FABRIC_TONES[1 + ((v - 1) % (FABRIC_TONES.length - 1))]!;

/** Tahar şeridi (üstte, 1. çerçeve alt satırda) + kumaş görünümü; tek SVG, renk başına tek `<path>`. */
function fabricHtml(v: WeaveCardView): string {
  const f = v.fabric;
  if (!f) return "";
  // Stil blokla birlikte: kumaş görünümü olmayan kartın basımı bayt-aynı kalır.
  const css = `<style>.bottom>.fabric{flex:0 0 52mm}.fab{display:block;margin:1mm 0}</style>`;
  if (f.kind === "LENO") {
    return `<div class="fabric">${css}<h3>KUMAŞ GÖRÜNÜMÜ</h3><p class="muted">Döner (leno) desende kumaş görünümü çizilmez: çapraz dönen teller kare ızgarayla gösterilemez.</p></div>`;
  }
  const g = f.groundFrames.length;
  const top = g + 1;
  const rows = top + f.picks;
  const cell = Math.round(Math.min(2.2, 48 / f.ends, 70 / rows) * 100) / 100;
  const paths = new Map<number, string[]>();
  const add = (val: number, x: number, y: number): void => { (paths.get(val) ?? paths.set(val, []).get(val)!).push(`M${x} ${y}h1v1h-1z`); };
  f.threading.forEach((fr, x) => add(0, x, g - 1 - f.groundFrames.indexOf(fr)));
  f.cells.forEach((row, j) => row.forEach((val, x) => { if (val !== 1) add(val, x, top + j); }));
  const lines: string[] = [];
  for (let x = 0; x <= f.ends; x++) lines.push(`M${x} 0v${g}M${x} ${top}v${f.picks}`);
  for (let y = 0; y <= g; y++) lines.push(`M0 ${y}h${f.ends}`);
  for (let y = 0; y <= f.picks; y++) lines.push(`M0 ${top + y}h${f.ends}`);
  const body = [...paths.entries()].map(([val, d]) => `<path fill="${fabricTone(val)}" d="${d.join("")}"/>`).join("");
  const svg = `<svg class="fab" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f.ends} ${rows}" width="${Math.round(f.ends * cell * 100) / 100}mm" height="${Math.round(rows * cell * 100) / 100}mm" shape-rendering="crispEdges">`
    + `<rect x="0" y="0" width="${f.ends}" height="${g}" fill="#fff"/><rect x="0" y="${top}" width="${f.ends}" height="${f.picks}" fill="${fabricTone(1)}"/>`
    + `${body}<path fill="none" stroke="#999" stroke-width="0.06" d="${lines.join("")}"/></svg>`;
  const tones = (v.weft?.yarns.length ?? 0) > 1 ? ` · atkı ipliği: ${v.weft!.yarns.map((y) => `${y.no}. <i class="sw" style="background:${fabricTone(y.no)}"></i>`).join(" ")}` : "";
  return `<div class="fabric">${css}<h3>KUMAŞ GÖRÜNÜMÜ</h3>${svg}<div class="muted">Üstte tahar (düz tahar varsayıldı, ${g} zemin çerçevesi) · dolu kare = çözgü üstte${tones}</div></div>`;
}

const e = (v: unknown): string => escapeHtml(String(v ?? ""));
/** Boş bırakılan alt satır: usta kâğıda elle ekleyebilsin (bugünkü form gibi). */
const BLANK_ROWS = 6;

function yarnText(y: WeaveCardYarn): string {
  return `${e(y.name)}${y.denier ? ` <span class="den">${e(y.denier)} DN</span>` : ""}`;
}

/** Çerçeve sütunlarını ardışık bloklara böler: döner / kenar / zemin geçişinde yeni blok (kâğıttaki ayrık kutular). */
export function frameBlocks(frames: number, leno: ReadonlySet<number>, selvedge: ReadonlySet<number> = new Set()): number[][] {
  const role = (f: number): number => (leno.has(f) ? 1 : selvedge.has(f) ? 2 : 0);
  const blocks: number[][] = [];
  for (let f = 1; f <= frames; f++) {
    const last = blocks[blocks.length - 1];
    if (last && role(last[0]!) === role(f)) last.push(f);
    else blocks.push([f]);
  }
  return blocks;
}

/** Kenar sütunu stili yalnız kenar işaretli kartta basılır: işaretsiz kartın HTML'i bayt-aynı kalır. */
const SELVEDGE_CSS = `<style>.grid th.selv{background:#fff;border-bottom:0.6mm double #333}.grid td.c.selv{background:#f7f7f7;border-style:dashed}.sw.selv{background:#f7f7f7;border-style:dashed}</style>`;

function gridHtml(v: WeaveCardView): string {
  const plan = v.liftPlan ?? [];
  const frames = plan.reduce((m, r) => Math.max(m, r.length), 0);
  const selCount = v.pickSequence ? (v.weft?.yarns.length ?? 0) : 0;
  const filled = Math.max(plan.length, v.pickSequence?.length ?? 0);
  if (frames === 0 && selCount === 0) return `<p class="empty">Desen örgüsü girilmemiş.</p>`;
  const leno = new Set(v.lenoFrames.filter((f) => f <= frames));
  const selv = new Set((v.selvedgeFrames ?? []).filter((f) => f <= frames && !leno.has(f)));
  const blocks = frameBlocks(frames, leno, selv);
  const cols = frames + selCount + 1 + blocks.length + (selCount ? 1 : 0);
  const cell = Math.max(3.2, Math.min(6.5, 176 / cols));
  const gap = `<td class="gap"></td>`;
  const cls = (f: number): string => (leno.has(f) ? "leno" : selv.has(f) ? "selv" : "");
  const head = [
    `<th class="no"></th>`,
    ...blocks.map((b) => gap + b.map((f) => `<th class="${cls(f)}">${f}${selv.has(f) ? "K" : ""}</th>`).join("")),
    selCount ? gap + Array.from({ length: selCount }, (_, i) => `<th class="sel">${i + 1}.</th>`).join("") : "",
  ].join("");
  const body: string[] = [];
  for (let r = 0; r < filled + BLANK_ROWS; r++) {
    const row = plan[r];
    const pick = r < filled ? v.pickSequence?.[r] : undefined;
    body.push(`<tr><td class="no">${r < filled ? r + 1 : ""}</td>${blocks.map((b) => gap + b.map((f) => {
      const on = row?.[f - 1] === 1;
      return `<td class="c${cls(f) ? ` ${cls(f)}` : ""}">${on ? "X" : ""}</td>`;
    }).join("")).join("")}${selCount ? gap + Array.from({ length: selCount }, (_, i) => `<td class="c sel">${pick === i + 1 ? "X" : ""}</td>`).join("") : ""}</tr>`);
  }
  const legend = [
    leno.size ? `<span class="lg"><i class="sw leno"></i>Döner çerçeve: ${[...leno].join(", ")}</span>` : "",
    selv.size ? `<span class="lg"><i class="sw selv"></i>Kenar çerçeve (K): ${[...selv].join(", ")}</span>` : "",
    selCount ? `<span class="lg">Sağ blok: atkı seçici (hangi atkı ipliği atılır)</span>` : "",
  ].filter(Boolean).join("");
  // CSS ölçüsü (para değil): yüzde birlik mm yeter.
  const mm = Math.round(cell * 100) / 100;
  const pt = Math.round(Math.min(9, cell * 1.6) * 10) / 10;
  return `<style>.grid td.c,.grid th{width:${mm}mm;height:${mm}mm;font-size:${pt}pt}</style>${selv.size ? SELVEDGE_CSS : ""}
<table class="grid"><thead><tr>${head}</tr></thead><tbody>${body.join("")}</tbody></table>${legend ? `<div class="legend">${legend}</div>` : ""}`;
}

function warpsHtml(v: WeaveCardView): string {
  if (v.warps.length === 0) return `<div class="kv"><b>ÇÖZGÜ :</b> —</div>`;
  return v.warps.map((w) => `<div class="kv"><b>ÇÖZGÜ${w.roleLabel ? ` (${e(w.roleLabel)})` : ""} :</b> ${w.lines.map((l) => `${yarnText(l)} <span class="muted">× ${l.endsCount} tel</span>`).join(" + ")} <span class="muted">· ${e(w.code)}</span></div>`).join("");
}

function variantsHtml(v: WeaveCardView): string {
  if (v.variants.length === 0) return "";
  const rows = v.variants.map((x) => `<tr><td>${e(x.variantCode ?? "—")}</td><td>${e(x.name)}</td><td>${x.swaps.length ? x.swaps.map((s) => `${s.no}. atkı → ${yarnText(s)}`).join("<br>") : `<span class="muted">Kart iplikleri</span>`}</td></tr>`).join("");
  return `<h3>VARYANTLAR</h3><table class="list"><thead><tr><th>Varyant</th><th>Ad</th><th>Değişen atkı ipliği</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function renderWeaveDesignCardHtml(v: WeaveCardView): string {
  const d = v.design;
  const meta = [
    d ? `Örgü: <b>${e(d.code)}</b> · ${e(d.name)} (${e(d.kindLabel)})` : "",
    d?.familyLabel ? `Aile: ${e(d.familyLabel)}` : "",
    d?.frameCount ? `Çerçeve: ${d.frameCount}` : "",
    d?.repeatWidthCm && d.repeatCm ? `Desen raporu: ${e(d.repeatWidthCm)} × ${e(d.repeatCm)} cm` : d?.repeatCm ? `Desen raporu: ${e(d.repeatCm)} cm` : "",
    d?.hookCount ? `Kanca: ${d.hookCount}` : "",
    v.widthCm ? `En: ${e(v.widthCm)} cm` : "",
    d?.loomFileName ? `Tezgâh dosyası: ${e(d.loomFileName)}` : "",
    d?.lenoSetup ? `Döner: ${e(d.lenoSetup)}` : "",
  ].filter(Boolean).join(" · ");
  const w = v.weft;
  const weftYarns = w?.yarns.length
    ? `<ol class="yarns">${w.yarns.map((y) => `<li value="${y.no}">${yarnText(y)} <span class="muted">· ${y.picksInRepeat} atkı/rapor</span>${y.colorChannel != null ? ` <b>· Kanal ${y.colorChannel}</b>` : ""}</li>`).join("")}</ol>`
    : `<p class="muted">—</p>`;
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Desen kartı ${e(v.designNo)}</title><style>
@page{size:A4 portrait;margin:10mm}
*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;font-size:10pt}
@media screen{body{padding:10mm}}
h1{text-align:center;font-size:16pt;margin:0 0 2mm}h3{font-size:10pt;margin:4mm 0 1mm}
.sub{text-align:center;font-size:9pt;color:#333;margin-bottom:3mm}
.grid{border-collapse:collapse;margin:0 auto}.grid thead{display:table-header-group}.grid tr{page-break-inside:avoid}
.grid th{font-weight:bold;text-align:center;padding:0}.grid th.leno{background:#e5e5e5}
.grid td.c{border:0.3mm solid #333;text-align:center;font-weight:bold;padding:0;line-height:1}
.grid td.c.leno{background:#f0f0f0}.grid td.gap{width:2.5mm;border:none}
.grid td.no,.grid th.no{width:7mm;text-align:right;padding-right:1mm;font-size:7pt;color:#555;border:none}
.legend{text-align:center;font-size:8pt;margin-top:1.5mm;color:#333}.lg{margin:0 3mm}
.sw{display:inline-block;width:3mm;height:3mm;border:0.3mm solid #333;margin-right:1mm;vertical-align:middle}.sw.leno{background:#e5e5e5}
.bottom{display:flex;gap:8mm;margin-top:4mm;page-break-inside:avoid}.bottom>div{flex:1}
.kv{margin:1mm 0}.den{font-weight:bold}.muted{color:#666;font-size:8.5pt}
.yarns{margin:1mm 0 0 5mm;padding:0}.yarns li{margin:0.6mm 0}
.list{border-collapse:collapse;width:100%;font-size:9pt}.list th,.list td{border:0.3mm solid #999;padding:1mm 1.5mm;text-align:left;vertical-align:top}
.warn{font-size:8pt;color:#8a4b00;margin-top:2mm}.empty{text-align:center;color:#666}
.foot{margin-top:4mm;font-size:7.5pt;color:#666;text-align:right}
</style></head><body>
<h1>DESEN NO : ${e(v.designNo)}</h1>
<div class="sub">${e(v.itemName)}${v.weavingOrderNumber ? ` · ${TERIM.dokumaIsEmri.tekil}: <b>${e(v.weavingOrderNumber)}</b>` : ""}${meta ? `<br>${meta}` : ""}</div>
${gridHtml(v)}
<div class="bottom">
<div><h3>ATKI İPLİKLERİ</h3>${weftYarns}${w?.sequenceCode ? `<div class="kv muted">Atkı raporu: ${e(w.sequenceCode)}</div>` : ""}</div>
<div>${warpsHtml(v)}
${taharHtml(d)}<div class="kv"><b>ATKI SIKLIĞI :</b> ${w?.picksPerCm ? `${e(w.picksPerCm)} ATKI/CM` : "—"}</div>
${w ? `<div class="kv muted">Atkı kartı: ${e(w.code)} · ${e(w.name)}${w.weftProgramNo ? ` · Program ${e(w.weftProgramNo)}` : ""}</div>` : ""}</div>${fabricHtml(v)}
</div>
${variantsHtml(v)}
${v.warnings.length ? `<div class="warn">${v.warnings.map((x) => `⚠ ${e(x)}`).join("<br>")}</div>` : ""}
<div class="foot">Basım: ${e(v.printedAtText)}</div>
</body></html>`;
}
