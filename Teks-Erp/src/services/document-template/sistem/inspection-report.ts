// =============================================================================
// INSPECTION_REPORT (Muayene Raporu) — Sistem renderer'ının Liquid eşleniği (K4P-RAPOR)
// =============================================================================
// KOD KİPİ (kalite sertifikası kalıbı): iki tablonun kolonu ayardan dinamik; özet, bant metni
// ve dipnotlar sözleşmeden HAZIR metin gelir (Liquid aritmetik yapmaz). İç kolonlar
// (operatör/istasyon/cihaz) yalnız opt-in edilince `ayar.kolonlar.toplar`a girer.
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
        kurallar: { hidden: ["cap"], order: ["bands", "name"], labels: { bands: "Bant <&>" } },
        toplar: { hidden: ["seq", "width"], order: ["result", "label", "score", "barcode"], blankLabels: ["itemColor"] },
      },
    },
  },
  {
    name: "ic_kolonlar_opt_in",
    config: { columns: { toplar: { shown: ["inspector", "station", "device"], order: ["inspector", "barcode"] } } },
  },
  {
    name: "bolum_kapali_imza_dipnot",
    config: {
      sections: { taxNo: false, customerCode: false, orderNos: false, summary: false, ruleTable: false, footnotes: false },
      signatureLabels: ["Kalite Müdürü", "Sevk Sorumlusu", "Müşteri"],
      footerNote: "Alt not <&>.",
      titleOverride: "muayene belgesi",
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
    name: "tablolar_kapali_baslik_yok",
    config: {
      sections: { rollDetail: false, shipmentNo: false, date: false },
      columns: { toplar: { hidden: ["meters", "defects", "points"] } },
      style: { tableStyle: "plain", tableDensity: "relaxed", fontWeight: "light" },
    },
  },
  {
    name: "toplamsiz_kolonlar_damga_blok_grid_logo",
    config: {
      columns: { toplar: { hidden: ["meters", "defects", "points"] } },
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
  .sum { display: flex; flex-wrap: wrap; gap: ${scaleW(d, 4)}px ${scaleW(d, 14)}px; margin-top: ${scaleW(d, 8)}px; font-size: ${d.note}px; }
  .sum-i span { color: #475569; margin-right: 4px; }
  .fn { margin-top: ${scaleW(d, 8)}px; font-size: ${d.note}px; color: #334155; }
  .decl { margin-top: ${scaleW(d, 12)}px; font-size: ${d.note}px; white-space: pre-wrap;
          border: 1px solid #cbd5e1; padding: ${scaleW(d, 8)}px ${scaleW(d, 10)}px; border-radius: 4px; font-style: italic; }
  ${DOC_LOGO_CSS}
  ${DOC_STAMPS_CSS}
  ${docBlankGridCss({ blankGrid: s.blankGrid ?? undefined })}
  ${docTableCss(style, [".sec"])}
  ${docFieldCss(s.fields, DOC_FIELD_CATALOGS["muayeneRaporu"], d)}
`,
    style,
  );
}

const DASH_OR = (path: string, out: string) => String.raw`{%- if ${path} == nil -%}—{%- else -%}${out}{%- endif -%}`;

const RULE_CELLS = String.raw`{%- when "name" -%}{{ satir.ad }}
{%- when "unit" -%}{{ satir.birim }}
{%- when "cap" -%}{{ satir.tavan }}
{%- when "bands" -%}{{ satir.bantlar }}`;

const ROLL_CELLS = String.raw`{%- when "seq" -%}{{ satir.sira }}
{%- when "barcode" -%}${BARCODE}
{%- when "itemColor" -%}${ITEM_COLOR}
{%- when "width" -%}${WIDTH}
{%- when "meters" -%}{{ satir.metre | sayi: 2 }}
{%- when "defects" -%}${DASH_OR("satir.hata", "{{ satir.hata }}")}
{%- when "points" -%}${DASH_OR("satir.puan", "{{ satir.puan }}")}
{%- when "score" -%}${DASH_OR("satir.puan_100", "{{ satir.puan_100 | sayi: 2 }}")}
{%- when "label" -%}${DASH_OR("satir.etiket", "{{ satir.etiket }}")}
{%- when "result" -%}{{ satir.sonuc }}
{%- when "inspector" -%}{{ satir.operator }}
{%- when "station" -%}{{ satir.istasyon }}
{%- when "device" -%}{{ satir.cihaz }}`;

const ROLL_FOOT = String.raw`{%- when "meters" -%}{{ toplamlar.metre | sayi: 2 }}
{%- when "defects" -%}{{ toplamlar.hata }}
{%- when "points" -%}{{ toplamlar.puan }}`;

const SUMMARY = String.raw`{%- if ayar.sections.summary -%}<div class="sum">
<div class="sum-i"><span>Muayene edilen top</span><b>{{ toplamlar.muayene_edilen }} / {{ toplamlar.top_adedi }}</b></div>
<div class="sum-i"><span>Geçti</span><b>{{ toplamlar.gecti }}</b></div>
<div class="sum-i"><span>Kaldı</span><b>{{ toplamlar.kaldi }}</b></div>
<div class="sum-i"><span>Ortalama puan / 100 m²</span><b>${DASH_OR("toplamlar.ortalama_puan_100m2", "{{ toplamlar.ortalama_puan_100m2 | sayi: 2 }}")}</b></div>
</div>{%- endif -%}`;

const html = customerDocBody({
  taxCondition: "ayar.sections.taxNo",
  headLeft: SAYIN,
  headRight: String.raw`{%- if ayar.sections.shipmentNo -%}<div class="ln">Sevkiyat No: <b>{{ belge.no }}</b></div>{%- endif -%}
{%- if ayar.sections.date -%}<div class="ln">Tarih: <b>{{ belge.tarih | tarih }}</b></div>{%- endif -%}
{%- if ayar.sections.orderNos and ${filled("belge.siparis_nolari")} -%}<div class="ln">Sipariş: <b>{{ belge.siparis_nolari }}</b></div>{%- endif -%}`,
  main: String.raw`${SUMMARY}
{%- assign kural_sayisi = tablolar.kurallar | size -%}
{%- if ayar.sections.ruleTable and kural_sayisi > 0 -%}<div class="tbl-cap">Kural</div>
${dynamicTable({ rows: "tablolar.kurallar", cols: "kurallar", widths: [["unit", "70px"]], cells: RULE_CELLS })}
{%- endif -%}
{%- assign dokum_sayisi = tablolar.toplar | size -%}
{%- if ayar.sections.rollDetail and dokum_sayisi > 0 -%}<div class="tbl-cap">Top Muayene Dökümü ({{ toplamlar.top_adedi }})</div>
${dynamicTable({
  rows: "tablolar.toplar",
  cols: "toplar",
  widths: [["seq", "30px"], ["width", "56px"], ["meters", "70px"], ["defects", "46px"], ["points", "46px"], ["score", "64px"], ["label", "64px"], ["result", "78px"]],
  cells: ROLL_CELLS,
  foot: { label: "TOPLAM", cells: ROLL_FOOT },
})}
{%- endif -%}
{%- assign dipnot_sayisi = tablolar.dipnotlar | size -%}
{%- if ayar.sections.footnotes and dipnot_sayisi > 0 -%}<div class="fn">{%- for dipnot in tablolar.dipnotlar -%}<div>{{ dipnot.metin }}</div>{%- endfor -%}</div>{%- endif -%}
{%- if ayar.footerNote != "" -%}<div class="decl">{{ ayar.footerNote }}</div>{%- endif -%}`,
});

export const inspectionReportSystem: SystemEquivalent = {
  docType: "INSPECTION_REPORT",
  editMode: "CODE",
  html,
  css,
  pageSettings: (settings) => pageSettingsFor(settings, 9),
  tableBindings: {},
  variants,
};
