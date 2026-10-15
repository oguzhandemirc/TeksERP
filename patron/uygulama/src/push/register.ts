// Bu cihazı bildirim için kaydet — izin isteme + belirteç + `POST /cihazlar`. Platform ayrımı burada:
//   · iOS/Android: yalnız `NATIVE_PUSH` açıkken `register-native.ts` (expo-notifications izni → Expo push belirteci);
//     kapalıyken izin istenmez, native modüle dokunulmaz, ağ çağrısı yapılmaz.
//   · Web: service worker (`/bildirim-sw.js`) + Push API aboneliği (VAPID açık anahtarı sunucudan) → platform web.
// İzin reddi/desteklenmeyen ortam HATA değil DURUMdur (ekran açıklar); ağ/sunucu hatası olduğu gibi yükselir.
import { Platform } from "react-native";
import type { Api } from "../api/endpoints";
import { base64UrlToBytes } from "../lib/notification-form";
import { NATIVE_PUSH, NATIVE_PUSH_SOON } from "./support";

export type RegisterOutcome =
  | { readonly kind: "KAYITLI"; readonly deviceId: string }
  | { readonly kind: "IZIN_YOK" | "DESTEKLENMIYOR" | "YAPILANDIRMA_EKSIK"; readonly message: string };

const SW_PATH = "/bildirim-sw.js";

async function registerWeb(api: Api, vapidKey: string | null): Promise<RegisterOutcome> {
  const nav = globalThis.navigator as Navigator | undefined;
  if (!nav?.serviceWorker || !("PushManager" in globalThis) || !("Notification" in globalThis)) {
    return { kind: "DESTEKLENMIYOR", message: "Bu tarayıcı bildirim desteklemiyor (iPhone'da 16.4+ ve ana ekrana eklenmiş olmalı)" };
  }
  if (!vapidKey) return { kind: "YAPILANDIRMA_EKSIK", message: "Sunucuda web bildirimi yapılandırılmamış" };
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { kind: "IZIN_YOK", message: "Tarayıcı bildirim izni verilmedi" };
  const reg = await nav.serviceWorker.register(SW_PATH);
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(vapidKey) as BufferSource }));
  const device = await api.deviceRegister({ platform: "web", belirtec: JSON.stringify(sub.toJSON()), ad: "Tarayıcı" });
  return { kind: "KAYITLI", deviceId: device.id };
}

export function registerThisDevice(api: Api, vapidKey: string | null, nativePush: boolean = NATIVE_PUSH): Promise<RegisterOutcome> {
  if (Platform.OS === "web") return registerWeb(api, vapidKey);
  if (!nativePush) return Promise.resolve({ kind: "DESTEKLENMIYOR", message: NATIVE_PUSH_SOON });
  return (require("./register-native") as typeof import("./register-native")).registerNative(api);
}
