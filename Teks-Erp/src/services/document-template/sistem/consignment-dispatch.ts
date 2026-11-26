// =============================================================================
// CONSIGNMENT_DISPATCH (Emanet Çıkış Belgesi) — Sistem renderer'ının Liquid eşleniği (denetim 6)
// =============================================================================
// KOD KİPİ (gövde mutabakatı kalıbı): kalem kolonları ayardan dinamik; özet ve araç metni sözleşmeden HAZIR.
// Belge notu yalnız `internalFields` opt-in'iyle bağlama girer (Sistem: `sections.internalNotes`).
// =============================================================================

import { DOC_LOGO_CSS, DOC_STAMPS_CSS, docBlankGridCss, docTableCss, scaleDocCss } from "../../document-render/doc-style";
import { DOC_DENSITY, docChromeCss, resolveDocPageSize } from "../../document-render/doc-density";
import { DOC_FIELD_CATALOGS, docFieldCss } from "../../document-render/doc-fields";
import { commercialCssBody } from "../../document-render/commercial-doc";
import { customerDocBody, dynamicTable, filled } from "./_ortak/musteri";
import { TINY_PNG, pageSettingsFor, styleOf, type StyleSettings } from "./subcontractor-fragments";
import type { EquivalenceVariant, SystemEquivalent } from "./tipler";

type Settings = Readonly<Record<string, unknown>>;

const variants: EquivalenceVariant[] = [
  { name: "ic_not_acik", config: { sections: { internalNotes: true } } },
  {
    name: "kolon_gizle_sira_baslik",
    config: { columns: { kalemler: { hidden: ["kind"], order: ["qty", "ref", "seq"], labels: { qty: "Adet <&>" }, blankLabels: ["unit"] } } },
  },
  {
    name: "bolum_kapali_imza_dipnot",
    config: {
      sections: { taxNo: false, ownerCode: false, date: false, vehicle: false, summary: false },
      signatureLabels: ["Depo Sorumlusu", "Alıcı"],
      footerNote: "Alt not <&>.",
      titleOverride: "emanet teslim",
    },
  },
  {
    name: "a5_olcek_alan",
    config: {
      style: { pageSize: "A5", fontScale: 0.85, tableStyle: "zebra", tableDensity: "compact", fontWeight: "bold", margins: { top: 5, left: 12 } },
      fields: { tblCap: { size: 13, weight: "black" }, company: { size: 15 } },
      showSignatures: false,
      showLetterhead: false,
    },
  },
  { name: "tablo_kapali", config: { sections: { lineTable: false }, style: { tableStyle: "plain", tableDensity: "relaxed", fontWeight: "light" } } },
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
      blankGrid: { enabled: true, title: "TESLİM", rows: 2, columns: 2, headers: ["Kalem", "Açıklama"], position: "beforeSignatures" },
    },
    print: { logo: TINY_PNG, qr: TINY_PNG, zaman: "2026-06-07T09:00:00.000Z", basan: "depo", not: "Tek seferlik not" },
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
  ${docFieldCss(s.fields, DOC_FIELD_CATALOGS["emanetCikis"], d)}
`,
    style,
  );
}

const LINE_CELLS = String.raw`{%- when "seq" -%}{{ satir.sira }}
{%- when "kind" -%}{{ satir.tur }}
{%- when "item" -%}{{ satir.kalem }}
{%- when "ref" -%}{{ satir.referans }}
{%- when "qty" -%}{{ satir.miktar | sayi: 2 }}
{%- when "unit" -%}{{ satir.birim }}`;

const html = customerDocBody({
  taxCondition: "ayar.sections.taxNo",
  headLeft: String.raw`<div class="sayin">SAYIN: <b>{{ karsi_taraf.ad }}</b></div>
{%- if ayar.sections.ownerCode and ${filled("karsi_taraf.kod")} -%}<div class="sub">Kod: {{ karsi_taraf.kod }}</div>{%- endif -%}`,
  headRight: String.raw`<div class="ln">Belge No: <b>{{ belge.no }}</b></div>
{%- if ayar.sections.date -%}<div class="ln">Tarih: <b>{{ belge.tarih | tarih_saat }}</b></div>{%- endif -%}
{%- if ayar.sections.vehicle and ${filled("belge.arac_metni")} -%}<div class="meta-row">{{ belge.arac_metni }}</div>{%- endif -%}`,
  main: String.raw`{%- assign ozet_sayisi = tablolar.ozet | size -%}
{%- if ayar.sections.summary and ozet_sayisi > 0 -%}<div class="sum">{%- for oz in tablolar.ozet -%}<div class="sum-i"><span>{{ oz.etiket }}</span><b>{{ oz.deger }}</b></div>{%- endfor -%}</div>{%- endif -%}
{%- assign kalem_sayisi = tablolar.kalemler | size -%}
{%- if ayar.sections.lineTable and kalem_sayisi > 0 -%}<div class="tbl-cap">Çıkan Kalemler ({{ kalem_sayisi }})</div>
${dynamicTable({
  rows: "tablolar.kalemler",
  cols: "kalemler",
  widths: [["seq", "30px"], ["kind", "60px"], ["ref", "120px"], ["qty", "84px"], ["unit", "48px"]],
  cells: LINE_CELLS,
})}
{%- endif -%}
{%- if ic_acik.belge_notu -%}{%- if ${filled("belge.not")} -%}<div class="decl">Not: {{ belge.not }}</div>{%- endif -%}{%- endif -%}
{%- if ayar.footerNote != "" -%}<div class="decl">{{ ayar.footerNote }}</div>{%- endif -%}`,
});

export const consignmentDispatchSystem: SystemEquivalent = {
  docType: "CONSIGNMENT_DISPATCH",
  editMode: "CODE",
  html,
  css,
  pageSettings: (settings) => pageSettingsFor(settings, 9),
  tableBindings: {},
  variants,
};
