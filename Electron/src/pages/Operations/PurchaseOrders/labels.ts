// =============================================================================
// ALIŞ SİPARİŞİ — ETİKETLER
// =============================================================================
// ⚠️ DURUM TÜRETİLİR, SEÇİLMEZ. Bu dosyada durum GÖSTERİMİ vardır, durum
// DEĞİŞTİRME yoktur ve olmamalı: `OPEN`/`PARTIAL`/`CLOSED` mal kabulünden
// hesaplanır; elle işaretlense ilk senkronda geri döner. Bu yüzden formda durum
// seçici ÇİZİLMEZ ve etiketler yalnız okunur.
//
// ⚠️ Etiketler enum ADIYLA değil, satın almacının SORUSUYLA yazılır: "CLOSED"
// yerine "Tamamlandı", "PARTIAL" yerine "Kısmen geldi". Varsayılan okuyucu
// vardiya ortasındaki depo/satın alma personelidir; İngilizce enum adı ona
// hiçbir şey söylemez.
// =============================================================================
import type { PurchaseOrderStatus } from "./service";

export const PO_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  OPEN: "Bekliyor",
  PARTIAL: "Kısmen geldi",
  CLOSED: "Tamamlandı",
  CANCELLED: "İptal",
};

/** `Badge` bileşeninin `className`i — variant yerine ton, çünkü beş kova var. */
export const PO_STATUS_BADGE: Record<PurchaseOrderStatus, string> = {
  OPEN: "border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  PARTIAL: "border-transparent bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  CLOSED: "border-transparent bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  CANCELLED: "border-transparent bg-muted text-muted-foreground",
};

/** Satır sonuna eklenen kısa açıklama — rozet rengi tek başına bilgi taşımaz. */
export const PO_STATUS_HINT: Record<PurchaseOrderStatus, string> = {
  OPEN: "hiç mal gelmedi",
  PARTIAL: "bir kısmı geldi",
  CLOSED: "tüm kalemler karşılandı",
  CANCELLED: "iptal edildi",
};

/** Mal kabul fişi rozetleri — sipariş detayındaki "bağlı fişler" listesi için. */
export const RECEIPT_STATUS_LABEL: Record<"ACTIVE" | "CANCELLED", string> = {
  ACTIVE: "Aktif",
  CANCELLED: "İptal",
};

export const PO_CURRENCIES = ["TRY", "USD", "EUR", "GBP", "RUB"] as const;
