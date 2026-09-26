// =============================================================================
// Kalite Sertifikası — "KALİTE SERTİFİKASI" HTML renderer (TEK KAYNAK)
// =============================================================================
// Sevkiyata eşlik eden kalite belgesi: gönderilen topların kalite dağılımı
// (kalite başına adet/metraj) + opsiyonel top-bazlı döküm + beyan metni. Kaynak
// Shipment (sourceId = Shipment.id); lazy-init ile ilk açılışta donar.
// =============================================================================

import type { PrintedDocStatus } from "@prisma/client";
import type { PrintedDocSnapshot } from "../printed-document.service";
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
import { DOC_DENSITY, docChromeCss, resolveDocPageSize, scaleW } from "./doc-density";
import { DOC_FIELD_CATALOGS, docFieldCss } from "./doc-fields";
import { fmtDate } from "./fmt-date";
import { docNum } from "./fmt-num";

interface QualityGradeRow {
  grade: string;
  rollCount: number;
  totalMeters: number;
}
interface QualityRollRow {
  sequence: number;
  barcode: string | null;
  itemName: string;
  colorName: string | null;
  width: number | null;
  grade: string;
  meters: number;
}
export interface QualityCertificateDoc {
  header: {
    shipmentNo: string;
    customerName: string;
    customerCode: string | null;
    date: string | null;
    orderNos: string;
  };
  grades: QualityGradeRow[];
  rolls: QualityRollRow[];
  totals: { rollCount: number; totalMeters: number };
}

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
/** Metre/kg: 2 ondalık; yuvarlama snapshot'ın damgasından (`docNum`). */
const qtyFmt = (snapshot: PrintedDocSnapshot) => (n: number | null | undefined): string => docNum(snapshot).tr(n, 2);
function sectionOn(sections: Record<string, boolean> | undefined, key: string): boolean {
  return sections?.[key] !== false;
}

export function renderQualityCertificateHtml(
  snapshot: PrintedDocSnapshot,
  meta: RenderMeta = {},
): string {
  const doc = snapshot.doc as unknown as QualityCertificateDoc;
  const fmtQty = qtyFmt(snapshot);
  const cfg = snapshot.docConfigOverride ?? {};
  const pageSize = resolveDocPageSize(cfg.style?.pageSize);
  const d = DOC_DENSITY[pageSize];
  const style = resolveDocStyle(cfg.style, { marginMm: 9 });
  const logo = docLogoHtml(meta.logoDataUrl, cfg);
  const company = snapshot.company;
  const lh = company?.letterhead ?? { addressLine: "", phone: "", taxInfo: "" };
  const h = doc.header;
  const t = doc.totals;

  // Alan aç/kapa toggle'ları (hepsi varsayılan AÇIK — kapanmadıkça mevcut davranış).
  const showTaxNo = sectionOn(cfg.sections, "taxNo");
  const showCustomerCode = sectionOn(cfg.sections, "customerCode");
  const showShipmentNo = sectionOn(cfg.sections, "shipmentNo");
  const showDate = sectionOn(cfg.sections, "date");
  const showOrderNos = sectionOn(cfg.sections, "orderNos");

  const title = docTitle(cfg.titleOverride, "KALİTE SERTİFİKASI");
  const showLetterhead = cfg.showLetterhead !== false;
  const showSignatures = cfg.showSignatures !== false;
  const sigLabels = cfg.signatureLabels?.length ? cfg.signatureLabels : ["Kalite Sorumlusu", "Teslim Alan"];

  const lhLines = showLetterhead
    ? [lh.addressLine, lh.phone, showTaxNo && lh.taxInfo ? `V.D./No: ${lh.taxInfo}` : "", ...(lh.extraLines ?? [])]
        .filter((s) => s && s.trim()).map((s) => `<div class="lh-line">${esc(s)}</div>`).join("")
    : "";
  const watermark = meta.draft
    ? `<div class="wm wm-draft">TASLAK</div>`
    : meta.status === "VOIDED" ? `<div class="wm">İPTAL</div>`
      : meta.status === "SUPERSEDED" ? `<div class="wm wm-old">ESKİ KOPYA</div>` : "";

  const gradeTable = sectionOn(cfg.sections, "gradeSummary")
    ? `<div class="tbl-cap">Kalite Dağılımı</div>` +
      buildDocTable<QualityGradeRow>({
        className: "sec",
        colCfg: cfg.columns?.gradeSummary,
        footLabel: "TOPLAM",
        rows: doc.grades,
        cols: [
          { key: "grade", label: "KALİTE", align: "l", cell: (g) => esc(g.grade) },
          { key: "rollCount", label: "TOP ADEDİ", align: "r", cell: (g) => esc(g.rollCount), foot: esc(t.rollCount) },
          { key: "totalMeters", label: "TOPLAM METRE", align: "r", cell: (g) => esc(fmtQty(g.totalMeters)), foot: esc(fmtQty(t.totalMeters)) },
        ],
      })
    : "";

  const rollTable = sectionOn(cfg.sections, "rollDetail") && doc.rolls.length
    ? `<div class="tbl-cap">Top Dökümü (${esc(t.rollCount)})</div>` +
      buildDocTable<QualityRollRow>({
        className: "sec",
        colCfg: cfg.columns?.rollDetail,
        rows: doc.rolls,
        cols: [
          { key: "seq", label: "#", align: "c", width: "34px", cell: (r) => esc(r.sequence) },
          { key: "barcode", label: "BARKOD", align: "l", cellClass: "mono", cell: (r) => esc(r.barcode ?? "—") },
          { key: "itemColor", label: "ÜRÜN / RENK", align: "l", cell: (r) => `${esc(r.itemName)}${r.colorName ? ` · ${esc(r.colorName)}` : ""}` },
          { key: "width", label: "EN", align: "c", width: "60px", cell: (r) => (r.width != null ? `${esc(Math.round(r.width))} cm` : "—") },
          { key: "grade", label: "KALİTE", align: "c", width: "70px", cell: (r) => esc(r.grade || "—") },
          { key: "meters", label: "METRE", align: "r", width: "80px", cell: (r) => esc(fmtQty(r.meters)) },
        ],
      })
    : "";

  const declaration = sectionOn(cfg.sections, "declaration")
    ? `<div class="decl">${esc(cfg.footerNote || "Yukarıda dökümü verilen ürünlerin belirtilen kalite sınıflarında sevk edildiğini beyan ederiz.")}</div>`
    : (cfg.footerNote ? `<div class="decl">${esc(cfg.footerNote)}</div>` : "");

  const signatures = showSignatures
    ? `<div class="sign">${sigLabels.map((l) => `<div class="sign-box"><div class="sign-line"></div><div class="sign-lbl">${esc(l)}</div></div>`).join("")}</div>`
    : "";

  const css = scaleDocCss(
    `
  * { box-sizing: border-box; }
  ${docPageCss(style)}
  ${docChromeCss(d)}
  /* ── Kalite sertifikasına ÖZEL — ortak chrome'dan SONRA basılır ki kazansın.
     (Şablonun içinde BACKTICK kullanma — literal'i ortadan böler.) */
  .tbl-cap { margin: ${scaleW(d, 8)}px 0 ${scaleW(d, 3)}px; }
  .decl { margin-top: ${scaleW(d, 12)}px; font-size: ${d.note}px; white-space: pre-wrap;
          border: 1px solid #cbd5e1; padding: ${scaleW(d, 8)}px ${scaleW(d, 10)}px; border-radius: 4px; font-style: italic; }
  ${DOC_LOGO_CSS}
  ${DOC_STAMPS_CSS}
  ${docBlankGridCss(cfg)}
  ${docTableCss(style, [".sec"])}
  ${docFieldCss(cfg.fields, DOC_FIELD_CATALOGS["kaliteSertifikasi"], d)}
`,
    style,
  );

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
        ${showCustomerCode && h.customerCode ? `<div class="sub">Kod: ${esc(h.customerCode)}</div>` : ""}
      </div>
      <div class="hr">
        ${logo.right}
        <div class="title">${esc(title)}</div>
        ${copyBadge}
        ${showShipmentNo ? `<div class="ln">Sevkiyat No: <b>${esc(h.shipmentNo)}</b></div>` : ""}
        ${showDate ? `<div class="ln">Tarih: <b>${esc(fmtDate(h.date))}</b></div>` : ""}
        ${showOrderNos && h.orderNos ? `<div class="ln">Sipariş: <b>${esc(h.orderNos)}</b></div>` : ""}
      </div>
    </header>
    ${blocksTop}
    ${gradeTable}
    ${rollTable}
    ${declaration}
    ${blocksBottom}
    ${printNote}
    ${signatures}
    ${stampsBar}
  </div>
</body></html>`;
}
