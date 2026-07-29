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
  docPrintNoteHtml,
  docStampsBar,
} from "./doc-style";
import { buildDocTable } from "./doc-table";

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
function fmtQty(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "";
  const [int, frac] = Math.abs(n).toFixed(2).split(".");
  return (n < 0 ? "-" : "") + int.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (frac ? `,${frac}` : "");
}
function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}
function sectionOn(sections: Record<string, boolean> | undefined, key: string): boolean {
  return sections?.[key] !== false;
}

export function renderQualityCertificateHtml(
  snapshot: PrintedDocSnapshot,
  meta: RenderMeta = {},
): string {
  const doc = snapshot.doc as unknown as QualityCertificateDoc;
  const cfg = snapshot.docConfigOverride ?? {};
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

  const title = (cfg.titleOverride?.trim() || "KALİTE SERTİFİKASI").toUpperCase();
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
  body { margin: 0; font-family: Arial, "Helvetica Neue", sans-serif; color: #111; font-size: 11px; }
  .sheet { position: relative; width: 100%; }
  .mono { font-family: ui-monospace, "Courier New", monospace; }
  .wm { position: fixed; top: 42%; left: 0; right: 0; text-align: center; font-size: 96px; font-weight: 800; color: rgba(220,38,38,0.16); transform: rotate(-22deg); letter-spacing: 8px; z-index: 0; }
  .wm-old { color: rgba(100,116,139,0.18); } .wm-draft { color: rgba(100,116,139,0.16); }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 8px; gap: 12px; }
  .hl { flex: 1; min-width: 0; } .company { font-size: 16px; font-weight: 800; text-transform: uppercase; } .lh-line { font-size: 10px; color: #333; }
  .sayin { margin-top: 6px; font-size: 13px; } .sayin b { font-size: 15px; text-transform: uppercase; } .sub { font-size: 10px; color: #444; margin-top: 1px; }
  .hr { text-align: right; white-space: nowrap; } .title { font-size: 18px; font-weight: 800; letter-spacing: 1px; }
  .hr .ln { margin-top: 3px; font-size: 11px; } .hr .ln b { font-size: 12px; }
  .tbl-cap { font-size: 11px; font-weight: 700; text-transform: uppercase; margin: 8px 0 3px; }
  table { border-collapse: collapse; width: 100%; }
  .sec th, .sec td { border: 1px solid #000; padding: 3px 6px; font-size: 11px; }
  .sec thead th { background: #f1f5f9; font-weight: 700; font-size: 10px; text-transform: uppercase; }
  .sec .l { text-align: left; } .sec .r { text-align: right; } .sec .c { text-align: center; }
  .sec .tot td { font-weight: 800; background: #f8fafc; border-top: 2px solid #000; }
  .decl { margin-top: 12px; font-size: 11px; white-space: pre-wrap; border: 1px solid #cbd5e1; padding: 8px 10px; border-radius: 4px; font-style: italic; }
  .sign { display: flex; gap: 24px; margin-top: 28px; } .sign-box { flex: 1; text-align: center; } .sign-line { border-top: 1px solid #000; margin-bottom: 3px; margin-top: 28px; } .sign-lbl { font-size: 10px; color: #333; }
  ${DOC_LOGO_CSS}
  ${DOC_STAMPS_CSS}
  ${docTableCss(style, [".sec"])}
`,
    style,
  );

  const copyBadge = docCopyBadge(cfg, esc);
  const blocksTop = docBlocksHtml(cfg, "afterHeader", esc);
  const blocksBottom = docBlocksHtml(cfg, "beforeSignatures", esc);
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
