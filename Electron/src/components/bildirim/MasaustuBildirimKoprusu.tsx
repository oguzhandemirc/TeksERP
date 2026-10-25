// =============================================================================
// MASAÜSTÜ KÖPRÜSÜ — zil (tek kaynak) → OS bildirimi / tost + görev çubuğu rozeti (plan §6.7)
// =============================================================================
// DOM üretmez. Köprü yoksa (web paneli) ya da bayrak kapalıysa IPC'ye hiç dokunmaz. Rozet sayısı zil
// rozetinin sayısıdır (`/ozet.okunmamis`); seçili tür yoksa liste de çekilmez (ek istek yok).
// =============================================================================
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { isAppPath } from "@shared/bildirim-notify";
import { bildirimService } from "@/services/bildirimService";
import { useOptionalPreferences } from "@/providers/PreferencesProvider";
import { useTabsStore } from "@/store/tabs";
import { bellClient, useNotificationInboxFlag } from "@/lib/bildirim/hooks";
import { bildirimBridge, createDesktopNotifier, DESKTOP_SCAN_LIMIT, rozetIstegi } from "@/lib/bildirim/masaustu";

const BOS: readonly string[] = [];

export function MasaustuBildirimKoprusu() {
  const bridge = useMemo(() => bildirimBridge(), []);
  const { acik } = useNotificationInboxFlag();
  const turler = useOptionalPreferences()?.prefs.bildirim?.masaustuTurler ?? BOS;
  const zil = useSyncExternalStore(bellClient.dinle, bellClient.durum, bellClient.durum);
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const navRef = useRef(navigateActive);
  navRef.current = navigateActive;

  const ac = useMemo(
    () => (id: string, yol: string) => {
      if (!isAppPath(yol)) return;
      navRef.current(yol);
      void bildirimService.okundu(id).then(() => bellClient.tazele()).catch(() => undefined);
    },
    [],
  );

  const notifier = useMemo(
    () =>
      createDesktopNotifier({
        bridge,
        liste: async (t) => (await bildirimService.liste({ sekme: "okunmamis", turler: t, limit: DESKTOP_SCAN_LIMIT })).items,
        tost: (top, extra) =>
          toast(top.baslik, {
            description: extra > 0 ? `${top.govde} · ve ${extra} yeni bildirim daha` : top.govde,
            action: { label: "Aç", onClick: () => ac(top.id, top.yol) },
          }),
      }),
    [bridge, ac],
  );

  const etkin = !!bridge && acik;
  useEffect(() => {
    if (!etkin || turler.length === 0) return;
    notifier.turleriAyarla(turler);
    void notifier.kontrol();
    const birak = bellClient.abone();
    const olayBirak = bellClient.olayDinle((o) => {
      if (o !== "alarm") void notifier.kontrol();
    });
    return () => {
      olayBirak();
      birak();
      // Yeniden açılınca kapalıyken biriken okunmamışlar bildirilmesin: taban yeniden kurulur.
      notifier.turleriAyarla(BOS);
    };
  }, [etkin, turler, notifier]);
  useEffect(() => () => notifier.sifirla(), [notifier]);

  useEffect(() => {
    if (!bridge) return;
    return bridge.onOpen((e) => ac(e.bildirimId, e.yol));
  }, [bridge, ac]);

  // Rozet aynası: yalnız değişince yollanır; kapanışta (çıkış / bayrak kapandı) önceki rozet temizlenir.
  const istek = etkin ? rozetIstegi(zil) : null;
  const anahtar = istek ? `${istek.okunmamis}|${istek.alarm}` : "";
  const sonRef = useRef("");
  useEffect(() => {
    if (!bridge) return;
    if (istek && anahtar !== sonRef.current) {
      sonRef.current = anahtar;
      void bridge.rozet(istek).catch(() => undefined);
    } else if (!istek && sonRef.current) {
      sonRef.current = "";
      void bridge.rozet({ okunmamis: 0, alarm: false }).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `istek` anahtarla temsil edilir
  }, [bridge, anahtar]);
  useEffect(
    () => () => {
      if (bridge && sonRef.current) void bridge.rozet({ okunmamis: 0, alarm: false }).catch(() => undefined);
    },
    [bridge],
  );

  return null;
}
