// =============================================================================
// INVOICE_INTERNAL (Fatura) — Sistem renderer'ının Liquid eşleniği
// =============================================================================
// KOD KİPİ (T6 kalıbı, D8). Tutarlar `para` filtresiyle (`fmtMoney` eşi) basılır; toplamlar
// sözleşmeden donmuş gelir. Tevkifat satırı yalnız sıfırdan büyükse, TL karşılığı yalnız
// dövizli faturada basılır. İskelet `_ortak/finans.ts` → `_ortak/musteri.ts`.
// =============================================================================

import { CREATED_BY_ROW, PARTY_NAME_ROW, financeCss, financeDocBody, partyRow, qtyOrDash } from "./_ortak/finans";
import { dynamicTable, filled } from "./_ortak/musteri";
import { TINY_PNG, pageSettingsFor } from "./subcontractor-fragments";
import type { EquivalenceVariant, SystemEquivalent } from "./tipler";

const variants: EquivalenceVariant[] = [
  {
    name: "kolon_gizle_sira_baslik",
    config: {
      columns: {
        lineTable: { hidden: ["discountRate"], order: ["lineNet", "description", "vatRate", "qty", "unitPrice"], labels: { description: "Mal/Hizmet 'adı' <&>" }, blankLabels: ["vatRate"] },
      },
    },
  },
  {
    name: "bolum_kapali_imza_yasal_blok",
    config: {
      sections: { dueDate: false, externalNo: false, createdBy: false, documentNo: false },
      signatureLabels: ["Düzenleyen", "Kontrol Eden", "Onaylayan"],
      blocks: [
        { position: "afterHeader", text: "Bu belge iç kullanım içindir; resmî fatura yerine geçmez." },
        { position: "beforeSignatures", text: "6563 sayılı Kanun gereği saklanır.\nİkinci satır" },
      ],
      footerNote: "Muhasebe dosyasına.",
      titleOverride: "fatura dökümü",
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
    name: "tablo_toplam_kapali_tarih_yok",
    config: {
      sections: { lineTable: false, totals: false, date: false },
      style: { tableStyle: "plain", tableDensity: "relaxed", fontWeight: "light" },
    },
  },
  {
    name: "toplamsiz_kolonlar_damga_grid_logo",
    config: {
      columns: { lineTable: { hidden: ["lineNet"] } },
      qr: true,
      showLogo: true,
      logoPosition: "right",
      stamps: { printedAt: true, printedBy: true, copyLabel: "  MUHASEBE NÜSHASI  " },
      blankGrid: { enabled: true, title: "ONAY", rows: 2, columns: 3, headers: ["Birim", "Ad", "İmza"], position: "afterHeader" },
    },
    print: { logo: TINY_PNG, qr: TINY_PNG, zaman: "2026-09-25T09:00:00.000Z", basan: "muhasebe", not: "Tek seferlik not" },
  },
];

const LINE_CELLS = String.raw`{%- when "description" -%}{{ satir.aciklama }}
{%- when "qty" -%}${qtyOrDash("satir.miktar")} {{ satir.birim }}
{%- when "unitPrice" -%}{{ satir.birim_fiyat | para }}
{%- when "discountRate" -%}${qtyOrDash("satir.iskonto")}
{%- when "vatRate" -%}${qtyOrDash("satir.kdv_orani")}
{%- when "lineNet" -%}{{ satir.tutar | para }}`;

const TOTALS = String.raw`{%- if ayar.sections.totals -%}<div class="tot">
<div class="row"><span>Ara Toplam</span><b>{{ toplamlar.ara_toplam | para }} {{ belge.para_birimi }}</b></div>
<div class="row"><span>KDV</span><b>{{ toplamlar.kdv | para }} {{ belge.para_birimi }}</b></div>
{%- if toplamlar.tevkifat_var -%}<div class="row"><span>Tevkifat (−)</span><b>{{ toplamlar.tevkifat | para }} {{ belge.para_birimi }}</b></div>{%- endif -%}
<div class="row grand"><span>GENEL TOPLAM</span><b>{{ toplamlar.genel | para }} {{ belge.para_birimi }}</b></div>
{%- if belge.para_birimi != "TRY" and ${filled("toplamlar.genel_tl")} -%}<div class="row try"><span>TL Karşılığı (kur ${qtyOrDash("belge.kur")})</span><b>{{ toplamlar.genel_tl | para: "TRY" }}</b></div>{%- endif -%}
</div>{%- endif -%}`;

const html = financeDocBody({
  headLines: String.raw`{%- if ayar.sections.dueDate and ${filled("belge.vade")} -%}<div class="ln">Vade: <b>{{ belge.vade | takvim }}</b></div>{%- endif -%}
{%- if ayar.sections.externalNo and ${filled("belge.dis_belge_no")} -%}<div class="ln">Belge/İrsaliye No: <b>{{ belge.dis_belge_no }}</b></div>{%- endif -%}`,
  party: String.raw`${PARTY_NAME_ROW}
{%- if ${filled("karsi_taraf.vergi_bilgisi")} -%}${partyRow("Vergi", "{{ karsi_taraf.vergi_bilgisi }}")}{%- endif -%}
${partyRow("Para Birimi", "{{ belge.para_birimi }}")}
${CREATED_BY_ROW}`,
  table: String.raw`{%- if ayar.sections.lineTable -%}
${dynamicTable({
  rows: "tablolar.kalemler",
  cols: "kalemler",
  caption: "FATURA KALEMLERİ",
  widths: [["qty", "80px"], ["unitPrice", "90px"], ["discountRate", "55px"], ["vatRate", "55px"], ["lineNet", "100px"]],
  cells: LINE_CELLS,
  foot: { label: "TOPLAM ({{ toplamlar.kalem_adedi }} kalem)", cells: String.raw`{%- when "lineNet" -%}{{ toplamlar.ara_toplam | para }}` },
})}
{%- endif -%}`,
  totals: TOTALS,
});

export const invoiceInternalSystem: SystemEquivalent = {
  docType: "INVOICE_INTERNAL",
  editMode: "CODE",
  html,
  css: (settings) => financeCss(settings, "fatura", false),
  pageSettings: (settings) => pageSettingsFor(settings, 9),
  tableBindings: {},
  variants,
};
