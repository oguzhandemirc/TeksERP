// Profil şeridinin veri katmanı: liste (eski sunucu 404 → şerit yok), uygula, kaydet, güncelle, sil. Uygula cevabı
// tercih formunun sorgusuna yazılır (form CEVAPTAN yeniden kurulur); kaydet `clientToken`ı mantıksal deneme başınadır.
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { NOTIFICATION_QUERY_KEY } from "@/lib/bildirim/hooks";
import { useAttemptToken } from "@/lib/attemptToken";
import type { NotificationProfileChannel, NotificationProfilesView } from "@/lib/bildirim/types";
import { actionErrorMessage } from "@/pages/Operations/LoomAlarms/useLoomAlarmActions";
import { bildirimService, httpStatusOf } from "@/services/bildirimService";
import { applyBody, type ProfileChip } from "./profile-strip-model";
import { PREF_QUERY_KEY } from "./useNotificationSettingsForm";

export const profilesQueryKey = (kanal: NotificationProfileChannel) => [...NOTIFICATION_QUERY_KEY, "profiller", kanal] as const;

export function useProfileStrip(kanal: NotificationProfileChannel, enabled: boolean) {
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const key = profilesQueryKey(kanal);
  const list = useQuery({ queryKey: key, queryFn: () => bildirimService.profiller(kanal), enabled, retry: false });
  const setView = (v: NotificationProfilesView) => qc.setQueryData(key, v);

  const apply = useMutation({
    mutationFn: (c: ProfileChip) => bildirimService.profilUygula(applyBody(c, kanal)),
    onSuccess: (r, c) => {
      qc.setQueryData(PREF_QUERY_KEY, { hucreler: r.hucreler, satirlar: r.satirlar });
      setView(r.profiller);
      void qc.invalidateQueries({ queryKey: [...NOTIFICATION_QUERY_KEY, "katalog"] });
      toast.success(`“${c.ad}” profili uygulandı.`);
    },
    // eslint-disable-next-line yerel/mutation-onerror-toast -- istekler `suppressErrorToast` taşır: sunucu cümlesi TEK toast
    onError: (e) => toast.error(actionErrorMessage(e)),
  });

  const create = useMutation({
    mutationFn: (ad: string) => bildirimService.profilKaydet({ ad, kanal, clientToken: attempt.token() }),
    onSuccess: (r) => {
      attempt.onSuccess();
      setView(r.profiller);
      toast.success(`“${r.profil?.ad ?? ""}” profili kaydedildi.`);
    },
    onError: (e) => {
      attempt.onFailure(e);
      // eslint-disable-next-line yerel/mutation-onerror-toast -- istekler `suppressErrorToast` taşır: sunucu cümlesi TEK toast
      toast.error(actionErrorMessage(e));
    },
  });

  const update = useMutation({
    mutationFn: (b: { id: string; ad?: string; seciminiGuncelle?: boolean }) => bildirimService.profilGuncelle(b.id, { ad: b.ad, kanal, seciminiGuncelle: b.seciminiGuncelle }),
    onSuccess: (r, b) => {
      setView(r.profiller);
      toast.success(b.seciminiGuncelle ? "Profil şu anki seçimle güncellendi." : "Profil adı değişti.");
    },
    // eslint-disable-next-line yerel/mutation-onerror-toast -- istekler `suppressErrorToast` taşır: sunucu cümlesi TEK toast
    onError: (e) => toast.error(actionErrorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => bildirimService.profilSil(id, kanal),
    onSuccess: (v) => {
      setView(v);
      toast.success("Profil silindi; bildirim seçiminiz değişmedi.");
    },
    // eslint-disable-next-line yerel/mutation-onerror-toast -- istekler `suppressErrorToast` taşır: sunucu cümlesi TEK toast
    onError: (e) => toast.error(actionErrorMessage(e)),
  });

  /** Eski sunucu (uç yok) ya da hata → şerit çizilmez; tercih ekranı eskisi gibi çalışır. */
  const unsupported = list.isError && (httpStatusOf(list.error) === 404 || httpStatusOf(list.error) === 405);
  return { view: list.data ?? null, unsupported, failed: list.isError, apply, create, update, remove, renewAttempt: attempt.renew };
}
