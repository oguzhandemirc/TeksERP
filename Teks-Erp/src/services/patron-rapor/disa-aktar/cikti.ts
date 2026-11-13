// =============================================================================
// Patron rapor dosyası — TEK spec → Excel sayfaları + PDF HTML'i. Panelin `_components/reportExport.ts` v2 yolunun
// AYNASI (`toSheetsV2`, `buildReportHtmlV2`; düzen/SVG dalı yok) — altın dosya bayt bayt ölçer.
// HTML dış kaynak yüklemez (çevrimdışı PDF); her kullanıcı metni `esc`ten geçer.
// =============================================================================
import { factoryDateTimeTr } from "../../../constants/time";
import { reportCellText, reportExcelNumFmt } from "./sayi";
import type { ExportBlok, ReportColumn, ReportExportSpec, ReportTableSpec } from "./spec";

export interface SheetColumn {
  header: string;
  key: string;
  width?: number;
  numFmt?: string;
  align?: "left" | "right";
}

export interface SheetSpec {
  name: string;
  columns: SheetColumn[];
  rows: Array<Record<string, unknown>>;
  totalRow?: Record<string, unknown>;
  notes?: string[];
  preamble?: Array<Array<string | number | null>>;
}

const WHAT_WE_SEE = "Ne görüyoruz?";
const WHAT_IT_COUNTS = "Bu rapor ne sayar?";

/** Üst bloğun bağlam satırları — PDF başlığı ve Excel ön satırları AYNI metin; basım anı fabrika diliminde. */
function v2ContextLines(spec: ReportExportSpec): string[] {
  const basim = factoryDateTimeTr(spec.basimAni ?? new Date());
  return [
    ...(spec.soru ? [spec.soru] : []),
    ...(spec.subtitle ? [`Dönem: ${spec.subtitle}`] : []),
    ...(spec.kiyasDonemi ? [`Kıyas: ${spec.kiyasDonemi}`] : []),
    ...(spec.parametreCumlesi ? [spec.parametreCumlesi] : []),
    ...(spec.meta ?? []),
    `Basım: ${basim}`,
  ];
}

// ---------- Excel ----------
function tableToSheet(t: ReportTableSpec, preamble: SheetSpec["preamble"]): SheetSpec {
  const cell = (c: ReportColumn, v: unknown) => (!c.numFmt && typeof v === "number" && !Number.isInteger(v) ? String(v) : v);
  const row = (r: Record<string, unknown>) => Object.fromEntries(t.columns.map((c) => [c.key, cell(c, r[c.key])]));
  return {
    name: t.name,
    preamble,
    columns: t.columns.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.width,
      ...(c.numFmt ? { numFmt: reportExcelNumFmt(c.numFmt) } : {}),
      ...(c.align ? { align: c.align } : {}),
    })),
    rows: t.rows.map(row),
    ...(t.totalRow ? { totalRow: row(t.totalRow) } : {}),
    ...(t.notes?.length ? { notes: t.notes } : {}),
  };
}

/** "Özet" (ana sayı + anlatı + tanımlar + uyarılar) · grafik veri sayfası · tablolar; her sayfanın üstünde bağlam. */
export function toSheets(spec: ReportExportSpec): SheetSpec[] {
  const preamble = [[spec.title], ...v2ContextLines(spec).map((m) => [m])];
  const summaryRows: Array<Record<string, unknown>> = [];
  for (const b of spec.bloklar) {
    if (b.tur === "anaSayi") for (const k of b.kartlar) summaryRows.push({ b: k.ana ? "Ana sayı" : "Yan sayı", a: k.ad, d: k.deger, k: k.kiyas ?? "" });
    else if (b.tur === "anlati") for (const c of b.cumleler) summaryRows.push({ b: WHAT_WE_SEE, a: c, d: "", k: "" });
    else if (b.tur === "tanimlar") for (const t of b.satirlar) summaryRows.push({ b: WHAT_IT_COUNTS, a: t.ad, d: t.aciklama, k: "" });
  }
  for (const u of spec.uyarilar ?? []) summaryRows.push({ b: "Uyarı", a: u, d: "", k: "" });
  const summarySheet: SheetSpec = {
    name: "Özet",
    preamble,
    columns: [
      { header: "Bölüm", key: "b", width: 18 },
      { header: "Ad", key: "a", width: 60 },
      { header: "Değer", key: "d", width: 40 },
      { header: "Kıyas", key: "k", width: 28 },
    ],
    rows: summaryRows,
  };
  const grafikler = spec.bloklar.flatMap((b) => (b.tur === "grafik" ? [tableToSheet(b.veri, preamble)] : []));
  return [summarySheet, ...grafikler, ...spec.tables.map((t) => tableToSheet(t, preamble))];
}

// ---------- PDF HTML ----------
export const esc = (v: unknown): string =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const alignOf = (c: ReportColumn) => (c.align === "right" ? "right" : "left");

function tableHtml(t: ReportTableSpec): string {
  const head = t.columns.map((c) => `<th style="text-align:${alignOf(c)}">${esc(c.header)}</th>`).join("");
  const tr = (r: Record<string, unknown> | undefined) => t.columns.map((c) => `<td style="text-align:${alignOf(c)}">${esc(reportCellText(r?.[c.key], c.numFmt))}</td>`).join("");
  const body = t.rows.map((r) => `<tr>${tr(r)}</tr>`).join("");
  const total = t.totalRow ? `<tr class="tot">${tr(t.totalRow)}</tr>` : "";
  const notes = (t.notes ?? []).map((n) => `<div class="note">${esc(n)}</div>`).join("");
  // Girinti panelin çıktısının BAYTIDIR (altın dosya eşitliği) — düzeltme.
  return `<section class="tbl-wrap">
        <h2>${esc(t.name)}</h2>
        <table><thead><tr>${head}</tr></thead><tbody>${body}${total}</tbody></table>
        ${notes}
      </section>`;
}

function blockHtml(b: ExportBlok): string {
  switch (b.tur) {
    case "anaSayi":
      return `<section class="kartlar">${b.kartlar
        .map((k) => `<div class="kart${k.ana ? " ana" : ""}"><div class="kart-ad">${esc(k.ad)}</div><div class="kart-deger">${esc(k.deger)}</div>${k.kiyas ? `<div class="kart-kiyas">${esc(k.kiyas)}</div>` : ""}</div>`)
        .join("")}</section>`;
    case "anlati":
      return `<section class="anlati"><h2>${WHAT_WE_SEE}</h2><ul>${b.cumleler.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></section>`;
    case "grafik":
      return tableHtml({ ...b.veri, name: b.baslik });
    case "tanimlar":
      return `<section class="tanimlar"><h2>${WHAT_IT_COUNTS}</h2><dl>${b.satirlar.map((t) => `<dt>${esc(t.ad)}</dt><dd>${esc(t.aciklama)}</dd>`).join("")}</dl></section>`;
  }
}

const CSS = `
  @page { size: A4 portrait; margin: 14mm 12mm 16mm; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: -apple-system, "Segoe UI", Arial, sans-serif; color: #111; margin: 0; font-size: 11px; }
  h1 { font-size: 17px; margin: 0 0 2px; }
  .soru { font-size: 12px; color: #333; font-style: italic; margin-bottom: 4px; }
  .meta { font-size: 10px; color: #555; }
  .basim { font-size: 9.5px; color: #666; margin-top: 3px; }
  .hdr { border-bottom: 1.5px solid #111; padding-bottom: 6px; margin-bottom: 12px; }
  h2 { font-size: 12px; margin: 0 0 4px; break-after: avoid; }
  section { margin-bottom: 14px; }
  .kartlar { display: flex; gap: 8px; flex-wrap: wrap; break-inside: avoid; }
  .kart { border: 0.5px solid #bbb; border-radius: 4px; padding: 6px 10px; min-width: 120px; break-inside: avoid; }
  .kart-ad { font-size: 9.5px; color: #555; }
  .kart-deger { font-size: 15px; font-weight: 700; }
  .kart.ana { border: 1px solid #1f4e9c; background: #eef3fb; }
  .kart.ana .kart-deger { font-size: 22px; }
  .kart-kiyas { font-size: 10px; color: #333; }
  .anlati { break-inside: avoid; }
  .anlati ul { margin: 0; padding-left: 16px; }
  .anlati li { margin-bottom: 2px; }
  .grafik { break-inside: avoid; }
  .grafik svg { display: block; width: 100%; max-width: 180mm; height: auto; }
  .tbl-wrap { break-inside: auto; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th, td { border: 0.5px solid #bbb; padding: 3px 5px; }
  th { background: #eee; font-weight: 600; }
  tr.tot td { font-weight: 700; background: #f4f4f4; }
  .note { font-size: 9.5px; color: #555; font-style: italic; margin-top: 3px; }
  .tanimlar { break-inside: avoid; }
  .tanimlar dl { margin: 0; }
  .tanimlar dt { font-weight: 600; margin-top: 4px; }
  .tanimlar dd { margin: 0 0 2px 0; color: #333; }
  .uyari { font-size: 10px; color: #7a4b00; border-left: 2px solid #d9730d; padding-left: 6px; margin-top: 4px; }
`;

/** A4 belgesi: üst blok → bloklar → tablolar (ilk `tanimlar`dan önce) → uyarılar. */
export function buildReportHtml(spec: ReportExportSpec): string {
  const blocks = spec.bloklar;
  const tablesHtml = spec.tables.map(tableHtml).join("");
  const defsIndex = blocks.findIndex((b) => b.tur === "tanimlar");
  const before = defsIndex < 0 ? blocks : blocks.slice(0, defsIndex);
  const after = defsIndex < 0 ? [] : blocks.slice(defsIndex);
  const body = [...before.map(blockHtml), tablesHtml, ...after.map(blockHtml)].join("\n");
  const [question, ...context] = spec.soru ? v2ContextLines(spec) : ["", ...v2ContextLines(spec)];
  const printedLine = context.pop() ?? "";
  const warningsHtml = (spec.uyarilar ?? []).map((u) => `<div class="uyari">${esc(u)}</div>`).join("");
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<title>${esc(spec.title)}</title>
<style>${CSS}</style></head><body>
<div class="hdr">
  <h1>${esc(spec.title)}</h1>
  ${question ? `<div class="soru">${esc(question)}</div>` : ""}
  ${context.map((m) => `<div class="meta">${esc(m)}</div>`).join("")}
  <div class="basim">${esc(printedLine)}</div>
</div>
${body}
${warningsHtml}
</body></html>`;
}
