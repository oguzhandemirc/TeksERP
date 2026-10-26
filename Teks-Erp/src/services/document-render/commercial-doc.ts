// =============================================================================
// Ticari müşteri belgeleri (satış teklifi + fiyat listesi) — ortak parçalar (MAL-6)
// =============================================================================
// İki renderer aynı künye/filigran/imza/CSS iskeletini basar; Liquid eşlenikleri bu
// HTML'i `sistem/_ortak/musteri.ts` ile yeniden üretir (bekçi: test_belge_sistem_esdegeri).
// =============================================================================

import type { PrintedDocStatus } from "@prisma/client";
import type { PrintedDocSnapshot } from "../printed-document.service";
import { DOC_LOGO_CSS, DOC_STAMPS_CSS, docBlankGridCss, docPageCss, docTableCss, resolveDocStyle, scaleDocCss } from "./doc-style";
import type { DocFmtKit } from "./doc-model";
import { DOC_DENSITY, docChromeCss, scaleW } from "./doc-density";
import { DOC_FIELD_CATALOGS, docFieldCss } from "./doc-fields";
import { docNum } from "./fmt-num";

export interface CommercialRenderMeta {
  status?: PrintedDocStatus;
  voidReason?: string | null;
  draft?: boolean;
  logoDataUrl?: string | null;
  qrDataUrl?: string | null;
  printedAtText?: string;
  printedBy?: string | null;
  printNote?: string | null;
}

export function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
export const kitOf = (snapshot: PrintedDocSnapshot): DocFmtKit => ({ esc, fmtTr: docNum(snapshot).tr });
export function sectionOn(sections: Record<string, boolean> | undefined, key: string): boolean {
  return sections?.[key] !== false;
}

/** Ölçü birimi metni — kâğıtta enum adı basılmaz. */
const UNIT_TEXT: Record<string, string> = { MT: "m", KG: "kg", ADET: "adet" };
export const unitText = (u: string | null | undefined): string => (u ? (UNIT_TEXT[u] ?? u) : "");

/** Excel başlığının filigran satırı — HTML filigranıyla aynı karar. */
export function watermarkText(meta: CommercialRenderMeta): string | null {
  if (meta.draft) return "TASLAK";
  if (meta.status === "VOIDED") return "İPTAL";
  return meta.status === "SUPERSEDED" ? "ESKİ KOPYA" : null;
}

export function watermarkHtml(meta: CommercialRenderMeta): string {
  if (meta.draft) return `<div class="wm wm-draft">TASLAK</div>`;
  if (meta.status === "VOIDED") return `<div class="wm">İPTAL</div>`;
  return meta.status === "SUPERSEDED" ? `<div class="wm wm-old">ESKİ KOPYA</div>` : "";
}

type Cfg = NonNullable<PrintedDocSnapshot["docConfigOverride"]>;

/** Künye satırları (adres/telefon/vergi + ek satırlar). */
export function letterheadHtml(snapshot: PrintedDocSnapshot, cfg: Cfg): string {
  if (cfg.showLetterhead === false) return "";
  const lh = snapshot.company?.letterhead ?? { addressLine: "", phone: "", taxInfo: "" };
  const showTaxNo = sectionOn(cfg.sections, "taxNo");
  return [lh.addressLine, lh.phone, showTaxNo && lh.taxInfo ? `V.D./No: ${lh.taxInfo}` : "", ...(lh.extraLines ?? [])]
    .filter((s) => s && s.trim())
    .map((s) => `<div class="lh-line">${esc(s)}</div>`)
    .join("");
}

export function signaturesHtml(cfg: Cfg, defaults: readonly string[]): string {
  if (cfg.showSignatures === false) return "";
  const labels = cfg.signatureLabels?.length ? cfg.signatureLabels : defaults;
  return `<div class="sign">${labels.map((l) => `<div class="sign-box"><div class="sign-line"></div><div class="sign-lbl">${esc(l)}</div></div>`).join("")}</div>`;
}

/** Ticari belge CSS'i — Liquid eşleniği aynı metni `commercialCssBody` ile kurar. */
export function commercialCssBody(d: (typeof DOC_DENSITY)[keyof typeof DOC_DENSITY]): string {
  return `
  .tbl-cap { margin: ${scaleW(d, 8)}px 0 ${scaleW(d, 3)}px; }
  .sum { display: flex; flex-wrap: wrap; gap: ${scaleW(d, 4)}px ${scaleW(d, 14)}px; margin-top: ${scaleW(d, 8)}px; font-size: ${d.note}px; }
  .sum-i span { color: #475569; margin-right: 4px; }
  .grand { margin-top: ${scaleW(d, 6)}px; text-align: right; font-size: ${d.note + 2}px; }
  .grand span { color: #475569; margin-right: 6px; }
  .qn { margin-top: ${scaleW(d, 10)}px; font-size: ${d.note}px; white-space: pre-wrap; }
  .decl { margin-top: ${scaleW(d, 12)}px; font-size: ${d.note}px; white-space: pre-wrap;
          border: 1px solid #cbd5e1; padding: ${scaleW(d, 8)}px ${scaleW(d, 10)}px; border-radius: 4px; font-style: italic; }`;
}

export function commercialCss(
  cfg: Cfg,
  style: ReturnType<typeof resolveDocStyle>,
  d: (typeof DOC_DENSITY)[keyof typeof DOC_DENSITY],
  catalog: keyof typeof DOC_FIELD_CATALOGS,
): string {
  return scaleDocCss(
    `
  * { box-sizing: border-box; }
  ${docPageCss(style)}
  ${docChromeCss(d)}
  ${commercialCssBody(d)}
  ${DOC_LOGO_CSS}
  ${DOC_STAMPS_CSS}
  ${docBlankGridCss(cfg)}
  ${docTableCss(style, [".sec"])}
  ${docFieldCss(cfg.fields, DOC_FIELD_CATALOGS[catalog], d)}
`,
    style,
  );
}
