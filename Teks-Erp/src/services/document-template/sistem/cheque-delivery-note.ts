// =============================================================================
// CHEQUE_DELIVERY_NOTE (Çek / Senet Teslim Bordrosu) — Sistem renderer'ının Liquid eşleniği
// =============================================================================
// KOD KİPİ (T6 kalıbı, D8). Farklı para birimleri TOPLANMAZ: tablo toplam hücresi yalnız tek
// para biriminde dolu (karışıkta boş hücre etiket alır, renderer'daki gibi); ara toplam kutusu
// para birimi başına. Beyan yöne ve para birimi sayısına göre — metin AYNEN.
// =============================================================================

import { CREATED_BY_ROW, dateOrDash, financeCss, financeDocBody, partyRow } from "./_ortak/finans";
import { dynamicTable, filled } from "./_ortak/musteri";
import { TINY_PNG, pageSettingsFor } from "./subcontractor-fragments";
import type { EquivalenceVariant, SystemEquivalent } from "./tipler";

const variants: EquivalenceVariant[] = [
  {
    name: "kolon_gizle_sira_baslik",
    config: {
      columns: { chequeTable: { hidden: ["no", "bank"], order: ["amount", "currency", "docNo"], labels: { drawer: "Borçlu 'firma' <&>" }, blankLabels: ["serialNo"] } },
    },
  },
  {
    name: "yalniz_tutar_kolonu",
    config: { columns: { chequeTable: { hidden: ["no", "docNo", "serialNo", "issueDate", "dueDate", "drawer", "bank", "currency"] } } },
  },
  {
    name: "bolum_kapali_imza_yasal_blok",
    config: {
      sections: { createdBy: false, declaration: false, documentNo: false },
      signatureLabels: ["Teslim Eden (Firma)", "Teslim Alan (Banka)", "Tanık"],
      blocks: [
        { position: "afterHeader", text: "Çek Kanunu md. 3 uyarınca ibraz süreleri saklıdır." },
        { position: "beforeSignatures", text: "Ciro zinciri arka yüzdedir." },
      ],
      footerNote: "Bir nüsha bankada kalır.",
      titleOverride: "çek teslim",
    },
  },
  {
    name: "a5_olcek_alan",
    config: {
      style: { pageSize: "A5", fontScale: 0.85, tableStyle: "zebra", tableDensity: "compact", fontWeight: "bold", margins: { top: 5, left: 12 } },
      fields: { secCaption: { size: 13, weight: "black" }, boxRow: { size: 9 } },
      showSignatures: false,
      showLetterhead: false,
    },
  },
  {
    name: "tablo_kapali_tarih_yok",
    config: { sections: { chequeTable: false, date: false }, style: { tableStyle: "plain", tableDensity: "relaxed", fontWeight: "light" } },
  },
  {
    name: "toplamsiz_damga_grid_logo",
    config: {
      columns: { chequeTable: { hidden: ["amount"] } },
      qr: true,
      showLogo: true,
      logoPosition: "right",
      stamps: { printedAt: true, printedBy: true, copyLabel: "BANKA NÜSHASI" },
      blankGrid: { enabled: true, title: "TESLİM", rows: 2, columns: 3, headers: ["Ad", "Tarih", "İmza"], position: "afterHeader" },
    },
    print: { logo: TINY_PNG, qr: TINY_PNG, zaman: "2026-09-25T09:00:00.000Z", basan: "finans", not: "Tek seferlik not" },
  },
];

const CHEQUE_CELLS = String.raw`{%- when "no" -%}{{ satir.sira }}
{%- when "docNo" -%}{{ satir.belge_no }}
{%- when "serialNo" -%}{%- if satir.seri_no == nil -%}—{%- else -%}{{ satir.seri_no }}{%- endif -%}
{%- when "issueDate" -%}${dateOrDash("satir.keside_tarihi")}
{%- when "dueDate" -%}${dateOrDash("satir.vade", "takvim")}
{%- when "drawer" -%}{%- if satir.kesideci == nil -%}—{%- else -%}{{ satir.kesideci }}{%- endif -%}
{%- when "bank" -%}{%- if satir.banka == nil -%}—{%- else -%}{{ satir.banka }}{%- endif -%}
{%- when "currency" -%}{{ satir.para_birimi }}
{%- when "amount" -%}{{ satir.tutar | para }}`;

// Karışık para biriminde toplam hücresi boştur; etiket henüz konmadıysa bu boş hücreye oturur.
const FOOT_LABEL = "TOPLAM ({{ toplamlar.adet }} adet)";
const CHEQUE_FOOT = String.raw`{%- when "amount" -%}{%- if toplamlar.para_birimi_sayisi == 1 -%}{{ toplamlar.tek_toplam | para }}
{%- elsif etiket_kondu == false -%}${FOOT_LABEL}{%- assign etiket_kondu = true -%}{%- endif -%}`;

const DECLARATION = String.raw`{%- if belge.yon == "RECEIVED" -%}Aşağıda dökümü verilen çek/senetler portföyümüzden teslim edilmiştir.
{%- else -%}Aşağıda dökümü verilen çek/senetler tarafımızca düzenlenmiş olup teslim edilmiştir.{%- endif -%}
{%- if toplamlar.para_birimi_sayisi > 1 %}
Listede birden fazla para birimi vardır; farklı para birimleri toplanmadığı için tek TOPLAM yazılmamıştır — kırılım yukarıdadır.{%- endif %}
İki nüsha düzenlenir; bir nüsha teslim alan tarafta kalır.`;

const html = financeDocBody({
  party: String.raw`{%- if ${filled("karsi_taraf.ad")} -%}${partyRow(
    "{% if karsi_taraf.tur_etiketi == nil %}Teslim Edilen{% else %}{{ karsi_taraf.tur_etiketi }}{% endif %}",
    "{{ karsi_taraf.ad }}",
  )}{%- endif -%}
${partyRow("Adet", "{{ toplamlar.adet }}")}
${CREATED_BY_ROW}`,
  table: String.raw`{%- if ayar.sections.chequeTable -%}
${dynamicTable({
  rows: "tablolar.cekler",
  cols: "cekler",
  caption: "TESLİM EDİLEN ÇEK / SENETLER",
  widths: [["no", "40px"], ["issueDate", "80px"], ["dueDate", "80px"], ["currency", "50px"], ["amount", "100px"]],
  cells: CHEQUE_CELLS,
  foot: { label: FOOT_LABEL, cells: CHEQUE_FOOT },
  mono: ["docNo", "serialNo"],
})}
{%- endif -%}`,
  totals: String.raw`{%- if toplamlar.para_birimi_sayisi > 0 -%}<div class="tot">
{%- for ara in tablolar.ara_toplamlar -%}<div class="row"><span>{{ ara.para_birimi }} ({{ ara.adet }} adet)</span><b>{{ ara.tutar | para }} {{ ara.para_birimi }}</b></div>{%- endfor -%}
</div>{%- endif -%}`,
  declaration: DECLARATION,
});

export const chequeDeliveryNoteSystem: SystemEquivalent = {
  docType: "CHEQUE_DELIVERY_NOTE",
  editMode: "CODE",
  html,
  css: (settings) => financeCss(settings, "cekTeslimBordrosu", true),
  pageSettings: (settings) => pageSettingsFor(settings, 9),
  tableBindings: {},
  variants,
};
