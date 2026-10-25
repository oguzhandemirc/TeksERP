// =============================================================================
// QUALITY_CERTIFICATE (Kalite Sertifikası) — Sistem renderer'ının Liquid eşleniği
// =============================================================================
// KOD KİPİ (T6 kalıbı, D8): iki tablonun kolon sırası/başlığı ayardan dinamik, toplam etiketi
// yerleşimi ve beyan metni (alt not ya da varsayılan) koşullu. İskelet `_ortak/musteri.ts`ten.
// =============================================================================

import { DOC_LOGO_CSS, DOC_STAMPS_CSS, docBlankGridCss, docTableCss, scaleDocCss } from "../../document-render/doc-style";
import { DOC_DENSITY, docChromeCss, resolveDocPageSize, scaleW } from "../../document-render/doc-density";
import { DOC_FIELD_CATALOGS, docFieldCss } from "../../document-render/doc-fields";
import { BARCODE, ITEM_COLOR, SAYIN, WIDTH, customerDocBody, dynamicTable, filled } from "./_ortak/musteri";
import { TINY_PNG, pageSettingsFor, styleOf, type StyleSettings } from "./subcontractor-fragments";
import type { EquivalenceVariant, SystemEquivalent } from "./tipler";

type Settings = Readonly<Record<string, unknown>>;

const variants: EquivalenceVariant[] = [
  {
    name: "kolon_gizle_sira_baslik",
    config: {
      columns: {
        gradeSummary: { order: ["totalMeters", "grade"], labels: { grade: "Sınıf <&>" } },
        rollDetail: { hidden: ["seq", "width"], order: ["meters", "grade", "itemColor", "barcode"], blankLabels: ["itemColor"] },
      },
    },
  },
  {
    name: "bolum_kapali_imza_dipnot",
    config: {
      sections: { taxNo: false, customerCode: false, orderNos: false, rollDetail: false, declaration: false },
      signatureLabels: ["Kalite Müdürü", "Sevk Sorumlusu", "Müşteri"],
      footerNote: "Bu not beyan kapalıyken de basılır.",
      titleOverride: "kalite belgesi",
    },
  },
  {
    name: "a5_olcek_alan_beyan_metni",
    config: {
      style: { pageSize: "A5", fontScale: 0.85, tableStyle: "zebra", tableDensity: "compact", fontWeight: "bold", margins: { top: 5, left: 12 } },
      fields: { secCaption: { size: 13, weight: "black" }, company: { size: 15 } },
      footerNote: "Ürünler TS EN ISO standardına uygundur.\nİkinci satır <&>",
      showSignatures: false,
      showLetterhead: false,
    },
  },
  {
    name: "tablolar_kapali_baslik_yok",
    config: {
      sections: { gradeSummary: false, rollDetail: false, shipmentNo: false, date: false },
      columns: { gradeSummary: { hidden: ["rollCount", "totalMeters"] } },
      style: { tableStyle: "plain", tableDensity: "relaxed", fontWeight: "light" },
    },
  },
  {
    name: "toplamsiz_kolonlar_damga_blok_grid_logo",
    config: {
      columns: { gradeSummary: { hidden: ["rollCount", "totalMeters"] } },
      qr: true,
      showLogo: true,
      logoPosition: "right",
      stamps: { printedAt: true, printedBy: true, copyLabel: "  MÜŞTERİ NÜSHASI  " },
      blocks: [
        { position: "afterHeader", text: "Üst blok\nikinci satır" },
        { position: "beforeSignatures", text: "Alt blok <b>" },
      ],
      blankGrid: { enabled: true, title: "NUMUNE", rows: 2, columns: 2, headers: ["Test", "Sonuç"], position: "afterHeader" },
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
  .tbl-cap { margin: ${scaleW(d, 8)}px 0 ${scaleW(d, 3)}px; }
  .decl { margin-top: ${scaleW(d, 12)}px; font-size: ${d.note}px; white-space: pre-wrap;
          border: 1px solid #cbd5e1; padding: ${scaleW(d, 8)}px ${scaleW(d, 10)}px; border-radius: 4px; font-style: italic; }
  ${DOC_LOGO_CSS}
  ${DOC_STAMPS_CSS}
  ${docBlankGridCss({ blankGrid: s.blankGrid ?? undefined })}
  ${docTableCss(style, [".sec"])}
  ${docFieldCss(s.fields, DOC_FIELD_CATALOGS["kaliteSertifikasi"], d)}
`,
    style,
  );
}

const GRADE_CELLS = String.raw`{%- when "grade" -%}{{ satir.kalite }}
{%- when "rollCount" -%}{{ satir.top_adedi }}
{%- when "totalMeters" -%}{{ satir.metre | sayi: 2 }}`;

const GRADE_FOOT = String.raw`{%- when "rollCount" -%}{{ toplamlar.top_adedi }}
{%- when "totalMeters" -%}{{ toplamlar.metre | sayi: 2 }}`;

const ROLL_CELLS = String.raw`{%- when "seq" -%}{{ satir.sira }}
{%- when "barcode" -%}${BARCODE}
{%- when "itemColor" -%}${ITEM_COLOR}
{%- when "width" -%}${WIDTH}
{%- when "grade" -%}{%- if ${filled("satir.kalite")} -%}{{ satir.kalite }}{%- else -%}—{%- endif -%}
{%- when "meters" -%}{{ satir.metre | sayi: 2 }}`;

const DEFAULT_DECLARATION = "Yukarıda dökümü verilen ürünlerin belirtilen kalite sınıflarında sevk edildiğini beyan ederiz.";

const html = customerDocBody({
  taxCondition: "ayar.sections.taxNo",
  headLeft: SAYIN,
  headRight: String.raw`{%- if ayar.sections.shipmentNo -%}<div class="ln">Sevkiyat No: <b>{{ belge.no }}</b></div>{%- endif -%}
{%- if ayar.sections.date -%}<div class="ln">Tarih: <b>{{ belge.tarih | tarih }}</b></div>{%- endif -%}
{%- if ayar.sections.orderNos and ${filled("belge.siparis_nolari")} -%}<div class="ln">Sipariş: <b>{{ belge.siparis_nolari }}</b></div>{%- endif -%}`,
  main: String.raw`{%- if ayar.sections.gradeSummary -%}<div class="tbl-cap">Kalite Dağılımı</div>
${dynamicTable({ rows: "tablolar.kaliteler", cols: "kaliteler", widths: {}, cells: GRADE_CELLS, foot: { label: "TOPLAM", cells: GRADE_FOOT } })}
{%- endif -%}
{%- assign dokum_sayisi = tablolar.toplar | size -%}
{%- if ayar.sections.rollDetail and dokum_sayisi > 0 -%}<div class="tbl-cap">Top Dökümü ({{ toplamlar.top_adedi }})</div>
${dynamicTable({ rows: "tablolar.toplar", cols: "toplar", widths: { seq: "34px", width: "60px", grade: "70px", meters: "80px" }, cells: ROLL_CELLS })}
{%- endif -%}
{%- if ayar.sections.declaration -%}<div class="decl">{%- if ayar.footerNote != "" -%}{{ ayar.footerNote }}{%- else -%}${DEFAULT_DECLARATION}{%- endif -%}</div>
{%- elsif ayar.footerNote != "" -%}<div class="decl">{{ ayar.footerNote }}</div>{%- endif -%}`,
});

export const qualityCertificateSystem: SystemEquivalent = {
  docType: "QUALITY_CERTIFICATE",
  editMode: "CODE",
  html,
  css,
  pageSettings: (settings) => pageSettingsFor(settings, 9),
  tableBindings: {},
  variants,
};
