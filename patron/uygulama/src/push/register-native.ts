// Telefon (iOS/Android) bildirim kaydı: izin → Expo push belirteci → `POST /cihazlar`. Yalnız `NATIVE_PUSH` açıkken
// `register.ts`ten `require` edilir; modül yüklenince expo-notifications native modülü istenir.
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { Api } from "../api/endpoints";
import type { RegisterOutcome } from "./register";

export async function registerNative(api: Api): Promise<RegisterOutcome> {
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
