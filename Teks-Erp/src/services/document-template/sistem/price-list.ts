// =============================================================================
// PRICE_LIST (Fiyat Listesi) — Sistem renderer'ının Liquid eşleniği (MAL-6)
// =============================================================================
// KOD KİPİ: satır kolonları ayardan dinamik; geçerlilik metni sözleşmeden HAZIR gelir.
// Müşterisiz (genel) liste "KAPSAM: Genel" ile basılır. Maliyet/kâr kolonu YOK.
// =============================================================================

import { DOC_LOGO_CSS, DOC_STAMPS_CSS, docBlankGridCss, docTableCss, scaleDocCss } from "../../document-render/doc-style";
import { DOC_DENSITY, docChromeCss, resolveDocPageSize } from "../../document-render/doc-density";
import { DOC_FIELD_CATALOGS, docFieldCss } from "../../document-render/doc-fields";
import { commercialCssBody } from "../../document-render/commercial-doc";
import { SAYIN, customerDocBody, dynamicTable, filled } from "./_ortak/musteri";
import { TINY_PNG, pageSettingsFor, styleOf, type StyleSettings } from "./subcontractor-fragments";
import type { EquivalenceVariant, SystemEquivalent } from "./tipler";

type Settings = Readonly<Record<string, unknown>>;

const variants: EquivalenceVariant[] = [
  {
    name: "kolon_gizle_sira_baslik",
    config: { columns: { satirlar: { hidden: ["code"], order: ["unitPrice", "item", "seq"], labels: { unitPrice: "Fiyat <&>" }, blankLabels: ["minQty"] } } },
  },
  {
    name: "bolum_kapali_imza_dipnot",
    config: {
      sections: { taxNo: false, customerCode: false, publishedAt: false, validity: false, notes: false },
      signatureLabels: ["Satış Müdürü"],
      footerNote: "Alt not <&>.",
      titleOverride: "fiyat cetveli",
    },
  },
  {
    name: "a5_olcek_alan",
    config: {
      style: { pageSize: "A5", fontScale: 0.85, tableStyle: "zebra", tableDensity: "compact", fontWeight: "bold", margins: { top: 5, left: 12 } },
      fields: { secCaption: { size: 13, weight: "black" }, company: { size: 15 } },
      showSignatures: false,
      showLetterhead: false,
    },
  },
  {
    name: "tablo_kapali_baslik_yok",
    config: { sections: { lineTable: false, listNo: false }, style: { tableStyle: "plain", tableDensity: "relaxed", fontWeight: "light" } },
  },
  {
    name: "damga_blok_grid_logo",
    config: {
      qr: true,
      showLogo: true,
      logoPosition: "right",
      stamps: { printedAt: true, printedBy: true, copyLabel: "  MÜŞTERİ NÜSHASI  " },
      blocks: [
        { position: "afterHeader", text: "Üst blok\nikinci satır" },
        { position: "beforeSignatures", text: "Alt blok <b>" },
      ],
      blankGrid: { enabled: true, title: "ONAY", rows: 2, columns: 2, headers: ["Ad", "İmza"], position: "beforeSignatures" },
    },
    print: { logo: TINY_PNG, qr: TINY_PNG, zaman: "2026-09-25T09:00:00.000Z", basan: "operatör", not: "Tek seferlik not" },
  },
];

function css(settings: Settings): string {
  const s = settings as StyleSettings;
  const style = styleOf(settings, 9);
  const d = DOC_DENSITY[resolveDocPageSize(style.pageSize)];
  return scaleDocCss(
    `
  * { box-sizing: border-box; }
  ${docChromeCss(d)}
  ${commercialCssBody(d)}
  ${DOC_LOGO_CSS}
  ${DOC_STAMPS_CSS}
  ${docBlankGridCss({ blankGrid: s.blankGrid ?? undefined })}
  ${docTableCss(style, [".sec"])}
  ${docFieldCss(s.fields, DOC_FIELD_CATALOGS["fiyatListesi"], d)}
`,
    style,
  );
}

const CELLS = String.raw`{%- when "seq" -%}{{ satir.sira }}
{%- when "code" -%}{{ satir.urun_kodu }}
{%- when "item" -%}{{ satir.urun }}
{%- when "color" -%}{%- if satir.renk == nil -%}Tüm renkler{%- else -%}{{ satir.renk }}{%- endif -%}
{%- when "unitPrice" -%}{{ satir.birim_fiyat | sayi: 2 }}
{%- when "minQty" -%}{%- if satir.asgari_miktar == nil -%}—{%- else -%}{{ satir.asgari_miktar | sayi: 2 }}{%- endif -%}`;

const html = customerDocBody({
  taxCondition: "ayar.sections.taxNo",
  headLeft: String.raw`{%- if ${filled("karsi_taraf.ad")} -%}${SAYIN}{%- else -%}<div class="sayin">KAPSAM: <b>{{ belge.kapsam }}</b></div>{%- endif -%}`,
  headRight: String.raw`{%- if ayar.sections.listNo -%}<div class="ln">Liste No: <b>{{ belge.no }}</b></div>{%- endif -%}
<div class="ln">Liste: <b>{{ belge.ad }}</b></div>
<div class="ln">Döviz: <b>{{ belge.doviz }}</b></div>
{%- if ayar.sections.publishedAt and belge.tarih != nil -%}<div class="ln">Yayın Tarihi: <b>{{ belge.tarih | tarih }}</b></div>{%- endif -%}
{%- if ayar.sections.validity and ${filled("belge.gecerlilik_metni")} -%}<div class="ln">Geçerlilik: <b>{{ belge.gecerlilik_metni }}</b></div>{%- endif -%}`,
  main: String.raw`{%- assign satir_sayisi = tablolar.satirlar | size -%}
{%- if ayar.sections.lineTable and satir_sayisi > 0 -%}<div class="tbl-cap">Fiyatlar ({{ satir_sayisi }})</div>
${dynamicTable({
  rows: "tablolar.satirlar",
  cols: "satirlar",
  widths: [["seq", "30px"], ["code", "90px"], ["unitPrice", "90px"], ["minQty", "90px"]],
  cells: CELLS,
})}
{%- endif -%}
{%- if ayar.sections.notes and ${filled("belge.not")} -%}<div class="qn">{{ belge.not }}</div>{%- endif -%}
{%- if ayar.footerNote != "" -%}<div class="decl">{{ ayar.footerNote }}</div>{%- endif -%}`,
});

export const priceListSystem: SystemEquivalent = {
  docType: "PRICE_LIST",
  editMode: "CODE",
  html,
  css,
  pageSettings: (settings) => pageSettingsFor(settings, 9),
  tableBindings: {},
  variants,
};
