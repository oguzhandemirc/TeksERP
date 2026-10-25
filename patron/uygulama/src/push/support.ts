// Bu cihaz anlık bildirim alabilir mi? Mağaza paketinde telefonda native push YOK (kullanıcı kararı 2026-10-15).
// İki kat: `NATIVE_PUSH` ANA ANAHTARDIR (literal; gizlilik metni bekçisi `scripts/test_gizlilik_sayfasi.mjs` §7 bu satırı
// okur — açmak metni de değiştirir) · `NATIVE_PUSH_ETKIN` = ana anahtar ∧ derleme kapısı (`app.config.js` →
// `extra.nativePush`) ∧ native modül bağlı (fail-closed). Native modüle dokunan kod yalnız etkin kapıyla `require` edilir.
import Constants from "expo-constants";
import { requireOptionalNativeModule } from "expo";

export const NATIVE_PUSH = false;

export function nativePushEnabled(extra: unknown, moduleLinked: boolean): boolean {
  return moduleLinked && typeof extra === "object" && extra !== null && (extra as { nativePush?: unknown }).nativePush === true;
}

function moduleLinked(): boolean {
  try {
    return requireOptionalNativeModule("ExpoPushTokenManager") !== null;
  } catch {
    return false;
  }
}

export const NATIVE_PUSH_ETKIN: boolean = NATIVE_PUSH && nativePushEnabled(Constants.expoConfig?.extra, moduleLinked());

export function pushAvailable(os: string, nativePush: boolean = NATIVE_PUSH_ETKIN): boolean {
  return os === "web" || nativePush;
}

export const NATIVE_PUSH_SOON = "Bu cihazda anlık bildirim yakında geliyor. Şimdilik bildirimleri web sürümünden (tarayıcıdan) alabilirsiniz.";
