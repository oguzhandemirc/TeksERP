// =============================================================================
// ÇÖZGÜ TALİMATI (+ isteğe bağlı İPLİK SEVK İRSALİYESİ) — yazdırılabilir HTML (önizleme ve baskı AYNI string)
// =============================================================================
// Devereciye giden çalışma belgesidir — donmuş/versiyonlu PrintedDocument DEĞİL (çeki listesi statüsü). İçerik
// `GET /:id/instruction` ve sevk listesinden; iç kolon (maliyet, fire, stok, ücret) YOK — yalnız devecinin işi.
// Saatler fabrika diliminden (`factory-time`). Sevk irsaliyesi seçilirse talimattan önce, sayfa sonuyla ayrılır.
// =============================================================================
import { fmtFactoryDate, fmtFactoryDateTime } from "@/lib/factory-time";
import { fmtKg, fmtM, isBeamCountOpen, trimNum } from "./order-model";
import type { WarpingDispatchRow, WarpingInstruction } from "./yarn-types";
import { reedPlanHtml, reedPlanText, VISUAL_CSS, warpEndsStripHtml } from "./instruction-visual-html";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** İplik ADI birincil, stok kodu küçük gri (panelin `YarnLabel` biçimiyle aynı). */
const yarnCell = (name: string, code: string) => `${esc(name || code)}${name && code && code !== name ? ` <span class="code">${esc(code)}</span>` : ""}`;

const row = (label: string, value: string) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`;

export function reedText(r: WarpingInstruction["reed"]): string {
  if (!r) return "—";
  return [r.reedNo && `No ${r.reedNo}`, r.reedWidthCm && `${trimNum(r.reedWidthCm)} cm`, r.endsPerDent !== null && `dişe ${r.endsPerDent} tel`].filter(Boolean).join(" · ") || "—";
}

function instructionSection(i: WarpingInstruction): string {
  const cards = [`${i.warpSpec.name} (${i.warpSpec.code})`, ...i.extraSpecs.map((e) => `${e.name} (${e.code}, ek tel grubu)`)].join("; ");
  const beams = i.beamLines.map((b) => `${b.beamCount} × ${fmtM(b.beamLengthM)} m`).join(" + ");
  const beamRow = isBeamCountOpen(i) ? row("Levent adedi", `devereciye bırakıldı, toplam ${fmtM(i.targetLengthM)} m`) : row("Levent", `${beams} — toplam ${i.beamCount} levent, ${fmtM(i.targetLengthM)} m`);
  const reedPlan = reedPlanText(i.reed?.endsPerDent ?? null, i.totalEnds, i.selvedgeEnds);
  const yarns = i.yarns
    .map((y) => `<tr><td class="c">${esc(y.letter)}</td><td>${yarnCell(y.name, y.code)}</td><td class="n">${String(y.endsCount)}</td><td class="n">${esc(trimNum(y.denier))}</td></tr>`)
    .join("");
  return `<section>
    <h1>ÇÖZGÜ TALİMATI</h1>
    <div class="sub">Sipariş ${esc(i.orderNo)} · Devereci ${esc(i.subcontractor.name)} (${esc(i.subcontractor.code)})</div>
    <table class="kv">
      ${row("Çözgü kartı", cards)}
      ${beamRow}
      ${row("Toplam tel", String(i.totalEnds))}
      ${row("Tarak", reedText(i.reed))}
      ${reedPlan ? row("Tarak planı", reedPlan) : ""}
      ${row("Termin", i.expectedReturnAt ? fmtFactoryDate(i.expectedReturnAt) : "—")}
    </table>
    <table class="grid"><thead><tr><th class="c">Harf</th><th>İplik</th><th class="n">Tel</th><th class="n">Denye</th></tr></thead><tbody>${yarns}</tbody></table>
    <div class="box"><b>Dizilim:</b> ${i.sequenceNote ? esc(i.sequenceNote) : "—"}</div>
    ${warpEndsStripHtml(i.endsSequence, i.yarns)}
    ${reedPlanHtml(i.reed?.endsPerDent ?? null, i.totalEnds, i.selvedgeEnds, i.endsSequence)}
    ${i.notes ? `<div class="box"><b>Not:</b> ${esc(i.notes)}</div>` : ""}
  </section>`;
}

const countCell = (v: number | null | undefined) => `<td class="n">${v == null ? "—" : String(v)}</td>`;

/** B4: iplikle giden boş gövdeler — yalnız varsa basılır (gövdesiz irsaliye B2 öncesiyle bayt-aynı). */
function beamBodiesBox(d: WarpingDispatchRow): string {
  const bs = d.beamBodies ?? [];
  if (bs.length === 0) return "";
  const list = bs.map((b) => `${esc(b.bodyNo)}${b.ownerName ? ` (${esc(b.ownerName)})` : ""}`).join(", ");
  return `<div class="box"><b>Boş levent gövdeleri (${String(bs.length)}):</b> ${list}</div>`;
}

function dispatchSection(d: WarpingDispatchRow, i: WarpingInstruction): string {
  // H2: koli/bobin sütunu yalnız bir kalemde girildiyse basılır — adetsiz sevkin irsaliyesi H1 öncesiyle aynı.
  const pc = d.items.some((it) => it.packageCount != null);
  const bc = d.items.some((it) => it.bobbinCount != null);
  const items = d.items
    .map((it) => `<tr><td>${yarnCell(it.yarnItemName, it.yarnItemCode)}</td><td>${esc(it.lotNo ?? "—")}</td><td>${esc(it.warehouseName ?? "—")}</td>${pc ? countCell(it.packageCount) : ""}${bc ? countCell(it.bobbinCount) : ""}<td class="n">${esc(fmtKg(it.outKg))}</td></tr>`)
    .join("");
  const countHead = `${pc ? `<th class="n">Koli</th>` : ""}${bc ? `<th class="n">Bobin</th>` : ""}`;
  const countFoot = `${pc ? `<td class="n"><b>${String(d.totalPackageCount ?? d.items.reduce((s, it) => s + (it.packageCount ?? 0), 0))}</b></td>` : ""}${bc ? `<td class="n"><b>${String(d.totalBobbinCount ?? d.items.reduce((s, it) => s + (it.bobbinCount ?? 0), 0))}</b></td>` : ""}`;
  return `<section class="break">
    <h1>İPLİK SEVK İRSALİYESİ</h1>
    <div class="sub">${esc(d.dispatchNo)} · ${esc(fmtFactoryDateTime(d.dispatchedAt))}</div>
    <table class="kv">
      ${row("Devereci", `${i.subcontractor.name} (${i.subcontractor.code})`)}
      ${row("Sipariş", `${i.orderNo} — ${i.warpSpec.name}`)}
    </table>
    <table class="grid"><thead><tr><th>İplik</th><th>Lot</th><th>Çıkış deposu</th>${countHead}<th class="n">Kg</th></tr></thead>
      <tbody>${items}</tbody>
      <tfoot><tr><td colspan="3"><b>Toplam</b></td>${countFoot}<td class="n"><b>${esc(fmtKg(d.totalOutKg))}</b></td></tr></tfoot></table>
    ${beamBodiesBox(d)}
    <div class="sign"><div>Teslim eden</div><div>Teslim alan</div></div>
  </section>`;
}

const CSS = `@page{size:A4;margin:14mm}body{font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;font-size:11pt;color:#111}
h1{font-size:16pt;margin:0 0 2mm}.code{color:#666;font-size:8pt}.sub{color:#444;margin-bottom:4mm}table{border-collapse:collapse;width:100%;margin-bottom:4mm}
.kv th{text-align:left;width:32%;font-weight:600;padding:1.5mm 2mm;border-bottom:1px solid #ddd}.kv td{padding:1.5mm 2mm;border-bottom:1px solid #ddd}
.grid th,.grid td{border:1px solid #999;padding:1.5mm 2mm}.grid th{background:#f2f2f2;text-align:left}.grid th.n{text-align:right}.grid th.c{text-align:center}.n{text-align:right;font-variant-numeric:tabular-nums}.c{text-align:center;width:12mm}
.box{border:1px solid #999;padding:2mm 3mm;margin-bottom:3mm;white-space:pre-wrap}.break{page-break-after:always}
.sign{display:flex;gap:20mm;margin-top:14mm}.sign div{flex:1;border-top:1px solid #333;padding-top:1.5mm;text-align:center}
${VISUAL_CSS}`;

/** Tam belge; `dispatch` verilirse irsaliye önce, talimat ayrı sayfada. */
export function buildInstructionHtml(i: WarpingInstruction, dispatch?: WarpingDispatchRow | null): string {
  const title = dispatch ? `${dispatch.dispatchNo} — ${i.orderNo}` : `Çözgü talimatı ${i.orderNo}`;
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>${dispatch ? dispatchSection(dispatch, i) : ""}${instructionSection(i)}</body></html>`;
}
