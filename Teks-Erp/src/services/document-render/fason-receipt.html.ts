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
  docBlankGridCss,
  docBlankGridHtml,
  docPrintNoteHtml,
  docStampsBar,
} from "./doc-style";
import { buildDocTable } from "./doc-table";
import { DOC_DENSITY, docChromeCss, resolveDocPageSize } from "./doc-density";
import { DOC_FIELD_CATALOGS, docFieldCss } from "./doc-fields";

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
  /** Dönen topların partileri — "hangi partiyi gönderdim / hangi parti döndü" döngüsünü
   *  kapatır. ÇOĞUL: sevkte K10 "bir sevk = bir parti" garantisi vardır ama KABUL birden
   *  fazla sevki kapsayabilir (kısmi/örtüşen kabul) → tekil alan sessizce yanlış olurdu.
   *  ⚠️ OPSİYONEL: 2026-08-05 öncesi donmuş makbuzlarda YOK → satır basılmaz. */
  batchNumbers?: string[];
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
  // Yoğunluk profili sayfa boyutundan çözülür; ortak chrome CSS'i oradan beslenir.
  const pageSize = resolveDocPageSize(cfg.style?.pageSize);
  const d = DOC_DENSITY[pageSize];
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
  // Parti satırı — varsayılan AÇIK (fason firmanın operasyonel ihtiyacı). Alan
  // taşımayan eski donmuş makbuzlarda dizi boş → satır hiç doğmaz.
  const showBatch = sectionOn(cfg.sections, "batchInfo");
  const batchNumbers = doc.batchNumbers ?? [];
  const subBox = showSub
    ? `<div class="box"><div class="box-t">FASON FİRMA</div>
        <div class="row"><span>Adı:</span><b>${esc(doc.subcontractor.name)}</b></div>
        ${doc.subcontractor.code ? `<div class="row"><span>Kod:</span><b>${esc(doc.subcontractor.code)}</b></div>` : ""}
        <div class="row"><span>İş Emri:</span><b>${esc(doc.workOrder.workOrderNumber)}</b></div>
        ${showBatch && batchNumbers.length ? `<div class="row"><span>Parti:</span><b>${esc(batchNumbers.join(", "))}</b></div>` : ""}
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
  ${docChromeCss(d, { boxLabelA4: 64 })}
  ${DOC_LOGO_CSS}
  ${DOC_STAMPS_CSS}
  ${docBlankGridCss(cfg)}
  ${docTableCss(style, [".sec"])}
  ${docFieldCss(cfg.fields, DOC_FIELD_CATALOGS["fasonKabul"], d)}
`,
    style,
  );

  const copyBadge = docCopyBadge(cfg, esc);
  const blocksTop = docBlocksHtml(cfg, "afterHeader", esc) + docBlankGridHtml(cfg, "afterHeader", esc);
  const blocksBottom = docBlocksHtml(cfg, "beforeSignatures", esc) + docBlankGridHtml(cfg, "beforeSignatures", esc);
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
