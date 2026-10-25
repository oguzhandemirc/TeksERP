// =============================================================================
// Muayene Raporu — "MUAYENE RAPORU" HTML + Excel tabloları (TEK KAYNAK, K4P-RAPOR)
// =============================================================================
// Kaynak Shipment; sevk toplarının aktif 4 puan muayeneleri ilk basımda donar
// (`quality-inspection-shipment.service`). Kolonlar bir kez `DocColSpec` olarak yazılır:
// HTML `toHtmlCols → buildDocTable`, Excel `resolveDocTable` (PDF = Excel). İç kolonlar
// (operatör, istasyon, cihaz) `defaultHidden` doğar — müşteri belgesinde OPT-IN.
// =============================================================================

import type { PrintedDocStatus } from "@prisma/client";
import type { PrintedDocSnapshot } from "../printed-document.service";
import type { InspectionResult, ShipmentInspectionRow, ShipmentInspectionRule, ShipmentInspectionSummary } from "../quality-inspection-shipment.service";
import {
  resolveDocStyle,
  docPageCss,
  docTableCss,
  scaleDocCss,
  docLogoHtml,
  DOC_LOGO_CSS,
  DOC_STAMPS_CSS,
  docCopyBadge,
  docBlocksHtml,
  docBlankGridCss,
  docBlankGridHtml,
  docPrintNoteHtml,
  docStampsBar, docTitle,
} from "./doc-style";
import { buildDocTable } from "./doc-table";
import { resolveDocTable, toHtmlCols, type DocColSpec, type DocFmtKit, type DocTablesPayload } from "./doc-model";
import { DOC_DENSITY, docChromeCss, resolveDocPageSize, scaleW } from "./doc-density";
import { DOC_FIELD_CATALOGS, docFieldCss } from "./doc-fields";
import { fmtDate } from "./fmt-date";
import { docNum } from "./fmt-num";

export type InspectionReportDoc = ShipmentInspectionSummary;
export const INSPECTION_RESULT_TEXT: Record<InspectionResult, string> = {
  PASS: "GEÇTİ",
  FAIL: "KALDI",
  NONE: "Muayene yok",
  NO_SCORE: "Hesaplanamadı",
};
export const INSPECTION_REPORT_TITLE = "MUAYENE RAPORU";
export const INSPECTION_REPORT_SIGNATURES = ["Kalite Sorumlusu", "Teslim Alan"];

interface RenderMeta {
  status?: PrintedDocStatus;
  voidReason?: string | null;
  draft?: boolean;
  logoDataUrl?: string | null;
  qrDataUrl?: string | null;
  printedAtText?: string;
  printedBy?: string | null;
  printNote?: string | null;
}

function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const kitOf = (snapshot: PrintedDocSnapshot): DocFmtKit => ({ esc, fmtTr: docNum(snapshot).tr });
function sectionOn(sections: Record<string, boolean> | undefined, key: string): boolean {
  return sections?.[key] !== false;
}

// ── Metin yardımcıları — sözleşme de AYNI fonksiyonlarla doldurur (Liquid hesap yapmaz) ──
const UNIT_TEXT = { M2: "100 m²", YD2: "100 yd²" } as const;
const CAP_TEXT = { NONE: "Tavan yok", METER: "Metre başına en çok 4 puan", YARD: "Yarda başına en çok 4 puan" } as const;
export const unitText = (u: ShipmentInspectionRule["unit"] | null): string => (u ? UNIT_TEXT[u] : "");
export const capText = (c: ShipmentInspectionRule["runningCap"]): string => CAP_TEXT[c];
/** "≤ 20,00 → A (kabul) · üstü → C (ret)" — bant sırası korunur. */
export function bandsText(rule: ShipmentInspectionRule, fmt: (n: number, d: number) => string): string {
  return rule.bands
    .map((b) => `${b.maxScore == null ? "üstü" : `≤ ${fmt(b.maxScore, 2)}`} → ${b.label} (${b.accepted ? "kabul" : "ret"})`)
    .join(" · ");
}
export const resultText = (r: InspectionResult): string => INSPECTION_RESULT_TEXT[r];
const WIDTH_SOURCE_TEXT = { ITEM_CARD: "ürün kartı", ROLL_MEASURED: "ölçülen", MANUAL: "elle", UNKNOWN: "bilinmiyor" } as const;
/** Dipnot satırları — renderer ve sözleşme aynı listeyi basar. */
export function inspectionFootnotes(doc: InspectionReportDoc): string[] {
  const out: string[] = [];
  if (doc.notes.unplacedRollCount > 0) {
    out.push(`Konumu girilmemiş hata: ${doc.totals.unplacedDefectCount} adet (${doc.notes.unplacedRollCount} topta); koşu tavanı bu hatalara uygulanmaz.`);
  }
  const ws = (Object.keys(WIDTH_SOURCE_TEXT) as Array<keyof typeof WIDTH_SOURCE_TEXT>)
    .filter((k) => (doc.notes.widthSources[k] ?? 0) > 0)
    .map((k) => `${WIDTH_SOURCE_TEXT[k]} ${doc.notes.widthSources[k]}`);
  if (ws.length) out.push(`En kaynağı: ${ws.join(" · ")}.`);
  if (doc.totals.uninspectedCount > 0) out.push(`Muayenesi olmayan top: ${doc.totals.uninspectedCount}.`);
  // Patron kararı (2026-10-25): müşteri setinin koşu tavanı farklı olsa da puan yeniden hesaplanmaz.
  if (doc.totals.inspectedCount > 0) out.push("Puan, muayene anındaki kural setiyle hesaplanmıştır.");
  return out;
}
/** Özet satırları ([etiket, değer]) — HTML kutusu, Excel başlığı ve sözleşme aynı listeden. */
export function inspectionSummaryLines(doc: InspectionReportDoc, fmt: (n: number | null | undefined, d: number) => string): Array<[string, string]> {
  const t = doc.totals;
  return [
    ["Muayene edilen top", `${t.inspectedCount} / ${t.rollCount}`],
    ["Geçti", String(t.passCount)],
    ["Kaldı", String(t.failCount)],
    ["Ortalama puan / 100 m²", t.avgPointsPer100M2 == null ? "—" : fmt(t.avgPointsPer100M2, 2)],
  ];
}

// ── Kolon tanımları (PDF = Excel) ──
const TEXT = { t: "text" } as const;
const NUM2 = { t: "num", dec: 2 } as const;
const INT = { t: "int" } as const;

export function ruleColumns(): DocColSpec<ShipmentInspectionRule>[] {
  return [
    { key: "name", label: "KURAL", align: "l", kind: TEXT, value: (r) => r.name },
    { key: "unit", label: "BİRİM", align: "c", width: "70px", kind: TEXT, value: (r) => unitText(r.unit) },
    { key: "cap", label: "TAVAN", align: "l", kind: TEXT, value: (r) => capText(r.runningCap) },
    { key: "bands", label: "BANTLAR", align: "l", kind: TEXT, value: () => null },
  ];
}

export function rollColumns(doc: InspectionReportDoc): DocColSpec<ShipmentInspectionRow>[] {
  const t = doc.totals;
  return [
    { key: "seq", label: "#", align: "c", width: "30px", kind: TEXT, value: (r) => String(r.sequence) },
    { key: "barcode", label: "BARKOD", align: "l", cellClass: "mono", kind: TEXT, value: (r) => r.barcode ?? "—" },
    { key: "itemColor", label: "KUMAŞ / RENK", align: "l", kind: TEXT, value: (r) => (r.colorName ? `${r.itemName} · ${r.colorName}` : r.itemName) },
    { key: "width", label: "EN", align: "c", width: "56px", kind: { t: "int", suffix: " cm" }, value: (r) => (r.widthCm != null ? Math.round(r.widthCm) : "—") },
    { key: "meters", label: "METRE", align: "r", width: "70px", kind: NUM2, value: (r) => r.meters, foot: { value: t.totalMeters } },
    { key: "defects", label: "HATA", align: "r", width: "46px", kind: INT, value: (r) => r.defectCount ?? "—", foot: { value: t.defectCount } },
    { key: "points", label: "PUAN", align: "r", width: "46px", kind: INT, value: (r) => r.totalPoints ?? "—", foot: { value: t.totalPoints } },
    { key: "score", label: "PUAN/100", align: "r", width: "64px", kind: NUM2, value: (r) => r.score ?? "—" },
    { key: "label", label: "ETİKET", align: "c", width: "64px", kind: TEXT, value: (r) => r.label ?? "—" },
    { key: "result", label: "SONUÇ", align: "c", width: "78px", kind: TEXT, value: (r) => resultText(r.result) },
    { key: "inspector", label: "OPERATÖR", align: "l", defaultHidden: true, kind: TEXT, value: (r) => r.inspectorName ?? "" },
    { key: "station", label: "İSTASYON", align: "l", defaultHidden: true, kind: TEXT, value: (r) => r.stationName ?? "" },
    { key: "device", label: "CİHAZ", align: "l", defaultHidden: true, kind: TEXT, value: (r) => r.deviceName ?? "" },
  ];
}

function rulesWithBands(snapshot: PrintedDocSnapshot): DocColSpec<ShipmentInspectionRule>[] {
  const tr = docNum(snapshot).tr;
  return ruleColumns().map((c) => (c.key === "bands" ? { ...c, value: (r) => bandsText(r, (n, d) => tr(n, d)) } : c));
}

function parts(snapshot: PrintedDocSnapshot) {
  const doc = snapshot.doc as unknown as InspectionReportDoc;
  const cfg = snapshot.docConfigOverride ?? {};
  const kit = kitOf(snapshot);
  const ruleTable = sectionOn(cfg.sections, "ruleTable") && doc.rules.length > 0;
  const rollTable = sectionOn(cfg.sections, "rollDetail") && doc.rows.length > 0;
  return { doc, cfg, kit, ruleTable, rollTable, ruleCols: rulesWithBands(snapshot), rollCols: rollColumns(doc) };
}

/** Excel tabloları — HTML ile AYNI kolon çözücüsü ve ayar (PDF = Excel). */
export function renderInspectionReportTables(snapshot: PrintedDocSnapshot, meta: RenderMeta = {}): DocTablesPayload {
  const p = parts(snapshot);
  const h = p.doc.header;
  const fmt = docNum(snapshot).tr;
  const wm = meta.draft ? "TASLAK" : meta.status === "VOIDED" ? "İPTAL" : meta.status === "SUPERSEDED" ? "ESKİ KOPYA" : null;
  const header: Array<[string, string | null]> = [
    ...(wm ? [[wm, null] as [string, null]] : []),
    [docTitle(p.cfg.titleOverride, INSPECTION_REPORT_TITLE), null],
    ...(snapshot.company?.name ? [[snapshot.company.name, null] as [string, null]] : []),
    ["Sayın", h.customerName],
    ["Sevkiyat No", h.shipmentNo],
    ["Tarih", fmtDate(h.date)],
    ...(sectionOn(p.cfg.sections, "summary") ? inspectionSummaryLines(p.doc, fmt) : []),
  ];
  const tables = [
    ...(p.ruleTable ? [resolveDocTable({ key: "kurallar", caption: "Kural", cols: p.ruleCols, rows: p.doc.rules, colCfg: p.cfg.columns?.kurallar, kit: p.kit })] : []),
    ...(p.rollTable
      ? [resolveDocTable({ key: "toplar", caption: "Top Muayene Dökümü", cols: p.rollCols, rows: p.doc.rows, colCfg: p.cfg.columns?.toplar, footLabel: "TOPLAM", kit: p.kit })]
      : []),
  ];
  const notes = [...(sectionOn(p.cfg.sections, "footnotes") ? inspectionFootnotes(p.doc) : []), p.cfg.footerNote, meta.printNote]
    .filter((n): n is string => !!n && !!n.trim());
  return { docType: "INSPECTION_REPORT", documentNo: h.shipmentNo, header, tables, notes };
}

/** Belgenin CSS'i — renderer gövdesini satır tavanında tutmak için ayrı. */
function inspectionReportCss(
  cfg: ReturnType<typeof parts>["cfg"],
  style: ReturnType<typeof resolveDocStyle>,
  d: (typeof DOC_DENSITY)[keyof typeof DOC_DENSITY],
): string {
  return scaleDocCss(
    `
  * { box-sizing: border-box; }
  ${docPageCss(style)}
  ${docChromeCss(d)}
  .tbl-cap { margin: ${scaleW(d, 8)}px 0 ${scaleW(d, 3)}px; }
  .sum { display: flex; flex-wrap: wrap; gap: ${scaleW(d, 4)}px ${scaleW(d, 14)}px; margin-top: ${scaleW(d, 8)}px; font-size: ${d.note}px; }
  .sum-i span { color: #475569; margin-right: 4px; }
  .fn { margin-top: ${scaleW(d, 8)}px; font-size: ${d.note}px; color: #334155; }
  .decl { margin-top: ${scaleW(d, 12)}px; font-size: ${d.note}px; white-space: pre-wrap;
          border: 1px solid #cbd5e1; padding: ${scaleW(d, 8)}px ${scaleW(d, 10)}px; border-radius: 4px; font-style: italic; }
  ${DOC_LOGO_CSS}
  ${DOC_STAMPS_CSS}
  ${docBlankGridCss(cfg)}
  ${docTableCss(style, [".sec"])}
  ${docFieldCss(cfg.fields, DOC_FIELD_CATALOGS["muayeneRaporu"], d)}
`,
    style,
  );
}

export function renderInspectionReportHtml(snapshot: PrintedDocSnapshot, meta: RenderMeta = {}): string {
  const p = parts(snapshot);
  const { doc, cfg } = p;
  const fmt = docNum(snapshot).tr;
  const pageSize = resolveDocPageSize(cfg.style?.pageSize);
  const d = DOC_DENSITY[pageSize];
  const style = resolveDocStyle(cfg.style, { marginMm: 9 });
  const logo = docLogoHtml(meta.logoDataUrl, cfg);
  const company = snapshot.company;
  const lh = company?.letterhead ?? { addressLine: "", phone: "", taxInfo: "" };
  const h = doc.header;

  const showTaxNo = sectionOn(cfg.sections, "taxNo");
  const title = docTitle(cfg.titleOverride, INSPECTION_REPORT_TITLE);
  const showSignatures = cfg.showSignatures !== false;
  const sigLabels = cfg.signatureLabels?.length ? cfg.signatureLabels : INSPECTION_REPORT_SIGNATURES;

  const lhLines = cfg.showLetterhead !== false
    ? [lh.addressLine, lh.phone, showTaxNo && lh.taxInfo ? `V.D./No: ${lh.taxInfo}` : "", ...(lh.extraLines ?? [])]
        .filter((s) => s && s.trim()).map((s) => `<div class="lh-line">${esc(s)}</div>`).join("")
    : "";
  const watermark = meta.draft
    ? `<div class="wm wm-draft">TASLAK</div>`
    : meta.status === "VOIDED" ? `<div class="wm">İPTAL</div>`
      : meta.status === "SUPERSEDED" ? `<div class="wm wm-old">ESKİ KOPYA</div>` : "";

  const summary = sectionOn(cfg.sections, "summary")
    ? `<div class="sum">${inspectionSummaryLines(doc, fmt).map(([k, v]) => `<div class="sum-i"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}</div>`
    : "";
  const ruleTable = p.ruleTable
    ? `<div class="tbl-cap">Kural</div>` +
      buildDocTable<ShipmentInspectionRule>({ className: "sec", colCfg: cfg.columns?.kurallar, rows: doc.rules, cols: toHtmlCols(p.ruleCols, p.kit) })
    : "";
  const rollTable = p.rollTable
    ? `<div class="tbl-cap">Top Muayene Dökümü (${esc(doc.totals.rollCount)})</div>` +
      buildDocTable<ShipmentInspectionRow>({ className: "sec", colCfg: cfg.columns?.toplar, footLabel: "TOPLAM", rows: doc.rows, cols: toHtmlCols(p.rollCols, p.kit) })
    : "";
  const footnotes = sectionOn(cfg.sections, "footnotes") ? inspectionFootnotes(doc) : [];
  const notesHtml = footnotes.length ? `<div class="fn">${footnotes.map((n) => `<div>${esc(n)}</div>`).join("")}</div>` : "";
  const footer = cfg.footerNote ? `<div class="decl">${esc(cfg.footerNote)}</div>` : "";
  const signatures = showSignatures
    ? `<div class="sign">${sigLabels.map((l) => `<div class="sign-box"><div class="sign-line"></div><div class="sign-lbl">${esc(l)}</div></div>`).join("")}</div>`
    : "";

  const css = inspectionReportCss(cfg, style, d);

  const copyBadge = docCopyBadge(cfg, esc);
  const blocksTop = docBlocksHtml(cfg, "afterHeader", esc) + docBlankGridHtml(cfg, "afterHeader", esc);
  const blocksBottom = docBlocksHtml(cfg, "beforeSignatures", esc) + docBlankGridHtml(cfg, "beforeSignatures", esc);
  const printNote = docPrintNoteHtml(meta.printNote, esc);
  const stampsBar = docStampsBar(cfg, meta, esc, { printedAt: "Basım", printedBy: "Basan" });

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>${css}</style></head>
<body>
  ${watermark}
  <div class="sheet">
    <header>
      <div class="hl">
        ${logo.left}
        <div class="company">${esc(company?.name ?? "")}</div>
        ${lhLines}
        <div class="sayin">SAYIN: <b>${esc(h.customerName)}</b></div>
        ${sectionOn(cfg.sections, "customerCode") && h.customerCode ? `<div class="sub">Kod: ${esc(h.customerCode)}</div>` : ""}
      </div>
      <div class="hr">
        ${logo.right}
        <div class="title">${esc(title)}</div>
        ${copyBadge}
        ${sectionOn(cfg.sections, "shipmentNo") ? `<div class="ln">Sevkiyat No: <b>${esc(h.shipmentNo)}</b></div>` : ""}
        ${sectionOn(cfg.sections, "date") ? `<div class="ln">Tarih: <b>${esc(fmtDate(h.date))}</b></div>` : ""}
        ${sectionOn(cfg.sections, "orderNos") && h.orderNos ? `<div class="ln">Sipariş: <b>${esc(h.orderNos)}</b></div>` : ""}
      </div>
    </header>
    ${blocksTop}
    ${summary}
    ${ruleTable}
    ${rollTable}
    ${notesHtml}
    ${footer}
    ${blocksBottom}
    ${printNote}
    ${signatures}
    ${stampsBar}
  </div>
</body></html>`;
}
