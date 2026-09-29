// Bildirime dokununca ilgili ekran — yalnız iOS/Android (web'de service worker pencereyi açar). Yol bildirimin
// verisinden gelir ve `safeRoute`tan geçer: uygulamanın kendi ekranı değilse hiçbir yere gidilmez.
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";
import { safeRoute } from "../lib/notification-form";

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: () => Promise.resolve({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

export function useNotificationTaps(enabled: boolean): void {
  const router = useRouter();
  useEffect(() => {
    if (!enabled || Platform.OS === "web") return;
    const open = (r: Notifications.NotificationResponse | null) => {
      const route = safeRoute((r?.notification.request.content.data as { rota?: unknown } | undefined)?.rota);
      if (route) router.push(route as never);
    };
    void Notifications.getLastNotificationResponseAsync().then(open);
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [enabled, router]);
}
