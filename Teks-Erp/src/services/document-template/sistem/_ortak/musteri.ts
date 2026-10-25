// =============================================================================
// Müşteriye/karşı tarafa giden ek belgelerin ORTAK gövdesi (kartela çeki, kalite
// sertifikası, iade irsaliyesi)
// =============================================================================
// Üç renderer aynı künye/başlık iskeletini ve `buildDocTable` tablosunu basar; eşlenikte
// iskelet ve dinamik kolon tablosu burada TEK kaynaktır, her eşlenik tek parça Liquid
// üretir (Liquid `include` yasak). Değişiklik üçünü birden etkiler — bekçi üçünü koşar.
// =============================================================================

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
  letterhead,
} from "../subcontractor-fragments";

/**
 * Sayfa iskeleti. `taxCondition` vergi satırının ek koşulu; `headLeft` künyeden sonra sol
 * blokta (SAYIN satırı), `headRight` nüsha rozetinden sonra sağ blokta; `beforeBlocks`
 * başlık ile üst bloklar arasında; `main` üst bloklar ile alt bloklar arasındaki gövde.
 */
export function customerDocBody(parts: {
  taxCondition?: string;
  headLeft?: string;
  headRight: string;
  beforeBlocks?: string;
  main: string;
}): string {
  return String.raw`<div class="sheet">
<header>
<div class="hl">
${LOGO_ASSIGN}
${LOGO_LEFT}
<div class="company">{{ firma.ad }}</div>
${letterhead(parts.taxCondition ?? "")}
${parts.headLeft ?? ""}
</div>
<div class="hr">
${LOGO_RIGHT}
<div class="title">{{ belge.baslik }}</div>
${COPY_BADGE}
${parts.headRight}
</div>
</header>
${parts.beforeBlocks ?? ""}
${BLANK_GRID_CAPTURE}
${blocksAt("afterHeader")}
${parts.main}
${blocksAt("beforeSignatures")}
${PRINT_NOTE}
${SIGNATURES}
${STAMPS}
</div>`;
}

/** Karşı taraf hitabı + kod satırı (kod `ayar.sections.customerCode` ile kapanır). */
export const SAYIN = String.raw`<div class="sayin">SAYIN: <b>{{ karsi_taraf.ad }}</b></div>
{%- if ayar.sections.customerCode and karsi_taraf.kod != nil and karsi_taraf.kod != "" -%}<div class="sub">Kod: {{ karsi_taraf.kod }}</div>{%- endif -%}`;

/** Dolu metin koşulu (Sistem'deki JS doğruluk sınamasının eşi: null ve "" basılmaz). */
export const filled = (path: string) => `${path} != nil and ${path} != ""`;

/** "ürün · renk" hücresi (renk boşsa yalnız ürün). */
export const ITEM_COLOR = String.raw`{{ satir.urun }}{%- if satir.renk != nil and satir.renk != "" %} · {{ satir.renk }}{% endif -%}`;

/** Barkod hücresi (yoksa uzun çizgi). */
export const BARCODE = String.raw`{%- if satir.barkod == nil -%}—{%- else -%}{{ satir.barkod }}{%- endif -%}`;

/** En hücresi — tam sayı + " cm" (yoksa uzun çizgi). */
export const WIDTH = String.raw`{%- if satir.en == nil -%}—{%- else -%}{{ satir.en | sayi: 0 }} cm{%- endif -%}`;

/**
 * `buildDocTable` eşi: kolonlar ayardan (`ayar.kolonlar.<cols>`) sıralı/başlıklı gelir; kolon
 * yoksa tablo hiç basılmaz. Hücre/genişlik (`[kaynak, css]` demetleri) ve toplam `kolon.kaynak`la seçilir; toplam satırı
 * `kolon.toplam` dolu bir kolon görünürse (ve `foot.when` sağlanırsa) basılır, etiket ilk
 * toplamsız kolona oturur. `caption` verilirse thead'de colspan'lı başlık satırı olur.
 */
export function dynamicTable(opts: {
  rows: string;
  cols: string;
  caption?: string;
  widths: ReadonlyArray<readonly [string, string]>;
  cells: string;
  foot?: { label: string; cells: string; when?: string };
}): string {
  const widths = opts.widths
    .map(([k, w]) => String.raw`{% when "${k}" %} style="width:${w}"`)
    .join("");
  const caption = opts.caption
    ? String.raw`<tr><th class="caption" colspan="{{ kolon_sayisi }}">${opts.caption}</th></tr>`
    : "";
  const foot = opts.foot
    ? String.raw`{%- assign toplam_var = false -%}
{%- for kolon in kolonlar -%}{%- if kolon.toplam != nil -%}{%- assign toplam_var = true -%}{%- endif -%}{%- endfor -%}
{%- if toplam_var${opts.foot.when ? ` and ${opts.foot.when}` : ""} -%}
{%- assign etiket_kondu = false -%}
<tr class="tot">{%- for kolon in kolonlar -%}<td class="{{ kolon.hiza }}">
{%- if kolon.toplam != nil -%}{%- case kolon.kaynak -%}${opts.foot.cells}{%- endcase -%}
{%- elsif etiket_kondu == false -%}${opts.foot.label}{%- assign etiket_kondu = true -%}{%- endif -%}
</td>{%- endfor -%}</tr>
{%- endif -%}`
    : "";
  return String.raw`{%- assign kolonlar = ayar.kolonlar.${opts.cols} -%}
{%- assign kolon_sayisi = kolonlar | size -%}
{%- if kolon_sayisi > 0 -%}
<table class="sec"><thead>${caption}<tr>
{%- for kolon in kolonlar -%}<th class="{{ kolon.hiza }}"{% case kolon.kaynak %}${widths}{% endcase %}>{{ kolon.etiket }}</th>{%- endfor -%}
</tr></thead><tbody>
{%- for satir in ${opts.rows} -%}<tr>
{%- for kolon in kolonlar -%}<td class="{{ kolon.hiza }}{% if kolon.kaynak == "barcode" %} mono{% endif %}">
{%- case kolon.kaynak -%}
${opts.cells}
{%- endcase -%}
</td>{%- endfor -%}
</tr>{%- endfor -%}
${foot}
</tbody></table>
{%- endif -%}`;
}
