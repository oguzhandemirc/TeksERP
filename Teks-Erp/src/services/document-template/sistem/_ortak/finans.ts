// =============================================================================
// Ön muhasebe eşleniklerinin ORTAK gövdesi (fatura, makbuz, mutabakat mektubu, çek bordrosu)
// =============================================================================
// Dört renderer `renderFinanceDoc` iskeletini basar: künye (vergi satırı YOK), başlık sağında
// belge no/tarih, taraf kutusu, tablo, toplam kutusu, beyan, not, alt not. İskelet
// `_ortak/musteri.ts`ten (tek kaynak); burası finans parçalarını ve CSS'ini taşır.
// =============================================================================

import { DOC_LOGO_CSS, DOC_STAMPS_CSS, docBlankGridCss, docTableCss, scaleDocCss } from "../../../document-render/doc-style";
import { DOC_DENSITY, docChromeCss, resolveDocPageSize, scaleW } from "../../../document-render/doc-density";
import { DOC_FIELD_CATALOGS, docFieldCss } from "../../../document-render/doc-fields";
import { styleOf, type StyleSettings } from "../subcontractor-fragments";
import { customerDocBody, filled } from "./musteri";

type Settings = Readonly<Record<string, unknown>>;

/** `renderFinanceDoc` CSS'i (`@page` hariç — `pageSettings`ten gelir); `.decl` yalnız beyanlı belgede. */
export function financeCss(settings: Settings, catalog: keyof typeof DOC_FIELD_CATALOGS, withDeclaration: boolean): string {
  const s = settings as StyleSettings;
  const style = styleOf(settings, 9);
  const d = DOC_DENSITY[resolveDocPageSize(style.pageSize)];
  return scaleDocCss(
    `
  * { box-sizing: border-box; }
  ${docChromeCss(d, { boxLabelA4: 104 })}
  .sec { margin-top: ${scaleW(d, 6)}px; }
  .sec th.caption { background: #e2e8f0; text-align: center; font-size: ${d.secCaption}px; font-weight: 800; letter-spacing: 1px; padding: ${scaleW(d, 5)}px; }
  .sec thead th:not(.caption) { background: #f1f5f9; font-weight: 700; font-size: ${d.secHead}px; text-transform: none; }
  .box { flex: none; margin-top: ${scaleW(d, 8)}px; }
  .box .row { margin-top: 2px; }
  .tot { margin-top: ${scaleW(d, 8)}px; margin-left: auto; width: ${scaleW(d, 260)}px; }
  .tot .row { display: flex; justify-content: space-between; padding: 2px 0; }
  .tot .grand { border-top: 2px solid #0f172a; margin-top: 3px; padding-top: 4px; font-weight: 800; font-size: ${d.secCell}px; }
  .tot .try { color: #475569; font-weight: 600; }
  ${
    withDeclaration
      ? `.decl { clear: both; margin-top: ${scaleW(d, 12)}px; font-size: ${d.note}px; white-space: pre-wrap;
          border: 1px solid #cbd5e1; padding: ${scaleW(d, 8)}px ${scaleW(d, 10)}px; border-radius: 4px; font-style: italic; }`
      : ""
  }
  ${DOC_LOGO_CSS}
  ${DOC_STAMPS_CSS}
  ${docBlankGridCss({ blankGrid: s.blankGrid ?? undefined })}
  ${docTableCss(style, [".sec"])}
  ${docFieldCss(s.fields, DOC_FIELD_CATALOGS[catalog], d)}
`,
    style,
  );
}

/** Tarih ya da uzun çizgi (Sistem `fmtDate(x, "—")`); kenar boşluğu yemez ("kur 40,25", "— m"). */
export const dateOrDash = (path: string, filter = "tarih") =>
  String.raw`{% if ${path} == nil %}—{% else %}{{ ${path} | ${filter} }}{% endif %}`;

/** Ondalığı en çok 2 hane sayı ya da uzun çizgi (Sistem `fmtQty`); hane sözleşmeden gelir. */
export const qtyOrDash = (path: string) =>
  String.raw`{% if ${path} == nil %}—{% else %}{{ ${path} | sayi: ${path}_hane }}{% endif %}`;

/** Taraf kutusu satırı. */
export const partyRow = (label: string, value: string) => String.raw`<div class="row"><span>${label}:</span><b>${value}</b></div>`;

/** "Cari: ad (kod)" satırı. */
export const PARTY_NAME_ROW = partyRow(
  "Cari",
  String.raw`{{ karsi_taraf.ad }}{%- if ${filled("karsi_taraf.kod")} %} ({{ karsi_taraf.kod }}){% endif -%}`,
);

export const CREATED_BY_ROW = String.raw`{%- if ayar.sections.createdBy and ${filled("belge.duzenleyen")} -%}${partyRow("Düzenleyen", "{{ belge.duzenleyen }}")}{%- endif -%}`;

/**
 * `renderFinanceDoc` gövdesi. `headLines` belge no/tarihten sonraki başlık satırları; `party`
 * taraf kutusunun satırları (kutu her belgede dolu); `declaration` beyan METNİ (bölümle kapanır).
 */
export function financeDocBody(parts: {
  headLines?: string;
  party: string;
  table?: string;
  totals?: string;
  declaration?: string;
  signatures?: string;
}): string {
  return customerDocBody({
    // Finans künyesi vergi satırı basmaz (renderer'da yok).
    taxCondition: "false",
    headRight: String.raw`{%- if ayar.sections.documentNo -%}<div class="ln">Belge No: <b>{{ belge.no }}</b></div>{%- endif -%}
{%- if ayar.sections.date -%}<div class="ln">Tarih: <b>${dateOrDash("belge.tarih")}</b></div>{%- endif -%}
${parts.headLines ?? ""}`,
    main: String.raw`<div class="box">${parts.party}</div>
${parts.table ?? ""}
${parts.totals ?? ""}
${parts.declaration ? String.raw`{%- if ayar.sections.declaration -%}<div class="decl">${parts.declaration}</div>{%- endif -%}` : ""}
{%- if ${filled("belge.notlar")} -%}<div class="box">${partyRow("Not", "{{ belge.notlar }}")}</div>{%- endif -%}
{%- if ayar.footerNote != "" -%}<div class="note">{{ ayar.footerNote }}</div>{%- endif -%}`,
    ...(parts.signatures ? { signatures: parts.signatures } : {}),
  });
}
