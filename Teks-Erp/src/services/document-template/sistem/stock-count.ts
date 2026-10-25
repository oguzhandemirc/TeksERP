// =============================================================================
// STOCK_COUNT (Stok Sayım Tutanağı) — Sistem renderer'ının Liquid eşleniği
// =============================================================================
// KOD KİPİ (T6 kalıbı, D8): dinamik kolonlar + durum etiketinin zaman kipi (`belge.kesinlesti`)
// + koşullu ekler. Gövde `_ortak/depo.ts`ten; fark özeti sayaçları sözleşmeden. Eşitlik: test_belge_sistem_esdegeri.
// =============================================================================

import { TINY_PNG } from "./subcontractor-fragments";
import { columnTable, nameWithCode, warehouseBody, warehouseCss, warehousePageSettings } from "./_ortak/depo";
import type { EquivalenceVariant, SystemEquivalent } from "./tipler";

const variants: EquivalenceVariant[] = [
  {
    name: "kolon_gizle_sira_baslik",
    config: {
      columns: {
        rollTable: { hidden: ["countedQty"], order: ["state", "expectedQty", "barcode"], labels: { state: "Sonuç <&> 'durum'" }, blankLabels: ["barcode"] },
      },
    },
  },
  {
    name: "bolum_kapali_imza_dipnot",
    config: {
      sections: { countStatus: false, createdBy: false, countSummary: false },
      signatureLabels: ["Sayım Ekibi", "Depo Şefi"],
      footerNote: "Fark fişi muhasebeye iletildi.",
      titleOverride: "sayım fişi",
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
      sections: { rollTable: false, yarnTable: false, documentNo: false },
      style: { tableStyle: "plain", tableDensity: "relaxed", fontWeight: "light" },
    },
  },
  {
    name: "toplamsiz_kolonlar_damga_blok_grid_logo",
    config: {
      columns: { rollTable: { hidden: ["expectedQty"] } },
      qr: true,
      showLogo: true,
      logoPosition: "right",
      stamps: { printedAt: true, printedBy: true, copyLabel: "MUHASEBE NÜSHASI" },
      blocks: [
        { position: "afterHeader", text: "Üst blok\nikinci satır" },
        { position: "beforeSignatures", text: "Alt blok <b>" },
        { position: "beforeSignatures", text: "   " },
      ],
      blankGrid: { enabled: true, title: "EKSİK TOP", rows: 2, columns: 3, headers: ["Barkod", "Metre", "Not"], position: "afterHeader" },
    },
    print: { logo: TINY_PNG, qr: TINY_PNG, zaman: "2026-09-25T09:00:00.000Z", basan: "operatör", not: "Tek seferlik not" },
  },
];

const ROLL_CELLS = String.raw`{%- when "barcode" -%}{%- if satir.barkod == nil -%}—{%- else -%}{{ satir.barkod }}{%- endif -%}
{%- when "itemColor" -%}{{ satir.urun }}{%- if satir.renk != nil and satir.renk != "" %} · {{ satir.renk }}{% endif -%}
{%- when "expectedQty" -%}{{ satir.beklenen | sayi: 2 }}
{%- when "countedQty" -%}{%- if satir.sayilan == nil -%}—{%- else -%}{{ satir.sayilan | sayi: 2 }}{%- endif -%}
{%- when "state" -%}
{%- case satir.durum -%}
{%- when "FOUND" -%}BULUNDU
{%- when "MISSING" -%}{%- if belge.kesinlesti -%}EKSİK — KAYITTAN DÜŞÜLDÜ{%- else -%}EKSİK (işaretlendi){%- endif -%}
{%- when "UNCOUNTED" -%}SAYILMADI
{%- when "OUT_OF_SCOPE" -%}KAPSAM DIŞI
{%- endcase -%}
{%- if satir.kapsam_disi_nedeni != nil and satir.kapsam_disi_nedeni != "" %} ({{ satir.kapsam_disi_nedeni }}){% endif -%}
{%- if satir.dusulen != nil and satir.dusulen != satir.beklenen %} · düşülen {{ satir.dusulen | sayi: 2 }}{% endif -%}
{%- if satir.notlar != nil and satir.notlar != "" %} · {{ satir.notlar }}{% endif -%}`;

const YARN_TABLE = String.raw`<table class="sec"><thead><tr><th class="caption" colspan="5">SAYIM LİSTESİ — İPLİK (kg)</th></tr><tr><th class="l">İPLİK</th><th class="r" style="width:80px">BEKLENEN</th><th class="r" style="width:80px">SAYILAN</th><th class="r" style="width:80px">FARK</th><th class="l" style="width:150px">DURUM</th></tr></thead><tbody>
{%- for satir in tablolar.iplik -%}<tr><td class="l">{{ satir.ad }}</td><td class="r">{{ satir.beklenen_kg | sayi: 2 }}</td>
<td class="r">{%- if satir.sayilan_kg == nil -%}—{%- else -%}{{ satir.sayilan_kg | sayi: 2 }}{%- endif -%}</td>
<td class="r">{%- if satir.fark_kg == nil -%}—{%- else -%}{{ satir.fark_kg | sayi: 2 }}{%- endif -%}</td>
<td class="l">
{%- case satir.durum -%}
{%- when "APPLIED" -%}{%- if belge.kesinlesti -%}FARK UYGULANDI{%- else -%}FARK VAR (uygulanmadı){%- endif -%}
{%- when "MATCH" -%}TUTTU
{%- when "UNCOUNTED" -%}SAYILMADI
{%- when "OUT_OF_SCOPE" -%}KAPSAM DIŞI
{%- endcase -%}
{%- if satir.kapsam_disi_nedeni != nil and satir.kapsam_disi_nedeni != "" %} ({{ satir.kapsam_disi_nedeni }}){% endif -%}
</td></tr>{%- endfor -%}
<tr class="tot"><td class="l">TOPLAM ({{ toplamlar.iplik_kalem }} kalem)</td><td class="r"></td><td class="r"></td><td class="r">{{ toplamlar.iplik_fark_kg | sayi: 2 }}</td><td class="l"></td></tr>
</tbody></table>`;

/** Fark özeti — yalnız mevcut sınıflar (`box`/`row`); sayaçlar snapshot'tan. */
const SUMMARY_BOX = String.raw`<div class="box"><div class="row"><span>FARK ÖZETİ</span><b>{{ belge.no }}</b></div>
<div class="row"><span>Sayılan top (bulundu):</span><b>{{ toplamlar.bulunan_top }} / {{ toplamlar.sayim_top_toplam }}</b></div>
<div class="row"><span>{% if belge.kesinlesti %}Eksik (kayıttan düşülen){% else %}Eksik (işaretlenen){% endif %}:</span><b>{{ toplamlar.eksik_top }} top · {{ toplamlar.eksik_metre | sayi: 2 }} m</b></div>
<div class="row"><span>Sayılmayan satır:</span><b>{{ toplamlar.sayilmayan_top }} top</b></div>
<div class="row"><span>Kapsam dışı:</span><b>{{ toplamlar.kapsam_disi_top }} top · {{ toplamlar.kapsam_disi_iplik }} iplik kalemi</b></div>
<div class="row"><span>Beklenen toplam metraj:</span><b>{{ toplamlar.ozet_beklenen_metre | sayi: 2 }} m</b></div>
<div class="row"><span>İplik farkı (net):</span><b>{{ toplamlar.iplik_fark_kg | sayi: 2 }} kg · {{ toplamlar.uygulanan_iplik }} / {{ toplamlar.sayim_iplik_toplam }} kalem uygulandı</b></div></div>`;

const html = warehouseBody({
  headerLines: String.raw`{%- if ayar.sections.countStatus -%}<div class="ln">Durum: <b>{{ belge.sayim_durumu }}</b></div>{%- endif -%}`,
  partyLines: String.raw`<div class="row"><span>Sayılan Depo:</span><b>${nameWithCode("belge.depo", "belge.depo_kod")}</b></div>
{%- if ayar.sections.createdBy and belge.acan != nil and belge.acan != "" -%}<div class="row"><span>Sayımı Açan:</span><b>{{ belge.acan }}</b></div>{%- endif -%}
{%- if ayar.sections.createdBy and belge.tamamlayan != nil and belge.tamamlayan != "" -%}<div class="row"><span>Tamamlayan:</span><b>{{ belge.tamamlayan }}</b></div>{%- endif -%}`,
  tables: String.raw`{%- if ayar.sections.rollTable and toplamlar.top_adedi > 0 -%}
${columnTable({
  caption: "SAYIM LİSTESİ — TOPLAR",
  widths: { expectedQty: "80px", countedQty: "80px", state: "150px" },
  cells: ROLL_CELLS,
  footLabel: "TOPLAM ({{ toplamlar.top_adedi }} top)",
})}
{%- endif -%}
{%- if ayar.sections.yarnTable and toplamlar.iplik_kalem > 0 -%}${YARN_TABLE}{%- endif -%}
{%- if ayar.sections.countSummary and toplamlar.ozet_var -%}${SUMMARY_BOX}{%- endif -%}`,
});

export const stockCountSystem: SystemEquivalent = {
  docType: "STOCK_COUNT",
  editMode: "CODE",
  html,
  css: (settings) => warehouseCss(settings, "stokSayimi"),
  pageSettings: warehousePageSettings,
  tableBindings: {},
  variants,
};
