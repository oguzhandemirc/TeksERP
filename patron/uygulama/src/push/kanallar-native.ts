// Android bildirim kanalları (S0; expo-notifications). Yalnız derleme kapısı açıkken `*-native.ts`ten yüklenir.
// Seçili iki kanal (BİLDİRİM + ALARM) kurulur; eski `varsayilan` kanalı ve seçilmeyen `tekserp-*` kanalları silinir
// (Android ayarlarında yalnız kullanılan kanallar görünsün). Kanal izin isteminden ÖNCE kurulur (13+ istemi kanal varken çıkar).
import * as Notifications from "expo-notifications";
import { Linking, Platform } from "react-native";
import { ESKI_KANAL, SES_ADI, kanalKimligi, sesDosyasi, type Ses, type SesSecimi, type SesSinifi } from "./sesler";

const SINIF_ADI: Readonly<Record<SesSinifi, string>> = { BILDIRIM: "Bildirim", ALARM: "Alarm" };

async function kanalKur(sinif: SesSinifi, ses: Ses): Promise<string> {
  const id = kanalKimligi(sinif, ses);
  await Notifications.setNotificationChannelAsync(id, {
    name: `${SINIF_ADI[sinif]} — ${SES_ADI[ses]}`,
    // Alarm en üst önem (BİLDİRİM bugünkü gibi HIGH); sessiz kanal titreşir ama ses çalmaz.
    importance: sinif === "ALARM" ? Notifications.AndroidImportance.MAX : Notifications.AndroidImportance.HIGH,
    ...(ses === "varsayilan" ? {} : { sound: sesDosyasi(ses) }),
    enableVibrate: true,
    vibrationPattern: sinif === "ALARM" ? [0, 500, 250, 500] : [0, 250],
  });
  return id;
}

export async function kanallariKur(s: SesSecimi): Promise<void> {
  if (Platform.OS !== "android") return;
  const istenen = new Set([await kanalKur("BILDIRIM", s.bildirim), await kanalKur("ALARM", s.alarm)]);
  // Temizlik best-effort: silinemeyen kanal yalnız ayarlarda fazladan görünür, bildirimi engellemez.
  try {
    for (const k of await Notifications.getNotificationChannelsAsync()) {
      if ((k.id === ESKI_KANAL || k.id.startsWith("tekserp-")) && !istenen.has(k.id)) await Notifications.deleteNotificationChannelAsync(k.id);
    }
  } catch {
    // yut
  }
}

/** Seçili sesi yerel bildirimle çalar (Android'de kanal sesi; iOS'ta dosya adı). Kanal önce kurulur. */
export async function sesiOnizle(sinif: SesSinifi, ses: Ses, secim: SesSecimi): Promise<void> {
  require("./taps-native"); // ön plan gösterim kuralı (ses çalsın) bu modülde kurulur
  await kanallariKur(sinif === "ALARM" ? { ...secim, alarm: ses } : { ...secim, bildirim: ses });
  const dosya = sesDosyasi(ses);
  await Notifications.scheduleNotificationAsync({
    content: { title: "Ses önizleme", body: SES_ADI[ses], ...(dosya === null ? {} : { sound: dosya }) },
    trigger: Platform.OS === "android" ? { channelId: kanalKimligi(sinif, ses) } : null,
  });
}

/** Seçili kanalın Android sistem ayarını açar (orada her sistem sesi seçilebilir); olmazsa uygulamanın bildirim ayarı. */
export async function kanalAyariniAc(sinif: SesSinifi, ses: Ses, paket: string | null): Promise<void> {
  if (Platform.OS !== "android" || !paket) {
    await Linking.openSettings();
    return;
  }
  try {
    await Linking.sendIntent("android.settings.CHANNEL_NOTIFICATION_SETTINGS", [
      { key: "android.provider.extra.APP_PACKAGE", value: paket },
      { key: "android.provider.extra.CHANNEL_ID", value: kanalKimligi(sinif, ses) },
    ]);
  } catch {
    await Linking.openSettings();
  }
}
