// =============================================================================
// FREE_DOCUMENT (Serbest Belge) — Sistem renderer'ının Liquid eşleniği
// =============================================================================
// KOD KİPİ. Antet/logo/nüsha/blok/grid/not/imza/damga ortak fason parçalarından; gövde düz
// `{{ belge.govde }}` — Sistem `pre-wrap` basar, satır kırma CSS'te (`satir_kir` eşitliği bozar).
// =============================================================================

import { DOC_LOGO_CSS, DOC_STAMPS_CSS, docBlankGridCss, scaleDocCss } from "../../document-render/doc-style";
import {
  BLANK_GRID_CAPTURE,
  COPY_BADGE,
  LOGO_ASSIGN,
  LOGO_LEFT,
  LOGO_RIGHT,
  PRINT_NOTE,
  SIGNATURES,
  STAMPS,
  TINY_PNG,
  blocksAt,
  letterhead,
  pageSettingsFor,
  styleOf,
  type StyleSettings,
} from "./subcontractor-fragments";
import type { EquivalenceVariant, SystemEquivalent } from "./tipler";

type Settings = Readonly<Record<string, unknown>>;

/** Sistem `<style>`ının eşi (`@page` hariç — `pageSettings`ten gelir). */
function freeDocumentCss(settings: Settings): string {
  const s = settings as StyleSettings;
  return scaleDocCss(
    `
  * { box-sizing: border-box; }
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
  ${docBlankGridCss({ blankGrid: s.blankGrid ?? undefined })}
`,
    styleOf(settings, 12),
  );
}

const html = String.raw`<div class="sheet">
<header>
<div class="hl">
${LOGO_ASSIGN}
${LOGO_LEFT}
<div class="company">{{ firma.ad }}</div>
${letterhead()}
</div>
<div class="hr">
${LOGO_RIGHT}
${COPY_BADGE}
<div class="ln">Belge No: <b>{{ belge.no }}</b></div>
<div class="ln">Tarih: <b>{{ belge.tarih | tarih }}</b></div>
</div>
</header>
<div class="title">{{ belge.baslik }}</div>
{%- if belge.alici != nil and belge.alici != "" -%}<div class="recipient">SAYIN: <b>{{ belge.alici }}</b></div>{%- endif -%}
${BLANK_GRID_CAPTURE}
${blocksAt("afterHeader")}
<div class="body">{{ belge.govde }}</div>
{%- if ayar.footerNote != nil and ayar.footerNote != "" -%}<div class="note">{{ ayar.footerNote }}</div>{%- endif -%}
${blocksAt("beforeSignatures")}
${PRINT_NOTE}
${SIGNATURES}
${STAMPS}
</div>`;

const variants: EquivalenceVariant[] = [
  {
    name: "imza_blok_not",
    config: {
      showSignatures: true,
      signatureLabels: ["Teslim Eden", "Teslim Alan <imza>"],
      blocks: [
        { position: "afterHeader", text: "İlgi: 24.09.2026 tarihli yazınız." },
        { position: "beforeSignatures", text: "Bu tutanak iki nüsha düzenlenmiştir." },
      ],
      footerNote: "Dosyaya.\nİkinci satır",
    },
  },
  {
    name: "a5_olcek_antetsiz",
    config: { style: { pageSize: "A5", fontScale: 0.85, fontWeight: "bold", margins: { top: 6, left: 14 } }, showLetterhead: false, showSignatures: true },
  },
  {
    name: "damga_grid_logo",
    config: {
      qr: true,
      showLogo: true,
      logoPosition: "right",
      stamps: { printedAt: true, printedBy: true, copyLabel: "ARŞİV NÜSHASI" },
      blankGrid: { enabled: true, title: "Teslim edilenler", rows: 2, columns: 3, position: "afterHeader" },
    },
    print: { logo: TINY_PNG, qr: TINY_PNG, zaman: "2026-09-25T09:00:00.000Z", basan: "sekreter", not: "Tek seferlik not" },
  },
];

export const freeDocumentSystem: SystemEquivalent = {
  docType: "FREE_DOCUMENT",
  editMode: "CODE",
  html,
  css: freeDocumentCss,
  pageSettings: (settings) => pageSettingsFor(settings, 12),
  tableBindings: {},
  variants,
};
