// =============================================================================
// BEAM_BODY_STATEMENT (Gövde Mutabakatı) — Sistem renderer'ının Liquid eşleniği (devere S6)
// =============================================================================
// KOD KİPİ (sipariş teyidi kalıbı): gövde/hareket kolonları ayardan dinamik; özet satırları, dönem
// ve yön metinleri sözleşmeden HAZIR gelir. Gövde notu kolonu yalnız `internalFields` opt-in'iyle
// `ayar.kolonlar.govdeler`e girer (Sistem: `sections.internalNotes`).
// =============================================================================

import { DOC_LOGO_CSS, DOC_STAMPS_CSS, docBlankGridCss, docTableCss, scaleDocCss } from "../../document-render/doc-style";
import { DOC_DENSITY, docChromeCss, resolveDocPageSize } from "../../document-render/doc-density";
import { DOC_FIELD_CATALOGS, docFieldCss } from "../../document-render/doc-fields";
import { commercialCssBody } from "../../document-render/commercial-doc";
import { customerDocBody, dynamicTable } from "./_ortak/musteri";
import { TINY_PNG, pageSettingsFor, styleOf, type StyleSettings } from "./subcontractor-fragments";
import type { EquivalenceVariant, SystemEquivalent } from "./tipler";

type Settings = Readonly<Record<string, unknown>>;

const variants: EquivalenceVariant[] = [
  { name: "ic_not_acik", config: { sections: { internalNotes: true } } },
  {
    name: "kolon_gizle_sira_baslik",
    config: {
      sections: { internalNotes: true },
      columns: {
        govdeler: { hidden: ["owner"], order: ["notes", "age", "bodyNo", "seq"], labels: { age: "Gün <&>" }, blankLabels: ["state"] },
        hareketler: { hidden: ["document"], order: ["kind", "seq"], labels: { direction: "Yön 'x'" } },
      },
    },
  },
  {
    name: "bolum_kapali_imza_dipnot",
    config: {
      sections: { taxNo: false, subcontractorCode: false, date: false, summary: false },
      signatureLabels: ["Depo Sorumlusu", "Devereci"],
      footerNote: "Alt not <&>.",
      titleOverride: "gövde sayımı",
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
  {
    name: "tablolar_kapali",
    config: { sections: { bodyTable: false, moveTable: false }, style: { tableStyle: "plain", tableDensity: "relaxed", fontWeight: "light" } },
  },
  {
    name: "damga_blok_grid_logo",
    config: {
      qr: true,
      showLogo: true,
      logoPosition: "right",
      stamps: { printedAt: true, printedBy: true, copyLabel: "  DEVERECİ NÜSHASI  " },
      blocks: [
        { position: "afterHeader", text: "Üst blok\nikinci satır" },
        { position: "beforeSignatures", text: "Alt blok <b>" },
      ],
      blankGrid: { enabled: true, title: "FARK", rows: 2, columns: 2, headers: ["Gövde", "Açıklama"], position: "beforeSignatures" },
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
  ${docFieldCss(s.fields, DOC_FIELD_CATALOGS["govdeMutabakat"], d)}
`,
    style,
  );
}

const BODY_CELLS = String.raw`{%- when "seq" -%}{{ satir.sira }}
{%- when "bodyNo" -%}{{ satir.govde_no }}
{%- when "state" -%}{{ satir.durum }}
{%- when "owner" -%}{{ satir.sahibi }}
{%- when "since" -%}{{ satir.tarih | tarih }}
{%- when "age" -%}{{ satir.gun }}
{%- when "notes" -%}{%- if ic_acik.govde_notu and satir.notlar != nil -%}{{ satir.notlar }}{%- endif -%}`;

const MOVE_CELLS = String.raw`{%- when "seq" -%}{{ satir.sira }}
{%- when "date" -%}{{ satir.tarih | tarih }}
{%- when "bodyNo" -%}{{ satir.govde_no }}
{%- when "direction" -%}{{ satir.yon }}
{%- when "kind" -%}{{ satir.hareket }}
{%- when "document" -%}{%- if satir.belge_no == nil -%}—{%- else -%}{{ satir.belge_no }}{%- endif -%}`;

const html = customerDocBody({
  taxCondition: "ayar.sections.taxNo",
  headLeft: String.raw`<div class="sayin">SAYIN: <b>{{ karsi_taraf.ad }}</b></div>
{%- if ayar.sections.subcontractorCode -%}<div class="sub">Kod: {{ karsi_taraf.kod }}</div>{%- endif -%}`,
  headRight: String.raw`{%- if ayar.sections.date -%}<div class="ln">Tarih: <b>{{ belge.tarih | tarih }}</b></div>{%- endif -%}
<div class="ln">Dönem: <b>{{ belge.donem_metni }}</b></div>`,
  main: String.raw`{%- if ayar.sections.summary -%}<div class="sum">{%- for oz in tablolar.ozet -%}<div class="sum-i"><span>{{ oz.etiket }}</span><b>{{ oz.deger }}</b></div>{%- endfor -%}</div>{%- endif -%}
{%- if ayar.sections.bodyTable -%}
{%- assign govde_sayisi = tablolar.govdeler | size -%}
<div class="tbl-cap">Sizdeki gövdelerimiz ({{ govde_sayisi }})</div>
{%- if govde_sayisi > 0 -%}
${dynamicTable({
  rows: "tablolar.govdeler",
  cols: "govdeler",
  widths: [["seq", "30px"], ["bodyNo", "110px"], ["since", "84px"], ["age", "44px"]],
  cells: BODY_CELLS,
})}
{%- else -%}<div class="qn">Kayıtlarımıza göre sizde gövdemiz yok.</div>{%- endif -%}
{%- endif -%}
{%- assign hareket_sayisi = tablolar.hareketler | size -%}
{%- if ayar.sections.moveTable and hareket_sayisi > 0 -%}<div class="tbl-cap">Dönem hareketleri ({{ belge.donem_metni }})</div>
${dynamicTable({
  rows: "tablolar.hareketler",
  cols: "hareketler",
  widths: [["seq", "30px"], ["date", "84px"], ["bodyNo", "110px"], ["direction", "110px"]],
  cells: MOVE_CELLS,
})}
{%- endif -%}
{%- if ayar.footerNote != "" -%}<div class="decl">{{ ayar.footerNote }}</div>{%- endif -%}`,
});

export const beamBodyStatementSystem: SystemEquivalent = {
  docType: "BEAM_BODY_STATEMENT",
  editMode: "CODE",
  html,
  css,
  pageSettings: (settings) => pageSettingsFor(settings, 9),
  tableBindings: {},
  variants,
};
