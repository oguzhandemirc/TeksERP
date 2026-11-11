// =============================================================================
// Sipariş Teyidi — "SİPARİŞ TEYİDİ" HTML + Excel tabloları (TEK KAYNAK, Seyitoğlu 3. bölüm L1)
// =============================================================================
// Müşteriye gider: payload'da iç alan (sevk edilen, reçete, kesim notu, iç not) YOKTUR
// (`order-documents.service` yalnız müşteri alanlarını seçer). Kolonlar bir kez `DocColSpec`:
// HTML `toHtmlCols → buildDocTable`, Excel `resolveDocTable` (PDF = Excel). Sipariş tarihi bir
// AN'dır (fabrika günü, `fmtDate`); termin takvim günü kuralıyla (`fmtCalendarDate`).
// =============================================================================

import type { PrintedDocSnapshot } from "../printed-document.service";
import { docBlankGridHtml, docBlocksHtml, docCopyBadge, docLogoHtml, docPrintNoteHtml, docStampsBar, docTitle, resolveDocStyle } from "./doc-style";
import { buildDocTable } from "./doc-table";
import { resolveDocTable, toHtmlCols, type DocColSpec, type DocTablesPayload } from "./doc-model";
import { DOC_DENSITY, resolveDocPageSize } from "./doc-density";
import { fmtCalendarDate, fmtDate } from "./fmt-date";
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

export interface OrderConfirmationDocLine {
  lineNo: number;
  itemCode: string;
  itemName: string;
  /** Satırda müşterinin kendi ürün/renk adı yazılıysa (yoksa null). */
  customerItemName: string | null;
  colorName: string | null;
  customerColorName: string | null;
  widthCm: number | null;
  quantity: number;
  unit: string;
  /** Fiyatsız satırda null (tutar da null, "—" basılır). */
  unitPrice: number | null;
  lineTotal: number | null;
  tolerancePct: number | null;
}

/** Donmuş teyit payload'ı — YALNIZ müşteri alanları. */
export interface OrderConfirmationDoc {
  header: {
    documentNo: string;
    orderNumber: string;
    orderDate: string;
    deadline: string | null;
    currency: string;
    customerName: string;
    customerCode: string | null;
    branchName: string | null;
  };
  /** İptal edilmemiş satırlar. */
  lines: OrderConfirmationDocLine[];
  /** amount = sipariş kaydının toplamı; kayıtta yoksa null. */
  totals: { quantity: number; amount: number | null };
}

export const ORDER_CONFIRMATION_TITLE = "SİPARİŞ TEYİDİ";
export const ORDER_CONFIRMATION_SIGNATURES = ["Satıcı", "Müşteri Onayı"];

const TEXT = { t: "text" } as const;
const NUM2 = { t: "num", dec: 2 } as const;

export type OrderConfirmationFootTotals = OrderConfirmationDoc["totals"];

const withCustomer = (own: string, customer: string | null): string => (customer && customer !== own ? `${own} (${customer})` : own);

/** Kalem kolonları — PDF ve Excel bu TEK listeden; fiyatsız teyit `columns.kalemler.hidden` ile. */
export function orderConfirmationColumns(t: OrderConfirmationFootTotals): DocColSpec<OrderConfirmationDocLine>[] {
  return [
    { key: "seq", label: "#", align: "c", width: "30px", kind: TEXT, value: (r) => String(r.lineNo) },
    { key: "description", label: "ÜRÜN", align: "l", kind: TEXT, value: (r) => withCustomer(`${r.itemCode} — ${r.itemName}`, r.customerItemName) },
    { key: "color", label: "RENK", align: "l", kind: TEXT, value: (r) => (r.colorName ? withCustomer(r.colorName, r.customerColorName) : r.customerColorName ?? "—") },
    { key: "width", label: "EN", align: "c", width: "56px", kind: { t: "int", suffix: " cm" }, value: (r) => (r.widthCm != null ? Math.round(r.widthCm) : "—") },
    { key: "qty", label: "MİKTAR", align: "r", width: "76px", kind: NUM2, value: (r) => r.quantity, foot: { value: t.quantity } },
    { key: "unit", label: "BİRİM", align: "c", width: "48px", kind: TEXT, value: (r) => unitText(r.unit) },
    { key: "tolerance", label: "TOL. %", align: "r", width: "52px", kind: NUM2, value: (r) => r.tolerancePct ?? "—" },
    { key: "unitPrice", label: "BİRİM FİYAT", align: "r", width: "84px", kind: NUM2, value: (r) => r.unitPrice ?? "—" },
    { key: "amount", label: "TUTAR", align: "r", width: "96px", kind: NUM2, value: (r) => r.lineTotal ?? "—", foot: { value: t.amount ?? "—" } },
  ];
}

function parts(snapshot: PrintedDocSnapshot) {
  const doc = snapshot.doc as unknown as OrderConfirmationDoc;
  const cfg = snapshot.docConfigOverride ?? {};
  const lineTable = sectionOn(cfg.sections, "lineTable") && doc.lines.length > 0;
  return { doc, cfg, kit: kitOf(snapshot), lineTable, cols: orderConfirmationColumns(doc.totals) };
}

/** "12.345,00 USD" ya da "—" — genel toplam metni (HTML ve Excel aynı). */
export const orderGrandTotalText = (doc: OrderConfirmationDoc, fmt: (n: number | null | undefined, d: number) => string): string =>
  doc.totals.amount == null ? "—" : `${fmt(doc.totals.amount, 2)} ${doc.header.currency}`;

/** Koşul satırları ([etiket, değer]) — HTML kutusu ve Excel başlığı aynı listeden. */
export function orderTermLines(doc: OrderConfirmationDoc): Array<[string, string]> {
  const h = doc.header;
  return [["Döviz", h.currency], ...(h.deadline ? [["Termin", fmtCalendarDate(h.deadline)] as [string, string]] : [])];
}

/** Excel tabloları — HTML ile AYNI kolon çözücüsü ve ayar (PDF = Excel). */
export function renderOrderConfirmationTables(snapshot: PrintedDocSnapshot, meta: CommercialRenderMeta = {}): DocTablesPayload {
  const p = parts(snapshot);
  const h = p.doc.header;
  const fmt = docNum(snapshot).tr;
  const wm = watermarkText(meta);
  const header: Array<[string, string | null]> = [
    ...(wm ? [[wm, null] as [string, null]] : []),
    [docTitle(p.cfg.titleOverride, ORDER_CONFIRMATION_TITLE), null],
    ...(snapshot.company?.name ? [[snapshot.company.name, null] as [string, null]] : []),
    ["Sayın", h.customerName],
    ["Sipariş No", h.documentNo],
    ["Tarih", fmtDate(h.orderDate)],
    ...(sectionOn(p.cfg.sections, "terms") ? orderTermLines(p.doc) : []),
    ...(sectionOn(p.cfg.sections, "grandTotal") ? [["Genel Toplam", orderGrandTotalText(p.doc, fmt)] as [string, string]] : []),
  ];
  const tables = p.lineTable
    ? [resolveDocTable({ key: "kalemler", caption: "Sipariş Kalemleri", cols: p.cols, rows: p.doc.lines, colCfg: p.cfg.columns?.kalemler, footLabel: "TOPLAM", kit: p.kit })]
    : [];
  const notes = [p.cfg.footerNote, meta.printNote].filter((n): n is string => !!n && !!n.trim());
  return { docType: "ORDER_CONFIRMATION", documentNo: h.documentNo, header, tables, notes };
}

export function renderOrderConfirmationHtml(snapshot: PrintedDocSnapshot, meta: CommercialRenderMeta = {}): string {
  const p = parts(snapshot);
  const { doc, cfg } = p;
  const h = doc.header;
  const fmt = docNum(snapshot).tr;
  const d = DOC_DENSITY[resolveDocPageSize(cfg.style?.pageSize)];
  const style = resolveDocStyle(cfg.style, { marginMm: 9 });
  const logo = docLogoHtml(meta.logoDataUrl, cfg);
  const on = (k: string) => sectionOn(cfg.sections, k);

  const terms = on("terms")
    ? `<div class="sum">${orderTermLines(doc).map(([k, v]) => `<div class="sum-i"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}</div>`
    : "";
  const lineTable = p.lineTable
    ? `<div class="tbl-cap">Sipariş Kalemleri (${esc(doc.lines.length)})</div>` +
      buildDocTable<OrderConfirmationDocLine>({ className: "sec", colCfg: cfg.columns?.kalemler, footLabel: "TOPLAM", rows: doc.lines, cols: toHtmlCols(p.cols, p.kit) })
    : "";
  const grand = on("grandTotal") ? `<div class="grand"><span>Genel Toplam</span><b>${esc(orderGrandTotalText(doc, fmt))}</b></div>` : "";
  const footer = cfg.footerNote ? `<div class="decl">${esc(cfg.footerNote)}</div>` : "";

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>${commercialCss(cfg, style, d, "siparisTeyidi")}</style></head>
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
        <div class="title">${esc(docTitle(cfg.titleOverride, ORDER_CONFIRMATION_TITLE))}</div>
        ${docCopyBadge(cfg, esc)}
        ${on("orderNo") ? `<div class="ln">Sipariş No: <b>${esc(h.documentNo)}</b></div>` : ""}
        ${on("date") ? `<div class="ln">Tarih: <b>${esc(fmtDate(h.orderDate))}</b></div>` : ""}
      </div>
    </header>
    ${docBlocksHtml(cfg, "afterHeader", esc) + docBlankGridHtml(cfg, "afterHeader", esc)}
    ${terms}
    ${lineTable}
    ${grand}
    ${footer}
    ${docBlocksHtml(cfg, "beforeSignatures", esc) + docBlankGridHtml(cfg, "beforeSignatures", esc)}
    ${docPrintNoteHtml(meta.printNote, esc)}
    ${signaturesHtml(cfg, ORDER_CONFIRMATION_SIGNATURES)}
    ${docStampsBar(cfg, meta, esc, { printedAt: "Basım", printedBy: "Basan" })}
  </div>
</body></html>`;
}
