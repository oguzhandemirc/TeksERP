// Bu cihazı bildirim için kaydet — izin isteme + belirteç + `POST /cihazlar`. Platform ayrımı burada:
//   · iOS/Android: expo-notifications izni → Expo push belirteci (EAS proje kimliği gerekir) → platform ios/android.
//   · Web: service worker (`/bildirim-sw.js`) + Push API aboneliği (VAPID açık anahtarı sunucudan) → platform web.
// İzin reddi/desteklenmeyen ortam HATA değil DURUMdur (ekran açıklar); ağ/sunucu hatası olduğu gibi yükselir.
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { Api } from "../api/endpoints";
import { base64UrlToBytes } from "../lib/notification-form";

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

async function registerNative(api: Api): Promise<RegisterOutcome> {
  if (!Device.isDevice) return { kind: "DESTEKLENMIYOR", message: "Bildirim yalnız gerçek cihazda alınabilir (öykünücü değil)" };
  const current = await Notifications.getPermissionsAsync();
  const status = current.granted ? current.status : (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") return { kind: "IZIN_YOK", message: "Bildirim izni verilmedi; telefon ayarlarından açabilirsiniz" };
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("varsayilan", { name: "Bildirimler", importance: Notifications.AndroidImportance.HIGH });
  }
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  const projectId = extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return { kind: "YAPILANDIRMA_EKSIK", message: "Uygulama derlemesinde bildirim proje kimliği yok" };
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  const platform = Platform.OS === "ios" ? "ios" : "android";
  const device = await api.deviceRegister({ platform, belirtec: token, ...(Device.deviceName ? { ad: Device.deviceName.slice(0, 120) } : {}) });
  return { kind: "KAYITLI", deviceId: device.id };
}

export function registerThisDevice(api: Api, vapidKey: string | null): Promise<RegisterOutcome> {
  return Platform.OS === "web" ? registerWeb(api, vapidKey) : registerNative(api);
}
