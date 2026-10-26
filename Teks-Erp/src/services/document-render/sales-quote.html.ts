// =============================================================================
// Satış Teklifi — "SATIŞ TEKLİFİ" HTML + Excel tabloları (TEK KAYNAK, MAL-6)
// =============================================================================
// Müşteriye gider: payload'da maliyet/kâr/iç not HİÇ YOKTUR (`quote-documents.service`
// yalnız müşteri alanlarını toplar). Kolonlar bir kez `DocColSpec`: HTML `toHtmlCols →
// buildDocTable`, Excel `resolveDocTable` (PDF = Excel). Takvim günleri `fmtCalendarDate`.
// =============================================================================

import type { PrintedDocSnapshot } from "../printed-document.service";
import { docBlankGridHtml, docBlocksHtml, docCopyBadge, docLogoHtml, docPrintNoteHtml, docStampsBar, docTitle, resolveDocStyle } from "./doc-style";
import { buildDocTable } from "./doc-table";
import { resolveDocTable, toHtmlCols, type DocColSpec, type DocTablesPayload } from "./doc-model";
import { DOC_DENSITY, resolveDocPageSize } from "./doc-density";
import { fmtCalendarDate } from "./fmt-date";
import { docNum } from "./fmt-num";
import {
  commercialCss,
  esc,
  kitOf,
  letterheadHtml,
  sectionOn,
  signaturesHtml,
  unitText,
  watermarkHtml,
  watermarkText,
  type CommercialRenderMeta,
} from "./commercial-doc";

export interface SalesQuoteDocLine {
  lineNo: number;
  description: string;
  itemCode: string | null;
  colorName: string | null;
  widthCm: number | null;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
}

/** Donmuş teklif payload'ı — YALNIZ müşteri alanları (sözleşme `hedef: musteri`). */
export interface SalesQuoteDoc {
  header: {
    documentNo: string;
    quoteNo: string;
    revisionNo: number;
    quoteDate: string;
    validUntilDate: string;
    currency: string;
    /** TRY teklifte null (kur satırı basılmaz). */
    fxRate: number | null;
    paymentTermDays: number | null;
    customerReference: string | null;
    customerName: string;
    customerCode: string | null;
    branchName: string | null;
  };
  lines: SalesQuoteDocLine[];
  totals: { quantity: number; amount: number };
  notes: string | null;
}

export const SALES_QUOTE_TITLE = "SATIŞ TEKLİFİ";
export const SALES_QUOTE_SIGNATURES = ["Teklifi Veren", "Müşteri Onayı"];

/** Koşul satırları ([etiket, değer]) — HTML kutusu, Excel başlığı ve sözleşme aynı listeden. */
export function quoteTermLines(doc: SalesQuoteDoc, fmt: (n: number | null | undefined, d: number) => string): Array<[string, string]> {
  const h = doc.header;
  return [
    ["Döviz", h.currency],
    ...(h.fxRate != null ? [["Kur", `1 ${h.currency} = ${fmt(h.fxRate, 4)} TRY`] as [string, string]] : []),
    ...(h.paymentTermDays != null ? [["Vade", `${h.paymentTermDays} gün`] as [string, string]] : []),
    ["Geçerlilik", `${fmtCalendarDate(h.validUntilDate)} tarihine kadar`],
  ];
}

const TEXT = { t: "text" } as const;
const NUM2 = { t: "num", dec: 2 } as const;

export type QuoteFootTotals = SalesQuoteDoc["totals"];

/** Kalem kolonları — PDF ve Excel bu TEK listeden (iç maliyet kolonu YOK, opt-in de yok). */
export function quoteLineColumns(t: QuoteFootTotals): DocColSpec<SalesQuoteDocLine>[] {
  return [
    { key: "seq", label: "#", align: "c", width: "30px", kind: TEXT, value: (r) => String(r.lineNo) },
    { key: "description", label: "ÜRÜN / TANIM", align: "l", kind: TEXT, value: (r) => (r.itemCode ? `${r.itemCode} — ${r.description}` : r.description) },
    { key: "color", label: "RENK", align: "l", kind: TEXT, value: (r) => r.colorName ?? "—" },
    { key: "width", label: "EN", align: "c", width: "56px", kind: { t: "int", suffix: " cm" }, value: (r) => (r.widthCm != null ? Math.round(r.widthCm) : "—") },
    { key: "qty", label: "MİKTAR", align: "r", width: "76px", kind: NUM2, value: (r) => r.quantity, foot: { value: t.quantity } },
    { key: "unit", label: "BİRİM", align: "c", width: "48px", kind: TEXT, value: (r) => unitText(r.unit) },
    { key: "unitPrice", label: "BİRİM FİYAT", align: "r", width: "84px", kind: NUM2, value: (r) => r.unitPrice },
    { key: "amount", label: "TUTAR", align: "r", width: "96px", kind: NUM2, value: (r) => r.lineTotal, foot: { value: t.amount } },
  ];
}

function parts(snapshot: PrintedDocSnapshot) {
  const doc = snapshot.doc as unknown as SalesQuoteDoc;
  const cfg = snapshot.docConfigOverride ?? {};
  const lineTable = sectionOn(cfg.sections, "lineTable") && doc.lines.length > 0;
  return { doc, cfg, kit: kitOf(snapshot), lineTable, cols: quoteLineColumns(doc.totals) };
}

/** "12.345,00 USD" — genel toplam metni (HTML, Excel ve sözleşme aynı). */
export const grandTotalText = (doc: SalesQuoteDoc, fmt: (n: number | null | undefined, d: number) => string): string =>
  `${fmt(doc.totals.amount, 2)} ${doc.header.currency}`;

/** Excel tabloları — HTML ile AYNI kolon çözücüsü ve ayar (PDF = Excel). */
export function renderSalesQuoteTables(snapshot: PrintedDocSnapshot, meta: CommercialRenderMeta = {}): DocTablesPayload {
  const p = parts(snapshot);
  const h = p.doc.header;
  const fmt = docNum(snapshot).tr;
  const wm = watermarkText(meta);
  const header: Array<[string, string | null]> = [
    ...(wm ? [[wm, null] as [string, null]] : []),
    [docTitle(p.cfg.titleOverride, SALES_QUOTE_TITLE), null],
    ...(snapshot.company?.name ? [[snapshot.company.name, null] as [string, null]] : []),
    ["Sayın", h.customerName],
    ["Teklif No", h.documentNo],
    ["Tarih", fmtCalendarDate(h.quoteDate)],
    ...(sectionOn(p.cfg.sections, "terms") ? quoteTermLines(p.doc, fmt) : []),
    ...(sectionOn(p.cfg.sections, "grandTotal") ? [["Genel Toplam", grandTotalText(p.doc, fmt)] as [string, string]] : []),
  ];
  const tables = p.lineTable
    ? [resolveDocTable({ key: "kalemler", caption: "Teklif Kalemleri", cols: p.cols, rows: p.doc.lines, colCfg: p.cfg.columns?.kalemler, footLabel: "TOPLAM", kit: p.kit })]
    : [];
  const notes = [sectionOn(p.cfg.sections, "notes") ? p.doc.notes : null, p.cfg.footerNote, meta.printNote]
    .filter((n): n is string => !!n && !!n.trim());
  return { docType: "SALES_QUOTE", documentNo: h.documentNo, header, tables, notes };
}

function headRight(doc: SalesQuoteDoc, cfg: ReturnType<typeof parts>["cfg"]): string {
  const h = doc.header;
  const on = (k: string) => sectionOn(cfg.sections, k);
  return [
    on("quoteNo") ? `<div class="ln">Teklif No: <b>${esc(h.documentNo)}</b></div>` : "",
    on("date") ? `<div class="ln">Tarih: <b>${esc(fmtCalendarDate(h.quoteDate))}</b></div>` : "",
    on("customerReference") && h.customerReference ? `<div class="ln">Referans: <b>${esc(h.customerReference)}</b></div>` : "",
  ].join("");
}

export function renderSalesQuoteHtml(snapshot: PrintedDocSnapshot, meta: CommercialRenderMeta = {}): string {
  const p = parts(snapshot);
  const { doc, cfg } = p;
  const h = doc.header;
  const fmt = docNum(snapshot).tr;
  const d = DOC_DENSITY[resolveDocPageSize(cfg.style?.pageSize)];
  const style = resolveDocStyle(cfg.style, { marginMm: 9 });
  const logo = docLogoHtml(meta.logoDataUrl, cfg);
  const on = (k: string) => sectionOn(cfg.sections, k);

  const terms = on("terms")
    ? `<div class="sum">${quoteTermLines(doc, fmt).map(([k, v]) => `<div class="sum-i"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}</div>`
    : "";
  const lineTable = p.lineTable
    ? `<div class="tbl-cap">Teklif Kalemleri (${esc(doc.lines.length)})</div>` +
      buildDocTable<SalesQuoteDocLine>({ className: "sec", colCfg: cfg.columns?.kalemler, footLabel: "TOPLAM", rows: doc.lines, cols: toHtmlCols(p.cols, p.kit) })
    : "";
  const grand = on("grandTotal") ? `<div class="grand"><span>Genel Toplam</span><b>${esc(grandTotalText(doc, fmt))}</b></div>` : "";
  const notes = on("notes") && doc.notes ? `<div class="qn">${esc(doc.notes)}</div>` : "";
  const footer = cfg.footerNote ? `<div class="decl">${esc(cfg.footerNote)}</div>` : "";

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>${commercialCss(cfg, style, d, "satisTeklifi")}</style></head>
<body>
  ${watermarkHtml(meta)}
  <div class="sheet">
    <header>
      <div class="hl">
        ${logo.left}
        <div class="company">${esc(snapshot.company?.name ?? "")}</div>
        ${letterheadHtml(snapshot, cfg)}
        <div class="sayin">SAYIN: <b>${esc(h.customerName)}</b></div>
        ${on("customerCode") && h.customerCode ? `<div class="sub">Kod: ${esc(h.customerCode)}</div>` : ""}
        ${on("branch") && h.branchName ? `<div class="sub">Şube: ${esc(h.branchName)}</div>` : ""}
      </div>
      <div class="hr">
        ${logo.right}
        <div class="title">${esc(docTitle(cfg.titleOverride, SALES_QUOTE_TITLE))}</div>
        ${docCopyBadge(cfg, esc)}
        ${headRight(doc, cfg)}
      </div>
    </header>
    ${docBlocksHtml(cfg, "afterHeader", esc) + docBlankGridHtml(cfg, "afterHeader", esc)}
    ${terms}
    ${lineTable}
    ${grand}
    ${notes}
    ${footer}
    ${docBlocksHtml(cfg, "beforeSignatures", esc) + docBlankGridHtml(cfg, "beforeSignatures", esc)}
    ${docPrintNoteHtml(meta.printNote, esc)}
    ${signaturesHtml(cfg, SALES_QUOTE_SIGNATURES)}
    ${docStampsBar(cfg, meta, esc, { printedAt: "Basım", printedBy: "Basan" })}
  </div>
</body></html>`;
}
