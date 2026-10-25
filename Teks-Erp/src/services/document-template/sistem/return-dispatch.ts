// =============================================================================
// RETURN_DISPATCH (İade İrsaliyesi) — Sistem renderer'ının Liquid eşleniği
// =============================================================================
// KOD KİPİ (T6 kalıbı, D8): kolon sırası/başlığı ayardan dinamik; tekil/çok kalem başlığı,
// yalnız çok kalemde basılan toplam satırı ve ayraçlı referans satırı koşullu. İskelet
// `_ortak/musteri.ts`ten. İade dipnotu (`belge.iade_dipnotu`) snapshot'tan; boşsa basılmaz.
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
        rollTable: { hidden: ["width"], order: ["qty", "grade", "itemColor", "barcode"], labels: { barcode: "Barkod 'no' <&>" }, blankLabels: ["itemColor"] },
      },
    },
  },
  {
    name: "bolum_kapali_imza_dipnot",
    config: {
      sections: { taxNo: false, customerCode: false, references: false, reason: false, documentNo: false },
      signatureLabels: ["Müşteri", "Depo", "Kalite"],
      footerNote: "İade, kalite kontrolünden sonra değerlendirilir.",
      titleOverride: "iade belgesi",
    },
  },
  {
    name: "a5_olcek_alan",
    config: {
      style: { pageSize: "A5", fontScale: 0.85, tableStyle: "zebra", tableDensity: "compact", fontWeight: "bold", margins: { top: 5, left: 12 } },
      fields: { secCaption: { size: 13, weight: "black" }, boxRow: { size: 9 }, company: { size: 15 } },
      showSignatures: false,
      showLetterhead: false,
    },
  },
  {
    name: "tablo_kapali_tarih_yok",
    config: {
      sections: { rollTable: false, date: false },
      style: { tableStyle: "plain", tableDensity: "relaxed", fontWeight: "light" },
    },
  },
  {
    name: "toplamsiz_kolonlar_damga_blok_grid_logo",
    config: {
      columns: { rollTable: { hidden: ["qty"] } },
      qr: true,
      showLogo: true,
      logoPosition: "right",
      stamps: { printedAt: true, printedBy: true, copyLabel: "  MÜŞTERİ NÜSHASI  " },
      blocks: [
        { position: "afterHeader", text: "Üst blok\nikinci satır" },
        { position: "beforeSignatures", text: "Alt blok <b>" },
      ],
      blankGrid: { enabled: true, title: "KONTROL", rows: 2, columns: 3, headers: ["Barkod", "Metre", "Not"], position: "beforeSignatures" },
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
  ${docChromeCss(d, { boxLabelA4: 92, totRow: false })}
  .sec { margin-top: ${scaleW(d, 6)}px; }
  .sec th.caption { background: #e2e8f0; text-align: center; font-size: ${d.secCaption}px; font-weight: 800; letter-spacing: 1px; padding: ${scaleW(d, 5)}px; }
  .sec thead th:not(.caption) { background: #f1f5f9; font-weight: 700; font-size: ${d.secHead}px; text-transform: none; }
  .box { flex: none; margin-top: ${scaleW(d, 10)}px; }
  .box .row { margin-top: 2px; }
  ${DOC_LOGO_CSS}
  ${DOC_STAMPS_CSS}
  ${docBlankGridCss({ blankGrid: s.blankGrid ?? undefined })}
  ${docTableCss(style, [".sec"])}
  ${docFieldCss(s.fields, DOC_FIELD_CATALOGS["iadeIrsaliyesi"], d)}
`,
    style,
  );
}

const ROLL_CELLS = String.raw`{%- when "barcode" -%}${BARCODE}
{%- when "itemColor" -%}${ITEM_COLOR}
{%- when "width" -%}${WIDTH}
{%- when "grade" -%}{%- if ${filled("satir.kalite")} -%}{{ satir.kalite }}{%- else -%}—{%- endif -%}
{%- when "qty" -%}{{ satir.metre | sayi: 2 }}`;

const REFERENCES = String.raw`{%- capture referanslar -%}
{%- if ${filled("belge.sevkiyat_no")} -%}Geldiği Sevkiyat: <b>{{ belge.sevkiyat_no }}</b>{%- endif -%}
{%- if ${filled("belge.siparis_no")} -%}{%- if ${filled("belge.sevkiyat_no")} %} &nbsp;·&nbsp; {% endif -%}Sipariş: <b>{{ belge.siparis_no }}</b>{%- endif -%}
{%- endcapture -%}
{%- if ayar.sections.references and referanslar != "" -%}<div class="meta-row">{{ referanslar }}</div>{%- endif -%}`;

const REASON_BOX = String.raw`{%- assign neden_var = false -%}
{%- if ${filled("belge.iade_nedeni")} -%}{%- assign neden_var = true -%}{%- endif -%}
{%- if ${filled("belge.notlar")} -%}{%- assign neden_var = true -%}{%- endif -%}
{%- if ayar.sections.reason and neden_var -%}<div class="box">
{%- if ${filled("belge.iade_nedeni")} -%}<div class="row"><span>İade Nedeni:</span><b>{{ belge.iade_nedeni }}</b></div>{%- endif -%}
{%- if ${filled("belge.notlar")} -%}<div class="row"><span>Not:</span><b>{{ belge.notlar }}</b></div>{%- endif -%}
{%- if ${filled("belge.teslim_alan")} -%}<div class="row"><span>Teslim Alan:</span><b>{{ belge.teslim_alan }}</b></div>{%- endif -%}
</div>{%- endif -%}`;

const html = customerDocBody({
  taxCondition: "ayar.sections.taxNo",
  headLeft: SAYIN,
  headRight: String.raw`{%- if ayar.sections.documentNo -%}<div class="ln">İade No: <b>{{ belge.no }}</b></div>{%- endif -%}
{%- if ayar.sections.date -%}<div class="ln">Tarih: <b>{{ belge.tarih | tarih }}</b></div>{%- endif -%}`,
  beforeBlocks: REFERENCES,
  main: String.raw`{%- if ayar.sections.rollTable -%}
${dynamicTable({
  rows: "tablolar.toplar",
  cols: "toplar",
  caption: "{% if toplamlar.top_adedi > 1 %}İADE EDİLEN TOPLAR{% else %}İADE EDİLEN TOP{% endif %}",
  widths: [["width", "60px"], ["grade", "70px"], ["qty", "80px"]],
  cells: ROLL_CELLS,
  foot: { label: "TOPLAM ({{ toplamlar.top_adedi }} top)", cells: String.raw`{%- when "qty" -%}{{ toplamlar.metre | sayi: 2 }}`, when: "toplamlar.top_adedi > 1" },
})}
{%- endif -%}
${REASON_BOX}
{%- if ${filled("belge.iade_dipnotu")} -%}<div class="note">{{ belge.iade_dipnotu }}</div>{%- endif -%}
{%- if ayar.footerNote != "" -%}<div class="note">{{ ayar.footerNote }}</div>{%- endif -%}`,
});

export const returnDispatchSystem: SystemEquivalent = {
  docType: "RETURN_DISPATCH",
  editMode: "CODE",
  html,
  css,
  pageSettings: (settings) => pageSettingsFor(settings, 9),
  tableBindings: {},
  variants,
};
