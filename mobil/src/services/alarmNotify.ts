// =============================================================================
// TEZGAH ALARMI — işletim sistemi bildirimi köprüsü (`expo-notifications`, YEREL; push yok)
// =============================================================================
// Ölçüm (RN 0.81 `JavaTimerManager.onHostPause`): uygulama arka plandayken Android JS zamanlayıcıları
// DURUR ⇒ arka planda yoklama yapılamaz. Arka planda tek güvenilir araç önceden ZAMANLANMIŞ yerel
// bildirimdir (JS gerekmez). Bu köprü yalnız onu ve dokunma olayını sarar; karar `lib/loomAlarm/reminder`.
// Her native çağrı yutulur — bildirim izni yok/servis yoksa uygulama içi uyarı sürer.
// =============================================================================
import { Platform } from 'react-native';
import type { AlarmNotificationData } from '../lib/loomAlarm/deepLink';

type NotificationsModule = typeof import('expo-notifications');
let loaded: NotificationsModule | null | undefined;

/** Tembel + korumalı yükleme: paket modül kapsamında native modül ister; native'i olmayan (eski) APK'da
 *  içe aktarma fırlatır — burada yutulur, bildirim yolu kapanır, uygulama ÇÖKMEZ. */
export function loadNotifications(): NotificationsModule | null {
  if (loaded !== undefined) return loaded;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- korumalı tembel yükleme (eski APK'da native yok)
    loaded = require('expo-notifications') as NotificationsModule;
  } catch {
    loaded = null;
  }
  return loaded;
}

/** Bu kurulumda yerel bildirim yolu var mı (native modül yüklü). */
export const notificationsAvailable = (): boolean => loadNotifications() !== null;

export const ALARM_CHANNEL_ID = 'tezgah-alarmi';
/** Tek hatırlatma kimliği — yeniden zamanlama öncekini EZER (yağmur yok). */
export const ALARM_REMINDER_ID = 'tezgah-alarmi-hatirlatma';

let prepared = false;

/** Kanal + ön plan davranışı — süreç başına bir kez. */
export async function prepareAlarmNotifications(): Promise<void> {
  const Notifications = loadNotifications();
  if (prepared || !Notifications) return;
  prepared = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(ALARM_CHANNEL_ID, {
        name: 'Tezgah alarmları',
        description: 'Hedef süreyi aşan tezgah duruşları',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 400, 250, 400],
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });
    }
  } catch {
    prepared = false;
  }
}

export type NotifyPermission = 'granted' | 'denied' | 'undetermined';

/** Android 13+ çalışma anı izni; daha önce reddedildiyse yeniden sormaz (sistem de sormaz). */
export async function ensureNotifyPermission(): Promise<NotifyPermission> {
  const Notifications = loadNotifications();
  if (!Notifications) return 'denied';
  try {
    const cur = await Notifications.getPermissionsAsync();
    if (cur.granted) return 'granted';
    if (cur.canAskAgain === false) return 'denied';
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted ? 'granted' : asked.canAskAgain === false ? 'denied' : 'undetermined';
  } catch {
    return 'undetermined';
  }
}

export async function readNotifyPermission(): Promise<NotifyPermission> {
  const Notifications = loadNotifications();
  if (!Notifications) return 'denied';
  try {
    const cur = await Notifications.getPermissionsAsync();
    return cur.granted ? 'granted' : cur.canAskAgain === false ? 'denied' : 'undetermined';
  } catch {
    return 'undetermined';
  }
}

export interface ReminderRequest {
  fireAt: number;
  title: string;
  body: string;
  data: AlarmNotificationData;
}

/** Arka plan hatırlatması: aynı kimlikle — öncekinin yerine geçer. */
export async function scheduleAlarmReminder(r: ReminderRequest): Promise<void> {
  const Notifications = loadNotifications();
  if (!Notifications) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(ALARM_REMINDER_ID);
    await Notifications.scheduleNotificationAsync({
      identifier: ALARM_REMINDER_ID,
      content: { title: r.title, body: r.body, data: { ...r.data }, sound: true },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(r.fireAt), channelId: ALARM_CHANNEL_ID },
    });
  } catch {
    // izin yok / servis yok: uygulama içi uyarı sürer
  }
}

/** Ön plana dönüşte: bekleyen hatırlatma bayatlar (güncel liste ekranda). */
export async function cancelAlarmReminder(): Promise<void> {
  const Notifications = loadNotifications();
  if (!Notifications) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(ALARM_REMINDER_ID);
  } catch {
    // yok say
  }
}

/** Bildirime dokunma — sıcak (dinleyici) ve soğuk açılış (son yanıt) aynı geri çağrıya. */
export function subscribeAlarmTaps(onTap: (data: unknown) => void): () => void {
  const Notifications = loadNotifications();
  if (!Notifications) return () => {};
  let sub: { remove: () => void } | null = null;
  try {
    sub = Notifications.addNotificationResponseReceivedListener((r) => onTap(r.notification.request.content.data));
    void Notifications.getLastNotificationResponseAsync()
      .then((r) => {
        if (!r) return;
        onTap(r.notification.request.content.data);
        return Notifications.clearLastNotificationResponseAsync();
      })
      .catch(() => {});
  } catch {
    // native modül yok (eski APK): dokunma yolu yok, uygulama içi uyarı sürer
  }
  return () => sub?.remove();
}
