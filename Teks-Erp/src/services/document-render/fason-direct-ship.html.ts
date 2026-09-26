// =============================================================================
// Fasondan Doğrudan Sevk İrsaliyesi — HTML renderer (TEK KAYNAK)
// =============================================================================
// Fason firmasındaki malın fabrikaya dönmeden DOĞRUDAN müşteriye sevk edildiği
// resmi irsaliye. Normal fason çeki listesinden (KUMAŞ İRSALİYESİ) ayrı belge
// zinciri — burada mal müşteriye gider, fasona değil. Tüm cihazlar bu backend
// HTML'ini basar → format her yerde aynı. Donmuş PrintedDocument snapshot'ından
// üretilir; düzen:
//   üst:   firma anteti + başlık + İrsaliye No + Tarih
//   meta:  Fason Firma / Sevk Bilgileri (sebep, sevk eden, iş emri, araç)
//   bölüm: Karşılanan Siparişler (allocations: sipariş no, ürün, renk, miktar)
//   tablo: # | Barkod | Ürün/Renk | En | Metre | Kg  (+ TOPLAM)
//   alt:   serbest not + imza kutuları + filigran (TASLAK/İPTAL/ESKİ KOPYA)
// =============================================================================

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
import { toHtmlCols } from "./doc-model";
import { DOC_DENSITY, docChromeCss, resolveDocPageSize } from "./doc-density";
import { DOC_FIELD_CATALOGS, docFieldCss } from "./doc-fields";
import {
  directShipParts,
  esc,
  fmtKit,
  type DirectShipRenderMeta,
  type DirectShipSection,
  type InfoBox,
} from "./fason-direct-ship.model";

export { renderFasonDirectShipTables } from "./fason-direct-ship.model";

export function renderFasonDirectShipHtml(
  snapshot: PrintedDocSnapshot,
  meta: DirectShipRenderMeta = {},
): string {
  const { cfg, title, headRight, boxes, sections, footerNote, watermark: wmKind } = directShipParts(snapshot, meta);
  // Yoğunluk profili sayfa boyutundan çözülür; ortak chrome CSS'i oradan beslenir.
  const pageSize = resolveDocPageSize(cfg.style?.pageSize);
  const d = DOC_DENSITY[pageSize];
  const style = resolveDocStyle(cfg.style, { marginMm: 9 });
  const logo = docLogoHtml(meta.logoDataUrl, cfg);
  const company = snapshot.company;
  const lh = company?.letterhead ?? { addressLine: "", phone: "", taxInfo: "" };

  const showLetterhead = cfg.showLetterhead !== false;
  const showSignatures = cfg.showSignatures !== false;
  const sigLabels =
    cfg.signatureLabels && cfg.signatureLabels.length
      ? cfg.signatureLabels
      : ["Teslim Eden", "Teslim Alan"];

  const lhLines = showLetterhead
    ? [lh.addressLine, lh.phone, lh.taxInfo ? `V.D./No: ${lh.taxInfo}` : "", ...(lh.extraLines ?? [])]
        .filter((s) => s && s.trim())
        .map((s) => `<div class="lh-line">${esc(s)}</div>`)
        .join("")
    : "";

  const watermark = wmKind === "draft"
    ? `<div class="wm wm-draft">TASLAK</div>`
    : wmKind === "void"
      ? `<div class="wm">İPTAL</div>`
      : wmKind === "old"
        ? `<div class="wm wm-old">ESKİ KOPYA</div>`
        : "";

  const boxHtml = (b: InfoBox) =>
    `<div class="box"><div class="box-t">${b.title}</div>
        ${b.rows.map((r) => `<div class="row"><span>${r.label}:</span><b>${esc(r.value)}</b></div>`).join("\n        ")}
      </div>`;
  const infoGrid = boxes.length ? `<div class="info">${boxes.map(boxHtml).join("")}</div>` : "";

  const head = (k: string) => headRight.find((i) => i.key === k);
  const fasonNo = head("fasonDispatchNo");
  const batchNo = head("batchNo");

  const tableHtml = (key: DirectShipSection<never>["key"]): string => {
    const s = sections.find((x) => x.key === key);
    if (!s) return "";
    return (
      `<div class="tbl-cap">${esc(s.caption)}</div>` +
      buildDocTable({
        className: "sec",
        colCfg: s.colCfg,
        ...(s.footLabel ? { footLabel: s.footLabel } : {}),
        rows: s.rows,
        cols: toHtmlCols(s.cols, fmtKit(snapshot)),
      })
    );
  };
  const allocTable = tableHtml("allocations");
  const rollTable = tableHtml("rollTable");

  const noteBlock = footerNote ? `<div class="note">${esc(footerNote)}</div>` : "";

  const signatures = showSignatures
    ? `<div class="sign">${sigLabels
        .map(
          (l) =>
            `<div class="sign-box"><div class="sign-line"></div><div class="sign-lbl">${esc(l)}</div></div>`,
        )
        .join("")}</div>`
    : "";

  const css = scaleDocCss(
    `
  * { box-sizing: border-box; }
  ${docPageCss(style)}
  ${docChromeCss(d, { boxLabelA4: 72 })}
  ${DOC_LOGO_CSS}
  ${DOC_STAMPS_CSS}
  ${docBlankGridCss(cfg)}
  ${docTableCss(style, [".sec"])}
  ${docFieldCss(cfg.fields, DOC_FIELD_CATALOGS["fasonDirectShip"], d)}
`,
    style,
  );

  // Nüsha rozeti + konumlu bloklar + tek seferlik baskı notu + damga/QR çubuğu.
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
        <div class="ln">İrsaliye No: <b>${esc(head("docNo")?.value)}</b></div>
        ${fasonNo ? `<div class="ln">Fason Sevk No: <b>${esc(fasonNo.value)}</b></div>` : ""}
        <div class="ln">Tarih: <b>${esc(head("date")?.value)}</b></div>
        ${batchNo ? `<div class="ln">Parti No: <b>${esc(batchNo.value)}</b></div>` : ""}
      </div>
    </header>

    ${infoGrid}
    ${blocksTop}
    ${allocTable}
    ${rollTable}
    ${noteBlock}
    ${blocksBottom}
    ${printNote}
    ${signatures}
    ${stampsBar}
  </div>
</body></html>`;
}
