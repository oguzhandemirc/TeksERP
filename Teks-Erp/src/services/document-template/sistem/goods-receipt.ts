// =============================================================================
// GOODS_RECEIPT (Mal Kabul Fişi) — Sistem renderer'ının Liquid eşleniği
// =============================================================================
// KOD KİPİ (T6 kalıbı, D8): kolon sırası/başlığı ayardan dinamik, "ürün · renk" ve "ad (kod)"
// birleşimleri koşullu; iplik tablosu yalnız iplik satırı varken. Gövde `_ortak/depo.ts`ten. Eşitlik: test_belge_sistem_esdegeri.
// =============================================================================

import { TINY_PNG } from "./subcontractor-fragments";
import { ROLL_CELLS, ROLL_WIDTHS, columnTable, nameWithCode, warehouseBody, warehouseCss, warehousePageSettings } from "./_ortak/depo";
import type { EquivalenceVariant, SystemEquivalent } from "./tipler";

const variants: EquivalenceVariant[] = [
  {
    name: "kolon_gizle_sira_baslik",
    config: {
      columns: {
        rollTable: { hidden: ["barcode"], order: ["width", "qty"], labels: { itemColor: "Kumaş <&> 'cins'", qty: "  " }, blankLabels: ["width"] },
      },
    },
  },
  {
    name: "bolum_kapali_imza_dipnot",
    config: {
      sections: { deliveryNote: false, createdBy: false, date: false },
      signatureLabels: ["Tedarikçi", "Depo", "Kalite", "Muhasebe"],
      footerNote: "Mal sayılarak teslim alındı.",
      titleOverride: "giriş fişi",
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
      stamps: { printedAt: true, printedBy: true, copyLabel: "TEDARİKÇİ NÜSHASI" },
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

const html = warehouseBody({
  headerLines: String.raw`{%- if ayar.sections.deliveryNote and belge.tedarikci_irsaliye_no != nil and belge.tedarikci_irsaliye_no != "" -%}<div class="ln">Tedarikçi İrsaliyesi: <b>{{ belge.tedarikci_irsaliye_no }}</b></div>{%- endif -%}`,
  partyLines: String.raw`{%- if karsi_taraf.ad != nil and karsi_taraf.ad != "" -%}<div class="row"><span>Tedarikçi:</span><b>${nameWithCode("karsi_taraf.ad", "karsi_taraf.kod")}</b></div>{%- endif -%}
<div class="row"><span>Giren Depo:</span><b>${nameWithCode("belge.depo", "belge.depo_kod")}</b></div>
{%- if ayar.sections.createdBy and belge.teslim_alan != nil and belge.teslim_alan != "" -%}<div class="row"><span>Teslim Alan:</span><b>{{ belge.teslim_alan }}</b></div>{%- endif -%}`,
  tables: String.raw`{%- if ayar.sections.rollTable -%}
${columnTable({ caption: "KABUL EDİLEN TOPLAR", widths: ROLL_WIDTHS, cells: ROLL_CELLS, footLabel: "TOPLAM ({{ toplamlar.top_adedi }} top)" })}
{%- endif -%}
{%- if toplamlar.iplik_kalem > 0 -%}
<table class="sec"><thead><tr><th class="caption" colspan="2">KABUL EDİLEN İPLİK (kg)</th></tr><tr><th class="l">İPLİK</th><th class="r" style="width:90px">KG</th></tr></thead><tbody>
{%- for satir in tablolar.iplik -%}<tr><td class="l">{{ satir.ad }}</td><td class="r">{{ satir.kg | sayi: 2 }}</td></tr>{%- endfor -%}
<tr class="tot"><td class="l">TOPLAM ({{ toplamlar.iplik_kalem }} kalem)</td><td class="r">{{ toplamlar.iplik_kg | sayi: 2 }}</td></tr>
</tbody></table>
{%- endif -%}`,
});

export const goodsReceiptSystem: SystemEquivalent = {
  docType: "GOODS_RECEIPT",
  editMode: "CODE",
  html,
  css: (settings) => warehouseCss(settings, "malKabul"),
  pageSettings: warehousePageSettings,
  tableBindings: {},
  variants,
};
