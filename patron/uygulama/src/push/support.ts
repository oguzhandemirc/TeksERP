// Bu cihaz anlık bildirim alabilir mi? İlk mağaza sürümünde telefonda native push YOK (kullanıcı kararı 2026-10-15):
// Firebase/APNs yapılandırması yok ve expo-notifications Android'de hiç bağlanmaz (package.json `expo.autolinking`),
// bu yüzden native modüle dokunan kod yalnız bu kapı açıkken `require` edilir. Web push aynen sürer.
export const NATIVE_PUSH = false;

export function pushAvailable(os: string, nativePush: boolean = NATIVE_PUSH): boolean {
  return os === "web" || nativePush;
}

export const NATIVE_PUSH_SOON = "Bu cihazda anlık bildirim yakında geliyor. Şimdilik bildirimleri web sürümünden (tarayıcıdan) alabilirsiniz.";
