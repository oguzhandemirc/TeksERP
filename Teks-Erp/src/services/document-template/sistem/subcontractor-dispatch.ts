// =============================================================================
// SUBCONTRACTOR_DISPATCH (Fason Sevk — KUMAŞ İRSALİYESİ) — Sistem renderer'ının Liquid eşleniği
// =============================================================================
// KOD KİPİ (T6 kalıbı, D8): ızgara sayfa/satır sınırları hücre bayraklarıyla açılıp kapanır,
// alt tablo kolonları ayardan dinamik, talimat kutusu ve üst bilgi satırları koşullu birleşir.
// Talimat kutusu CSS'i (`.cmd*`) Sistem'de yalnız kutu varken basılır; eşlenikte HEP vardır
// (kutusuz belgede hiçbir öğeye değmez). Fason çeki taslağı aynı şablondur (TASLAK üst katmanı).
// =============================================================================

import { TERIM } from "../../../constants/terim";
import {
  DOC_LOGO_CSS,
  DOC_PAGINATION_CSS,
  DOC_STAMPS_CSS,
  docBlankGridCss,
  docTableCss,
  scaleDocCss,
} from "../../document-render/doc-style";
import { FASON_DENSITY, gridColWidths, resolveFasonPageSize, resolveGridGroups } from "../../document-render/fason-ceki.density";
import { fasonFieldCss } from "../../document-render/fason-ceki.fields";
import {
  BLANK_GRID_CAPTURE,
  COPY_BADGE,
  LOGO_ASSIGN,
  LOGO_LEFT,
  LOGO_RIGHT,
  PRINT_NOTE,
  SIGNATURES,
  STAMPS,
  TINY_PNG,
  blocksAt,
  letterhead,
  pageSettingsFor,
  styleOf,
  type StyleSettings,
} from "./subcontractor-fragments";
import type { EquivalenceVariant, SystemEquivalent } from "./tipler";

type Settings = Readonly<Record<string, unknown>>;

interface DispatchStyleSettings extends StyleSettings {
  sections?: Record<string, boolean>;
  gridGroups?: number;
}

const marginOf = (settings: Settings) =>
  FASON_DENSITY[resolveFasonPageSize((settings as StyleSettings).style?.pageSize)].marginMm;

/** Sistem CSS'i (`@page` hariç — `pageSettings`ten gelir); yazı ölçeği bitmiş CSS'e uygulanır. */
function css(settings: Settings): string {
  const s = settings as DispatchStyleSettings;
  const style = styleOf(settings, marginOf(settings));
  const d = FASON_DENSITY[style.pageSize];
  const showGridWidth = s.sections?.gridWidth !== false;
  const col = gridColWidths(resolveGridGroups(s.gridGroups), showGridWidth);
  return scaleDocCss(
    `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, "Helvetica Neue", sans-serif; color: #111; font-size: ${d.base}px; }
  .sheet { position: relative; width: 100%; }
  .wm { position: fixed; top: 42%; left: 0; right: 0; text-align: center;
        font-size: ${d.watermark}px; font-weight: 800; color: rgba(220,38,38,0.16);
        transform: rotate(-22deg); letter-spacing: 8px; z-index: 0; }
  .wm-old { color: rgba(100,116,139,0.18); }
  .wm-draft { color: rgba(100,116,139,0.16); }
  header { display: flex; justify-content: space-between; align-items: flex-start;
           border-bottom: 2px solid #000; padding-bottom: ${d.headerPadB}px; margin-bottom: ${d.headerMarB}px; gap: ${d.headerGap}px; }
  .hl { flex: 1; min-width: 0; }
  .company { font-size: ${d.company}px; font-weight: 800; text-transform: uppercase; overflow-wrap: anywhere; }
  .lh-line { font-size: ${d.lhLine}px; color: #333; }
  .sayin { margin-top: ${d.sayinMarT}px; font-size: ${d.sayin}px; }
  .sayin b { font-size: ${d.sayinB}px; text-transform: uppercase; }
  .sub { font-size: ${d.sub}px; color: #444; margin-top: 1px; }
  .hr { text-align: right; min-width: 0; }
  .hr .title { overflow-wrap: anywhere; }
  .title { font-size: ${d.title}px; font-weight: 800; letter-spacing: 1px; }
  .ln { margin-top: ${d.lnMarT}px; font-size: ${d.ln}px; overflow-wrap: anywhere; }
  .ln b { font-size: ${d.lnB}px; white-space: nowrap; }
  table { border-collapse: collapse; width: 100%; }
  .grid { margin-bottom: ${d.gridMarB}px; table-layout: fixed; }
  .grid th, .grid td { border: 1px solid #000; height: ${d.gridRowH}px; text-align: center;
                       font-size: ${d.gridCell}px; padding: 0 ${d.gridPadX}px; overflow: hidden; }
  .grid th { background: #f1f5f9; font-weight: 700; }
  .grid .c-top { width: ${col.top}; background: #f8fafc; }
  .grid .c-met { width: ${col.met}; }${showGridWidth ? `
  .grid .c-cm  { width: ${col.cm}; }` : ""}
  .grid tbody .c-top { font-weight: 700; }
  .meta-row { margin: ${d.metaRowMarY}px 0; font-size: ${d.metaRow}px; }
  .totals { margin-top: ${d.totalsMarT}px; }
  .totals th, .totals td { border: 1px solid #000; padding: ${d.totalsPad}; font-size: ${d.totalsCell}px; }
  .totals th { background: #f1f5f9; text-align: left; font-size: ${d.totalsHead}px; text-transform: uppercase; }
  .totals .cins { font-weight: 700; }
  .totals .tot td { font-weight: 800; background: #f8fafc; }
  .note { margin-top: ${d.noteMarT}px; font-size: ${d.note}px; white-space: pre-wrap; border: 1px solid #cbd5e1; padding: ${d.notePad}; border-radius: 4px; }
  .instr { margin-top: ${d.instrMarT}px; border: 2px solid #000; padding: ${d.instrPad}; border-radius: 4px; }
  .instr-lbl { font-size: ${d.instrLbl}px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: #333; }
  .instr-txt { margin-top: ${d.instrTxtMarT}px; font-size: ${d.instrTxt}px; font-weight: 600; white-space: pre-wrap; }
  .cmd { margin-top: ${d.cmdMarT}px; border: 2px solid #000; border-radius: 4px; padding: ${d.cmdPad}; display: grid; grid-template-columns: max-content max-content 1fr; column-gap: ${d.cmdColGap}px; row-gap: ${d.cmdRowGap}px; align-items: baseline; }
  .cmd-lbl { font-size: ${d.cmdLbl}px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: #333; white-space: nowrap; }
  .cmd-sep { font-size: ${d.cmdLbl}px; font-weight: 700; color: #333; }
  .cmd-val { font-size: ${d.cmdVal}px; font-weight: 800; min-width: 0; overflow-wrap: anywhere; }
  .sign { display: flex; gap: ${d.signGap}px; margin-top: ${d.signMarT}px; }
  .sign-box { flex: 1; text-align: center; }
  .sign-line { border-top: 1px solid #000; margin-bottom: ${d.signLineMarB}px; }
  .sign-lbl { font-size: ${d.signLbl}px; color: #333; }
  ${DOC_LOGO_CSS}
  ${DOC_STAMPS_CSS}
  ${docBlankGridCss({ blankGrid: s.blankGrid ?? undefined })}
  ${DOC_PAGINATION_CSS}
  ${docTableCss(style, [".totals"])}
  ${fasonFieldCss(s.fields, d)}
`,
    style,
  );
}

const variants: EquivalenceVariant[] = [
  {
    name: "izgara_3_grup_7_satir_cm_kapali",
    config: { gridGroups: 3, gridRows: 7, sections: { gridWidth: false } },
  },
  {
    name: "bos_grid_basliklar_bolumler_kapali",
    config: {
      sections: {
        subcontractorInfo: false, workOrderInfo: false, vehicleInfo: false, notes: false, batchInfo: false,
        requestedColor: false, dyehouseNote: false, productionProps: false, dyeColorLine: false,
      },
      blankGrid: { enabled: true, title: "KURŞUN KAYDI", rows: 3, columns: 4, columnWidths: [40, 20, 20, 20], headers: ["Top", "Kurşun"], position: "afterHeader" },
      signatureLabels: ["Sevk Eden", "Boyahane", "Kalite"],
      titleOverride: "boyahane çekisi",
    },
  },
  {
    name: "kumas_satiri_hesap_parti_solda",
    config: {
      sections: { fabricHeader: true, accountNo: true },
      placements: { batchInfo: "left" },
      footerNote: "Dönüşte parti no ile eşleştirilir.",
    },
  },
  {
    name: "a5_4_grup_en_bos_alan",
    config: {
      style: { pageSize: "A5", fontScale: 0.85, tableStyle: "zebra", tableDensity: "compact", fontWeight: "bold", margins: { top: 5, left: 12 } },
      fields: { gridMetre: { size: 11, weight: "bold" }, cmdLabel: { size: 9 }, totalsFoot: { size: 10, weight: "black" } },
      gridGroups: 4,
      blankWidths: true,
      showSignatures: false,
      sections: { fabricHeader: true, instructionWarning: false },
    },
  },
  {
    name: "ozet_kolon_gizle_sira_baslik",
    config: {
      columns: { totals: { hidden: ["fiyat", "tutar"], order: ["metre", "top", "cins"], labels: { cins: "Kumaş 'adı' <&>" }, blankLabels: ["en"] } },
      style: { tableStyle: "plain", tableDensity: "relaxed", fontWeight: "light" },
    },
  },
  {
    name: "ozet_yalniz_toplamli_kolonlar_damga_logo",
    config: {
      columns: { totals: { hidden: ["cins", "en", "fiyat", "tutar"] } },
      gridRows: 20,
      qr: true,
      showLogo: true,
      logoPosition: "right",
      stamps: { printedAt: true, printedBy: true, copyLabel: "  FASON NÜSHASI  " },
      blocks: [
        { position: "afterHeader", text: "Üst blok\nikinci satır" },
        { position: "beforeSignatures", text: "Alt blok <b>" },
      ],
      blankGrid: { enabled: true, rows: 2, columns: 3, position: "beforeSignatures" },
    },
    print: { logo: TINY_PNG, qr: TINY_PNG, zaman: "2026-09-25T09:00:00.000Z", basan: "operatör", not: "Tek seferlik not" },
  },
];

const filled = (path: string) => `${path} != nil and ${path} != ""`;

/** Renderer `metreDot`: 1 hane, tam sayıda kesirsiz, NOKTA ondalık, binlik ayraçsız; boş/0 → "". */
const metreDot = (path: string) =>
  `{%- if ${path} != nil and ${path} != 0 -%}{{ ${path} | sayi: 1 | remove: "." | replace: ",0", "" | replace: ",", "." }}{%- endif -%}`;

const cmdRow = (label: string, value: string) =>
  `<div class="cmd-lbl">${label}</div><div class="cmd-sep">:</div><div class="cmd-val">${value}</div>`;

const html = String.raw`<div class="sheet">
{%- assign parti_html = "" -%}
{%- if ayar.sections.batchInfo and ${filled("belge.parti_no")} -%}{%- capture parti_html -%}<div class="ln ln-batch">Parti No: <b>{{ belge.parti_no }}</b></div>{%- endcapture -%}{%- endif -%}
{%- assign kumas_sayisi = tablolar.kumaslar | size -%}
{%- assign renk_sayisi = tablolar.renkler | size -%}
{%- assign dolu = false -%}
{%- capture kumas_satiri -%}
{%- if kumas_sayisi > 0 -%}{{ tablolar.kumaslar | map: "ad" | join: ", " }}{%- assign dolu = true -%}{%- endif -%}
{%- if ayar.blankWidths == false and belge.en != nil -%}{%- if dolu %} &nbsp;·&nbsp; {% endif -%}{{ belge.en | sayi: 0 }} cm{%- assign dolu = true -%}{%- endif -%}
{%- if ayar.sections.requestedColor and renk_sayisi > 0 -%}{%- if dolu %} &nbsp;·&nbsp; {% endif -%}{{ tablolar.renkler | map: "ad" | join: ", " }}{%- endif -%}
{%- endcapture -%}
{%- assign kumas_html = "" -%}
{%- if ayar.sections.fabricHeader and kumas_satiri != "" -%}{%- capture kumas_html -%}<div class="ln ln-fabric"><b>{{ kumas_satiri }}</b></div>{%- endcapture -%}{%- endif -%}
<header>
<div class="hl">
${LOGO_ASSIGN}
${LOGO_LEFT}
<div class="company">{{ firma.ad }}</div>
${letterhead()}
{%- if ayar.sections.subcontractorInfo -%}<div class="sayin">SAYIN: <b>{{ karsi_taraf.ad }}</b></div>{%- endif -%}
{%- if ayar.sections.workOrderInfo -%}<div class="sub">{{ belge.istasyon }} · ${TERIM.terbiyeIsEmri.tekil} {{ belge.is_emri_no }}{%- if ayar.sections.accountNo and ${filled("karsi_taraf.kod")} %} · Hesap: {{ karsi_taraf.kod }}{% endif -%}</div>{%- endif -%}
{%- if ayar.placements.batchInfo == "left" -%}{{ parti_html }}{{ kumas_html }}{%- endif -%}
</div>
<div class="hr">
${LOGO_RIGHT}
<div class="title">{{ belge.baslik }}</div>
${COPY_BADGE}
<div class="ln ln-docno">İrsaliye No: <b>{{ belge.no }}</b></div>
<div class="ln ln-date">Tarih: <b>{{ belge.tarih | tarih }}</b></div>
{%- if ayar.placements.batchInfo != "left" -%}{{ parti_html }}{{ kumas_html }}{%- endif -%}
</div>
</header>
{%- if ayar.sections.vehicleInfo -%}{%- if ${filled("belge.plaka")} or ${filled("belge.sofor")} -%}
<div class="meta-row">
{%- if ${filled("belge.plaka")} -%}Plaka: <b>{{ belge.plaka }}</b>{%- endif -%}
{%- if ${filled("belge.plaka")} and ${filled("belge.sofor")} %} &nbsp;·&nbsp; {% endif -%}
{%- if ${filled("belge.sofor")} -%}Şoför: <b>{{ belge.sofor }}</b>{%- endif -%}
</div>
{%- endif -%}{%- endif -%}
{%- comment -%} Talimat kutusu: yalnız commands verisi taşıyan belgede; uyarı HAM veri boşluğuna bakar. {%- endcomment -%}
{%- assign islem_sayisi = tablolar.islemler | size -%}
{%- capture talimat_satirlari -%}
{%- if belge.komut_var and ayar.sections.dyeColorLine -%}{%- assign boya = belge.boyanacak_renk | strip -%}{%- if boya != "" -%}${cmdRow("BOYANACAK RENK", "{{ belge.boyanacak_renk }}")}{%- endif -%}{%- endif -%}
{%- if belge.komut_var and ayar.sections.productionProps and islem_sayisi > 0 -%}${cmdRow(
  "YAPILACAK İŞLEMLER",
  `{%- for islem in tablolar.islemler -%}{%- unless forloop.first %} &nbsp;·&nbsp; {% endunless -%}{{ islem.ad }}{%- if ${filled("islem.deger")} %}: {{ islem.deger }}{% endif -%}{%- endfor -%}`,
)}{%- endif -%}
{%- if belge.talimat_girilmemis and ayar.sections.instructionWarning -%}${cmdRow("TALİMAT", "GİRİLMEMİŞ — SEVK EDENE SORUNUZ")}{%- endif -%}
{%- endcapture -%}
{%- if talimat_satirlari != "" -%}<div class="cmd">{{ talimat_satirlari }}</div>{%- endif -%}
${BLANK_GRID_CAPTURE}
${blocksAt("afterHeader")}
{%- comment -%} Izgara: sayfalara bölünmüş hücreler sözleşmeden; sayfa/satır sınırı hücre bayrağıdır. {%- endcomment -%}
{%- for hucre in tablolar.izgara -%}
{%- if hucre.sayfa_basi -%}<table class="grid"><thead><tr>
{%- for g in (1..ayar.gridGroups) -%}<th class="c-top">Top</th><th class="c-met">Metre</th>{%- if ayar.sections.gridWidth -%}<th class="c-cm">Cm</th>{%- endif -%}{%- endfor -%}
</tr></thead><tbody>{%- endif -%}
{%- if hucre.satir_basi -%}<tr>{%- endif -%}
<td class="c-top">{{ hucre.top_no }}</td><td class="c-met">${metreDot("hucre.metre")}</td>{%- if ayar.sections.gridWidth -%}<td class="c-cm"></td>{%- endif -%}
{%- if hucre.satir_sonu -%}</tr>{%- endif -%}
{%- if hucre.sayfa_sonu -%}</tbody></table>{%- endif -%}
{%- endfor -%}
{%- assign kolonlar = ayar.kolonlar.ozet -%}
{%- assign kolon_sayisi = kolonlar | size -%}
{%- if kolon_sayisi > 0 -%}
<table class="totals"><thead><tr>
{%- for kolon in kolonlar -%}<th class="{{ kolon.hiza }}"{% if kolon.kaynak == "cins" %} style="width:38%"{% endif %}>{{ kolon.etiket }}</th>{%- endfor -%}
</tr></thead><tbody>
{%- for satir in tablolar.ozet -%}<tr>
{%- for kolon in kolonlar -%}<td class="{{ kolon.hiza }}{% if kolon.kaynak == "cins" %} cins{% endif %}">
{%- case kolon.kaynak -%}
{%- when "cins" -%}{{ satir.cins }}{%- if ayar.sections.requestedColor and ${filled("belge.renk")} %} · {{ belge.renk }}{% endif -%}
{%- when "en" -%}{%- if ayar.blankWidths == false and satir.en != nil -%}{{ satir.en | sayi: 0 }} cm{%- endif -%}
{%- when "top" -%}{{ satir.top_adedi }}
{%- when "metre" -%}${metreDot("satir.metre")}
{%- endcase -%}
</td>{%- endfor -%}
</tr>{%- endfor -%}
{%- assign toplamli = false -%}
{%- for kolon in kolonlar -%}{%- if kolon.toplam != nil -%}{%- assign toplamli = true -%}{%- endif -%}{%- endfor -%}
{%- if toplamli -%}
<tr class="tot">
{%- assign etiket_kondu = false -%}
{%- for kolon in kolonlar -%}
{%- capture icerik -%}{%- if kolon.toplam == "top_adedi" -%}{{ toplamlar.top_adedi }}{%- elsif kolon.toplam == "metre" -%}${metreDot("toplamlar.metre")}{%- endif -%}{%- endcapture -%}
<td class="{{ kolon.hiza }}">{%- if icerik != "" -%}{{ icerik }}{%- elsif etiket_kondu == false -%}TOPLAM{%- assign etiket_kondu = true -%}{%- endif -%}</td>
{%- endfor -%}
</tr>
{%- endif -%}
</tbody></table>
{%- endif -%}
{%- assign hedef_sayisi = tablolar.hedef_ozellikler | size -%}
{%- if ayar.sections.productionProps and belge.komut_var == false and hedef_sayisi > 0 -%}<div class="instr"><div class="instr-lbl">İSTENEN ÖZELLİKLER</div><div class="instr-txt">{{ tablolar.hedef_ozellikler | map: "ad" | join: ", " }}</div></div>{%- endif -%}
{%- assign talimat_kirpik = belge.talimat | strip -%}
{%- if ayar.sections.dyehouseNote and ${filled("belge.talimat")} and talimat_kirpik != "" -%}<div class="instr"><div class="instr-lbl">FASON TALİMATI</div><div class="instr-txt">{{ belge.talimat }}</div></div>{%- endif -%}
{%- assign not_var = false -%}
{%- if ${filled("belge.notlar")} -%}{%- assign not_var = true -%}{%- endif -%}
{%- if ayar.sections.notes -%}{%- if not_var or ayar.footerNote != "" -%}<div class="note">{{ belge.notlar }}{% if not_var and ayar.footerNote != "" %} — {% endif %}{{ ayar.footerNote }}</div>{%- endif -%}{%- endif -%}
${blocksAt("beforeSignatures")}
${PRINT_NOTE}
${SIGNATURES}
${STAMPS}
</div>`;

export const subcontractorDispatchSystem: SystemEquivalent = {
  docType: "SUBCONTRACTOR_DISPATCH",
  editMode: "CODE",
  html,
  css,
  pageSettings: (settings) => pageSettingsFor(settings, marginOf(settings)),
  tableBindings: {},
  variants,
};
