// =============================================================================
// KUSURLU SARIM RET BELGESİ — yazdırılabilir HTML (önizleme ve baskı AYNI string; B2 iade belgesi emsali)
// =============================================================================
// Devereciye giden belge; içerik `GET /api/warping-beam-rejections/:id`ten (DTO = basım verisi). İç kolon yok:
// fiyat/fatura/tutma basılmaz — yalnız sarım no, gövde, metre, tel, irsaliye ve sebep. Saat fabrika diliminden.
// =============================================================================
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { fmtM } from "./order-model";
import type { WarpingBeamRejection } from "./rejection-types";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const row = (label: string, value: string) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`;

const CSS = `@page{size:A4;margin:14mm}body{font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;font-size:11pt;color:#111}
h1{font-size:16pt;margin:0 0 2mm}.sub{color:#444;margin-bottom:4mm}table{border-collapse:collapse;width:100%;margin-bottom:4mm}
.kv th{text-align:left;width:32%;font-weight:600;padding:1.5mm 2mm;border-bottom:1px solid #ddd}.kv td{padding:1.5mm 2mm;border-bottom:1px solid #ddd}
.grid th,.grid td{border:1px solid #999;padding:1.5mm 2mm}.grid th{background:#f2f2f2;text-align:left}.n{text-align:right;font-variant-numeric:tabular-nums}
.mono{font-family:ui-monospace,Menlo,Consolas,monospace}.void{border:2px solid #b91c1c;color:#b91c1c;padding:2mm 3mm;margin-bottom:4mm;font-weight:600}
.mode{border:1px solid #333;padding:2mm 3mm;margin-bottom:4mm;font-weight:600}
.sign{display:flex;gap:20mm;margin-top:14mm}.sign div{flex:1;border-top:1px solid #333;padding-top:1.5mm;text-align:center}`;

export const REJECT_MODE_TEXT = {
  REWORK: "Yeniden sarılması istenir — yeniden sarılan levent bu belgeye bağlanır.",
  CANCEL: "Yeniden sarım istenmez — iplik deverecide kalır.",
} as const;

export function buildRejectionHtml(d: WarpingBeamRejection): string {
  const items = d.items
    .map((it, i) => `<tr><td class="n">${String(i + 1)}</td><td class="mono">${esc(it.beamNo)}</td><td class="mono">${esc(it.bodyNo ?? "—")}</td><td class="n">${it.lengthM ? esc(fmtM(it.lengthM)) : "—"}</td><td class="n">${it.endsCount === null ? "—" : String(it.endsCount)}</td><td>${esc(it.deliveryNoteNo ?? "—")}</td></tr>`)
    .join("");
  const voided = d.status === "CANCELLED" ? `<div class="void">İPTAL EDİLDİ${d.cancelledAt ? ` — ${esc(fmtFactoryDateTime(d.cancelledAt))}` : ""}${d.cancelReason ? ` · ${esc(d.cancelReason)}` : ""}</div>` : "";
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(d.docNo)}</title><style>${CSS}</style></head><body>
  <h1>KUSURLU LEVENT RET BELGESİ</h1>
  <div class="sub">${esc(d.docNo)} · ${esc(fmtFactoryDateTime(d.rejectedAt))}</div>
  ${voided}
  <table class="kv">
    ${row("Devereci", `${d.subcontractor.name} (${d.subcontractor.code})`)}
    ${row("Devere siparişi", d.order.orderNo)}
    ${row("Çözgü kartı", `${d.order.warpSpec.name} (${d.order.warpSpec.code})`)}
    ${row("Ret sebebi", d.reason.text)}
    ${d.notes ? row("Not", d.notes) : ""}
    ${d.photos.length > 0 ? row("Fotoğraf", `${String(d.photos.length)} adet (kayıtta)`) : ""}
  </table>
  <div class="mode">${esc(REJECT_MODE_TEXT[d.mode])}</div>
  <table class="grid"><thead><tr><th class="n">#</th><th>Levent</th><th>Gövde</th><th class="n">Metre</th><th class="n">Tel</th><th>Dönüş irsaliyesi</th></tr></thead>
    <tbody>${items}</tbody>
    <tfoot><tr><td colspan="6"><b>Toplam ${String(d.totals.beamCount)} levent · ${esc(fmtM(d.totals.lengthM))} m</b></td></tr></tfoot></table>
  <div class="sign"><div>Teslim eden</div><div>Teslim alan (devereci)</div></div>
</body></html>`;
}
