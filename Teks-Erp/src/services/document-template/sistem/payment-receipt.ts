// =============================================================================
// PAYMENT_RECEIPT (Tahsilat / Ödeme Makbuzu) — Sistem renderer'ının Liquid eşleniği
// =============================================================================
// KOD KİPİ (T6 kalıbı, D8). Satır tablosu YOK (makbuz tek olaydır); tutar `para` filtresiyle.
// İmza etiketleri ayarda boşsa YÖNE göre seçilir (tahsilat: Ödeyen / Tahsil Eden; ödeme:
// Ödeyen (Firma) / Teslim Alan) — renderer'daki varsayılanın aynısı.
// =============================================================================

import { CREATED_BY_ROW, PARTY_NAME_ROW, financeCss, financeDocBody, partyRow, qtyOrDash } from "./_ortak/finans";
import { filled } from "./_ortak/musteri";
import { TINY_PNG, pageSettingsFor } from "./subcontractor-fragments";
import type { EquivalenceVariant, SystemEquivalent } from "./tipler";

const variants: EquivalenceVariant[] = [
  {
    name: "bolum_kapali_imza_yasal_blok",
    config: {
      sections: { account: false, createdBy: false, documentNo: false },
      signatureLabels: ["Kasiyer", "Müşteri <imza>"],
      blocks: [
        { position: "afterHeader", text: "Makbuz yalnız tahsil edilen tutar için geçerlidir." },
        { position: "beforeSignatures", text: "Çek ile yapılan ödemelerde tahsil şartı saklıdır." },
      ],
      footerNote: "Kasa dosyasına.",
      titleOverride: "makbuz",
    },
  },
  {
    name: "a5_olcek_alan",
    config: {
      style: { pageSize: "A5", fontScale: 0.85, tableDensity: "compact", fontWeight: "bold", margins: { top: 5, left: 12 } },
      fields: { boxRow: { size: 9 }, company: { size: 15 } },
      showSignatures: false,
      showLetterhead: false,
    },
  },
  {
    name: "tarih_yok_hafif",
    config: { sections: { date: false }, style: { fontWeight: "light", fontScale: 1.1 } },
  },
  {
    name: "damga_grid_logo",
    config: {
      qr: true,
      showLogo: true,
      logoPosition: "right",
      stamps: { printedAt: true, printedBy: true, copyLabel: "MÜŞTERİ NÜSHASI" },
      blankGrid: { enabled: true, title: "", rows: 1, columns: 2, position: "beforeSignatures" },
    },
    print: { logo: TINY_PNG, qr: TINY_PNG, zaman: "2026-09-25T09:00:00.000Z", basan: "kasa", not: "Tek seferlik not" },
  },
];

const SIGN_BOX = String.raw`<div class="sign-box"><div class="sign-line"></div><div class="sign-lbl">{{ etiket }}</div></div>`;

const SIGNATURES = String.raw`{%- if ayar.showSignatures -%}
{%- assign imza_sayisi = ayar.signatureLabels | size -%}
{%- if imza_sayisi > 0 -%}{%- assign imzalar = ayar.signatureLabels -%}
{%- elsif belge.yon == "IN" -%}{%- assign imzalar = "Ödeyen|Tahsil Eden" | split: "|" -%}
{%- else -%}{%- assign imzalar = "Ödeyen (Firma)|Teslim Alan" | split: "|" -%}{%- endif -%}
<div class="sign">{%- for etiket in imzalar -%}${SIGN_BOX}{%- endfor -%}</div>
{%- endif -%}`;

const html = financeDocBody({
  party: String.raw`${PARTY_NAME_ROW}
${partyRow("Ödeme Şekli", "{{ belge.odeme_sekli }}")}
{%- if ayar.sections.account and ${filled("belge.kasa_banka")} -%}${partyRow("Kasa/Banka", "{{ belge.kasa_banka }}")}{%- endif -%}
${CREATED_BY_ROW}`,
  totals: String.raw`<div class="tot">
<div class="row grand"><span>{{ belge.yon_etiketi | upcase }}</span><b>{{ toplamlar.tutar | para }} {{ belge.para_birimi }}</b></div>
{%- if belge.para_birimi != "TRY" and ${filled("toplamlar.tutar_tl")} -%}<div class="row try"><span>TL Karşılığı (kur ${qtyOrDash("belge.kur")})</span><b>{{ toplamlar.tutar_tl | para: "TRY" }}</b></div>{%- endif -%}
</div>`,
  signatures: SIGNATURES,
});

export const paymentReceiptSystem: SystemEquivalent = {
  docType: "PAYMENT_RECEIPT",
  editMode: "CODE",
  html,
  css: (settings) => financeCss(settings, "tahsilatMakbuzu", false),
  pageSettings: (settings) => pageSettingsFor(settings, 9),
  tableBindings: {},
  variants,
};
