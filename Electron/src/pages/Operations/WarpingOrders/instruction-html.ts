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

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const row = (label: string, value: string) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`;

export function reedText(r: WarpingInstruction["reed"]): string {
  if (!r) return "—";
  return [r.reedNo && `No ${r.reedNo}`, r.reedWidthCm && `${trimNum(r.reedWidthCm)} cm`, r.endsPerDent !== null && `dişe ${r.endsPerDent} tel`].filter(Boolean).join(" · ") || "—";
}

function instructionSection(i: WarpingInstruction): string {
  const cards = [`${i.warpSpec.code} — ${i.warpSpec.name}`, ...i.extraSpecs.map((e) => `${e.code} — ${e.name} (ek tel grubu)`)].join("; ");
  const beams = i.beamLines.map((b) => `${b.beamCount} × ${fmtM(b.beamLengthM)} m`).join(" + ");
  const beamRow = isBeamCountOpen(i) ? row("Levent adedi", `devereciye bırakıldı, toplam ${fmtM(i.targetLengthM)} m`) : row("Levent", `${beams} — toplam ${i.beamCount} levent, ${fmtM(i.targetLengthM)} m`);
  const yarns = i.yarns
    .map((y) => `<tr><td class="c">${esc(y.letter)}</td><td>${esc(y.code)} — ${esc(y.name)}</td><td class="n">${String(y.endsCount)}</td><td class="n">${esc(trimNum(y.denier))}</td></tr>`)
    .join("");
  return `<section>
    <h1>ÇÖZGÜ TALİMATI</h1>
    <div class="sub">Sipariş ${esc(i.orderNo)} · Devereci ${esc(i.subcontractor.name)} (${esc(i.subcontractor.code)})</div>
    <table class="kv">
      ${row("Çözgü kartı", cards)}
      ${beamRow}
      ${row("Toplam tel", String(i.totalEnds))}
      ${row("Tarak", reedText(i.reed))}
      ${row("Termin", i.expectedReturnAt ? fmtFactoryDate(i.expectedReturnAt) : "—")}
    </table>
    <table class="grid"><thead><tr><th class="c">Harf</th><th>İplik</th><th class="n">Tel</th><th class="n">Denye</th></tr></thead><tbody>${yarns}</tbody></table>
    <div class="box"><b>Dizilim:</b> ${i.sequenceNote ? esc(i.sequenceNote) : "—"}</div>
    ${i.notes ? `<div class="box"><b>Not:</b> ${esc(i.notes)}</div>` : ""}
  </section>`;
}

function dispatchSection(d: WarpingDispatchRow, i: WarpingInstruction): string {
  const items = d.items
    .map((it) => `<tr><td>${esc(it.yarnItemCode)} — ${esc(it.yarnItemName)}</td><td>${esc(it.lotNo ?? "—")}</td><td>${esc(it.warehouseName ?? "—")}</td><td class="n">${esc(fmtKg(it.outKg))}</td></tr>`)
    .join("");
  return `<section class="break">
    <h1>İPLİK SEVK İRSALİYESİ</h1>
    <div class="sub">${esc(d.dispatchNo)} · ${esc(fmtFactoryDateTime(d.dispatchedAt))}</div>
    <table class="kv">
      ${row("Devereci", `${i.subcontractor.name} (${i.subcontractor.code})`)}
      ${row("Sipariş", `${i.orderNo} — ${i.warpSpec.code}`)}
    </table>
    <table class="grid"><thead><tr><th>İplik</th><th>Lot</th><th>Çıkış deposu</th><th class="n">Kg</th></tr></thead>
      <tbody>${items}</tbody>
      <tfoot><tr><td colspan="3"><b>Toplam</b></td><td class="n"><b>${esc(fmtKg(d.totalOutKg))}</b></td></tr></tfoot></table>
    <div class="sign"><div>Teslim eden</div><div>Teslim alan</div></div>
  </section>`;
}

const CSS = `@page{size:A4;margin:14mm}body{font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;font-size:11pt;color:#111}
h1{font-size:16pt;margin:0 0 2mm}.sub{color:#444;margin-bottom:4mm}table{border-collapse:collapse;width:100%;margin-bottom:4mm}
.kv th{text-align:left;width:32%;font-weight:600;padding:1.5mm 2mm;border-bottom:1px solid #ddd}.kv td{padding:1.5mm 2mm;border-bottom:1px solid #ddd}
.grid th,.grid td{border:1px solid #999;padding:1.5mm 2mm}.grid th{background:#f2f2f2;text-align:left}.grid th.n{text-align:right}.grid th.c{text-align:center}.n{text-align:right;font-variant-numeric:tabular-nums}.c{text-align:center;width:12mm}
.box{border:1px solid #999;padding:2mm 3mm;margin-bottom:3mm;white-space:pre-wrap}.break{page-break-after:always}
.sign{display:flex;gap:20mm;margin-top:14mm}.sign div{flex:1;border-top:1px solid #333;padding-top:1.5mm;text-align:center}`;

/** Tam belge; `dispatch` verilirse irsaliye önce, talimat ayrı sayfada. */
export function buildInstructionHtml(i: WarpingInstruction, dispatch?: WarpingDispatchRow | null): string {
  const title = dispatch ? `${dispatch.dispatchNo} — ${i.orderNo}` : `Çözgü talimatı ${i.orderNo}`;
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>${dispatch ? dispatchSection(dispatch, i) : ""}${instructionSection(i)}</body></html>`;
}
