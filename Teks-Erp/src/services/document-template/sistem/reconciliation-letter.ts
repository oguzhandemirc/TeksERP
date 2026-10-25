// =============================================================================
// RECONCILIATION_LETTER (Cari Mutabakat Mektubu) — Sistem renderer'ının Liquid eşleniği
// =============================================================================
// KOD KİPİ (T6 kalıbı, D8). Beyan (rica) cümlesi belgenin kendisidir — metin AYNEN, bölümle
// kapanır. Toplam satırı YOK (para birimleri toplanmaz); bakiyesiz caride açık ifade kutusu.
// İskelet `_ortak/finans.ts` → `_ortak/musteri.ts`.
// =============================================================================

import { CREATED_BY_ROW, PARTY_NAME_ROW, dateOrDash, financeCss, financeDocBody, partyRow } from "./_ortak/finans";
import { dynamicTable, filled } from "./_ortak/musteri";
import { TINY_PNG, pageSettingsFor } from "./subcontractor-fragments";
import type { EquivalenceVariant, SystemEquivalent } from "./tipler";

const variants: EquivalenceVariant[] = [
  {
    name: "kolon_gizle_sira_baslik",
    config: {
      columns: { balanceTable: { hidden: ["debit", "credit"], order: ["side", "balance", "currency"], labels: { side: "B/A 'durum' <&>" }, blankLabels: ["currency"] } },
    },
  },
  {
    name: "bolum_kapali_imza_yasal_blok",
    config: {
      sections: { asOf: false, createdBy: false, declaration: false },
      signatureLabels: ["Muhasebe Müdürü", "Cari Yetkilisi — Kaşe / İmza"],
      blocks: [
        { position: "afterHeader", text: "TTK md. 64 uyarınca defter kayıtlarımıza dayanır." },
        { position: "beforeSignatures", text: "15 gün içinde yanıt verilmezse mutabık sayılırsınız." },
      ],
      footerNote: "Yanıtınızı muhasebe@ adresine iletiniz.",
      titleOverride: "mutabakat",
    },
  },
  {
    name: "a5_olcek_alan",
    config: {
      style: { pageSize: "A5", fontScale: 0.85, tableStyle: "zebra", tableDensity: "compact", fontWeight: "bold", margins: { top: 5, left: 12 } },
      fields: { secCaption: { size: 13, weight: "black" }, boxRow: { size: 9 }, decl: { size: 10 } },
      showSignatures: false,
      showLetterhead: false,
    },
  },
  {
    name: "tablo_kapali_tarih_yok",
    config: { sections: { balanceTable: false, date: false, documentNo: false }, style: { tableStyle: "plain", tableDensity: "relaxed", fontWeight: "light" } },
  },
  {
    name: "damga_grid_logo",
    config: {
      qr: true,
      showLogo: true,
      stamps: { printedAt: true, printedBy: true, copyLabel: "  CARİ NÜSHASI  " },
      blankGrid: { enabled: true, title: "FARK AÇIKLAMASI", rows: 3, columns: 2, headers: ["Para", "Açıklama"], position: "beforeSignatures" },
    },
    print: { logo: TINY_PNG, qr: TINY_PNG, zaman: "2026-09-25T09:00:00.000Z", basan: "muhasebe", not: "Tek seferlik not" },
  },
];

const BALANCE_CELLS = String.raw`{%- when "currency" -%}{{ satir.para_birimi }}
{%- when "debit" -%}{{ satir.borc | para }}
{%- when "credit" -%}{{ satir.alacak | para }}
{%- when "balance" -%}{{ satir.bakiye_mutlak | para }}
{%- when "side" -%}{{ satir.durum }}`;

const DECLARATION = String.raw`${dateOrDash("belge.bakiye_tarihi")} tarihi itibarıyla defterlerimizde görünen yukarıdaki bakiyeler için mutabakatınızı rica ederiz. Mutabık iseniz belgeyi kaşeleyip imzalayarak tarafımıza iade etmenizi, mutabık değilseniz farkın gerekçesini bildirmenizi rica ederiz.
BORÇ bakiyesi tarafınızın firmamıza, ALACAK bakiyesi firmamızın tarafınıza olan borcunu ifade eder.`;

const html = financeDocBody({
  headLines: String.raw`{%- if ayar.sections.asOf -%}<div class="ln">Bakiye Tarihi: <b>${dateOrDash("belge.bakiye_tarihi")}</b></div>{%- endif -%}`,
  party: String.raw`${PARTY_NAME_ROW}
{%- if ${filled("karsi_taraf.vergi_bilgisi")} -%}${partyRow("Vergi", "{{ karsi_taraf.vergi_bilgisi }}")}{%- endif -%}
${CREATED_BY_ROW}`,
  table: String.raw`{%- if ayar.sections.balanceTable -%}
${dynamicTable({
  rows: "tablolar.bakiyeler",
  cols: "bakiyeler",
  caption: "BAKİYE DÖKÜMÜ",
  widths: [["currency", "60px"], ["debit", "110px"], ["credit", "110px"], ["balance", "110px"], ["side", "90px"]],
  cells: BALANCE_CELLS,
})}
{%- endif -%}`,
  totals: String.raw`{%- if toplamlar.satir_adedi == 0 -%}<div class="box">${partyRow("Bakiye", "Belirtilen tarih itibarıyla kayıtlı hareket bulunmamaktadır.")}</div>{%- endif -%}`,
  declaration: DECLARATION,
});

export const reconciliationLetterSystem: SystemEquivalent = {
  docType: "RECONCILIATION_LETTER",
  editMode: "CODE",
  html,
  css: (settings) => financeCss(settings, "mutabakatMektubu", true),
  pageSettings: (settings) => pageSettingsFor(settings, 9),
  tableBindings: {},
  variants,
};
