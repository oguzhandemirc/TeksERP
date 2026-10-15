// Bildirime dokununca ilgili ekran — yalnız iOS/Android (web'de service worker pencereyi açar). Yol bildirimin
// verisinden gelir ve `safeRoute`tan geçer: uygulamanın kendi ekranı değilse hiçbir yere gidilmez. Bildirim başka
// tesise aitse (`data.tesisId`) önce o tesise geçilir; geçiş reddedilirse yol AÇILMAZ (ileti oturumdan gösterilir).
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { safeRoute } from "../lib/notification-form";
import { useSession } from "../state/session";

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: () => Promise.resolve({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

export interface TapDeps {
  readonly facilityId: string | null;
  switchFacility(tesisId: string): Promise<boolean>;
  push(route: string): void;
}

/** Saf dokunuş akışı: güvenli yol → (gerekirse) tesis geçişi → yol. Açıldıysa true. */
export async function openNotification(data: unknown, d: TapDeps): Promise<boolean> {
  const v = (data ?? {}) as { rota?: unknown; tesisId?: unknown };
  const route = safeRoute(v.rota);
  if (!route) return false;
  if (typeof v.tesisId === "string" && v.tesisId !== "" && v.tesisId !== d.facilityId) {
    if (!(await d.switchFacility(v.tesisId))) return false;
  }
  d.push(route);
  return true;
}

export function useNotificationTaps(enabled: boolean): void {
  const router = useRouter();
  const { facilityId, switchFacility } = useSession();
  // Tesis değişince dinleyici yeniden kurulmasın (son bildirim yeniden açılırdı): güncel değerler ref'te.
  const deps = useRef<TapDeps>({ facilityId, switchFacility, push: (r) => router.push(r as never) });
  deps.current = { facilityId, switchFacility, push: (r) => router.push(r as never) };
  useEffect(() => {
    if (!enabled || Platform.OS === "web") return;
    const open = (r: Notifications.NotificationResponse | null) => {
      if (r) void openNotification(r.notification.request.content.data, deps.current);
    };
    void Notifications.getLastNotificationResponseAsync().then(open);
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [enabled]);
}
