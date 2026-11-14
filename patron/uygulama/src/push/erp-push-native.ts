// ERP telefon push portları (expo-notifications). Yalnız derleme kapısı açıkken `erp-push.ts`ten `require` edilir.
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { degisinceSuzgeci, type IzinDurumu, type PushPortlari } from "./erp-push";
import { kanalAyariniAc, kanallariKur, sesiOnizle } from "./kanallar-native";
import type { SesSecimi } from "./sesler";

const durum = (p: Notifications.NotificationPermissionsStatus): IzinDurumu =>
  p.granted ? "VERILDI" : p.status === "denied" && !p.canAskAgain ? "REDDEDILDI" : "SORULMADI";

/**
 * Kanallar izinden ÖNCE (Android 13+ istemi kanal varken çıkar); izni önceden verilmiş cihazda da kayıtta kurulur
 * (idempotent). Ses başına kanal: seçim değişince yeni kanal kurulur, eski `varsayilan` ve seçilmeyenler silinir.
 */
export function erpPushPortlari(secim: () => Promise<SesSecimi>): PushPortlari {
  const kanal = async () => kanallariKur(await secim());
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
      const suz = degisinceSuzgeci(cb);
      const sub = Notifications.addPushTokenListener((t) => suz(t.data));
      return () => sub.remove();
    },
    cihazAdi: () => Device.deviceName ?? null,
    kanallariKur: (s) => kanallariKur(s),
    sesiOnizle: async (sinif, ses) => sesiOnizle(sinif, ses, await secim()),
    kanalAyariniAc: (sinif, ses) => kanalAyariniAc(sinif, ses, Constants.expoConfig?.android?.package ?? null),
  };
}
