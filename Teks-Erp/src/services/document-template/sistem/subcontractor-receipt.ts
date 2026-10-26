// =============================================================================
// SUBCONTRACTOR_RECEIPT (Fason Kabul Makbuzu) — Sistem renderer'ının Liquid eşleniği
// =============================================================================
// KOD KİPİ (T6 kalıbı, D8): kolon sırası/başlığı ayardan dinamik, "ürün · renk" birleşimi
// ve kutu satırlarının koşullu birleşimi `assign`/`capture` ister — data-* dilbilgisi taşımaz.
// Eşitlik: test_belge_sistem_esdegeri.
// =============================================================================

import { TERIM } from "../../../constants/terim";
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
  chromeDocCss,
  letterhead,
  pageSettingsFor,
} from "./subcontractor-fragments";
import type { EquivalenceVariant, SystemEquivalent } from "./tipler";

const variants: EquivalenceVariant[] = [
  {
    name: "kolon_gizle_sira_baslik",
    config: {
      columns: {
        rollTable: { hidden: ["width"], order: ["itemColor", "seq", "barcode"], labels: { barcode: "Barkod 'no' <&>" }, blankLabels: ["seq"] },
      },
    },
  },
  {
    name: "bolum_kapali_imza_dipnot",
    config: {
      sections: { taxNo: false, receiptNo: false, appliedInfo: false, batchInfo: false },
      signatureLabels: ["Boyahane", "Depo", "Kalite"],
      footerNote: "Toplar sayılarak teslim alındı.",
      titleOverride: "kabul fişi",
    },
  },
  {
    name: "a5_olcek_alan",
    config: {
      style: { pageSize: "A5", fontScale: 0.85, tableStyle: "zebra", tableDensity: "compact", fontWeight: "bold", margins: { top: 5, left: 12 } },
      fields: { tblCap: { size: 13, weight: "black" }, boxRow: { size: 9 } },
      showSignatures: false,
      showLetterhead: false,
    },
  },
  {
    name: "liste_ve_kutular_kapali",
    config: {
      sections: { rollTable: false, subcontractorInfo: false, appliedInfo: false, notes: false, date: false },
      columns: { rollTable: { hidden: ["seq", "barcode", "itemColor", "width"] } },
      style: { tableStyle: "plain", tableDensity: "relaxed", fontWeight: "light" },
    },
  },
  {
    name: "tum_kolon_gizli_damga_blok_grid_logo",
    config: {
      columns: { rollTable: { hidden: ["seq", "barcode", "itemColor", "width"] } },
      qr: true,
      showLogo: true,
      logoPosition: "right",
      stamps: { printedAt: true, printedBy: true, copyLabel: "  FASON NÜSHASI  " },
      blocks: [
        { position: "afterHeader", text: "Üst blok\nikinci satır" },
        { position: "beforeSignatures", text: "Alt blok <b>" },
        { position: "beforeSignatures", text: "   " },
      ],
      blankGrid: { enabled: true, title: "EKSİK TOP", rows: 2, columns: 3, headers: ["Barkod", "Metre", "Not"], position: "beforeSignatures" },
    },
    print: { logo: TINY_PNG, qr: TINY_PNG, zaman: "2026-09-25T09:00:00.000Z", basan: "operatör", not: "Tek seferlik not" },
  },
];

const html = String.raw`<div class="sheet">
<header>
<div class="hl">
${LOGO_ASSIGN}
${LOGO_LEFT}
<div class="company">{{ firma.ad }}</div>
${letterhead("ayar.sections.taxNo")}
</div>
<div class="hr">
${LOGO_RIGHT}
<div class="title">{{ belge.baslik }}</div>
${COPY_BADGE}
{%- if ayar.sections.receiptNo -%}<div class="ln">Makbuz No: <b>{{ belge.no }}</b></div>{%- endif -%}
{%- if ayar.sections.date -%}<div class="ln">Tarih: <b>{{ belge.tarih | tarih }}</b></div>{%- endif -%}
</div>
</header>
${BLANK_GRID_CAPTURE}
${blocksAt("afterHeader")}
{%- assign kutu_fason = "" -%}
{%- if ayar.sections.subcontractorInfo -%}
{%- assign parti_sayisi = tablolar.parti | size -%}
{%- capture kutu_fason -%}<div class="box"><div class="box-t">FASON FİRMA</div>
<div class="row"><span>Adı:</span><b>{{ karsi_taraf.ad }}</b></div>
{%- if karsi_taraf.kod != nil and karsi_taraf.kod != "" -%}<div class="row"><span>Kod:</span><b>{{ karsi_taraf.kod }}</b></div>{%- endif -%}
<div class="row"><span>${TERIM.terbiyeIsEmri.tekil}:</span><b>{{ belge.is_emri_no }}</b></div>
{%- if ayar.sections.batchInfo and parti_sayisi > 0 -%}<div class="row"><span>Parti:</span><b>{{ tablolar.parti | map: "no" | join: ", " }}</b></div>{%- endif -%}
<div class="row"><span>İşlem:</span><b>{{ belge.islem }}</b></div>
{%- if toplamlar.donen_metre != nil -%}<div class="row"><span>Dönen Metre:</span><b>{{ toplamlar.donen_metre | sayi: 2 }}</b></div>{%- endif -%}
{%- if belge.fason_irsaliye_no != nil and belge.fason_irsaliye_no != "" -%}<div class="row"><span>Fason İrs.:</span><b>{{ belge.fason_irsaliye_no }}</b></div>{%- endif -%}
</div>{%- endcapture -%}
{%- endif -%}
{%- assign kutu_uygulanan = "" -%}
{%- assign ozellik_sayisi = tablolar.ozellik | size -%}
{%- assign renk_var = false -%}
{%- if belge.uygulanan_renk != nil and belge.uygulanan_renk != "" -%}{%- assign renk_var = true -%}{%- endif -%}
{%- if ayar.sections.appliedInfo -%}{%- if renk_var or ozellik_sayisi > 0 -%}
{%- capture kutu_uygulanan -%}<div class="box"><div class="box-t">UYGULANAN</div>
{%- if renk_var -%}<div class="row"><span>Renk:</span><b>{{ belge.uygulanan_renk }}</b></div>{%- endif -%}
{%- if ozellik_sayisi > 0 -%}<div class="row"><span>Özellik:</span><b>{{ tablolar.ozellik | map: "ad" | join: ", " }}</b></div>{%- endif -%}
</div>{%- endcapture -%}
{%- endif -%}{%- endif -%}
{%- if kutu_fason != "" or kutu_uygulanan != "" -%}<div class="info">{{ kutu_fason }}{{ kutu_uygulanan }}</div>{%- endif -%}
{%- if ayar.sections.rollTable -%}
<div class="tbl-cap">Kabul Edilen Toplar ({{ toplamlar.top_adedi }})</div>
{%- assign kolonlar = ayar.kolonlar.toplar -%}
{%- assign kolon_sayisi = kolonlar | size -%}
{%- if kolon_sayisi > 0 -%}
<table class="sec"><thead><tr>
{%- for kolon in kolonlar -%}<th class="{{ kolon.hiza }}"{% case kolon.kaynak %}{% when "seq" %} style="width:34px"{% when "width" %} style="width:70px"{% when "qty" %} style="width:80px"{% endcase %}>{{ kolon.etiket }}</th>{%- endfor -%}
</tr></thead><tbody>
{%- for satir in tablolar.toplar -%}<tr>
{%- for kolon in kolonlar -%}<td class="{{ kolon.hiza }}{% if kolon.kaynak == "barcode" %} mono{% endif %}">
{%- case kolon.kaynak -%}
{%- when "seq" -%}{{ satir.sira }}
{%- when "barcode" -%}{%- if satir.barkod == nil -%}—{%- else -%}{{ satir.barkod }}{%- endif -%}
{%- when "itemColor" -%}{{ satir.urun }}{%- if satir.renk != nil and satir.renk != "" %} · {{ satir.renk }}{% endif -%}
{%- when "width" -%}{%- if satir.en == nil -%}—{%- else -%}{{ satir.en | sayi: 0 }} cm{%- endif -%}
{%- when "qty" -%}{%- if satir.metre == nil -%}—{%- else -%}{{ satir.metre | sayi: 2 }}{%- endif -%}
{%- endcase -%}
</td>{%- endfor -%}
</tr>{%- endfor -%}
{%- assign toplam_var = false -%}
{%- for kolon in kolonlar -%}{%- if kolon.toplam != nil -%}{%- assign toplam_var = true -%}{%- endif -%}{%- endfor -%}
{%- if toplam_var and toplamlar.top_adedi > 1 -%}
{%- assign etiket_kondu = false -%}
<tr class="tot">{%- for kolon in kolonlar -%}<td class="{{ kolon.hiza }}">
{%- if kolon.toplam != nil -%}{{ toplamlar.metre | sayi: 2 }}
{%- elsif etiket_kondu == false -%}TOPLAM{%- assign etiket_kondu = true -%}{%- endif -%}
</td>{%- endfor -%}</tr>
{%- endif -%}
</tbody></table>
{%- endif -%}
{%- endif -%}
{%- assign not_var = false -%}
{%- if belge.notlar != nil and belge.notlar != "" -%}{%- assign not_var = true -%}{%- endif -%}
{%- if ayar.sections.notes -%}{%- if not_var or ayar.footerNote != "" -%}<div class="note">{{ belge.notlar }}{% if not_var and ayar.footerNote != "" %} — {% endif %}{{ ayar.footerNote }}</div>{%- endif -%}{%- endif -%}
${blocksAt("beforeSignatures")}
${PRINT_NOTE}
${SIGNATURES}
${STAMPS}
</div>`;

export const subcontractorReceiptSystem: SystemEquivalent = {
  docType: "SUBCONTRACTOR_RECEIPT",
  editMode: "CODE",
  html,
  css: (settings) => chromeDocCss(settings, 64, "fasonKabul"),
  pageSettings: (settings) => pageSettingsFor(settings, 9),
  tableBindings: {},
  variants,
};
