// =============================================================================
// DEPO BELGELERİ — Transfer İrsaliyesi + Mal Kabul Fişi (TEK KAYNAK)
// =============================================================================
// İki belge de aynı iskelete oturuyor: antet + iki taraf kutusu + top tablosu +
// toplam + imzalar. Ayrı iki dosya yazmak, aynı tabloyu iki yerde bakmak demekti
// (kolon eklendiğinde biri unutulur). Fark yalnız BAŞLIK BLOĞUDUR:
//   • Transfer  : kaynak depo → hedef depo
//   • Mal Kabul : tedarikçi + irsaliye no + giren depo
//
// ⚠️ İç belgelerdir (müşteriye gitmez) — "SAYIN" bloğu yoktur. Yine de resmi
// belge zinciri aynıdır: donmuş snapshot + versiyon + İPTAL filigranı.
// =============================================================================

import type { PrintedDocStatus } from "@prisma/client";
import type { PrintedDocSnapshot } from "../printed-document.service";
import {
  resolveDocStyle, docPageCss, docTableCss, scaleDocCss, docLogoHtml,
  docBlankGridCss, docBlankGridHtml,
  DOC_LOGO_CSS, DOC_STAMPS_CSS, docCopyBadge, docBlocksHtml, docPrintNoteHtml, docStampsBar,
} from "./doc-style";
import { buildDocTable } from "./doc-table";
import { DOC_DENSITY, docChromeCss, resolveDocPageSize, scaleW } from "./doc-density";
import { DOC_FIELD_CATALOGS, docFieldCss } from "./doc-fields";

export interface WarehouseDocLine {
  barcode: string | null;
  itemName: string;
  colorName: string | null;
  width: number | null;
  qty: number;
}

export interface WarehouseTransferDoc {
  header: {
    documentNo: string;
    date: string | null;
    fromWarehouseName: string;
    fromWarehouseCode: string | null;
    toWarehouseName: string;
    toWarehouseCode: string | null;
    createdBy: string | null;
  };
  lines: WarehouseDocLine[];
  notes: string | null;
}

export interface GoodsReceiptDoc {
  header: {
    documentNo: string;
    date: string | null;
    warehouseName: string;
    warehouseCode: string | null;
    supplierName: string | null;
    supplierCode: string | null;
    deliveryNoteNo: string | null;
    createdBy: string | null;
  };
  lines: WarehouseDocLine[];
  notes: string | null;
}

interface RenderMeta {
  status?: PrintedDocStatus; voidReason?: string | null; draft?: boolean;
  logoDataUrl?: string | null; qrDataUrl?: string | null;
  printedAtText?: string; printedBy?: string | null; printNote?: string | null;
}

function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function fmtQty(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "";
  const [int, frac] = Math.abs(n).toFixed(2).split(".");
  return (n < 0 ? "-" : "") + int!.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (frac ? `,${frac}` : "");
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

/** İki belgenin ORTAK gövdesi — fark yalnız başlık satırları ve etiketlerde. */
function renderWarehouseDoc(
  snapshot: PrintedDocSnapshot,
  meta: RenderMeta,
  opts: {
    defaultTitle: string;
    configKey: string;
    /** Sağ üst blok satırları (belge no/tarih dışında). */
    headerLines: string[];
    /** Sol blok: taraf bilgisi (depo / tedarikçi). */
    partyLines: string[];
    caption: string;
    signatureLabels: string[];
    notes: string | null;
    lines: WarehouseDocLine[];
    documentNo: string;
    date: string | null;
  },
): string {
  const cfg = snapshot.docConfigOverride ?? {};
  const pageSize = resolveDocPageSize(cfg.style?.pageSize);
  const d = DOC_DENSITY[pageSize];
  const style = resolveDocStyle(cfg.style, { marginMm: 9 });
  const logo = docLogoHtml(meta.logoDataUrl, cfg);
  const company = snapshot.company;
  const lh = company?.letterhead ?? { addressLine: "", phone: "", taxInfo: "" };

  const title = (cfg.titleOverride?.trim() || opts.defaultTitle).toUpperCase();
  const showLetterhead = cfg.showLetterhead !== false;
  const showSignatures = cfg.showSignatures !== false;
  const sigLabels = cfg.signatureLabels?.length ? cfg.signatureLabels : opts.signatureLabels;

  const lhLines = showLetterhead
    ? [lh.addressLine, lh.phone, ...(lh.extraLines ?? [])]
        .filter((s) => s && s.trim()).map((s) => `<div class="lh-line">${esc(s)}</div>`).join("")
    : "";

  const watermark = meta.draft ? `<div class="wm wm-draft">TASLAK</div>`
    : meta.status === "VOIDED" ? `<div class="wm">İPTAL</div>`
      : meta.status === "SUPERSEDED" ? `<div class="wm wm-old">ESKİ KOPYA</div>` : "";

  const totalQty = opts.lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const table = sectionOn(cfg.sections, "rollTable")
    ? buildDocTable<WarehouseDocLine>({
        className: "sec",
        caption: opts.caption,
        colCfg: cfg.columns?.rollTable,
        rows: opts.lines,
        footLabel: `TOPLAM (${opts.lines.length} top)`,
        cols: [
          { key: "barcode", label: "BARKOD", align: "l", cellClass: "mono", cell: (r) => esc(r.barcode ?? "—") },
          { key: "itemColor", label: "ÜRÜN / RENK", align: "l", cell: (r) => `${esc(r.itemName)}${r.colorName ? ` · ${esc(r.colorName)}` : ""}` },
          { key: "width", label: "EN", align: "c", width: "60px", cell: (r) => (r.width != null ? `${esc(Math.round(r.width))} cm` : "—") },
          {
            key: "qty", label: "METRE", align: "r", width: "90px",
            cell: (r) => esc(fmtQty(r.qty)),
            foot: esc(fmtQty(totalQty)),
          },
        ],
      })
    : "";

  const partyBox = opts.partyLines.length
    ? `<div class="box">${opts.partyLines.join("")}</div>`
    : "";
  const notesBox = opts.notes ? `<div class="box"><div class="row"><span>Not:</span><b>${esc(opts.notes)}</b></div></div>` : "";

  const signatures = showSignatures
    ? `<div class="sign">${sigLabels.map((l) => `<div class="sign-box"><div class="sign-line"></div><div class="sign-lbl">${esc(l)}</div></div>`).join("")}</div>`
    : "";
  const noteBlock = cfg.footerNote ? `<div class="note">${esc(cfg.footerNote)}</div>` : "";

  const css = scaleDocCss(
    `
  * { box-sizing: border-box; }
  ${docPageCss(style)}
  ${docChromeCss(d, { boxLabelA4: 104 })}
  /* Depo belgelerine ÖZEL — ortak chrome'dan SONRA basılır ki kazansın.
     .box tek başına duran bir kutudur (taraf bilgisi), flex çocuğu DEĞİL.
     (Şablonun içinde BACKTICK kullanma — literal'i ortadan böler.) */
  .sec { margin-top: ${scaleW(d, 6)}px; }
  .sec th.caption { background: #e2e8f0; text-align: center; font-size: ${d.secCaption}px; font-weight: 800; letter-spacing: 1px; padding: ${scaleW(d, 5)}px; }
  .sec thead th:not(.caption) { background: #f1f5f9; font-weight: 700; font-size: ${d.secHead}px; text-transform: none; }
  .box { flex: none; margin-top: ${scaleW(d, 8)}px; }
  .box .row { margin-top: 2px; }
  ${DOC_LOGO_CSS}
  ${DOC_STAMPS_CSS}
  ${docBlankGridCss(cfg)}
  ${docTableCss(style, [".sec"])}
  ${docFieldCss(cfg.fields, DOC_FIELD_CATALOGS[opts.configKey], d)}
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
      </div>
      <div class="hr">
        ${logo.right}
        <div class="title">${esc(title)}</div>
        ${copyBadge}
        ${sectionOn(cfg.sections, "documentNo") ? `<div class="ln">Belge No: <b>${esc(opts.documentNo)}</b></div>` : ""}
        ${sectionOn(cfg.sections, "date") ? `<div class="ln">Tarih: <b>${esc(fmtDate(opts.date))}</b></div>` : ""}
        ${opts.headerLines.join("")}
      </div>
    </header>
    ${blocksTop}
    ${partyBox}
    ${table}
    ${notesBox}
    ${noteBlock}
    ${blocksBottom}
    ${printNote}
    ${signatures}
    ${stampsBar}
  </div>
</body></html>`;
}

export function renderWarehouseTransferHtml(snapshot: PrintedDocSnapshot, meta: RenderMeta = {}): string {
  const doc = snapshot.doc as unknown as WarehouseTransferDoc;
  const h = doc.header;
  const cfg = snapshot.docConfigOverride ?? {};
  return renderWarehouseDoc(snapshot, meta, {
    defaultTitle: "DEPO TRANSFER İRSALİYESİ",
    configKey: "depoTransfer",
    headerLines: [],
    partyLines: [
      `<div class="row"><span>Çıkan Depo:</span><b>${esc(h.fromWarehouseName)}${h.fromWarehouseCode ? ` (${esc(h.fromWarehouseCode)})` : ""}</b></div>`,
      `<div class="row"><span>Giren Depo:</span><b>${esc(h.toWarehouseName)}${h.toWarehouseCode ? ` (${esc(h.toWarehouseCode)})` : ""}</b></div>`,
      sectionOn(cfg.sections, "createdBy") && h.createdBy
        ? `<div class="row"><span>Düzenleyen:</span><b>${esc(h.createdBy)}</b></div>`
        : "",
    ].filter(Boolean),
    caption: "TAŞINAN TOPLAR",
    signatureLabels: ["Teslim Eden", "Teslim Alan"],
    notes: doc.notes,
    lines: doc.lines ?? [],
    documentNo: h.documentNo,
    date: h.date,
  });
}

export function renderGoodsReceiptHtml(snapshot: PrintedDocSnapshot, meta: RenderMeta = {}): string {
  const doc = snapshot.doc as unknown as GoodsReceiptDoc;
  const h = doc.header;
  const cfg = snapshot.docConfigOverride ?? {};
  return renderWarehouseDoc(snapshot, meta, {
    defaultTitle: "MAL KABUL FİŞİ",
    configKey: "malKabul",
    headerLines: [
      sectionOn(cfg.sections, "deliveryNote") && h.deliveryNoteNo
        ? `<div class="ln">Tedarikçi İrsaliyesi: <b>${esc(h.deliveryNoteNo)}</b></div>`
        : "",
    ].filter(Boolean),
    partyLines: [
      h.supplierName
        ? `<div class="row"><span>Tedarikçi:</span><b>${esc(h.supplierName)}${h.supplierCode ? ` (${esc(h.supplierCode)})` : ""}</b></div>`
        : "",
      `<div class="row"><span>Giren Depo:</span><b>${esc(h.warehouseName)}${h.warehouseCode ? ` (${esc(h.warehouseCode)})` : ""}</b></div>`,
      sectionOn(cfg.sections, "createdBy") && h.createdBy
        ? `<div class="row"><span>Teslim Alan:</span><b>${esc(h.createdBy)}</b></div>`
        : "",
    ].filter(Boolean),
    caption: "KABUL EDİLEN TOPLAR",
    signatureLabels: ["Teslim Eden (Tedarikçi)", "Teslim Alan"],
    notes: doc.notes,
    lines: doc.lines ?? [],
    documentNo: h.documentNo,
    date: h.date,
  });
}
