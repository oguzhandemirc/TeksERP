// =============================================================================
// SUNUCU HATASININ KENDİ CÜMLESİ — ortak çıkarıcı
// =============================================================================
// ⚠️ SEBEP TOAST'TAN OKUNAMAZ ve toast birkaç saniyede kaybolur. Ekranda kalan
// hata kutusunun elinde yalnız `error` nesnesi vardır; backend'in gerçek cümlesi
// ("Ön muhasebe modülü bu kurulumda kapalı", "Bu depoya erişiminiz yok") YALNIZ
// yanıt gövdesinde yaşar. Bu çıkarıcı onu oradan alır ve ASLA yeniden yazmaz.
//
// ⚠️ CÜMLE UYDURULMAZ: gövde yoksa (ağ/timeout) "istek ulaşmadı" denir, "kayıt
// yok" ya da "kaydedilmedi" DENMEZ — zaman aşımı "yazılmadı" demek değildir.
//
// Emsaller: `pages/Reports/Finance/service.reportErrorText` (rapor cümlesi) ve
// `pages/Finance/CashTransactions/service.cashTxnErrorText` (yazma cümlesi).
// İkisi de kendi bağlamına özel SON cümleyi taşıdığı için duruyorlar; buradaki
// çıkarıcı ise bağlamsız ortak bileşenler (DataTable / FilterBar) içindir.
// =============================================================================

import axios from "axios";

/**
 * Backend'in kendi hata cümlesi; yoksa çağıranın verdiği yedek cümle.
 * Alan hataları " • " ile birleşir (apiClient interceptor'ıyla aynı sözleşme).
 */
export function apiErrorText(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as
      | { message?: string; errors?: Array<{ message?: string }> }
      | undefined;
    const fieldMessages = (body?.errors ?? [])
      .map((e) => e?.message)
      .filter((m): m is string => Boolean(m));
    if (fieldMessages.length > 0) return fieldMessages.join(" • ");
    if (body?.message) return body.message;
    if (!error.response) return "Sunucuya ulaşılamadı. Bağlantıyı kontrol edip tekrar deneyin.";
  }
  return fallback;
}
