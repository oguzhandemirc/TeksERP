// =============================================================================
// İade İrsaliyesi — "İADE İRSALİYESİ" HTML renderer (TEK KAYNAK)
// =============================================================================
// Müşteriden dönen topun kabul belgesi. Kaynak RollReturn (top-başına) —
// sourceId = RollReturn.id. Hangi topun, hangi sevkiyattan/siparişten, hangi
// nedenle iade alındığını + kabul eden personeli gösterir. İade iptali → VOIDED.
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
import { fmtDate } from "./fmt-date";

interface ReturnLine {
  barcode: string | null;
  itemName: string;
  colorName: string | null;
  width: number | null;
  qty: number;
  grade: string;
}
export interface ReturnDispatchDoc {
  header: {
    documentNo: string;
    customerName: string;
    customerCode: string | null;
    date: string | null;
    fromShipmentNo: string | null;
    orderNo: string | null;
  };
  /** Tekil iade kalemi. ESKİ SNAPSHOT'LARIN TEK ALANI — kaldırılamaz. */
  line: ReturnLine;
  /**
   * ÇOK KALEMLİ iade (çuval bazlı toplu kabul) — yalnız grup iadelerinde yazılır.
   * Yoksa `[line]` kullanılır → 2026-08-05 öncesi donmuş belgeler bayt-bayt aynı
   * basılır (tablo zaten `buildDocTable` ile çiziliyordu, satır sayısı değişti).
   */
  lines?: ReturnLine[];
  reason: string | null;
  note: string | null;
  receivedBy: string | null;
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
  return (n < 0 ? "-" : "") + int.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (frac ? `,${frac}` : "");
}
function sectionOn(sections: Record<string, boolean> | undefined, key: string): boolean {
  return sections?.[key] !== false;
}

export function renderReturnDispatchHtml(snapshot: PrintedDocSnapshot, meta: RenderMeta = {}): string {
  const doc = snapshot.doc as unknown as ReturnDispatchDoc;
  const cfg = snapshot.docConfigOverride ?? {};
  const pageSize = resolveDocPageSize(cfg.style?.pageSize);
  const d = DOC_DENSITY[pageSize];
  const style = resolveDocStyle(cfg.style, { marginMm: 9 });
  const logo = docLogoHtml(meta.logoDataUrl, cfg);
  const company = snapshot.company;
  const lh = company?.letterhead ?? { addressLine: "", phone: "", taxInfo: "" };
  const h = doc.header;

  const title = (cfg.titleOverride?.trim() || "İADE İRSALİYESİ").toUpperCase();
  const showLetterhead = cfg.showLetterhead !== false;
  const showSignatures = cfg.showSignatures !== false;
  const sigLabels = cfg.signatureLabels?.length ? cfg.signatureLabels : ["Teslim Eden (Müşteri)", "Teslim Alan"];

  // Alan aç/kapa toggle'ları (hepsi varsayılan AÇIK — kapanmadıkça mevcut davranış).
  const showTaxNo = sectionOn(cfg.sections, "taxNo");
  const showCustomerCode = sectionOn(cfg.sections, "customerCode");
  const showDocumentNo = sectionOn(cfg.sections, "documentNo");
  const showDate = sectionOn(cfg.sections, "date");
  const showReferences = sectionOn(cfg.sections, "references");

  const lhLines = showLetterhead
    ? [lh.addressLine, lh.phone, showTaxNo && lh.taxInfo ? `V.D./No: ${lh.taxInfo}` : "", ...(lh.extraLines ?? [])]
        .filter((s) => s && s.trim()).map((s) => `<div class="lh-line">${esc(s)}</div>`).join("")
    : "";
  const watermark = meta.draft ? `<div class="wm wm-draft">TASLAK</div>`
    : meta.status === "VOIDED" ? `<div class="wm">İPTAL</div>`
      : meta.status === "SUPERSEDED" ? `<div class="wm wm-old">ESKİ KOPYA</div>` : "";

  const refBits = [
    h.fromShipmentNo ? `Geldiği Sevkiyat: <b>${esc(h.fromShipmentNo)}</b>` : "",
    h.orderNo ? `Sipariş: <b>${esc(h.orderNo)}</b>` : "",
  ].filter(Boolean);
  const refRow = showReferences && refBits.length ? `<div class="meta-row">${refBits.join(" &nbsp;·&nbsp; ")}</div>` : "";

  // Çok kalemli iade → `lines`; eski/tekil snapshot → `[line]`. Toplam satırı YALNIZ
  // çok kalemlide basılır (`footLabel` yoksa `buildDocTable` foot satırını hiç
  // üretmez) → tek kalemli belgenin çıktısı bayt-bayt korunur.
  const lines = doc.lines?.length ? doc.lines : [doc.line];
  const multiLine = lines.length > 1;
  const totalQty = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const table = sectionOn(cfg.sections, "rollTable")
    ? buildDocTable<ReturnLine>({
        className: "sec",
        caption: multiLine ? "İADE EDİLEN TOPLAR" : "İADE EDİLEN TOP",
        colCfg: cfg.columns?.rollTable,
        rows: lines,
        footLabel: multiLine ? `TOPLAM (${lines.length} top)` : undefined,
        cols: [
          { key: "barcode", label: "BARKOD", align: "l", cellClass: "mono", cell: (r) => esc(r.barcode ?? "—") },
          { key: "itemColor", label: "ÜRÜN / RENK", align: "l", cell: (r) => `${esc(r.itemName)}${r.colorName ? ` · ${esc(r.colorName)}` : ""}` },
          { key: "width", label: "EN", align: "c", width: "60px", cell: (r) => (r.width != null ? `${esc(Math.round(r.width))} cm` : "—") },
          { key: "grade", label: "KALİTE", align: "c", width: "70px", cell: (r) => esc(r.grade || "—") },
          {
            key: "qty", label: "METRE", align: "r", width: "80px",
            cell: (r) => esc(fmtQty(r.qty)),
            foot: multiLine ? esc(fmtQty(totalQty)) : undefined,
          },
        ],
      })
    : "";

  const reasonBox = sectionOn(cfg.sections, "reason") && (doc.reason || doc.note)
    ? `<div class="box">
        ${doc.reason ? `<div class="row"><span>İade Nedeni:</span><b>${esc(doc.reason)}</b></div>` : ""}
        ${doc.note ? `<div class="row"><span>Not:</span><b>${esc(doc.note)}</b></div>` : ""}
        ${doc.receivedBy ? `<div class="row"><span>Teslim Alan:</span><b>${esc(doc.receivedBy)}</b></div>` : ""}
      </div>`
    : "";

  const signatures = showSignatures
    ? `<div class="sign">${sigLabels.map((l) => `<div class="sign-box"><div class="sign-line"></div><div class="sign-lbl">${esc(l)}</div></div>`).join("")}</div>`
    : "";
  const noteBlock = cfg.footerNote ? `<div class="note">${esc(cfg.footerNote)}</div>` : "";

  const css = scaleDocCss(
    `
  * { box-sizing: border-box; }
  ${docPageCss(style)}
  ${docChromeCss(d, { boxLabelA4: 92, totRow: false })}
  /* ── İade irsaliyesine ÖZEL — ortak chrome'dan SONRA basılır ki kazansın.
     Buradaki .box bir FLEX ÇOCUĞU DEĞİL, tek başına duran bir kutudur (iade
     sebebi): ortak kuraldaki flex/min-width yerine kendi üst boşluğunu kullanır.
     totRow:false → bu belgede toplam satırı vurgusu HİÇ YOKTU; ortak katman
     uğruna canlı bir resmi belgenin görünümü sormadan değiştirilmedi.
     (Şablonun içinde BACKTICK kullanma — literal'i ortadan böler.) */
  .sec { margin-top: ${scaleW(d, 6)}px; }
  .sec th.caption { background: #e2e8f0; text-align: center; font-size: ${d.secCaption}px; font-weight: 800; letter-spacing: 1px; padding: ${scaleW(d, 5)}px; }
  .sec thead th:not(.caption) { background: #f1f5f9; font-weight: 700; font-size: ${d.secHead}px; text-transform: none; }
  .box { flex: none; margin-top: ${scaleW(d, 10)}px; }
  .box .row { margin-top: 2px; }
  ${DOC_LOGO_CSS}
  ${DOC_STAMPS_CSS}
  ${docBlankGridCss(cfg)}
  ${docTableCss(style, [".sec"])}
  ${docFieldCss(cfg.fields, DOC_FIELD_CATALOGS["iadeIrsaliyesi"], d)}
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
        ${showDocumentNo ? `<div class="ln">İade No: <b>${esc(h.documentNo)}</b></div>` : ""}
        ${showDate ? `<div class="ln">Tarih: <b>${esc(fmtDate(h.date))}</b></div>` : ""}
      </div>
    </header>
    ${refRow}
    ${blocksTop}
    ${table}
    ${reasonBox}
    ${noteBlock}
    ${blocksBottom}
    ${printNote}
    ${signatures}
    ${stampsBar}
  </div>
</body></html>`;
}
