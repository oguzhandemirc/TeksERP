// =============================================================================
// TeksERP Mobil — native güncelleme yolu: Google Play (K-14)
// =============================================================================
// Ortak tablet yalnız Play gizli yayınıyla kurulur ve native/büyük güncellemesi Play'den gelir;
// uygulama kendi APK'sını indirip kurmaz (Play politikası). Bu modül yalnız Play'deki sayfayı açar.
// Paket adı koda gömülmez: derlemede ortak kimlikten (dağıtım kaydı → `ortak-kimlik.cjs`)
// `expoConfig.android.package`a yazılan değer okunur.
// =============================================================================

import Constants from 'expo-constants';
import { Linking } from 'react-native';

/** Operatöre gösterilen tek cümle (kilit şeridi + Ayarlar → Güncelleme aynı metni basar). */
export const PLAY_GUNCELLE_MESAJI = "Yeni sürüm Google Play'de — Play Store'dan güncelleyin";

const PAKET_BICIMI = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

/** Kurulu uygulamanın paket adı (ortak kimlikten); okunamaz/biçimsizse null → düğme gösterilmez. */
export function uygulamaPaketi(): string | null {
  const p = Constants.expoConfig?.android?.package;
  return typeof p === 'string' && PAKET_BICIMI.test(p) ? p : null;
}

export function playStoreAdresleri(paket: string): { market: string; web: string } {
  const id = encodeURIComponent(paket);
  return {
    market: `market://details?id=${id}`,
    web: `https://play.google.com/store/apps/details?id=${id}`,
  };
}

export type PlayOpenResult = 'market' | 'web' | 'paket-yok' | 'acilamadi';

/**
 * Play Store uygulamasında sayfayı açar; Play uygulaması yoksa (market:// işleyicisi yok) tarayıcıda
 * play.google.com'a düşer. `canOpenURL` kullanılmaz: Android 11+ paket görünürlüğü onu `queries`
 * beyanı olmadan hep false yapar; doğrudan açmayı denemek tek doğru ölçüdür.
 */
export async function playStoreAc(
  ac: (url: string) => Promise<unknown> = (url) => Linking.openURL(url),
  paket: string | null = uygulamaPaketi(),
): Promise<PlayOpenResult> {
  if (!paket) return 'paket-yok';
  const { market, web } = playStoreAdresleri(paket);
  try {
    await ac(market);
    return 'market';
  } catch {
    try {
      await ac(web);
      return 'web';
    } catch {
      return 'acilamadi';
    }
  }
}
