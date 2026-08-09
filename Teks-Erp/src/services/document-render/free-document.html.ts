// =============================================================================
// Serbest Belge — admin'in elle yazdığı, veriye bağlı OLMAYAN belge renderer'ı
// =============================================================================
// Üst yazı, teslim tutanağı, dekont, duyuru vb. Antet/logo/damga/blok/imza mevcut
// stil katmanından gelir; gövde admin'in serbest metnidir. FreeDocument.config
// (DocumentConfig) stil/görünürlük taşır. PrintedDocument freeze zincirinden bağımsız.
// =============================================================================

import type { CompanyLetterhead, DocumentConfig } from "../system-setting.service";
import {
  resolveDocStyle, docPageCss, scaleDocCss, docLogoHtml,
  docBlankGridCss, docBlankGridHtml,
  DOC_LOGO_CSS, DOC_STAMPS_CSS, docCopyBadge, docBlocksHtml, docPrintNoteHtml, docStampsBar,
} from "./doc-style";

export interface FreeDocumentSnapshot {
  company: { name: string; letterhead: CompanyLetterhead; logoHash?: string | null };
  config: DocumentConfig;
  doc: { documentNo: string; title: string; recipient: string | null; body: string; date: string };
}
interface RenderMeta {
  logoDataUrl?: string | null;
  qrDataUrl?: string | null;
  printedAtText?: string;
  printedBy?: string | null;
  printNote?: string | null;
  draft?: boolean;
}

function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function renderFreeDocumentHtml(snapshot: FreeDocumentSnapshot, meta: RenderMeta = {}): string {
  const cfg = snapshot.config ?? {};
  const style = resolveDocStyle(cfg.style, { marginMm: 12 });
  const logo = docLogoHtml(meta.logoDataUrl, cfg);
  const company = snapshot.company;
  const lh = company?.letterhead ?? { addressLine: "", phone: "", taxInfo: "" };
  const doc = snapshot.doc;

  const showLetterhead = cfg.showLetterhead !== false;
  const showSignatures = cfg.showSignatures === true; // serbest belgede imza default KAPALI
  const sigLabels = cfg.signatureLabels?.length ? cfg.signatureLabels : ["İmza"];

  const lhLines = showLetterhead
    ? [lh.addressLine, lh.phone, lh.taxInfo ? `V.D./No: ${lh.taxInfo}` : "", ...(lh.extraLines ?? [])]
        .filter((s) => s && s.trim()).map((s) => `<div class="lh-line">${esc(s)}</div>`).join("")
    : "";
  const watermark = meta.draft ? `<div class="wm wm-draft">TASLAK</div>` : "";

  const signatures = showSignatures
    ? `<div class="sign">${sigLabels.map((l) => `<div class="sign-box"><div class="sign-line"></div><div class="sign-lbl">${esc(l)}</div></div>`).join("")}</div>`
    : "";
  const footerBlock = cfg.footerNote ? `<div class="note">${esc(cfg.footerNote)}</div>` : "";

  const css = scaleDocCss(
    `
  * { box-sizing: border-box; }
  ${docPageCss(style)}
  body { margin: 0; font-family: Arial, "Helvetica Neue", sans-serif; color: #111; font-size: 12px; }
  .sheet { position: relative; width: 100%; }
  .wm { position: fixed; top: 42%; left: 0; right: 0; text-align: center; font-size: 96px; font-weight: 800; color: rgba(100,116,139,0.16); transform: rotate(-22deg); letter-spacing: 8px; z-index: 0; }
  .wm-draft { color: rgba(100,116,139,0.16); }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 12px; gap: 12px; }
  .hl { flex: 1; min-width: 0; } .company { font-size: 16px; font-weight: 800; text-transform: uppercase; } .lh-line { font-size: 10px; color: #333; }
  .hr { text-align: right; white-space: nowrap; }
  .hr .ln { margin-top: 3px; font-size: 11px; } .hr .ln b { font-size: 12px; }
  .title { font-size: 20px; font-weight: 800; text-align: center; margin: 6px 0 12px; letter-spacing: 0.5px; }
  .recipient { font-size: 13px; margin-bottom: 10px; } .recipient b { text-transform: uppercase; }
  .body { font-size: 12px; line-height: 1.6; white-space: pre-wrap; text-align: justify; }
  .note { margin-top: 12px; font-size: 11px; white-space: pre-wrap; border: 1px solid #cbd5e1; padding: 6px 8px; border-radius: 4px; }
  .sign { display: flex; gap: 24px; margin-top: 40px; justify-content: flex-end; } .sign-box { width: 200px; text-align: center; } .sign-line { border-top: 1px solid #000; margin-bottom: 3px; margin-top: 28px; } .sign-lbl { font-size: 10px; color: #333; }
  ${DOC_LOGO_CSS}
  ${DOC_STAMPS_CSS}
  ${docBlankGridCss(cfg)}
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
        ${copyBadge}
        <div class="ln">Belge No: <b>${esc(doc.documentNo)}</b></div>
        <div class="ln">Tarih: <b>${esc(fmtDate(doc.date))}</b></div>
      </div>
    </header>
    <div class="title">${esc(doc.title)}</div>
    ${doc.recipient ? `<div class="recipient">SAYIN: <b>${esc(doc.recipient)}</b></div>` : ""}
    ${blocksTop}
    <div class="body">${esc(doc.body)}</div>
    ${footerBlock}
    ${blocksBottom}
    ${printNote}
    ${signatures}
    ${stampsBar}
  </div>
</body></html>`;
}
