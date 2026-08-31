// =============================================================================
// ÇEK VADE TAKVİMİ — tipler + API çağrısı (backend `cheque.service.dueSummary` aynası)
// =============================================================================
// ⚠️ Yol TAM yazılır ("/api/finance/cheques/due-summary") — `apiClient.baseURL`
// `/api` İÇERMEZ; öneksiz yol 404 alır ve çağıran hatayı yutarsa ekran "vadesi
// yaklaşan çek yok" gösterir. Para ekranında bu, boş ekrandan kötüdür.
//
// ⚠️ UÇ `/api/reports/...` ALTINDA DEĞİL ve bu bilinçli: veri çekin KENDİ
// yaşam döngüsünden gelir ve İKİ ekranı birden besler — Çek Portföyü sayfasının
// vade kartı (kullanıcısı `finance:read`) ve buradaki rapor (kullanıcısı
// `report:finance`). Backend ucu ikisini de kabul eder
// (`requireAnyPermission`); ikinci bir "rapor kopyası" uç yazmak, aynı sorunun
// iki farklı cevabı demekti.
//
// ⚠️ DOSYA NEDEN BURADA: `cashBookService.ts` kasa/banka defterinin tipleridir
// ve oraya üçüncü bir konu eklemek, birini düzeltirken diğerini okumadan geçmeyi
// kolaylaştırıyordu (o dosyanın kendi başlığındaki gerekçe). Vade takvimi ayrı
// bir sorudur → ayrı, küçük dosya.
//
// ⚠️ TUTARLAR **STRING** GELİR (backend Decimal → 2 hane string; `service.ts`
// başlığındaki kuruş gerekçesi). Bu dosya onları `string` tipler; gösterim
// `moneyStr`, Excel hücresi `toNum` ile yapılır. İstemcide ARİTMETİK YAPILMAZ —
// tek istisna aynı para birimindeki NET (giren − çıkan) ve o da `toNum` ile
// açıkça sayıya çevrilerek yapılır (bkz. `netByPeriod`).
// =============================================================================

import apiClient from "@/services/apiClient";
import type { ChequeKind, ChequeStatus } from "@/pages/Finance/Cheques/service";
import type { Currency } from "./service";

/** Backend `CHEQUE_DUE_BUCKETS` aynası — SIRA anlamlıdır (geçmiş → uzak). */
export type ChequeDueBucket = "OVERDUE" | "SOON" | "MONTH" | "LATER" | "NO_DUE";

export interface ChequeDueBucketRow {
  bucket: ChequeDueBucket;
  kind: ChequeKind;
  currency: Currency;
  count: number;
  amount: string;
}

export interface ChequeDueCalendarRow {
  /** Hafta: pazartesi günü (`YYYY-MM-DD`) · Ay: `YYYY-MM`. */
  key: string;
  start: string;
  end: string;
  kind: ChequeKind;
  currency: Currency;
  count: number;
  amount: string;
}

export interface ChequeDueSummary {
  /** Fabrika takvim günü (`YYYY-MM-DD`) — kova sınırlarının çıpası. */
  today: string;
  /** "Yaklaşan" eşiği. ⚠️ İstemci kendi "7"sini YAZMAZ — buradan okur. */
  soonDays: number;
  buckets: ChequeDueBucketRow[];
  window: { from: string; to: string };
  weeks: ChequeDueCalendarRow[];
  months: ChequeDueCalendarRow[];
  /** Kapsam AÇIKÇA döner — liste süzgeci de bundan kurulur (tek kaynak). */
  liveStatuses: Record<ChequeKind, ChequeStatus[]>;
  notes: string[];
}

export async function getChequeDueSummary(p?: {
  /** ISO mutlak an. İKİSİ BİRDEN gönderilir — backend tek ucu 400'ler. */
  dateFrom?: string;
  dateTo?: string;
}): Promise<ChequeDueSummary> {
  // Boş değer GÖNDERİLMEZ: şema `.strict()` ve boş string "Geçersiz tarih"
  // 400'ü üretir. Hiç gönderilmezse backend İLERİ bakan varsayılanı uygular
  // (bugün + 30 gün) — varsayılanın TEK kaynağı orasıdır.
  const params: Record<string, string> = {};
  if (p?.dateFrom && p?.dateTo) {
    params.dateFrom = p.dateFrom;
    params.dateTo = p.dateTo;
  }
  const res = await apiClient.get<{ success: true; data: ChequeDueSummary }>(
    "/api/finance/cheques/due-summary",
    { params },
  );
  return res.data.data;
}

// -----------------------------------------------------------------------------
// GÖSTERİM SÖZLÜKLERİ
// -----------------------------------------------------------------------------

export const DUE_BUCKET_LABEL: Record<ChequeDueBucket, string> = {
  OVERDUE: "Vadesi geçmiş",
  SOON: "Yaklaşan",
  MONTH: "Bu ayın kalanı",
  LATER: "Sonrası",
  NO_DUE: "Vadesiz",
};

/**
 * Kovanın ekrandaki tonu.
 *
 * ⚠️ Renk TEK BAŞINA erişilebilir değildir (`dates.dueHint` ile aynı kural) —
 * her kova yanında ADIYLA yazılır; ton yalnız göz taraması içindir.
 */
export const DUE_BUCKET_TONE: Record<ChequeDueBucket, string> = {
  OVERDUE: "text-destructive",
  SOON: "text-amber-700 dark:text-amber-500",
  MONTH: "text-sky-700 dark:text-sky-400",
  LATER: "text-muted-foreground",
  NO_DUE: "text-muted-foreground",
};

export const DUE_KIND_LABEL: Record<ChequeKind, string> = {
  RECEIVED: "Tahsil edilecek",
  ISSUED: "Ödenecek",
};

const TR_MONTHS = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

/**
 * `YYYY-MM-DD` → `gg.aa.yyyy`.
 *
 * ⚠️ `new Date("2026-08-14").toLocaleDateString()` KULLANILMAZ: o metin
 * **UTC gece yarısı** sayılır (ECMAScript tarih-yalnız kuralı) ve negatif UTC
 * farklı bir makinede günü BİR GERİ kaydırır. Vade ekranında bir gün kayması
 * "vadesi geçti/geçmedi" kararını ters çevirir (`Cheques/dates.ts` başlığı).
 * Parçalardan kurmak bu belirsizliği tamamen ortadan kaldırır.
 */
export function fmtDayKey(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return y && m && d ? `${d}.${m}.${y}` : ymd;
}

/** `YYYY-MM` → "Ağustos 2026". */
export function fmtMonthKey(key: string): string {
  const [y, m] = key.split("-");
  const idx = Number(m) - 1;
  return y && TR_MONTHS[idx] ? `${TR_MONTHS[idx]} ${y}` : key;
}

/** Hafta etiketi — "17.08 – 23.08.2026". */
export function fmtWeekRange(start: string, end: string): string {
  const [, sm, sd] = start.split("-");
  const [ey, em, ed] = end.split("-");
  return sm && sd && ey ? `${sd}.${sm} – ${ed}.${em}.${ey}` : `${start} – ${end}`;
}

/**
 * Takvim günü anahtarına gün ekler/çıkarır (`YYYY-MM-DD` → `YYYY-MM-DD`).
 *
 * Aritmetik SAF UTC'dir: girdi bir takvim anahtarıdır (saat taşımaz), yani
 * saat dilimi/DST devreye girmez. `new Date(y, m, d + n)` yerel varyantı ay/yıl
 * taşmasını doğru çözer ama süreç saat dilimine bağlanırdı.
 */
export function shiftDayKey(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

// -----------------------------------------------------------------------------
// TÜRETİLMİŞ SATIRLAR — ekran ve dışa aktarım AYNI fonksiyondan beslenir
// -----------------------------------------------------------------------------

export interface DuePeriodRow {
  key: string;
  start: string;
  end: string;
  currency: Currency;
  receivedCount: number;
  receivedAmount: number;
  issuedCount: number;
  issuedAmount: number;
  /** Giren − çıkan. AYNI para biriminde olduğu için toplanabilir. */
  net: number;
}

/**
 * Takvim satırlarını (dönem × para birimi) tek satıra katlar.
 *
 * ⚠️ EKRAN VE EXCEL BU FONKSİYONU PAYLAŞIR. Ayrı ayrı yazılsalardı iki yüzey
 * aynı hafta için farklı net üretebilirdi — bu projede bir kez ısırmış sınıf
 * (`reportExport.ts` başlığı).
 *
 * ⚠️ NET YALNIZ AYNI PARA BİRİMİNDE hesaplanır; birimler arası toplam YOK.
 * Satırlar bu yüzden (dönem, para birimi) çiftiyle anahtarlanır.
 */
export function foldCalendar(rows: ChequeDueCalendarRow[]): DuePeriodRow[] {
  const map = new Map<string, DuePeriodRow>();
  for (const r of rows) {
    const k = `${r.key}|${r.currency}`;
    let row = map.get(k);
    if (!row) {
      row = {
        key: r.key,
        start: r.start,
        end: r.end,
        currency: r.currency,
        receivedCount: 0,
        receivedAmount: 0,
        issuedCount: 0,
        issuedAmount: 0,
        net: 0,
      };
      map.set(k, row);
    }
    const amount = Number(r.amount);
    const safe = Number.isFinite(amount) ? amount : 0;
    if (r.kind === "RECEIVED") {
      row.receivedCount += r.count;
      row.receivedAmount += safe;
    } else {
      row.issuedCount += r.count;
      row.issuedAmount += safe;
    }
    row.net = row.receivedAmount - row.issuedAmount;
  }
  return [...map.values()].sort(
    (a, b) => a.key.localeCompare(b.key) || a.currency.localeCompare(b.currency),
  );
}

/** Bir kovanın (yön kırılımlı) satırları — kart/tablo ikisi de bunu kullanır. */
export function bucketRows(
  data: ChequeDueSummary | undefined,
  bucket: ChequeDueBucket,
): ChequeDueBucketRow[] {
  return (data?.buckets ?? []).filter((b) => b.bucket === bucket);
}
