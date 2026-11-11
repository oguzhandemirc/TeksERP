// =============================================================================
// ORDER_CONFIRMATION (Sipariş Teyidi) — Sistem renderer'ının Liquid eşleniği (Seyitoğlu L1)
// =============================================================================
// KOD KİPİ (teklif kalıbı): kalem kolonları ayardan dinamik; ürün/renk hücre metni, koşul
// satırları ve genel toplam metni sözleşmeden HAZIR gelir (Liquid aritmetik yapmaz). Fiyatsız
// satırda birim fiyat/tutar/toplam boş gelir ve "—" basılır; fiyatsız teyit = kolon gizleme.
// =============================================================================

import { DOC_LOGO_CSS, DOC_STAMPS_CSS, docBlankGridCss, docTableCss, scaleDocCss } from "../../document-render/doc-style";
import { DOC_DENSITY, docChromeCss, resolveDocPageSize } from "../../document-render/doc-density";
import { DOC_FIELD_CATALOGS, docFieldCss } from "../../document-render/doc-fields";
import { commercialCssBody } from "../../document-render/commercial-doc";
import { SAYIN, WIDTH, customerDocBody, dynamicTable, filled } from "./_ortak/musteri";
import { TINY_PNG, pageSettingsFor, styleOf, type StyleSettings } from "./subcontractor-fragments";
import type { EquivalenceVariant, SystemEquivalent } from "./tipler";

type Settings = Readonly<Record<string, unknown>>;

const variants: EquivalenceVariant[] = [
  {
    // Fiyatsız teyit — müşteriye fiyat göstermeden gönderilen teyidin ayarı.
    name: "fiyatsiz_teyit",
    config: { columns: { kalemler: { hidden: ["unitPrice", "amount"] } }, sections: { grandTotal: false } },
  },
  {
    name: "kolon_gizle_sira_baslik",
    config: { columns: { kalemler: { hidden: ["width", "unit"], order: ["amount", "description", "seq", "tolerance"], labels: { amount: "Tutar <&>" }, blankLabels: ["color"] } } },
  },
  {
    name: "bolum_kapali_imza_dipnot",
    config: {
      sections: { taxNo: false, customerCode: false, branch: false, terms: false, grandTotal: false },
      signatureLabels: ["Satış Müdürü", "Müşteri"],
      footerNote: "Alt not <&>.",
      titleOverride: "sipariş onayı",
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
    config: { sections: { lineTable: false, orderNo: false, date: false }, style: { tableStyle: "plain", tableDensity: "relaxed", fontWeight: "light" } },
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
  ${docFieldCss(s.fields, DOC_FIELD_CATALOGS["siparisTeyidi"], d)}
`,
    style,
  );
}

const DASH_OR = (path: string, expr: string) => String.raw`{%- if ${path} == nil -%}—{%- else -%}${expr}{%- endif -%}`;

const CELLS = String.raw`{%- when "seq" -%}{{ satir.sira }}
{%- when "description" -%}{{ satir.urun }}
{%- when "color" -%}${DASH_OR("satir.renk", "{{ satir.renk }}")}
{%- when "width" -%}${WIDTH}
{%- when "qty" -%}{{ satir.miktar | sayi: 2 }}
{%- when "unit" -%}{{ satir.birim }}
{%- when "tolerance" -%}${DASH_OR("satir.tolerans", "{{ satir.tolerans | sayi: 2 }}")}
{%- when "unitPrice" -%}${DASH_OR("satir.birim_fiyat", "{{ satir.birim_fiyat | sayi: 2 }}")}
{%- when "amount" -%}${DASH_OR("satir.tutar", "{{ satir.tutar | sayi: 2 }}")}`;

const FOOT = String.raw`{%- when "qty" -%}{{ toplamlar.miktar | sayi: 2 }}
{%- when "amount" -%}${DASH_OR("toplamlar.tutar", "{{ toplamlar.tutar | sayi: 2 }}")}`;

const html = customerDocBody({
  taxCondition: "ayar.sections.taxNo",
  headLeft: String.raw`${SAYIN}
{%- if ayar.sections.branch and ${filled("karsi_taraf.sube")} -%}<div class="sub">Şube: {{ karsi_taraf.sube }}</div>{%- endif -%}`,
  headRight: String.raw`{%- if ayar.sections.orderNo -%}<div class="ln">Sipariş No: <b>{{ belge.no }}</b></div>{%- endif -%}
{%- if ayar.sections.date -%}<div class="ln">Tarih: <b>{{ belge.tarih | tarih }}</b></div>{%- endif -%}`,
  main: String.raw`{%- if ayar.sections.terms -%}<div class="sum">{%- for kosul in tablolar.kosullar -%}<div class="sum-i"><span>{{ kosul.etiket }}</span><b>{{ kosul.deger }}</b></div>{%- endfor -%}</div>{%- endif -%}
{%- assign kalem_sayisi = tablolar.kalemler | size -%}
{%- if ayar.sections.lineTable and kalem_sayisi > 0 -%}<div class="tbl-cap">Sipariş Kalemleri ({{ kalem_sayisi }})</div>
${dynamicTable({
  rows: "tablolar.kalemler",
  cols: "kalemler",
  widths: [["seq", "30px"], ["width", "56px"], ["qty", "76px"], ["unit", "48px"], ["tolerance", "52px"], ["unitPrice", "84px"], ["amount", "96px"]],
  cells: CELLS,
  foot: { label: "TOPLAM", cells: FOOT },
})}
{%- endif -%}
{%- if ayar.sections.grandTotal -%}<div class="grand"><span>Genel Toplam</span><b>{{ toplamlar.tutar_metni }}</b></div>{%- endif -%}
{%- if ayar.footerNote != "" -%}<div class="decl">{{ ayar.footerNote }}</div>{%- endif -%}`,
});

export const orderConfirmationSystem: SystemEquivalent = {
  docType: "ORDER_CONFIRMATION",
  editMode: "CODE",
  html,
  css,
  pageSettings: (settings) => pageSettingsFor(settings, 9),
  tableBindings: {},
  variants,
};
