// =============================================================================
// Depo eşleniklerinin ORTAK gövdesi (transfer, mal kabul, stok sayımı)
// =============================================================================
// Sistem'de üç belge `warehouse-doc.html.ts`in tek gövdesini paylaşır; eşlenikte de
// gövde ve CSS burada TEK kaynaktır ve her eşlenik onu birleştirip tek parça Liquid
// üretir (kopya editöre bütün gelir; Liquid `include` yasak). Değişiklik üçünü birden etkiler.
// =============================================================================

import { DOC_LOGO_CSS, DOC_STAMPS_CSS, docBlankGridCss, docTableCss, scaleDocCss } from "../../../document-render/doc-style";
import { DOC_DENSITY, docChromeCss, resolveDocPageSize, scaleW } from "../../../document-render/doc-density";
import { DOC_FIELD_CATALOGS, docFieldCss } from "../../../document-render/doc-fields";
import {
  BLANK_GRID_CAPTURE,
  COPY_BADGE,
  LOGO_ASSIGN,
  LOGO_LEFT,
  LOGO_RIGHT,
  PRINT_NOTE,
  SIGNATURES,
  STAMPS,
  blocksAt,
  pageSettingsFor,
  styleOf,
  type StyleSettings,
} from "../subcontractor-fragments";

type Settings = Readonly<Record<string, unknown>>;

/** Depo gövdesinin CSS'i — renderer'daki sırayla (`@page` hariç, `pageSettings`ten gelir). */
export function warehouseCss(settings: Settings, catalog: "depoTransfer" | "malKabul" | "stokSayimi"): string {
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
  ${DOC_LOGO_CSS}
  ${DOC_STAMPS_CSS}
  ${docBlankGridCss({ blankGrid: s.blankGrid ?? undefined })}
  ${docTableCss(style, [".sec"])}
  ${docFieldCss(s.fields, DOC_FIELD_CATALOGS[catalog], d)}
`,
    style,
  );
}

export const warehousePageSettings = (settings: Settings) => pageSettingsFor(settings, 9);

/** Ad + parantez içinde kod (kod boşsa yalnız ad) — taraf kutusu satırları. */
export const nameWithCode = (name: string, code: string) =>
  String.raw`{{ ${name} }}{%- if ${code} != nil and ${code} != "" %} ({{ ${code} }}){% endif -%}`;

/**
 * Ayardan sıralı/başlıklı kolon tablosu (`ayar.kolonlar.toplar`). Genişlik ve hücre `kolon.kaynak`
 * ile seçilir; toplam satırı `kolon.toplam` dolu kolonda `toplamlar.<toplam>`, etiket ilk boş kolonda.
 */
export function columnTable(opts: { caption: string; widths: Record<string, string>; cells: string; footLabel: string }): string {
  const widths = Object.entries(opts.widths)
    .map(([k, w]) => String.raw`{% when "${k}" %} style="width:${w}"`)
    .join("");
  return String.raw`{%- assign kolonlar = ayar.kolonlar.toplar -%}
{%- assign kolon_sayisi = kolonlar | size -%}
{%- if kolon_sayisi > 0 -%}
<table class="sec"><thead><tr><th class="caption" colspan="{{ kolon_sayisi }}">${opts.caption}</th></tr><tr>
{%- for kolon in kolonlar -%}<th class="{{ kolon.hiza }}"{% case kolon.kaynak %}${widths}{% endcase %}>{{ kolon.etiket }}</th>{%- endfor -%}
</tr></thead><tbody>
{%- for satir in tablolar.toplar -%}<tr>
{%- for kolon in kolonlar -%}<td class="{{ kolon.hiza }}{% if kolon.kaynak == "barcode" %} mono{% endif %}">
{%- case kolon.kaynak -%}
${opts.cells}
{%- endcase -%}
</td>{%- endfor -%}
</tr>{%- endfor -%}
{%- assign toplam_var = false -%}
{%- for kolon in kolonlar -%}{%- if kolon.toplam != nil -%}{%- assign toplam_var = true -%}{%- endif -%}{%- endfor -%}
{%- if toplam_var -%}
{%- assign etiket_kondu = false -%}
<tr class="tot">{%- for kolon in kolonlar -%}<td class="{{ kolon.hiza }}">
{%- if kolon.toplam != nil -%}{{ toplamlar[kolon.toplam] | sayi: 2 }}{%- elsif etiket_kondu == false -%}${opts.footLabel}{%- assign etiket_kondu = true -%}{%- endif -%}
</td>{%- endfor -%}</tr>
{%- endif -%}
</tbody></table>
{%- endif -%}`;
}

/** Transfer ve mal kabulün hücreleri (barkod · ürün/renk · en · metre). */
export const ROLL_CELLS = String.raw`{%- when "barcode" -%}{%- if satir.barkod == nil -%}—{%- else -%}{{ satir.barkod }}{%- endif -%}
{%- when "itemColor" -%}{{ satir.urun }}{%- if satir.renk != nil and satir.renk != "" %} · {{ satir.renk }}{% endif -%}
{%- when "width" -%}{%- if satir.en == nil -%}—{%- else -%}{{ satir.en | sayi: 0 }} cm{%- endif -%}
{%- when "qty" -%}{{ satir.metre | sayi: 2 }}`;

export const ROLL_WIDTHS = { width: "60px", qty: "90px" };

/**
 * Tam gövde. `headerLines` belge no/tarihten sonra sağ blokta; `partyLines` taraf kutusunun
 * içinde (her belgede en az bir satırı vardır); `tables` ana + ek tablolar.
 */
export function warehouseBody(parts: { headerLines: string; partyLines: string; tables: string }): string {
  return String.raw`<div class="sheet">
<header>
<div class="hl">
${LOGO_ASSIGN}
${LOGO_LEFT}
<div class="company">{{ firma.ad }}</div>
{%- if ayar.showLetterhead -%}
{%- if firma.adres != blank -%}<div class="lh-line">{{ firma.adres }}</div>{%- endif -%}
{%- if firma.telefon != blank -%}<div class="lh-line">{{ firma.telefon }}</div>{%- endif -%}
{%- for ek in tablolar.antet_ek -%}{%- if ek.metin != blank -%}<div class="lh-line">{{ ek.metin }}</div>{%- endif -%}{%- endfor -%}
{%- endif -%}
</div>
<div class="hr">
${LOGO_RIGHT}
<div class="title">{{ belge.baslik }}</div>
${COPY_BADGE}
{%- if ayar.sections.documentNo -%}<div class="ln">Belge No: <b>{{ belge.no }}</b></div>{%- endif -%}
{%- if ayar.sections.date -%}<div class="ln">Tarih: <b>{{ belge.tarih | tarih }}</b></div>{%- endif -%}
${parts.headerLines}
</div>
</header>
${BLANK_GRID_CAPTURE}
${blocksAt("afterHeader")}
<div class="box">${parts.partyLines}</div>
${parts.tables}
{%- if belge.notlar != nil and belge.notlar != "" -%}<div class="box"><div class="row"><span>Not:</span><b>{{ belge.notlar }}</b></div></div>{%- endif -%}
{%- if ayar.footerNote != "" -%}<div class="note">{{ ayar.footerNote }}</div>{%- endif -%}
${blocksAt("beforeSignatures")}
${PRINT_NOTE}
${SIGNATURES}
${STAMPS}
</div>`;
}
