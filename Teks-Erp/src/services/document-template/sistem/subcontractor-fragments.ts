// =============================================================================
// Fason eşleniklerinin ORTAK Liquid parçaları + stil üreticileri
// =============================================================================
// Üç fason renderer'ı künye, logo, nüsha rozeti, konumlu blok, boş grid, imza ve damga
// çubuğunu `doc-style` yardımcılarından aynı biçimde basar; parçalar sevk irsaliyesi
// eşleniğiyle (T6) aynı kalıptadır. Değişiklik üç eşleniği birden etkiler — bekçi üçünü koşar.
// =============================================================================

import {
  DOC_LOGO_CSS,
  DOC_STAMPS_CSS,
  docBlankGridCss,
  docTableCss,
  resolveDocStyle,
  scaleDocCss,
  type BlankGridConfig,
  type DocFieldStyle,
  type DocStyleConfig,
} from "../../document-render/doc-style";
import { DOC_DENSITY, docChromeCss, resolveDocPageSize } from "../../document-render/doc-density";
import { DOC_FIELD_CATALOGS, docFieldCss } from "../../document-render/doc-fields";

/** Dondurulmuş ayarın stile giren parçası (`ayarNormalize` çıktısı; eksik alan varsayılana düşer). */
export interface StyleSettings {
  style?: DocStyleConfig;
  blankGrid?: BlankGridConfig | null;
  fields?: Record<string, DocFieldStyle>;
}

type Settings = Readonly<Record<string, unknown>>;

export const styleOf = (settings: Settings, marginMm: number) =>
  resolveDocStyle((settings as StyleSettings).style, { marginMm });

export function pageSettingsFor(settings: Settings, marginMm: number): Record<string, unknown> {
  const { pageSize, margins: m } = styleOf(settings, marginMm);
  return { kagit: pageSize, kenar: { ust: m.top, sag: m.right, alt: m.bottom, sol: m.left } };
}

/** Kabul makbuzu ve doğrudan sevkin ortak chrome CSS'i (`@page` hariç — `pageSettings`ten gelir). */
export function chromeDocCss(settings: Settings, boxLabelA4: number, catalog: keyof typeof DOC_FIELD_CATALOGS): string {
  const s = settings as StyleSettings;
  const style = styleOf(settings, 9);
  const d = DOC_DENSITY[resolveDocPageSize(style.pageSize)];
  return scaleDocCss(
    `
  * { box-sizing: border-box; }
  ${docChromeCss(d, { boxLabelA4 })}
  ${DOC_LOGO_CSS}
  ${DOC_STAMPS_CSS}
  ${docBlankGridCss({ blankGrid: s.blankGrid ?? undefined })}
  ${docTableCss(style, [".sec"])}
  ${docFieldCss(s.fields, DOC_FIELD_CATALOGS[catalog], d)}
`,
    style,
  );
}

export const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// ── Liquid parçaları ──────────────────────────────────────────────────────────

export const LOGO_ASSIGN = String.raw`{%- assign logo_var = false -%}
{%- if ayar.showLogo and firma.logo != nil and firma.logo != "" -%}{%- assign logo_var = true -%}{%- endif -%}`;

export const LOGO_LEFT = String.raw`{%- if logo_var and ayar.logoPosition != "right" -%}<img class="doc-logo" src="{{ firma.logo }}" alt="">{%- endif -%}`;

export const LOGO_RIGHT = String.raw`{%- if logo_var and ayar.logoPosition == "right" -%}<img class="doc-logo" src="{{ firma.logo }}" alt="">{%- endif -%}`;

/** Künye satırları; `taxCondition` vergi satırının ek koşulu (kabul makbuzunda `sections.taxNo`). */
export function letterhead(taxCondition = ""): string {
  const extra = taxCondition ? `${taxCondition} and ` : "";
  return String.raw`{%- if ayar.showLetterhead -%}
{%- if firma.adres != blank -%}<div class="lh-line">{{ firma.adres }}</div>{%- endif -%}
{%- if firma.telefon != blank -%}<div class="lh-line">{{ firma.telefon }}</div>{%- endif -%}
{%- if ${extra}firma.vergi_bilgisi != nil and firma.vergi_bilgisi != "" -%}<div class="lh-line">V.D./No: {{ firma.vergi_bilgisi }}</div>{%- endif -%}
{%- for ek in tablolar.antet_ek -%}{%- if ek.metin != blank -%}<div class="lh-line">{{ ek.metin }}</div>{%- endif -%}{%- endfor -%}
{%- endif -%}`;
}

export const COPY_BADGE = String.raw`{%- assign nusha = ayar.stamps.copyLabel | strip -%}
{%- if nusha != "" -%}<div class="copy-badge">{{ nusha }}</div>{%- endif -%}`;

/** Boş grid `bos_grid` olarak yakalanır; isteğe bağlı alanlar nesne üzerinde gezilerek okunur. */
export const BLANK_GRID_CAPTURE = String.raw`{%- assign grid_konum = "" -%}
{%- if ayar.blankGrid != nil and ayar.blankGrid.enabled -%}
{%- assign grid_konum = ayar.blankGrid.position -%}
{%- assign grid_baslik = "" -%}{%- assign grid_genislik = "" -%}{%- assign grid_basliklar = "" -%}
{%- for alan in ayar.blankGrid -%}
{%- if alan[0] == "title" -%}{%- assign grid_baslik = alan[1] -%}{%- elsif alan[0] == "columnWidths" -%}{%- assign grid_genislik = alan[1] -%}{%- elsif alan[0] == "headers" -%}{%- assign grid_basliklar = alan[1] -%}{%- endif -%}
{%- endfor -%}
{%- assign baslik_sayisi = grid_basliklar | size -%}
{%- assign grid_baslik_kirpik = grid_baslik | strip -%}
{%- capture bos_grid -%}
<div class="bgrid-wrap">{%- if grid_baslik_kirpik != "" -%}<div class="bgrid-title">{{ grid_baslik }}</div>{%- endif -%}<table class="bgrid"><colgroup>
{%- for i in (1..ayar.blankGrid.columns) -%}{%- if grid_genislik != "" -%}<col style="width:{{ grid_genislik[forloop.index0] }}%">{%- else -%}<col>{%- endif -%}{%- endfor -%}
</colgroup>
{%- if baslik_sayisi > 0 -%}<thead><tr>{%- for i in (1..ayar.blankGrid.columns) -%}{%- if forloop.index <= baslik_sayisi -%}<th>{{ grid_basliklar[forloop.index0] }}</th>{%- else -%}<th></th>{%- endif -%}{%- endfor -%}</tr></thead>{%- endif -%}
<tbody>{%- for r in (1..ayar.blankGrid.rows) -%}<tr>{%- for c in (1..ayar.blankGrid.columns) -%}<td></td>{%- endfor -%}</tr>{%- endfor -%}</tbody></table></div>
{%- endcapture -%}
{%- endif -%}`;

/** Konumlu serbest bloklar + o konumdaki boş grid (`BLANK_GRID_CAPTURE` önce gelmeli). */
export function blocksAt(position: "afterHeader" | "beforeSignatures"): string {
  return String.raw`{%- for blok in ayar.blocks -%}{%- if blok.position == "${position}" and blok.text != blank -%}<div class="doc-block">{{ blok.text }}</div>{%- endif -%}{%- endfor -%}
{%- if grid_konum == "${position}" -%}{{ bos_grid }}{%- endif -%}`;
}

export const PRINT_NOTE = String.raw`{%- assign baski_notu = baski.not | strip -%}
{%- if baski_notu != "" -%}<div class="doc-block">{{ baski.not }}</div>{%- endif -%}`;

export const SIGNATURES = String.raw`{%- if ayar.showSignatures -%}
<div class="sign">{%- for etiket in ayar.signatureLabels -%}<div class="sign-box"><div class="sign-line"></div><div class="sign-lbl">{{ etiket }}</div></div>{%- endfor -%}</div>
{%- endif -%}`;

export const STAMPS = String.raw`{%- assign dolu = false -%}
{%- capture damga -%}
{%- if ayar.stamps.printedAt and baski.zaman != nil and baski.zaman != "" -%}Basım: {{ baski.zaman | tarih_saat }}{%- assign dolu = true -%}{%- endif -%}
{%- if ayar.stamps.printedBy and baski.basan != nil and baski.basan != "" -%}{%- if dolu %} &nbsp;·&nbsp; {% endif -%}Basan: {{ baski.basan }}{%- endif -%}
{%- endcapture -%}
{%- assign qr_var = false -%}
{%- if ayar.qr and baski.qr != nil and baski.qr != "" -%}{%- assign qr_var = true -%}{%- endif -%}
{%- if damga != "" or qr_var -%}<div class="stamps"><div class="stamps-l">{{ damga }}</div>{%- if qr_var -%}<img src="{{ baski.qr }}" alt="">{%- endif -%}</div>{%- endif -%}`;
