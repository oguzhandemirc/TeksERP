import Toast from 'react-native-toast-message';
import { isLicenseNotified } from './license';

/**
 * Ekranın HATA bildirimi — ortak yardımcı. Lisans kapısı reddini (kısıtlı kip · kapalı modül · K5)
 * interceptor tek, tekilleştirilmiş uyarıyla ya da K5 tam ekranıyla ZATEN söyledi; ekranın
 * "Kayıt başarısız" toast'ı onu ezerdi (aynı anda tek toast görünür). Yalnız toast susar —
 * geri alma ve deneme temizliği çağıranda sürer. Metin verilmezse sunucunun mesajı gösterilir.
 */
export function showScreenError(err: unknown, text1: string, text2?: string): void {
  if (isLicenseNotified(err)) return;
  const message = (err as { message?: unknown } | null)?.message;
  const detail = text2 ?? (typeof message === 'string' ? message : undefined);
  Toast.show(detail === undefined ? { type: 'error', text1 } : { type: 'error', text1, text2: detail });
}
