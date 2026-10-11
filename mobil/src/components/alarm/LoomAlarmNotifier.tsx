// =============================================================================
// TEZGAH ALARMI — bildirici (görünmez; MainNavigator'da bir kez)
// =============================================================================
// Ön planda: 15 sn yoklama → yeni alarm/kademe/tekrar çalmada ses + titreşim + dokunulabilir uyarı.
// Arka plana geçişte: açık-üstlenilmemiş alarm varsa TEK yerel hatırlatma zamanlanır; ön plana
// dönüşte iptal edilir ve hemen yoklanır. Bildirime dokunma → alarm sayfası (derin bağlantı).
// Erişim yoksa (izin/bayrak) hiçbir şey yapmaz — istek de, izin sorusu da yok.
// =============================================================================
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import Toast from 'react-native-toast-message';
import { useLoomAlarmAccess, useLoomAlarmFeed } from '../../hooks/useLoomAlarms';
import { consumeFreshSignals } from '../../lib/loomAlarm/dispatch';
import { notificationTextOf } from '../../lib/loomAlarm/signal';
import { reminderPlanOf } from '../../lib/loomAlarm/reminder';
import { alarmNotificationData, alarmTargetOf } from '../../lib/loomAlarm/deepLink';
import { fmtFactoryTime } from '../../lib/factory-time';
import { signalLoomAlarm } from '../../services/alarmFeedback';
import {
  cancelAlarmReminder,
  ensureNotifyPermission,
  prepareAlarmNotifications,
  scheduleAlarmReminder,
  subscribeAlarmTaps,
} from '../../services/alarmNotify';
import { rootNavigateToAlarm } from '../../navigation/navigationRef';
import type { LoomAlarmItem } from '../../types/loomAlarm';

export default function LoomAlarmNotifier() {
  const access = useLoomAlarmAccess();
  const feed = useLoomAlarmFeed({ enabled: access.canView, mine: true });
  const items = useRef<LoomAlarmItem[]>([]);
  items.current = feed.data?.items ?? [];

  // İzin + kanal: yalnız erişimi olan kullanıcıda, bir kez.
  useEffect(() => {
    if (!access.canView) return;
    void prepareAlarmNotifications().then(() => ensureNotifyPermission());
  }, [access.canView]);

  // Dokunma → alarm sayfası (sıcak + soğuk açılış).
  useEffect(() => {
    if (!access.canView) return;
    return subscribeAlarmTaps((data) => {
      const target = alarmTargetOf(data);
      if (target) rootNavigateToAlarm(target);
    });
  }, [access.canView]);

  // Ön planda yeni sinyal: ses + titreşim + dokunulabilir uyarı.
  useEffect(() => {
    if (!access.canView || !feed.dataUpdatedAt) return;
    const now = Date.now();
    const fresh = consumeFreshSignals(items.current, now, access.renotifyMinutes);
    if (fresh.length === 0) return;
    const top = fresh[0];
    signalLoomAlarm(top.tier);
    const text = notificationTextOf(top, now, fresh.length - 1);
    Toast.show({
      type: 'error',
      text1: text.title,
      text2: text.body,
      visibilityTime: 8000,
      onPress: () => {
        Toast.hide();
        rootNavigateToAlarm({ screen: 'UyariDetay', alarmId: top.alarm.id });
      },
    });
  }, [access.canView, access.renotifyMinutes, feed.dataUpdatedAt]);

  // Arka plan ↔ ön plan: hatırlatma zamanla / iptal et.
  const refetch = feed.refetch;
  useEffect(() => {
    if (!access.canView) return;
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'background') {
        const plan = reminderPlanOf(items.current, Date.now(), access.renotifyMinutes, (ms) => fmtFactoryTime(new Date(ms)));
        if (plan) void scheduleAlarmReminder({ ...plan, data: alarmNotificationData(plan.alarmId) });
      } else if (next === 'active') {
        void cancelAlarmReminder();
        void refetch();
      }
    });
    return () => sub.remove();
  }, [access.canView, access.renotifyMinutes, refetch]);

  return null;
}
