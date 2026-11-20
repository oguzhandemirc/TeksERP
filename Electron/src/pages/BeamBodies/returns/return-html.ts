// =============================================================================
// GÖVDE İADE BELGESİ — yazdırılabilir HTML (önizleme ve baskı AYNI string)
// =============================================================================
// Sahibe giden teslim belgesi (çalışma belgesi; donmuş PrintedDocument değil — çözgü talimatı emsali). İçerik
// `GET /api/beam-body-returns/:id`ten; iç kolon yok (yalnız gövde no, rol, en, dara). Saat fabrika diliminden.
// =============================================================================
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { trimNum } from "../model";
import type { BeamBodyReturnDoc } from "../types";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const row = (label: string, value: string) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`;

const CSS = `@page{size:A4;margin:14mm}body{font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;font-size:11pt;color:#111}
h1{font-size:16pt;margin:0 0 2mm}.sub{color:#444;margin-bottom:4mm}table{border-collapse:collapse;width:100%;margin-bottom:4mm}
.kv th{text-align:left;width:32%;font-weight:600;padding:1.5mm 2mm;border-bottom:1px solid #ddd}.kv td{padding:1.5mm 2mm;border-bottom:1px solid #ddd}
.grid th,.grid td{border:1px solid #999;padding:1.5mm 2mm}.grid th{background:#f2f2f2;text-align:left}.n{text-align:right;font-variant-numeric:tabular-nums}
.mono{font-family:ui-monospace,Menlo,Consolas,monospace}.void{border:2px solid #b91c1c;color:#b91c1c;padding:2mm 3mm;margin-bottom:4mm;font-weight:600}
.sign{display:flex;gap:20mm;margin-top:14mm}.sign div{flex:1;border-top:1px solid #333;padding-top:1.5mm;text-align:center}`;

export function buildReturnHtml(d: BeamBodyReturnDoc): string {
  const items = d.items
    .map((it, i) => `<tr><td class="n">${String(i + 1)}</td><td class="mono">${esc(it.bodyNo)}</td><td>${esc(it.ownerRoleLabel)}</td><td class="n">${it.widthCm ? esc(trimNum(it.widthCm)) : "—"}</td><td class="n">${it.tareKg ? esc(trimNum(it.tareKg)) : "—"}</td></tr>`)
    .join("");
  const voided = d.status === "CANCELLED" ? `<div class="void">İPTAL EDİLDİ${d.cancelledAt ? ` — ${esc(fmtFactoryDateTime(d.cancelledAt))}` : ""}${d.cancelReason ? ` · ${esc(d.cancelReason)}` : ""}</div>` : "";
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(d.docNo)}</title><style>${CSS}</style></head><body>
  <h1>LEVENT GÖVDESİ İADE BELGESİ</h1>
  <div class="sub">${esc(d.docNo)} · ${esc(fmtFactoryDateTime(d.returnedAt))}</div>
  ${voided}
  <table class="kv">
    ${row("Teslim alan (sahip)", `${d.owner.name} (${d.owner.code})`)}
    ${row("Plaka", d.plateNumber ?? "—")}
    ${row("Şoför", d.driverName ?? "—")}
    ${d.notes ? row("Not", d.notes) : ""}
  </table>
  <table class="grid"><thead><tr><th class="n">#</th><th>Gövde no</th><th>Sahiplik</th><th class="n">En (cm)</th><th class="n">Dara (kg)</th></tr></thead>
    <tbody>${items}</tbody>
    <tfoot><tr><td colspan="5"><b>Toplam ${String(d.items.length)} boş levent gövdesi</b></td></tr></tfoot></table>
  <div class="sign"><div>Teslim eden</div><div>Teslim alan</div></div>
</body></html>`;
}
