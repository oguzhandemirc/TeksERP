// Telefonda bildirime dokunma dinleyicisi (expo-notifications). Yalnız `NATIVE_PUSH` açıkken `taps.ts`ten `require`
// edilir; ön plan gösterim kuralı da modül yüklenince bir kez kurulur.
import * as Notifications from "expo-notifications";

Notifications.setNotificationHandler({
  handleNotification: () => Promise.resolve({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

/** Son dokunuşu ve sonrakileri `open`a verir; dönüş dinleyiciyi kaldırır. */
export function listenNativeTaps(open: (data: unknown) => void): () => void {
  const onResponse = (r: Notifications.NotificationResponse | null) => {
    if (r) open(r.notification.request.content.data);
  };
  void Notifications.getLastNotificationResponseAsync().then(onResponse);
  const sub = Notifications.addNotificationResponseReceivedListener(onResponse);
  return () => sub.remove();
}
