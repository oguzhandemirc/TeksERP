// Bildirim zili + gelen kutusu hook'ları — veri katmanı react-query; akış tek örnek (`bellClient`).
import { useEffect, useSyncExternalStore } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { notificationErrorCode, httpStatusOf, bildirimService } from "@/services/bildirimService";
import { openBellStream } from "./headers";
import { createBellClient, type BellState } from "./zil-istemcisi";
import type { NotificationTab, SnoozeDuration } from "./types";

export const NOTIFICATION_QUERY_KEY = ["bildirim"] as const;
export const UNDO_WINDOW_MS = 6_000;

export const bellClient = createBellClient({
  ozet: () => bildirimService.ozet(),
  bekle: (p, signal) => bildirimService.bekle(p, signal),
  akisAc: openBellStream,
  httpDurum: httpStatusOf,
});

/** Bayrak (`bildirim.gelenKutusuEnabled`) — yüklenene dek KAPALI (fail-closed). */
export function useNotificationInboxFlag(): { acik: boolean; yuklendi: boolean } {
  const q = useFeatureFlags();
  return { acik: q.data?.data?.bildirimGelenKutusuEnabled === true, yuklendi: q.isSuccess };
}

function refreshLists(qc: QueryClient, tam: boolean) {
  if (tam) void qc.resetQueries({ queryKey: NOTIFICATION_QUERY_KEY });
  else void qc.invalidateQueries({ queryKey: NOTIFICATION_QUERY_KEY });
}

/**
 * Zil durumuna abone olur; bayrak açıkken tek akışı (referans sayımlı) ayakta tutar.
 * Akış "degisti"/"tam" dediğinde bildirim sorguları tazelenir.
 */
export function useNotificationBell(): BellState & { bayrak: boolean } {
  const { acik } = useNotificationInboxFlag();
  const qc = useQueryClient();
  const state = useSyncExternalStore(bellClient.dinle, bellClient.durum, bellClient.durum);
  useEffect(() => {
    if (!acik) return;
    const birak = bellClient.abone();
    // "alarm" olayını alarm sorgusu kendisi dinler (`alarm-bell-query.ts`); liste "degisti" ile zaten tazelenir.
    const olayBirak = bellClient.olayDinle((o) => {
      if (o !== "alarm") refreshLists(qc, o === "tam");
    });
    return () => {
      olayBirak();
      birak();
    };
  }, [acik, qc]);
  return { ...state, bayrak: acik };
}

export function useNotificationList(p: { sekme: NotificationTab; turler?: readonly string[]; limit?: number }, enabled: boolean) {
  const turler = p.turler ? [...p.turler].sort() : [];
  return useInfiniteQuery({
    queryKey: [...NOTIFICATION_QUERY_KEY, "liste", p.sekme, turler.join(","), p.limit ?? 30],
    queryFn: ({ pageParam }) =>
      bildirimService.liste({ sekme: p.sekme, turler, limit: p.limit ?? 30, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
    staleTime: 10_000,
    retry: false,
  });
}

export function useNotificationCatalog(enabled: boolean) {
  return useQuery({
    queryKey: [...NOTIFICATION_QUERY_KEY, "katalog"],
    queryFn: () => bildirimService.katalog(),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

const SNOOZE_LABEL: Record<SnoozeDuration, string> = {
  "1s": "1 saat",
  "yarin-sabah": "yarın 08:00",
  "shift-sonu": "vardiya sonu",
};

function showActionError(e: unknown, yedek: string) {
  const kod = notificationErrorCode(e);
  if (kod === "VARDIYA_YOK") toast.error("Şu an süren bir vardiya yok; başka bir süre seçin.");
  else if (kod === "BILDIRIM_YOK") toast.error("Bu bildirim artık yok ya da size görünmüyor.");
  else if (kod === "BILDIRIM_KAPALI") toast.error("Bildirimler kapalı — Genel Ayarlar'dan açılır.");
  else toast.error(yedek);
}

/** Okundu / okunmadı / ertele / tümünü okundu (+ 6 sn geri al). Her eylem sonrası özet ve listeler tazelenir. */
export function useNotificationActions() {
  const qc = useQueryClient();
  const sonra = () => {
    void bellClient.tazele();
    refreshLists(qc, false);
  };
  const okundu = useMutation({
    mutationFn: ({ id, okundu }: { id: string; okundu: boolean }) =>
      okundu ? bildirimService.okundu(id) : bildirimService.okunmadi(id),
    onSuccess: sonra,
    onError: (e) => showActionError(e, "Bildirim işaretlenemedi."),
  });
  const ertele = useMutation({
    mutationFn: ({ id, sure }: { id: string; sure: SnoozeDuration }) => bildirimService.ertele(id, sure),
    onSuccess: (_r, v) => {
      toast.success(`Bildirim ertelendi (${SNOOZE_LABEL[v.sure]}).`);
      sonra();
    },
    onError: (e) => showActionError(e, "Bildirim ertelenemedi."),
  });
  const geriAl = useMutation({
    mutationFn: (ids: string[]) => bildirimService.geriAlOkundu(ids),
    onSuccess: sonra,
    onError: (e) => showActionError(e, "Geri alınamadı."),
  });
  const tumunuOkundu = useMutation({
    mutationFn: () => bildirimService.tumunuOkundu(),
    onSuccess: (r) => {
      sonra();
      if (r.ids.length === 0) return;
      // Onaysız eylem; 6 sn içinde geri alınabilir (plan §6.1).
      toast.success(`${r.ids.length} bildirim okundu sayıldı.`, {
        duration: UNDO_WINDOW_MS,
        action: { label: "Geri al", onClick: () => geriAl.mutate(r.ids) },
      });
    },
    onError: (e) => showActionError(e, "Bildirimler okundu sayılamadı."),
  });
  return { okundu, ertele, tumunuOkundu, geriAl };
}

export { SNOOZE_LABEL };

/**
 * "Vardiya sonu" ertelemesi için süren vardiya — menü AÇILINCA okunur. `null` = vardiya yok (pasif),
 * `undefined` = bilinmiyor (eski backend / yükleniyor): seçenek açık kalır, sunucu `VARDIYA_YOK` ile korur.
 */
export function useCurrentShiftEnd(enabled: boolean): string | null | undefined {
  const q = useQuery({
    queryKey: [...NOTIFICATION_QUERY_KEY, "vardiya"],
    queryFn: () => bildirimService.ozet(),
    enabled,
    staleTime: 30_000,
  });
  const d = q.data;
  return d && d.enabled ? d.vardiyaBitis : undefined;
}
