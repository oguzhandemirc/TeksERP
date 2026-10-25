// =============================================================================
// BASIM HATA İPUCULARI — `errorCode` → { neden, ipucu } (yazdırma geçmişi, A3)
// =============================================================================
// Anahtar kümesi = panel kodları (`print-error-codes.ts`, A2) ∪ sunucu kodları
// (`outcomeFromTransport` + servis varsayılanı `BILINMIYOR`, A1). Eşitliği
// `print-error-hints.test.ts` iki kaynağı da okuyarak ölçer; yeni kod iki uçta eklenir.
// =============================================================================
import type { PrintErrorCode } from "@/lib/print-error-codes";

/** Sunucunun kendi gönderiminde (TCP 9100) ürettiği kodlar — backend `print-job-input.helper.ts` aynası. */
export const SERVER_PRINT_ERROR_CODES = [
  "GONDERIM_HATASI",
  "DOGRUDAN_GONDERIM_YOK",
  "HEDEF_YOK",
  "ZAMAN_ASIMI",
  "BAGLANTI_REDDEDILDI",
  "AG_ULASILAMAZ",
  "BILINMIYOR",
] as const;
export type ServerPrintErrorCode = (typeof SERVER_PRINT_ERROR_CODES)[number];

export interface PrintErrorHint {
  neden: string;
  ipucu: string;
}

const CHECK_PRINTER = "Yazıcının açık ve kağıdının takılı olduğunu, kablosunun/ağ bağlantısının durduğunu kontrol edin.";

export const PRINT_ERROR_HINTS: Record<PrintErrorCode | ServerPrintErrorCode, PrintErrorHint> = {
  SURUCU_YOK: { neden: "Bu bilgisayarda kurulu yazıcı yok.", ipucu: "İşletim sistemine yazıcıyı ekleyin, sonra yeniden basın." },
  YAZICI_BULUNAMADI: { neden: "Seçili yazıcı bu bilgisayarda bulunamadı.", ipucu: "Yazıcı adı değişmiş olabilir: Sistem → Bu Bilgisayar'dan yeniden seçin." },
  BELGE_COK_BUYUK: { neden: "Belge yazdırma için çok büyük.", ipucu: "Belgeyi bölerek ya da daha kısa tarih aralığıyla basın." },
  PDF_OLUSTURULAMADI: { neden: "PDF oluşturulamadı ya da kaydedilemedi.", ipucu: "Kayıt klasörüne yazma izni ve diskte yer olduğunu kontrol edin." },
  YAZICI_YAPILANDIRILMADI: { neden: "Bu bilgisayara etiket yazıcısı seçilmemiş.", ipucu: "Sistem → Bu Bilgisayar'dan etiket yazıcısını seçin." },
  YAZICI_DILI_YOK: { neden: "Yazıcı dili (ZPL/TSPL) çözülemedi.", ipucu: "Sistem → Baskı & Cihazlar'da yazıcıyı seçin; dil oradan okunur." },
  YAZICI_BAGLANTI_REDDI: { neden: "Yazıcı bağlantıyı reddetti.", ipucu: "Yazıcı kapalı ya da port yanlış olabilir. " + CHECK_PRINTER },
  BAGLANTI_REDDEDILDI: { neden: "Yazıcı sunucunun bağlantısını reddetti.", ipucu: "Yazıcı kapalı ya da port (9100) yanlış olabilir. " + CHECK_PRINTER },
  AG_ULASILAMAZ: { neden: "Yazıcıya ağdan ulaşılamıyor.", ipucu: "Yazıcının IP adresi değişmiş olabilir; Tanımlar → Donanım'dan adresi doğrulayın." },
  ZAMAN_ASIMI: { neden: "Yazıcı zamanında cevap vermedi.", ipucu: "Yazıcı meşgul ya da uyku modunda olabilir. " + CHECK_PRINTER },
  SERIPORT_YOK: { neden: "Seri port açılamadı ya da bulunamadı.", ipucu: "USB/seri kabloyu yeniden takın; COM portu değiştiyse yazıcı ayarını güncelleyin." },
  SERI_SURUCU_YOK: { neden: "Seri port sürücüsü bu derlemede hazır değil.", ipucu: "Yazıcıyı ağ (TCP) ya da sistem kuyruğu üzerinden tanımlayın; destek ekibine bildirin." },
  CUPS_HATA: { neden: "Yazdırma kuyruğu (CUPS) işi reddetti.", ipucu: "Sistem yazıcı kuyruğunu açıp takılı işleri temizleyin." },
  WINSPOOL_HATA: { neden: "Windows yazdırma kuyruğu işi reddetti.", ipucu: "Windows'ta yazıcı kuyruğunu açıp takılı işleri temizleyin; yazıcının çevrimiçi olduğunu kontrol edin." },
  ICERIK_ALINAMADI: { neden: "Etiket içeriği sunucudan alınamadı.", ipucu: "Sunucu bağlantısını kontrol edip yeniden basın." },
  GONDERIM_HATASI: { neden: "Yazıcıya gönderilemedi.", ipucu: CHECK_PRINTER },
  DOGRUDAN_GONDERIM_YOK: { neden: "Sunucudan doğrudan gönderim kapalı ya da yapılmadı.", ipucu: "Yazıcı ayarlarında doğrudan gönderimi açın ya da basımı istasyondan yapın." },
  HEDEF_YOK: { neden: "Bu istasyon için yazıcı tanımlı değil.", ipucu: "Tanımlar → Donanım'dan istasyona yazıcı atayın." },
  BILINMEYEN: { neden: "Yazdırılamadı (neden bilinmiyor).", ipucu: "Yeniden deneyin; sürerse destek ekibine işlem numarasıyla bildirin." },
  BILINMIYOR: { neden: "Yazdırılamadı (neden bildirilmedi).", ipucu: "Yeniden deneyin; sürerse destek ekibine işlem numarasıyla bildirin." },
};

/** Bilinmeyen kod (yeni istemci, eski panel) da boş kalmaz: sunucunun Türkçe mesajı neden olur. */
export function printErrorHint(code: string | null | undefined, message?: string | null): PrintErrorHint {
  const known = code ? (PRINT_ERROR_HINTS as Record<string, PrintErrorHint>)[code] : undefined;
  if (known) return known;
  return { neden: message?.trim() || "Yazdırılamadı.", ipucu: "Yeniden deneyin; sürerse destek ekibine işlem numarasıyla bildirin." };
}
