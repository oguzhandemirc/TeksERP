// ERP telefon push portları (expo-notifications). Yalnız derleme kapısı açıkken `erp-push.ts`ten `require` edilir.
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { IzinDurumu, PushPortlari } from "./erp-push";

const durum = (p: Notifications.NotificationPermissionsStatus): IzinDurumu =>
  p.granted ? "VERILDI" : p.status === "denied" && !p.canAskAgain ? "REDDEDILDI" : "SORULMADI";

/** Kanal izinden ÖNCE (Android 13+ istemi kanal varken çıkar); izni önceden verilmiş cihazda da kayıtta kurulur (idempotent). */
async function kanal(): Promise<void> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("varsayilan", { name: "Bildirimler", importance: Notifications.AndroidImportance.HIGH });
  }
}

export function erpPushPortlari(): PushPortlari {
  return {
    platform: Platform.OS === "ios" ? "ios" : "android",
    izinOku: async () => (Device.isDevice ? durum(await Notifications.getPermissionsAsync()) : "DESTEKLENMIYOR"),
    izinIste: async () => {
      await kanal();
      return durum(await Notifications.requestPermissionsAsync());
    },
    belirtecAl: async () => {
      await kanal();
      const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
      const projectId = extra?.eas?.projectId ?? Constants.easConfig?.projectId;
      return projectId ? (await Notifications.getExpoPushTokenAsync({ projectId })).data : null;
    },
    belirtecDegisince: (cb) => {
      const sub = Notifications.addPushTokenListener(() => cb());
      return () => sub.remove();
    },
    cihazAdi: () => Device.deviceName ?? null,
  };
}
