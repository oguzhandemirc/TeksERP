// =============================================================================
// TRANSFER_DISPATCH (Depo Transfer İrsaliyesi) — Sistem renderer'ının Liquid eşleniği
// =============================================================================
// KOD KİPİ (T6 kalıbı, D8): kolon sırası/başlığı ayardan dinamik, "ürün · renk" ve "ad (kod)"
// birleşimleri koşullu. Gövde `_ortak/depo.ts`ten. Eşitlik: test_belge_sistem_esdegeri.
// =============================================================================

import { TINY_PNG } from "./subcontractor-fragments";
import { ROLL_CELLS, ROLL_WIDTHS, columnTable, nameWithCode, warehouseBody, warehouseCss, warehousePageSettings } from "./_ortak/depo";
import type { EquivalenceVariant, SystemEquivalent } from "./tipler";

const variants: EquivalenceVariant[] = [
  {
    name: "kolon_gizle_sira_baslik",
    config: {
      columns: {
        rollTable: { hidden: ["width"], order: ["qty", "itemColor", "barcode"], labels: { barcode: "Barkod 'no' <&>" }, blankLabels: ["itemColor"] },
      },
    },
  },
  {
    name: "bolum_kapali_imza_dipnot",
    config: {
      sections: { documentNo: false, createdBy: false },
      signatureLabels: ["Depo Sorumlusu", "Şoför", "Şube"],
      footerNote: "Toplar sayılarak teslim edildi.",
      titleOverride: "transfer fişi",
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
      stamps: { printedAt: true, printedBy: true, copyLabel: "  DEPO NÜSHASI  " },
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

const html = warehouseBody({
  headerLines: "",
  partyLines: String.raw`<div class="row"><span>Çıkan Depo:</span><b>${nameWithCode("belge.cikan_depo", "belge.cikan_depo_kod")}</b></div>
<div class="row"><span>Giren Depo:</span><b>${nameWithCode("belge.giren_depo", "belge.giren_depo_kod")}</b></div>
{%- if ayar.sections.createdBy and belge.duzenleyen != nil and belge.duzenleyen != "" -%}<div class="row"><span>Düzenleyen:</span><b>{{ belge.duzenleyen }}</b></div>{%- endif -%}`,
  tables: String.raw`{%- if ayar.sections.rollTable -%}
${columnTable({ caption: "TAŞINAN TOPLAR", widths: ROLL_WIDTHS, cells: ROLL_CELLS, footLabel: "TOPLAM ({{ toplamlar.top_adedi }} top)" })}
{%- endif -%}`,
});

export const transferDispatchSystem: SystemEquivalent = {
  docType: "TRANSFER_DISPATCH",
  editMode: "CODE",
  html,
  css: (settings) => warehouseCss(settings, "depoTransfer"),
  pageSettings: warehousePageSettings,
  tableBindings: {},
  variants,
};
