// Finans + rapor sözlüğü: fabrika enum'ları (çek/senet, fatura, tahsilat, yaşlandırma ve çek vade kovası) ve rapor
// anahtarları → Türkçe etiket + durum tonu. Tutar/kova değeri fabrikadan gelir; burada yalnız AD ve RENK var.
import { REPORT_STATUSES, type ReportStatus } from "../../api/wire";
import type { IconName } from "../../ui/icons";
import type { Domain } from "../../ui/tokens";
import { STATUS_DICT, type StatusEntry, type StatusTone } from "./ortak";
import { QUOTE_STATUS, STANDARD_COST_STATUS } from "./teklif";

/** Çek/senet yönü (`cek-senet.tur`, `ozet-finans.cekVade[].tur`). */
export const CHEQUE_KIND: Readonly<Record<string, string>> = { RECEIVED: "Alınan", ISSUED: "Verilen" };

/** Belge türü (`cek-senet.belgeTuru`). */
export const CHEQUE_DOC_TYPE: Readonly<Record<string, string>> = { CHEQUE: "Çek", PROMISSORY_NOTE: "Senet" };
/** Cümle içi küçük harfli hâli ("Alınan çek"); yerel ayar işlevi Hermes'te güvenilmez, elle yazılır. */
export const CHEQUE_DOC_TYPE_LOWER: Readonly<Record<string, string>> = { CHEQUE: "çek", PROMISSORY_NOTE: "senet" };

/** Çek/senet durumu (`cek-senet.durum`, `ozet-finans.cekDurum[].durum`). */
export const CHEQUE_STATUS: Readonly<Record<string, StatusEntry>> = {
  PORTFOLIO: { label: "Portföyde", tone: "bilgi" },
  AT_BANK: { label: "Bankada", tone: "bilgi" },
  ENDORSED: { label: "Ciro edildi", tone: "bilgi" },
  COLLECTED: { label: "Tahsil edildi", tone: "iyi" },
  BOUNCED: { label: "Karşılıksız", tone: "kritik" },
  RETURNED: { label: "İade edildi", tone: "bilgi" },
  ISSUED: { label: "Verildi", tone: "bilgi" },
  PAID: { label: "Ödendi", tone: "iyi" },
  CANCELLED: { label: "İptal", tone: "bilgi" },
};

/** Çek vade kovası (`ozet-finans.cekVade[].kova`; sıra fabrikadaki gibi: geçmiş → yakın → uzak). */
export const CHEQUE_DUE_BUCKETS = ["OVERDUE", "SOON", "MONTH", "LATER", "NO_DUE"] as const;
export const CHEQUE_DUE_BUCKET: Readonly<Record<(typeof CHEQUE_DUE_BUCKETS)[number], StatusEntry>> = {
  OVERDUE: { label: "Vadesi geçmiş", tone: "kritik" },
  SOON: { label: "7 gün içinde", tone: "uyari" },
  MONTH: { label: "Bu ay", tone: "bilgi" },
  LATER: { label: "Sonraki aylar", tone: "iyi" },
  NO_DUE: { label: "Vadesiz", tone: "bilgi" },
};

/** Cari yaşlandırma kovası (`ozet-finans.yaslandirma[].kovalar`). 0–30 dahil her gün kovası VADESİ GEÇMİŞ alacaktır:
 *  vadesi gelmemiş iyi · 0–30 uyarı · 31–60 uyarının koyusu · 61–90 kritik · 90+ kritiğin koyusu · vadesiz nötr. */
export interface AgingBucketEntry extends StatusEntry {
  readonly shade: "fill" | "deep";
}
export const AGING_BUCKETS = ["notDue", "d0_30", "d31_60", "d61_90", "d90plus", "noDueDate"] as const;
export const AGING_BUCKET: Readonly<Record<(typeof AGING_BUCKETS)[number], AgingBucketEntry>> = {
  notDue: { label: "Vadesi gelmemiş", tone: "iyi", shade: "fill" },
  d0_30: { label: "0–30 gün", tone: "uyari", shade: "fill" },
  d31_60: { label: "31–60 gün", tone: "uyari", shade: "deep" },
  d61_90: { label: "61–90 gün", tone: "kritik", shade: "fill" },
  d90plus: { label: "90+ gün", tone: "kritik", shade: "deep" },
  noDueDate: { label: "Vadesiz", tone: "bilgi", shade: "fill" },
};

/** Fatura türü (`fatura.tur`). */
export const INVOICE_TYPE: Readonly<Record<string, string>> = {
  SALES: "Satış faturası",
  PURCHASE: "Alış faturası",
  SALES_RETURN: "Satış iadesi",
  PURCHASE_RETURN: "Alış iadesi",
};

/** Fatura durumu (`fatura.durum`; taslak buluta girmez). */
export const INVOICE_STATUS: Readonly<Record<string, StatusEntry>> = {
  CONFIRMED: { label: "Onaylı", tone: "iyi" },
  CANCELLED: { label: "İptal", tone: "bilgi" },
};

/** Tahsilat/ödeme yönü (`tahsilat-odeme.yon`): işaret yalnız GÖSTERİM, tutar fabrikanın. */
export const PAYMENT_DIRECTION: Readonly<Record<string, { readonly label: string; readonly sign: "+" | "−" }>> = {
  IN: { label: "Tahsilat", sign: "+" },
  OUT: { label: "Ödeme", sign: "−" },
};

export const PAYMENT_METHOD: Readonly<Record<string, string>> = {
  CASH: "Nakit",
  BANK_TRANSFER: "Havale/EFT",
  CREDIT_CARD: "Kredi kartı",
  OTHER: "Diğer",
};

export const PAYMENT_STATUS: Readonly<Record<string, StatusEntry>> = {
  ACTIVE: { label: "Geçerli", tone: "iyi" },
  CANCELLED: { label: "İptal", tone: "bilgi" },
};

const labelsOf = (d: Readonly<Record<string, StatusEntry>>): Readonly<Record<string, string>> =>
  Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.label]));

/** Jenerik kayıt ayrıntısında enum alanlarının Türkçe adı (projeksiyon → alan → değer → ad). */
export const RECORD_ENUMS: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, string>>>>>> = {
  teklif: { durum: labelsOf(QUOTE_STATUS) },
  "standart-maliyet": { durum: labelsOf(STANDARD_COST_STATUS) },
  fatura: { tur: INVOICE_TYPE, durum: labelsOf(INVOICE_STATUS) },
  "cek-senet": { tur: CHEQUE_KIND, belgeTuru: CHEQUE_DOC_TYPE, durum: labelsOf(CHEQUE_STATUS) },
  "tahsilat-odeme": {
    yon: Object.fromEntries(Object.entries(PAYMENT_DIRECTION).map(([k, v]) => [k, v.label])),
    yontem: PAYMENT_METHOD,
    durum: labelsOf(PAYMENT_STATUS),
  },
};

/** Rapor hata kodu (`REPORT_ERROR_CODES`, fabrika) → kullanıcı cümlesi; ham kod ekrana basılmaz. */
export const REPORT_ERROR: Readonly<Record<string, string>> = {
  RAPOR_BILINMIYOR: "Fabrika bu raporu tanımıyor.",
  PARAMETRE_GECERSIZ: "Seçilen dönem ya da ayar bu rapor için geçerli değil.",
  ZAMAN_ASIMI: "Rapor zamanında hesaplanamadı; daha kısa bir dönemle yeniden deneyin.",
  RAPOR_KAPALI: "Bu rapor fabrikada kapalı.",
  MODUL_KAPALI: "Raporun ait olduğu modül fabrikada kapalı.",
  SONUC_BUYUK: "Sonuç buluta gönderilemeyecek kadar büyük; daha kısa bir dönem seçin.",
};

/** Finans alt satırı alan adları (`.finans`) → okunur ad; sözlükte yoksa jenerik `humanize`. */
export const FINANCE_FIELD: Readonly<Record<string, string>> = {
  bakiye: "Bakiye",
  tutar: "Tutar",
  tutarTl: "Tutar (TL)",
  eslesen: "Eşleşen",
  eslesmemis: "Eşleşmemiş",
  kur: "Kur",
  araToplam: "Ara toplam",
  iskonto: "İskonto",
  kdv: "KDV",
  tevkifat: "Tevkifat",
  genelToplam: "Genel toplam",
  genelToplamTl: "Genel toplam (TL)",
  odenen: "Ödenen",
  acikTutar: "Açık tutar",
  birimFiyat: "Birim fiyat",
  kdvTutari: "KDV tutarı",
  fiyat: "Fiyat",
  toplamTutar: "Teklif tutarı",
  toplamMaliyetTl: "Toplam maliyet (TL)",
  brutMarjPct: "Brüt marj (%)",
  metreMaliyetiTl: "Metre maliyeti (TL)",
  karPct: "Kâr payı (%)",
  cozguTl: "Çözgü (TL/m)",
  atkiTl: "Atkı (TL/m)",
  dokumaTl: "Dokuma (TL/m)",
  terbiyeTl: "Terbiye (TL/m)",
  genelGiderTl: "Genel gider (TL/m)",
};

/** Para OLMAYAN finans alanları (kur, oran): para birimi eklenmez. */
export function isMoneyField(key: string): boolean {
  return key !== "kur" && !/(Orani|Pct)$/.test(key);
}

/** TL karşılığı alanları kendi birimini taşır (`tutarTl` → ₺), kaydın dövizi değil. */
export function moneyCurrencyOf(key: string, recordCurrency: string): string {
  return /Tl$/.test(key) ? "TRY" : recordCurrency;
}

// ------------------------------------------------------------------------------------------------- raporlar

/** Rapor anahtarı → Türkçe başlık (YEDEK; asıl ad fabrikanın `rapor-katalogu` anlığındaki `baslik`). */
export const REPORT_TITLE: Readonly<Record<string, string>> = {
  "sales/order-intake": "Sipariş karnesi",
  "sales/shipment-scorecard": "Sevk ve termin karnesi",
  "customer/scorecard": "Müşteri karnesi",
  "quality/scorecard": "Kalite karnesi",
  "subcontract/scorecard": "Fason karnesi",
  "inventory/scorecard": "Stok ve ölü stok",
  "finance/aging": "Alacak yaşlandırma",
  "finance/cheque-due": "Çek vade takvimi",
  "sales/siparis-talep": "Ne kadar iş aldık?",
  "sales/sevkiyat": "Ne sevk ettik?",
  "sales/termin": "Sözümüzü tuttuk mu?",
  "sales/acik-siparisler": "Açık siparişler hazır mı?",
  "sales/vazgecilen-is": "Ne geri geldi, neden vazgeçildi?",
  "quality/kalite": "Kalite nasıl gidiyor?",
  "quality/kayip": "Ne kaybettik?",
  "inventory/depo": "Depoda ne yatıyor?",
  "subcontract/fasoncular": "Fasoncular zamanında dönüyor mu?",
  "dokuma/tezgah-randimani": "Tezgahlar verimli mi?",
  "dokuma/duruslar": "Tezgahlar neden duruyor?",
  "dokuma/levent-dengesi": "Leventten beklenen kumaş çıktı mı?",
  "production/makine-duruslari": "Makineler neden durdu?",
  "finance/alacaklar": "Kimden ne alacağız?",
};

/** Katalogda ad varsa ondan, yoksa sözlükten; ikisi de yoksa "Rapor" (ham anahtar ekrana basılmaz). */
export function reportTitle(key: string, catalog?: readonly { readonly anahtar: string; readonly baslik: string }[]): string {
  const fromCatalog = catalog?.find((e) => e.anahtar === key)?.baslik;
  if (fromCatalog) return fromCatalog;
  return Object.prototype.hasOwnProperty.call(REPORT_TITLE, key) ? REPORT_TITLE[key]! : "Rapor";
}

/** Rapor ailesi → alan rengi + ikon (kart ızgarası). */
export const REPORT_FAMILY: Readonly<Record<string, { readonly domain: Domain; readonly icon: IconName }>> = {
  sales: { domain: "siparisler", icon: "receipt-outline" },
  customer: { domain: "cariler", icon: "people-outline" },
  quality: { domain: "uretim", icon: "ribbon-outline" },
  subcontract: { domain: "fason", icon: "git-branch-outline" },
  inventory: { domain: "stok", icon: "cube-outline" },
  finance: { domain: "finans", icon: "wallet-outline" },
  dokuma: { domain: "uretim", icon: "construct-outline" },
  production: { domain: "uretim", icon: "construct-outline" },
};

/** Anahtara özel alan (aile içinde ayrışanlar): sevk karnesi sevkiyat renginde. */
const REPORT_KEY_DOMAIN: Readonly<Record<string, Domain>> = { "sales/shipment-scorecard": "sevkiyat", "sales/sevkiyat": "sevkiyat", "sales/termin": "sevkiyat" };

export function reportDomain(key: string): { domain: Domain; icon: IconName } {
  const fam = REPORT_FAMILY[key.split("/")[0] ?? ""] ?? { domain: "raporlar" as Domain, icon: "document-text-outline" };
  const d = REPORT_KEY_DOMAIN[key];
  return d ? { domain: d, icon: d === "sevkiyat" ? "car-outline" : fam.icon } : fam;
}

/** Rapor isteği durumu → etiket + ton (HAZIR iyi · HESAPLANIYOR bilgi · HATA kritik · BEKLIYOR uyarı · IPTAL nötr). */
export const REPORT_STATUS: Readonly<Record<ReportStatus, StatusEntry>> = Object.fromEntries(
  REPORT_STATUSES.map((s) => [s, STATUS_DICT[s]]),
) as Record<ReportStatus, StatusEntry>;

/** Kesinleşmemiş istek: ekran açıkken kısa yoklama sürer. */
export function reportPending(s: unknown): boolean {
  return s === "BEKLIYOR" || s === "HESAPLANIYOR";
}

/** Rapor parametresi adı → okunur ad (fabrika şemasının adları; değer biçimi fabrikanın). */
export const REPORT_PARAM: Readonly<Record<string, string>> = {
  dateFrom: "Başlangıç",
  dateTo: "Bitiş",
  asOf: "Kesit anı",
  from: "Başlangıç",
  to: "Bitiş",
  kiyas: "Kıyas",
  cariId: "Cari",
};

export type { StatusEntry, StatusTone };

/** `.finans` alt satırı taşıyan projeksiyonlar (bulut kataloğu `patron/sunucu/src/catalog/projections.ts` aynası; bekçi
 *  `e3-finans.test.tsx`). Alt satır yanıtta YOKSA hesap o alanı göremiyor demektir → kilit gösterilir. */
export const FINANCE_SUBROW_PROJECTIONS: readonly string[] = [
  "siparis",
  "siparis-kalemi",
  "cari-hesap",
  "cari-hareket",
  "kasa",
  "banka",
  "kasa-hareketi",
  "cek-senet",
  "fatura",
  "fatura-kalemi",
  "tahsilat-odeme",
  "fiyat",
  "teklif",
  "teklif-kalemi",
  "standart-maliyet",
];

/** İzinsiz finans alanının metni (liste satırında erişilebilirlik etiketi, ayrıntıda görünür metin). */
export const FINANCE_LOCKED_TEXT = "Bu alanı görme iznin yok";
