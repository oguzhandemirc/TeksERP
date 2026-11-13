// Telefonda bildirime dokunma dinleyicisi (expo-notifications). Yalnız `NATIVE_PUSH` açıkken `taps.ts`ten `require`
// edilir; ön plan gösterim kuralı da modül yüklenince bir kez kurulur.
import * as Notifications from "expo-notifications";

Notifications.setNotificationHandler({
  handleNotification: () => Promise.resolve({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

/** İşlenmiş dokunuşlar: dinleyici yeniden kurulunca (yeniden giriş) son dokunuş ikinci kez açılmasın. */
const islenen = new Set<string>();

/** Son dokunuşu (uygulama kapalıyken açılış) ve sonrakileri (arka plan/ön) `open`a verir; dönüş dinleyiciyi kaldırır. */
export function listenNativeTaps(open: (data: unknown) => void): () => void {
  const onResponse = (r: Notifications.NotificationResponse | null) => {
    if (!r) return;
    const id = r.notification.request.identifier;
    if (id && islenen.has(id)) return;
    if (id) islenen.add(id);
    open(r.notification.request.content.data);
  };
  void Notifications.getLastNotificationResponseAsync().then(onResponse);
  const sub = Notifications.addNotificationResponseReceivedListener(onResponse);
  return () => sub.remove();
}

/** Uygulama öndeyken gelen bildirim (dokunuş değil): liste/rozet tazelensin. */
export function listenNativeReceived(onReceived: () => void): () => void {
  const sub = Notifications.addNotificationReceivedListener(() => onReceived());
  return () => sub.remove();
}
