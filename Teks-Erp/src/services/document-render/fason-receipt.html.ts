// =============================================================================
// Fason Kabul Makbuzu — "FASON KABUL MAKBUZU" HTML renderer (TEK KAYNAK)
// =============================================================================
// Boyahane/baskı vb. fasondan mal DÖNÜŞÜNDE kesilen kabul belgesi. Fason sevk
// irsaliyesinin (gidiş) tersi: burada mal fabrikaya geri gelir, "şu kadar top,
// şu renk/apre uygulanmış" tutanağı fason mutabakatının temelidir. Donmuş
// PrintedDocument snapshot'ından üretilir (sourceId = SubcontractorReceipt.id).
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

interface FasonReceiptRoll {
  sequence: number;
  barcode: string | null;
  itemName: string;
  colorName: string | null;
  width: number | null;
}

export interface FasonReceiptDoc {
  receiptNo: string;
  manifestNo: string | null;
  receivedAt: string;
  notes: string | null;
  subcontractor: { name: string; code: string | null };
  workOrder: { workOrderNumber: string };
  stationName: string;
  /** Boyahane dönüşünde uygulanan renk (renk vermeyen fasonda null). */
  appliedColor: string | null;
  /** Uygulanan üretim özellikleri (apre vb.) — boşsa blok basılmaz. */
  appliedProperties: string[];
  rolls: FasonReceiptRoll[];
  totals: { rollCount: number };
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
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

export function renderFasonReceiptHtml(
  snapshot: PrintedDocSnapshot,
  meta: RenderMeta = {},
): string {
  const doc = snapshot.doc as unknown as FasonReceiptDoc;
  const cfg = snapshot.docConfigOverride ?? {};
  const style = resolveDocStyle(cfg.style, { marginMm: 9 });
  const logo = docLogoHtml(meta.logoDataUrl, cfg);
  const company = snapshot.company;
  const lh = company?.letterhead ?? { addressLine: "", phone: "", taxInfo: "" };

  const title = (cfg.titleOverride?.trim() || "FASON KABUL MAKBUZU").toUpperCase();
  const showLetterhead = cfg.showLetterhead !== false;
  const showSignatures = cfg.showSignatures !== false;
  const sigLabels =
    cfg.signatureLabels && cfg.signatureLabels.length
      ? cfg.signatureLabels
      : ["Teslim Eden (Fason)", "Teslim Alan"];

  const rolls = doc.rolls ?? [];
  const t = doc.totals;

  // Alan aç/kapa toggle'ları (hepsi varsayılan AÇIK — kapanmadıkça mevcut davranış).
  const showTaxNo = sectionOn(cfg.sections, "taxNo");
  const showReceiptNo = sectionOn(cfg.sections, "receiptNo");
  const showDate = sectionOn(cfg.sections, "date");
  const showNotes = sectionOn(cfg.sections, "notes");

  const lhLines = showLetterhead
    ? [lh.addressLine, lh.phone, showTaxNo && lh.taxInfo ? `V.D./No: ${lh.taxInfo}` : "", ...(lh.extraLines ?? [])]
        .filter((s) => s && s.trim())
        .map((s) => `<div class="lh-line">${esc(s)}</div>`)
        .join("")
    : "";

  const watermark = meta.draft
    ? `<div class="wm wm-draft">TASLAK</div>`
    : meta.status === "VOIDED"
      ? `<div class="wm">İPTAL</div>`
      : meta.status === "SUPERSEDED"
        ? `<div class="wm wm-old">ESKİ KOPYA</div>`
        : "";

  const showSub = sectionOn(cfg.sections, "subcontractorInfo");
  const showApplied = sectionOn(cfg.sections, "appliedInfo");
  const subBox = showSub
    ? `<div class="box"><div class="box-t">FASON FİRMA</div>
        <div class="row"><span>Adı:</span><b>${esc(doc.subcontractor.name)}</b></div>
        ${doc.subcontractor.code ? `<div class="row"><span>Kod:</span><b>${esc(doc.subcontractor.code)}</b></div>` : ""}
        <div class="row"><span>İş Emri:</span><b>${esc(doc.workOrder.workOrderNumber)}</b></div>
        <div class="row"><span>İşlem:</span><b>${esc(doc.stationName)}</b></div>
        ${doc.manifestNo ? `<div class="row"><span>Fason İrs.:</span><b>${esc(doc.manifestNo)}</b></div>` : ""}
      </div>`
    : "";
  const appliedBox =
    showApplied && (doc.appliedColor || doc.appliedProperties.length)
      ? `<div class="box"><div class="box-t">UYGULANAN</div>
          ${doc.appliedColor ? `<div class="row"><span>Renk:</span><b>${esc(doc.appliedColor)}</b></div>` : ""}
          ${doc.appliedProperties.length ? `<div class="row"><span>Özellik:</span><b>${esc(doc.appliedProperties.join(", "))}</b></div>` : ""}
        </div>`
      : "";
  const infoGrid = subBox || appliedBox ? `<div class="info">${subBox}${appliedBox}</div>` : "";

  const rollTable = sectionOn(cfg.sections, "rollTable")
    ? `<div class="tbl-cap">Kabul Edilen Toplar (${esc(t.rollCount)})</div>` +
      buildDocTable<FasonReceiptRoll>({
        className: "sec",
        colCfg: cfg.columns?.rollTable,
        rows: rolls,
        cols: [
          { key: "seq", label: "#", align: "c", width: "34px", cell: (r) => esc(r.sequence) },
          { key: "barcode", label: "BARKOD", align: "l", cellClass: "mono", cell: (r) => esc(r.barcode ?? "—") },
          { key: "itemColor", label: "ÜRÜN / RENK", align: "l", cell: (r) => `${esc(r.itemName)}${r.colorName ? ` · ${esc(r.colorName)}` : ""}` },
          { key: "width", label: "EN", align: "c", width: "70px", cell: (r) => (r.width != null ? `${esc(Math.round(r.width))} cm` : "—") },
        ],
      })
    : "";

  const noteBlock = showNotes && (doc.notes || cfg.footerNote)
    ? `<div class="note">${esc(doc.notes || "")}${doc.notes && cfg.footerNote ? " — " : ""}${esc(cfg.footerNote || "")}</div>`
    : "";

  const signatures = showSignatures
    ? `<div class="sign">${sigLabels
        .map((l) => `<div class="sign-box"><div class="sign-line"></div><div class="sign-lbl">${esc(l)}</div></div>`)
        .join("")}</div>`
    : "";

  const css = scaleDocCss(
    `
  * { box-sizing: border-box; }
  ${docPageCss(style)}
  body { margin: 0; font-family: Arial, "Helvetica Neue", sans-serif; color: #111; font-size: 11px; }
  .sheet { position: relative; width: 100%; }
  .mono { font-family: ui-monospace, "Courier New", monospace; }
  .wm { position: fixed; top: 42%; left: 0; right: 0; text-align: center;
        font-size: 96px; font-weight: 800; color: rgba(220,38,38,0.16);
        transform: rotate(-22deg); letter-spacing: 8px; z-index: 0; }
  .wm-old { color: rgba(100,116,139,0.18); }
  .wm-draft { color: rgba(100,116,139,0.16); }
  header { display: flex; justify-content: space-between; align-items: flex-start;
           border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 8px; gap: 12px; }
  .hl { flex: 1; min-width: 0; }
  .company { font-size: 16px; font-weight: 800; text-transform: uppercase; }
  .lh-line { font-size: 10px; color: #333; }
  .hr { text-align: right; white-space: nowrap; }
  .title { font-size: 18px; font-weight: 800; letter-spacing: 1px; }
  .hr .ln { margin-top: 3px; font-size: 11px; }
  .hr .ln b { font-size: 12px; }
  .info { display: flex; gap: 12px; margin: 8px 0; }
  .box { flex: 1; border: 1px solid #cbd5e1; border-radius: 4px; padding: 6px 8px; }
  .box-t { font-size: 10px; font-weight: 700; color: #475569; text-transform: uppercase; margin-bottom: 3px; }
  .box .row { display: grid; grid-template-columns: 64px 1fr; gap: 6px; font-size: 11px; }
  .box .row span { color: #555; }
  .tbl-cap { font-size: 11px; font-weight: 700; text-transform: uppercase; margin: 6px 0 3px; }
  table { border-collapse: collapse; width: 100%; }
  .sec th, .sec td { border: 1px solid #000; padding: 3px 6px; font-size: 11px; }
  .sec thead th { background: #f1f5f9; font-weight: 700; font-size: 10px; text-transform: uppercase; }
  .sec .l { text-align: left; }
  .sec .r { text-align: right; }
  .sec .c { text-align: center; }
  .note { margin-top: 8px; font-size: 11px; white-space: pre-wrap;
          border: 1px solid #cbd5e1; padding: 6px 8px; border-radius: 4px; }
  .sign { display: flex; gap: 24px; margin-top: 28px; }
  .sign-box { flex: 1; text-align: center; }
  .sign-line { border-top: 1px solid #000; margin-bottom: 3px; margin-top: 28px; }
  .sign-lbl { font-size: 10px; color: #333; }
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

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<style>${css}</style></head>
<body>
  ${watermark}
  <div class="sheet">
    <header>
      <div class="hl">
        ${logo.left}
        <div class="company">${esc(company?.name ?? "")}</div>
        ${lhLines}
      </div>
      <div class="hr">
        ${logo.right}
        <div class="title">${esc(title)}</div>
        ${copyBadge}
        ${showReceiptNo ? `<div class="ln">Makbuz No: <b>${esc(doc.receiptNo)}</b></div>` : ""}
        ${showDate ? `<div class="ln">Tarih: <b>${esc(fmtDate(doc.receivedAt))}</b></div>` : ""}
      </div>
    </header>

    ${blocksTop}
    ${infoGrid}
    ${rollTable}
    ${noteBlock}
    ${blocksBottom}
    ${printNote}
    ${signatures}
    ${stampsBar}
  </div>
</body></html>`;
}
