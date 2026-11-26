// =============================================================================
// Emanet Çıkış Belgesi — "EMANET ÇIKIŞ BELGESİ" HTML + Excel (TEK KAYNAK, denetim 6)
// =============================================================================
// Emanet sahibine gider: levent (levent no + metre) ve iplik (lot + kg) kalemleri. Depo adı payload'da YOK;
// belge notu iç alandır, OPT-IN (`sections.internalNotes === true`). Kolonlar bir kez `DocColSpec`:
// HTML `toHtmlCols → buildDocTable`, Excel `resolveDocTable` (PDF = Excel). Çıkış anı fabrika gününden (`fmtDate`).
// =============================================================================

import type { PrintedDocSnapshot } from "../printed-document.service";
import { docBlankGridHtml, docBlocksHtml, docCopyBadge, docLogoHtml, docPrintNoteHtml, docStampsBar, docTitle, resolveDocStyle } from "./doc-style";
import { buildDocTable } from "./doc-table";
import { resolveDocTable, toHtmlCols, type DocColSpec, type DocTablesPayload } from "./doc-model";
import { DOC_DENSITY, resolveDocPageSize } from "./doc-density";
import { fmtDateTime } from "./fmt-date";
import { docNum } from "./fmt-num";
import { commercialCss, esc, kitOf, letterheadHtml, sectionOn, signaturesHtml, watermarkHtml, watermarkText, type CommercialRenderMeta } from "./commercial-doc";

export interface ConsignmentDispatchDocLine {
  seq: number;
  kind: "WARP_BEAM" | "YARN";
  /** Levent: çözgü tanımı adı · iplik: "KOD — Ad". */
  itemText: string;
  /** Levent no ya da iplik lot no. */
  refNo: string;
  qty: number;
  /** "m" (levent) · "kg" (iplik). */
  unit: string;
}

/** Donmuş emanet çıkış payload'ı — fiyat yok; iç alan yalnız `header.notes`. */
export interface ConsignmentDispatchDoc {
  header: {
    documentNo: string;
    dispatchedAt: string;
    ownerName: string;
    ownerCode: string | null;
    plateNumber: string | null;
    driverName: string | null;
    /** İç not — yalnız `sections.internalNotes` açıkken basılır. */
    notes: string | null;
  };
  lines: ConsignmentDispatchDocLine[];
  totals: { beamCount: number; beamLengthM: number; yarnKg: number };
}

export const CONSIGNMENT_DISPATCH_TITLE = "EMANET ÇIKIŞ BELGESİ";
export const CONSIGNMENT_DISPATCH_SIGNATURES = ["Teslim Eden", "Teslim Alan"];
export const CONSIGNMENT_KIND_TEXT: Record<ConsignmentDispatchDocLine["kind"], string> = { WARP_BEAM: "Levent", YARN: "İplik" };

const TEXT = { t: "text" } as const;
const NUM2 = { t: "num", dec: 2 } as const;

/** Kalem kolonları — PDF ve Excel bu TEK listeden. Birimler karışık olduğu için kalem toplamı yok (özet kutusu). */
export function consignmentDispatchColumns(): DocColSpec<ConsignmentDispatchDocLine>[] {
  return [
    { key: "seq", label: "#", align: "c", width: "30px", kind: TEXT, value: (r) => String(r.seq) },
    { key: "kind", label: "TÜR", align: "l", width: "60px", kind: TEXT, value: (r) => CONSIGNMENT_KIND_TEXT[r.kind] },
    { key: "item", label: "KALEM", align: "l", kind: TEXT, value: (r) => r.itemText },
    { key: "ref", label: "LEVENT / LOT", align: "l", width: "120px", kind: TEXT, value: (r) => r.refNo },
    { key: "qty", label: "MİKTAR", align: "r", width: "84px", kind: NUM2, value: (r) => r.qty },
    { key: "unit", label: "BİRİM", align: "c", width: "48px", kind: TEXT, value: (r) => r.unit },
  ];
}

/** Özet satırları ([etiket, değer]) — HTML kutusu ve Excel başlığı aynı listeden; boş kalem türü yazılmaz. */
export function consignmentDispatchSummary(doc: ConsignmentDispatchDoc, fmt: (n: number | null | undefined, d: number) => string): Array<[string, string]> {
  const t = doc.totals;
  return [
    ...(t.beamCount > 0 ? [["Levent", `${t.beamCount} adet · ${fmt(t.beamLengthM, 2)} m`] as [string, string]] : []),
    ...(t.yarnKg > 0 ? [["İplik", `${fmt(t.yarnKg, 2)} kg`] as [string, string]] : []),
  ];
}

/** Araç satırı ("Plaka: … · Şoför: …") — ikisi de boşsa null. */
export function consignmentVehicleText(doc: ConsignmentDispatchDoc): string | null {
  const h = doc.header;
  const parts = [h.plateNumber ? `Plaka: ${h.plateNumber}` : null, h.driverName ? `Şoför: ${h.driverName}` : null].filter((x): x is string => !!x);
  return parts.length ? parts.join(" · ") : null;
}

function parts(snapshot: PrintedDocSnapshot) {
  const doc = snapshot.doc as unknown as ConsignmentDispatchDoc;
  const cfg = snapshot.docConfigOverride ?? {};
  const on = (k: string) => sectionOn(cfg.sections, k);
  // İç not OPT-IN: anahtar yokken KAPALI (müşteri belgesi sözleşmesi).
  const notes = cfg.sections?.internalNotes === true && doc.header.notes ? doc.header.notes : null;
  return { doc, cfg, on, notes, kit: kitOf(snapshot), lineTable: on("lineTable") && doc.lines.length > 0, cols: consignmentDispatchColumns() };
}

/** Excel tabloları — HTML ile AYNI kolon çözücüsü ve ayar (PDF = Excel). */
export function renderConsignmentDispatchTables(snapshot: PrintedDocSnapshot, meta: CommercialRenderMeta = {}): DocTablesPayload {
  const p = parts(snapshot);
  const h = p.doc.header;
  const fmt = docNum(snapshot).tr;
  const wm = watermarkText(meta);
  const vehicle = p.on("vehicle") ? consignmentVehicleText(p.doc) : null;
  const header: Array<[string, string | null]> = [
    ...(wm ? [[wm, null] as [string, null]] : []),
    [docTitle(p.cfg.titleOverride, CONSIGNMENT_DISPATCH_TITLE), null],
    ...(snapshot.company?.name ? [[snapshot.company.name, null] as [string, null]] : []),
    ["Sayın", h.ownerName],
    ["Belge No", h.documentNo],
    ["Tarih", fmtDateTime(h.dispatchedAt)],
    ...(vehicle ? [["Araç", vehicle] as [string, string]] : []),
    ...(p.on("summary") ? consignmentDispatchSummary(p.doc, fmt) : []),
    ...(p.notes ? [["Not", p.notes] as [string, string]] : []),
  ];
  const tables = p.lineTable
    ? [resolveDocTable({ key: "kalemler", caption: "Çıkan Kalemler", cols: p.cols, rows: p.doc.lines, colCfg: p.cfg.columns?.kalemler, kit: p.kit })]
    : [];
  const notes = [p.cfg.footerNote, meta.printNote].filter((n): n is string => !!n && !!n.trim());
  return { docType: "CONSIGNMENT_DISPATCH", documentNo: h.documentNo, header, tables, notes };
}

export function renderConsignmentDispatchHtml(snapshot: PrintedDocSnapshot, meta: CommercialRenderMeta = {}): string {
  const p = parts(snapshot);
  const { doc, cfg, on } = p;
  const h = doc.header;
  const fmt = docNum(snapshot).tr;
  const d = DOC_DENSITY[resolveDocPageSize(cfg.style?.pageSize)];
  const style = resolveDocStyle(cfg.style, { marginMm: 9 });
  const logo = docLogoHtml(meta.logoDataUrl, cfg);
  const vehicle = on("vehicle") ? consignmentVehicleText(doc) : null;
  const sum = on("summary") ? consignmentDispatchSummary(doc, fmt) : [];
  const summary = sum.length ? `<div class="sum">${sum.map(([k, v]) => `<div class="sum-i"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}</div>` : "";
  const lineTable = p.lineTable
    ? `<div class="tbl-cap">Çıkan Kalemler (${esc(doc.lines.length)})</div>` +
      buildDocTable<ConsignmentDispatchDocLine>({ className: "sec", colCfg: cfg.columns?.kalemler, rows: doc.lines, cols: toHtmlCols(p.cols, p.kit) })
    : "";
  const note = p.notes ? `<div class="decl">Not: ${esc(p.notes)}</div>` : "";
  const footer = cfg.footerNote ? `<div class="decl">${esc(cfg.footerNote)}</div>` : "";

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>${commercialCss(cfg, style, d, "emanetCikis")}</style></head>
<body>
  ${watermarkHtml(meta)}
  <div class="sheet">
    <header>
      <div class="hl">
        ${logo.left}
        <div class="company">${esc(snapshot.company?.name ?? "")}</div>
        ${letterheadHtml(snapshot, cfg)}
        <div class="sayin">SAYIN: <b>${esc(h.ownerName)}</b></div>
        ${on("ownerCode") && h.ownerCode ? `<div class="sub">Kod: ${esc(h.ownerCode)}</div>` : ""}
      </div>
      <div class="hr">
        ${logo.right}
        <div class="title">${esc(docTitle(cfg.titleOverride, CONSIGNMENT_DISPATCH_TITLE))}</div>
        ${docCopyBadge(cfg, esc)}
        <div class="ln">Belge No: <b>${esc(h.documentNo)}</b></div>
        ${on("date") ? `<div class="ln">Tarih: <b>${esc(fmtDateTime(h.dispatchedAt))}</b></div>` : ""}
        ${vehicle ? `<div class="meta-row">${esc(vehicle)}</div>` : ""}
      </div>
    </header>
    ${docBlocksHtml(cfg, "afterHeader", esc) + docBlankGridHtml(cfg, "afterHeader", esc)}
    ${summary}
    ${lineTable}
    ${note}
    ${footer}
    ${docBlocksHtml(cfg, "beforeSignatures", esc) + docBlankGridHtml(cfg, "beforeSignatures", esc)}
    ${docPrintNoteHtml(meta.printNote, esc)}
    ${signaturesHtml(cfg, CONSIGNMENT_DISPATCH_SIGNATURES)}
    ${docStampsBar(cfg, meta, esc, { printedAt: "Basım", printedBy: "Basan" })}
  </div>
</body></html>`;
}
