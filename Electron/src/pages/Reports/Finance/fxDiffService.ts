// =============================================================================
// KUR FARKI RAPORU — tipler + API çağrısı (backend `finance-fx-diff.report.ts` aynası)
// =============================================================================
// ⚠️ Yol TAM yazılır ("/api/reports/finance/fx-diff") — `apiClient.baseURL` `/api`
// İÇERMEZ; öneksiz yol 404 alır ve çağıran hatayı yutarsa ekran "bu dönemde
// dövizli kapama yok" gösterir. Para ekranında bu, boş ekrandan kötüdür (rapor
// BOZUK değil BOŞ görünür ve kimse fark etmez).
//
// ⚠️ TUTARLAR **STRING** GELİR (backend Decimal → 2 hane string). İstemci bu
// değerlerle ARİTMETİK YAPMAZ — gösterim `moneyStr`, Excel hücresi `toNum`.
// Bu yüzden ekranın/exportun ihtiyaç duyduğu HER toplam backend'de hazırdır
// (`summary.gainTry/lossTry/netTry` + `byCurrency`): "istemci toplamasın" kuralı,
// alan listesini backend sözleşmesinin belirlemesi demektir.
//
// ⚠️ `Number("1234.56")` GÜVENLİDİR, `Number("1.250")` DEĞİL. Backend düz ondalık
// basar (binlik ayraç YOK) — bu yüzden `moneyStr`/`toNum`'ın `Number()`'ı doğru
// çalışır. Buraya tr-TR biçimli ("1.250,00") bir metin gelirse sessizce 1,25
// okunur; yani biçimlendirme HER ZAMAN son adımdır, ara adım değil.
//
// ⚠️ İŞARET SÖZLEŞMESİ TEK KAYNAKTAN: `signedDiffTry` daima "+ = lehte (kambiyo
// kârı), − = aleyhte (zarar)" (backend `invoiceLedgerSide` ile çözer). İstemci
// yönü YENİDEN HESAPLAMAZ — fatura türüne bakıp kendi işaretini üretmek, satış
// ile alış faturasında birbirinin tersi iki ekran demekti. Tek yorum noktası
// `fxTone`.
// =============================================================================

import apiClient from "@/services/apiClient";
import {
  CURRENCY_SYMBOL,
  INVOICE_TYPE_LABEL,
  type Currency,
  type InvoiceType,
} from "@/pages/Finance/service";
import type { ReportResponse } from "../_services/types";
import type { CariKind } from "./service";

// -----------------------------------------------------------------------------
// SÖZLEŞME
// -----------------------------------------------------------------------------

export interface FxDiffRow {
  allocationId: string;
  /** Kapamanın anı — dönemin çıpası (faturanın ya da tahsilatın tarihi DEĞİL). */
  allocatedAt: string;
  cari: { id: string; name: string };
  invoice: { docNo: string; type: string; currency: Currency; exchangeRate: string };
  /** Kapamanın kaynağı — tahsilat/ödeme ya da çek/senet. */
  source: { kind: "PAYMENT" | "CHEQUE"; docNo: string; label: string; exchangeRate: string };
  /** Kapatılan tutar — FATURANIN para biriminde. */
  amount: string;
  /** + = lehte (kambiyo kârı) · − = aleyhte (zarar). Satır bazında kuruşa yuvarlı. */
  signedDiffTry: string;
}

export interface FxDiffCurrencyRow {
  currency: Currency;
  count: number;
  gainTry: string;
  lossTry: string;
  netTry: string;
}

export interface FxDiffSummary {
  count: number;
  /** Σ pozitif satırlar (lehte). */
  gainTry: string;
  /** Σ |negatif satırlar| (aleyhte) — POZİTİF sayı olarak gelir. */
  lossTry: string;
  /** gain − loss. */
  netTry: string;
  byCurrency: FxDiffCurrencyRow[];
}

export interface FxDiffReport {
  rows: FxDiffRow[];
  summary: FxDiffSummary;
}

export interface FxDiffApiParams {
  dateFrom?: string;
  dateTo?: string;
  /** Cari süzgeci LİSTE (CSV) — R5b-d. */
  cariId?: string[];
  /** Cari türü — kardeş rapor (yaşlandırma) bu ekseni taşıyordu, asimetri kapandı. */
  kind?: CariKind;
  /** TRY GÖNDERİLEMEZ — backend `.strict()` şeması onu enum'dan çıkarmıştır. */
  currency?: Currency;
}

export async function getFxDiffReport(
  p: FxDiffApiParams,
): Promise<ReportResponse<FxDiffReport>> {
  // Boş değer GÖNDERİLMEZ: backend şeması `.strict()` ve boş string tarih
  // "Geçersiz tarih formatı" 400'ü, boş `cariId` de "Geçersiz uuid" 400'ü üretir
  // — kullanıcı hiçbir filtre seçmemişken rapor patlardı.
  const params: Record<string, string> = {};
  if (p.dateFrom) params.dateFrom = p.dateFrom;
  if (p.dateTo) params.dateTo = p.dateTo;
  if (p.cariId?.length) params.cariId = p.cariId.join(",");
  if (p.kind) params.kind = p.kind;
  if (p.currency) params.currency = p.currency;
  const res = await apiClient.get<ReportResponse<FxDiffReport>>(
    "/api/reports/finance/fx-diff",
    { params },
  );
  return res.data;
}

// -----------------------------------------------------------------------------
// GÖSTERİM — işaret, etiket, kur
// -----------------------------------------------------------------------------

/** Satırın yönü. `flat` = fark yok VEYA okunamayan değer (aşağıdaki gerekçe). */
export type FxTone = "gain" | "loss" | "flat";

/**
 * İşaretten tona TEK dönüşüm — ekran rozeti, satır rengi ve özet kartı ONU
 * paylaşır.
 *
 * ⚠️ OKUNAMAYAN DEĞER `flat`'tir, `gain` DEĞİL. Bozuk/eksik bir tutarı yeşile
 * boyamak "kambiyo kârı" iddiasıdır ve para ekranında sessizce yanlış bir
 * cevaptır; nötr ton hiçbir şey iddia etmez.
 *
 * ⚠️ "-0.00" da SIFIRDIR (`isZeroAmount` ile aynı kural): Decimal negatif sıfır
 * basabilir ve metne bakıp `startsWith("-")` diyen bir kontrol onu "aleyhte"
 * gösterirdi.
 */
export function fxTone(signedDiffTry: string | number | null | undefined): FxTone {
  if (signedDiffTry === null || signedDiffTry === undefined || signedDiffTry === "") return "flat";
  const n = typeof signedDiffTry === "number" ? signedDiffTry : Number(signedDiffTry);
  if (!Number.isFinite(n)) return "flat";
  if (n > 0) return "gain";
  if (n < 0) return "loss";
  return "flat";
}

/**
 * Tonun ekrandaki rengi.
 *
 * ⚠️ Renk TEK BAŞINA erişilebilir değildir (`DUE_BUCKET_TONE` ile aynı kural):
 * yön her yerde ADIYLA da yazılır (`FX_TONE_LABEL`), ton yalnız göz taraması
 * içindir. Semantik token kullanılır — `--success`/`--destructive` koyu temada
 * kendi değerlerini taşır, yani ayrı bir `dark:` varyantı gerekmez.
 */
export const FX_TONE_CLASS: Record<FxTone, string> = {
  gain: "text-success",
  loss: "text-destructive",
  flat: "text-muted-foreground",
};

export const FX_TONE_LABEL: Record<FxTone, string> = {
  gain: "Lehte",
  loss: "Aleyhte",
  flat: "Fark yok",
};

/** `MetricCard` tonu — aynı işaret sözleşmesi, kart diliyle. */
export const FX_TONE_METRIC: Record<FxTone, "ok" | "bad" | "neutral"> = {
  gain: "ok",
  loss: "bad",
  flat: "neutral",
};

/**
 * Fatura türü etiketi.
 *
 * ⚠️ Yeni bir `InvoiceType` değeri eklenirse ekran HAM ENUM basar ("X_RETURN"),
 * çökmez — ve o çirkinlik tam da haritanın güncellenmesi gerektiğini söyler
 * (`CARI_TXN_SOURCE_LABEL` ile aynı sözleşme).
 */
export function invoiceTypeLabel(type: string): string {
  return INVOICE_TYPE_LABEL[type as InvoiceType] ?? type;
}

/**
 * Kur gösterimi — 4 hane (TCMB/muhasebe konvansiyonu).
 *
 * ⚠️ Kur TUTAR DEĞİLDİR: `moneyStr` ile basılırsa 2 haneye yuvarlanır ve
 * 32,4567 ile 32,4512 EKRANDA AYNI görünür — oysa raporun tamamı tam bu iki
 * kurun FARKINI anlatıyor. Sayı olmayan değerde "—" basılır (uydurma kur yok).
 */
export function fxRate(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("tr-TR", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

/**
 * Seçilebilir para birimleri — TRY HARİÇ.
 *
 * ⚠️ Liste elle YAZILMAZ, `CURRENCY_SYMBOL`den türetilir: yeni bir para birimi
 * tanımlandığında beşinci bir kopya güncellenmeyi bekleyen ölü liste olurdu.
 * TRY'nin dışarıda kalması bir tercih değil TANIM: TRY faturada iki kur damgası
 * da 1'dir, yani kur farkı matematiksel olarak sıfırdır — backend enum'u da onu
 * kabul etmez (400).
 */
export const FX_CURRENCIES: Currency[] = (Object.keys(CURRENCY_SYMBOL) as Currency[]).filter(
  (c) => c !== "TRY",
);

/**
 * Cari süzgecinin seçenekleri — GELEN SATIRLARDAN türetilir.
 *
 * ⚠️ Cari SEÇİCİ ucu (`/api/finance/cari`) BİLİNÇLİ olarak kullanılmaz: o uç
 * `finance:read` ister ve yalnız `report:finance` taşıyan yönetim kullanıcısı
 * 403 alır — filtre sessizce ölürdü (`AgingFilterBar` ve `Finance/tile-config`
 * başlıklarındaki aynı gerekçe). Rapor sayfalı olmadığı için gelen satır kümesi
 * TAMDIR; dönemdeki carilerin listesi de onun içindedir.
 */

/**
 * Raporun "nasıl okunur" notları.
 *
 * ⚠️ Bu uç `notes` DÖNMEZ (backend sözleşmesinde yok) — bu yüzden metin burada
 * yaşar. Tek kaynak olması load-bearing: ekran ile Excel/PDF ayrı ayrı yazılsaydı
 * biri güncellenip diğeri unutulurdu ve aynı rapor iki yüzeyde farklı şey
 * öğretirdi (`reportExport.ts` başlığındaki sınıf).
 */
export const FX_DIFF_NOTES: string[] = [
  "Kur farkı SAKLANMAZ, türetilir: kapatılan tutar × (kaynak kuru − fatura kuru). Kapama çözülürse satır bu listeden kendiliğinden düşer.",
  "İşaret sözleşmesi: + lehte (kambiyo kârı), − aleyhte (kambiyo zararı). Yön faturanın defter tarafından çözülür — satış ile alışta aynı kur hareketi ters sonuç verir.",
  "Dönem çıpası KAPAMANIN anıdır; faturanın ya da tahsilatın tarihi değil. Aynı dönemde kesilip kapanmayan fatura burada görünmez.",
  "Farkı SIFIR çıkan kapama da listelenir: aynı kurla kapanmak meşru bir sonuçtur ve satırı gizlemek 'bu dönemde dövizli kapama olmadı' yalanını üretirdi.",
  "Satır farkı kuruşa yuvarlanır; özet toplamlar yuvarlanmış satırların toplamıdır — ekrandaki toplam, satırların toplamına birebir eşittir.",
  "TRY faturalar kapsam dışıdır: iki kur damgası da 1 olduğu için kur farkı tanım gereği sıfırdır.",
];
