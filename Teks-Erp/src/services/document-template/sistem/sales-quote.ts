// =============================================================================
// SALES_QUOTE (Satış Teklifi) — Sistem renderer'ının Liquid eşleniği (MAL-6)
// =============================================================================
// KOD KİPİ (muayene raporu kalıbı): kalem kolonları ayardan dinamik; koşul satırları ve genel
// toplam metni sözleşmeden HAZIR gelir (Liquid aritmetik yapmaz). İç kolon YOK — maliyet/kâr
// bu belgenin hiçbir yolunda bulunmaz.
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
    config: { columns: { kalemler: { hidden: ["width", "unit"], order: ["amount", "description", "seq"], labels: { amount: "Tutar <&>" }, blankLabels: ["color"] } } },
  },
  {
    name: "bolum_kapali_imza_dipnot",
    config: {
      sections: { taxNo: false, customerCode: false, branch: false, customerReference: false, terms: false, grandTotal: false, notes: false },
      signatureLabels: ["Satış Müdürü", "Müşteri"],
      footerNote: "Alt not <&>.",
      titleOverride: "fiyat teklifi",
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
    config: { sections: { lineTable: false, quoteNo: false, date: false }, style: { tableStyle: "plain", tableDensity: "relaxed", fontWeight: "light" } },
  },
  {
    name: "toplamsiz_kolonlar_damga_blok_grid_logo",
    config: {
      columns: { kalemler: { hidden: ["qty", "amount"] } },
      qr: true,
      showLogo: true,
      logoPosition: "right",
      stamps: { printedAt: true, printedBy: true, copyLabel: "  MÜŞTERİ NÜSHASI  " },
      blocks: [
        { position: "afterHeader", text: "Üst blok\nikinci satır" },
        { position: "beforeSignatures", text: "Alt blok <b>" },
      ],
      blankGrid: { enabled: true, title: "ONAY", rows: 2, columns: 2, headers: ["Ad", "İmza"], position: "afterHeader" },
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
  ${docFieldCss(s.fields, DOC_FIELD_CATALOGS["satisTeklifi"], d)}
`,
    style,
  );
}

const CELLS = String.raw`{%- when "seq" -%}{{ satir.sira }}
{%- when "description" -%}{%- if ${filled("satir.urun_kodu")} -%}{{ satir.urun_kodu }} — {{ satir.tanim }}{%- else -%}{{ satir.tanim }}{%- endif -%}
{%- when "color" -%}{%- if satir.renk == nil -%}—{%- else -%}{{ satir.renk }}{%- endif -%}
{%- when "width" -%}{%- if satir.en == nil -%}—{%- else -%}{{ satir.en | sayi: 0 }} cm{%- endif -%}
{%- when "qty" -%}{{ satir.miktar | sayi: 2 }}
{%- when "unit" -%}{{ satir.birim }}
{%- when "unitPrice" -%}{{ satir.birim_fiyat | sayi: 2 }}
{%- when "amount" -%}{{ satir.tutar | sayi: 2 }}`;

const FOOT = String.raw`{%- when "qty" -%}{{ toplamlar.miktar | sayi: 2 }}
{%- when "amount" -%}{{ toplamlar.tutar | sayi: 2 }}`;

const html = customerDocBody({
  taxCondition: "ayar.sections.taxNo",
  headLeft: String.raw`${SAYIN}
{%- if ayar.sections.branch and ${filled("karsi_taraf.sube")} -%}<div class="sub">Şube: {{ karsi_taraf.sube }}</div>{%- endif -%}`,
  headRight: String.raw`{%- if ayar.sections.quoteNo -%}<div class="ln">Teklif No: <b>{{ belge.no }}</b></div>{%- endif -%}
{%- if ayar.sections.date -%}<div class="ln">Tarih: <b>{{ belge.tarih | takvim }}</b></div>{%- endif -%}
{%- if ayar.sections.customerReference and ${filled("belge.referans")} -%}<div class="ln">Referans: <b>{{ belge.referans }}</b></div>{%- endif -%}`,
  main: String.raw`{%- if ayar.sections.terms -%}<div class="sum">{%- for kosul in tablolar.kosullar -%}<div class="sum-i"><span>{{ kosul.etiket }}</span><b>{{ kosul.deger }}</b></div>{%- endfor -%}</div>{%- endif -%}
{%- assign kalem_sayisi = tablolar.kalemler | size -%}
{%- if ayar.sections.lineTable and kalem_sayisi > 0 -%}<div class="tbl-cap">Teklif Kalemleri ({{ kalem_sayisi }})</div>
${dynamicTable({
  rows: "tablolar.kalemler",
  cols: "kalemler",
  widths: [["seq", "30px"], ["width", "56px"], ["qty", "76px"], ["unit", "48px"], ["unitPrice", "84px"], ["amount", "96px"]],
  cells: CELLS,
  foot: { label: "TOPLAM", cells: FOOT },
})}
{%- endif -%}
{%- if ayar.sections.grandTotal -%}<div class="grand"><span>Genel Toplam</span><b>{{ toplamlar.tutar_metni }}</b></div>{%- endif -%}
{%- if ayar.sections.notes and ${filled("belge.not")} -%}<div class="qn">{{ belge.not }}</div>{%- endif -%}
{%- if ayar.footerNote != "" -%}<div class="decl">{{ ayar.footerNote }}</div>{%- endif -%}`,
});

export const salesQuoteSystem: SystemEquivalent = {
  docType: "SALES_QUOTE",
  editMode: "CODE",
  html,
  css,
  pageSettings: (settings) => pageSettingsFor(settings, 9),
  tableBindings: {},
  variants,
};
