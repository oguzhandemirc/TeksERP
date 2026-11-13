// Bu cihaz anlık bildirim alabilir mi? `NATIVE_PUSH` DERLEME KAPISINA bağlıdır (push köprüsü P4; literal değil — gizlilik
// bekçisi `scripts/test_gizlilik_sayfasi.mjs` §7 bu satırı okur): `app.config.js` kapısı (`extra.nativePush`) ∧ native
// modül bağlı (fail-closed). Kapı kapalı derlemede bugünkü gibi telefonda push yok. Native modüle dokunan kod yalnız bu kapıyla `require` edilir.
import Constants from "expo-constants";
import { requireOptionalNativeModule } from "expo";

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

export const NATIVE_PUSH: boolean = nativePushEnabled(Constants.expoConfig?.extra, moduleLinked());
/** Çağıranların adı; `NATIVE_PUSH` ile aynı değer. */
export const NATIVE_PUSH_ETKIN: boolean = NATIVE_PUSH;

export function pushAvailable(os: string, nativePush: boolean = NATIVE_PUSH_ETKIN): boolean {
  return os === "web" || nativePush;
}

export const NATIVE_PUSH_SOON = "Bu cihazda anlık bildirim yakında geliyor. Şimdilik bildirimleri web sürümünden (tarayıcıdan) alabilirsiniz.";
