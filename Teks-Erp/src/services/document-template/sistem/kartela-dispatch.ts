// =============================================================================
// KARTELA_DISPATCH (Kartela Çeki Listesi) — Sistem renderer'ının Liquid eşleniği
// =============================================================================
// KOD KİPİ (T6 kalıbı, D8): kolon sırası/başlığı ayardan dinamik, "ürün · renk" birleşimi ve
// toplam etiketi yerleşimi koşullu. İskelet `_ortak/musteri.ts`ten. Eşitlik: test_belge_sistem_esdegeri.
// =============================================================================

import { DOC_LOGO_CSS, DOC_STAMPS_CSS, docBlankGridCss, docTableCss, scaleDocCss } from "../../document-render/doc-style";
import { DOC_DENSITY, docChromeCss, resolveDocPageSize } from "../../document-render/doc-density";
import { DOC_FIELD_CATALOGS, docFieldCss } from "../../document-render/doc-fields";
import { BARCODE, ITEM_COLOR, WIDTH, customerDocBody, dynamicTable, filled } from "./_ortak/musteri";
import { TINY_PNG, pageSettingsFor, styleOf, type StyleSettings } from "./subcontractor-fragments";
import type { EquivalenceVariant, SystemEquivalent } from "./tipler";

type Settings = Readonly<Record<string, unknown>>;

const variants: EquivalenceVariant[] = [
  {
    name: "kolon_gizle_sira_baslik",
    config: {
      columns: {
        rollTable: { hidden: ["width", "seq"], order: ["kg", "meters", "itemColor", "barcode"], labels: { barcode: "Barkod 'no' <&>" }, blankLabels: ["itemColor"] },
      },
    },
  },
  {
    name: "bolum_kapali_imza_dipnot",
    config: {
      sections: { vehicleInfo: false, notes: false },
      signatureLabels: ["Depo Sorumlusu", "Şoför", "Kartela Firması"],
      footerNote: "Bu not basılmaz (notlar kapalı).",
      titleOverride: "kartela çekisi",
    },
  },
  {
    name: "a5_olcek_alan",
    config: {
      style: { pageSize: "A5", fontScale: 0.85, tableStyle: "zebra", tableDensity: "compact", fontWeight: "bold", margins: { top: 5, left: 12 } },
      fields: { secCaption: { size: 13, weight: "black" }, boxRow: { size: 9 }, company: { size: 15 } },
      footerNote: "Toplar sayılarak teslim edildi.",
      showSignatures: false,
      showLetterhead: false,
    },
  },
  {
    name: "tablo_kapali_bilgi_yok",
    config: {
      sections: { rollTable: false, subcontractorInfo: false, vehicleInfo: false },
      style: { tableStyle: "plain", tableDensity: "relaxed", fontWeight: "light" },
    },
  },
  {
    name: "toplamsiz_kolonlar_damga_blok_grid_logo",
    config: {
      columns: { rollTable: { hidden: ["meters", "kg"] } },
      qr: true,
      showLogo: true,
      logoPosition: "right",
      stamps: { printedAt: true, printedBy: true, copyLabel: "  FİRMA NÜSHASI  " },
      blocks: [
        { position: "afterHeader", text: "Üst blok\nikinci satır" },
        { position: "beforeSignatures", text: "Alt blok <b>" },
        { position: "beforeSignatures", text: "   " },
      ],
      blankGrid: { enabled: true, title: "DÖNEN TOP", rows: 2, columns: 3, headers: ["Barkod", "Metre", "Not"], position: "beforeSignatures" },
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
  ${docChromeCss(d, { boxLabelA4: 56 })}
  ${DOC_LOGO_CSS}
  ${DOC_STAMPS_CSS}
  ${docBlankGridCss({ blankGrid: s.blankGrid ?? undefined })}
  ${docTableCss(style, [".sec"])}
  ${docFieldCss(s.fields, DOC_FIELD_CATALOGS["kartelaCeki"], d)}
`,
    style,
  );
}

const ROLL_CELLS = String.raw`{%- when "seq" -%}{{ satir.sira }}
{%- when "barcode" -%}${BARCODE}
{%- when "itemColor" -%}${ITEM_COLOR}
{%- when "width" -%}${WIDTH}
{%- when "meters" -%}{{ satir.metre | sayi: 1 }}
{%- when "kg" -%}{%- if satir.kg == nil -%}—{%- else -%}{{ satir.kg | sayi: 1 }}{%- endif -%}`;

const FOOT_CELLS = String.raw`{%- when "meters" -%}{{ toplamlar.metre | sayi: 1 }} m
{%- when "kg" -%}{%- if toplamlar.kg > 0 -%}{{ toplamlar.kg | sayi: 1 }} kg{%- else -%}—{%- endif -%}`;

const html = customerDocBody({
  headRight: String.raw`<div class="ln">Sevk No: <b>{{ belge.no }}</b></div>
<div class="ln">Tarih: <b>{{ belge.tarih | tarih }}</b></div>`,
  beforeBlocks: String.raw`{%- if ayar.sections.subcontractorInfo or ayar.sections.vehicleInfo -%}<div class="info">
{%- if ayar.sections.subcontractorInfo -%}<div class="box"><div class="box-t">KARTELA FİRMASI</div>
<div class="row"><span>Adı:</span><b>{{ karsi_taraf.ad }}</b></div>
{%- if ${filled("karsi_taraf.kod")} -%}<div class="row"><span>Kod:</span><b>{{ karsi_taraf.kod }}</b></div>{%- endif -%}
</div>{%- endif -%}
{%- if ayar.sections.vehicleInfo -%}<div class="box"><div class="box-t">SEVK BİLGİLERİ</div>
<div class="row"><span>Plaka:</span><b>{%- if ${filled("belge.plaka")} -%}{{ belge.plaka }}{%- else -%}—{%- endif -%}</b></div>
<div class="row"><span>Şoför:</span><b>{%- if ${filled("belge.sofor")} -%}{{ belge.sofor }}{%- else -%}—{%- endif -%}</b></div>
{%- if ${filled("belge.notlar")} -%}<div class="row"><span>Not:</span><b>{{ belge.notlar }}</b></div>{%- endif -%}
</div>{%- endif -%}
</div>{%- endif -%}`,
  main: String.raw`{%- if ayar.sections.rollTable -%}<div class="tbl-cap">Gönderilen Toplar ({{ toplamlar.top_adedi }})</div>
${dynamicTable({ rows: "tablolar.toplar", cols: "toplar", widths: [["seq", "34px"], ["width", "60px"], ["meters", "80px"], ["kg", "70px"]], cells: ROLL_CELLS, foot: { label: "TOPLAM", cells: FOOT_CELLS } })}
{%- endif -%}
{%- if ayar.sections.notes and ayar.footerNote != "" -%}<div class="note">{{ ayar.footerNote }}</div>{%- endif -%}`,
});

export const kartelaDispatchSystem: SystemEquivalent = {
  docType: "KARTELA_DISPATCH",
  editMode: "CODE",
  html,
  css,
  pageSettings: (settings) => pageSettingsFor(settings, 9),
  tableBindings: {},
  variants,
};
