// =============================================================================
// Fiyat Listesi — "FİYAT LİSTESİ" HTML + Excel tabloları (TEK KAYNAK, MAL-6)
// =============================================================================
// Müşteriye gider: satırın maliyet/kâr kolonları payload'a HİÇ girmez. Müşterisiz liste
// "Genel" kapsamla basılır. Kolonlar bir kez `DocColSpec` (PDF = Excel).
// =============================================================================

import type { PrintedDocSnapshot } from "../printed-document.service";
import { docBlankGridHtml, docBlocksHtml, docCopyBadge, docLogoHtml, docPrintNoteHtml, docStampsBar, docTitle, resolveDocStyle } from "./doc-style";
import { buildDocTable } from "./doc-table";
import { resolveDocTable, toHtmlCols, type DocColSpec, type DocTablesPayload } from "./doc-model";
import { DOC_DENSITY, resolveDocPageSize } from "./doc-density";
import { fmtCalendarDate, fmtDate } from "./fmt-date";
import { commercialCss, esc, kitOf, letterheadHtml, sectionOn, signaturesHtml, watermarkHtml, watermarkText, type CommercialRenderMeta } from "./commercial-doc";

export interface PriceListDocLine {
  lineNo: number;
  itemCode: string;
  itemName: string;
  colorName: string | null;
  unitPrice: number;
  minQty: number | null;
}

/** Donmuş fiyat listesi payload'ı — YALNIZ müşteri alanları. */
export interface PriceListDoc {
  header: {
    documentNo: string;
    listNo: string;
    revisionNo: number;
    name: string;
    /** null = genel liste (müşteriye özel değil). */
    customerName: string | null;
    customerCode: string | null;
    currency: string;
    publishedAt: string | null;
    validFromDate: string | null;
    validUntilDate: string | null;
  };
  lines: PriceListDocLine[];
  notes: string | null;
}

export const PRICE_LIST_TITLE = "FİYAT LİSTESİ";
export const PRICE_LIST_SIGNATURES = ["Hazırlayan", "Onaylayan"];
export const GENERAL_SCOPE_TEXT = "Genel";

/** "01.11.2026 – 31.12.2026" · "01.11.2026 tarihinden itibaren" · "31.12.2026 tarihine kadar" · null. */
export function validityText(h: PriceListDoc["header"]): string | null {
  const from = fmtCalendarDate(h.validFromDate);
  const until = fmtCalendarDate(h.validUntilDate);
  if (from && until) return `${from} – ${until}`;
  if (from) return `${from} tarihinden itibaren`;
  return until ? `${until} tarihine kadar` : null;
}

const TEXT = { t: "text" } as const;
const NUM2 = { t: "num", dec: 2 } as const;

/** Satır kolonları — PDF ve Excel bu TEK listeden (maliyet/kâr kolonu YOK). */
export function priceListColumns(): DocColSpec<PriceListDocLine>[] {
  return [
    { key: "seq", label: "#", align: "c", width: "30px", kind: TEXT, value: (r) => String(r.lineNo) },
    { key: "code", label: "KOD", align: "l", width: "90px", kind: TEXT, value: (r) => r.itemCode },
    { key: "item", label: "ÜRÜN", align: "l", kind: TEXT, value: (r) => r.itemName },
    { key: "color", label: "RENK", align: "l", kind: TEXT, value: (r) => r.colorName ?? "Tüm renkler" },
    { key: "unitPrice", label: "BİRİM FİYAT", align: "r", width: "90px", kind: NUM2, value: (r) => r.unitPrice },
    { key: "minQty", label: "ASGARİ MİKTAR", align: "r", width: "90px", kind: NUM2, value: (r) => r.minQty ?? "—" },
  ];
}

function parts(snapshot: PrintedDocSnapshot) {
  const doc = snapshot.doc as unknown as PriceListDoc;
  const cfg = snapshot.docConfigOverride ?? {};
  const lineTable = sectionOn(cfg.sections, "lineTable") && doc.lines.length > 0;
  return { doc, cfg, kit: kitOf(snapshot), lineTable, cols: priceListColumns() };
}

export function renderPriceListTables(snapshot: PrintedDocSnapshot, meta: CommercialRenderMeta = {}): DocTablesPayload {
  const p = parts(snapshot);
  const h = p.doc.header;
  const wm = watermarkText(meta);
  const validity = validityText(h);
  const header: Array<[string, string | null]> = [
    ...(wm ? [[wm, null] as [string, null]] : []),
    [docTitle(p.cfg.titleOverride, PRICE_LIST_TITLE), null],
    ...(snapshot.company?.name ? [[snapshot.company.name, null] as [string, null]] : []),
    h.customerName ? ["Sayın", h.customerName] : ["Kapsam", GENERAL_SCOPE_TEXT],
    ["Liste No", h.documentNo],
    ["Liste", h.name],
    ["Döviz", h.currency],
    ...(h.publishedAt ? [["Yayın Tarihi", fmtDate(h.publishedAt)] as [string, string]] : []),
    ...(validity ? [["Geçerlilik", validity] as [string, string]] : []),
  ];
  const tables = p.lineTable
    ? [resolveDocTable({ key: "satirlar", caption: "Fiyatlar", cols: p.cols, rows: p.doc.lines, colCfg: p.cfg.columns?.satirlar, kit: p.kit })]
    : [];
  const notes = [sectionOn(p.cfg.sections, "notes") ? p.doc.notes : null, p.cfg.footerNote, meta.printNote]
    .filter((n): n is string => !!n && !!n.trim());
  return { docType: "PRICE_LIST", documentNo: h.documentNo, header, tables, notes };
}

function headRight(doc: PriceListDoc, cfg: ReturnType<typeof parts>["cfg"]): string {
  const h = doc.header;
  const on = (k: string) => sectionOn(cfg.sections, k);
  const validity = validityText(h);
  return [
    on("listNo") ? `<div class="ln">Liste No: <b>${esc(h.documentNo)}</b></div>` : "",
    `<div class="ln">Liste: <b>${esc(h.name)}</b></div>`,
    `<div class="ln">Döviz: <b>${esc(h.currency)}</b></div>`,
    on("publishedAt") && h.publishedAt ? `<div class="ln">Yayın Tarihi: <b>${esc(fmtDate(h.publishedAt))}</b></div>` : "",
    on("validity") && validity ? `<div class="ln">Geçerlilik: <b>${esc(validity)}</b></div>` : "",
  ].join("");
}

export function renderPriceListHtml(snapshot: PrintedDocSnapshot, meta: CommercialRenderMeta = {}): string {
  const p = parts(snapshot);
  const { doc, cfg } = p;
  const h = doc.header;
  const d = DOC_DENSITY[resolveDocPageSize(cfg.style?.pageSize)];
  const style = resolveDocStyle(cfg.style, { marginMm: 9 });
  const logo = docLogoHtml(meta.logoDataUrl, cfg);
  const on = (k: string) => sectionOn(cfg.sections, k);

  const party = h.customerName
    ? `<div class="sayin">SAYIN: <b>${esc(h.customerName)}</b></div>` +
      (on("customerCode") && h.customerCode ? `<div class="sub">Kod: ${esc(h.customerCode)}</div>` : "")
    : `<div class="sayin">KAPSAM: <b>${GENERAL_SCOPE_TEXT}</b></div>`;
  const lineTable = p.lineTable
    ? `<div class="tbl-cap">Fiyatlar (${esc(doc.lines.length)})</div>` +
      buildDocTable<PriceListDocLine>({ className: "sec", colCfg: cfg.columns?.satirlar, rows: doc.lines, cols: toHtmlCols(p.cols, p.kit) })
    : "";
  const notes = on("notes") && doc.notes ? `<div class="qn">${esc(doc.notes)}</div>` : "";
  const footer = cfg.footerNote ? `<div class="decl">${esc(cfg.footerNote)}</div>` : "";

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>${commercialCss(cfg, style, d, "fiyatListesi")}</style></head>
<body>
  ${watermarkHtml(meta)}
  <div class="sheet">
    <header>
      <div class="hl">
        ${logo.left}
        <div class="company">${esc(snapshot.company?.name ?? "")}</div>
        ${letterheadHtml(snapshot, cfg)}
        ${party}
      </div>
      <div class="hr">
        ${logo.right}
        <div class="title">${esc(docTitle(cfg.titleOverride, PRICE_LIST_TITLE))}</div>
        ${docCopyBadge(cfg, esc)}
        ${headRight(doc, cfg)}
      </div>
    </header>
    ${docBlocksHtml(cfg, "afterHeader", esc) + docBlankGridHtml(cfg, "afterHeader", esc)}
    ${lineTable}
    ${notes}
    ${footer}
    ${docBlocksHtml(cfg, "beforeSignatures", esc) + docBlankGridHtml(cfg, "beforeSignatures", esc)}
    ${docPrintNoteHtml(meta.printNote, esc)}
    ${signaturesHtml(cfg, PRICE_LIST_SIGNATURES)}
    ${docStampsBar(cfg, meta, esc, { printedAt: "Basım", printedBy: "Basan" })}
  </div>
</body></html>`;
}
