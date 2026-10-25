// Bildirim tercihleri formu: sunucu hücreleri → taslak; Kaydet = tam gövde PUT, form CEVAPTAN yeniden kurulur.
// 409 NOTIFICATION_KIND_LOCKED → o satır kilitli gösterilir (kilit arada profil/fabrikadan gelmiş olabilir).
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { NOTIFICATION_QUERY_KEY, useNotificationCatalog, useNotificationInboxFlag } from "@/lib/bildirim/hooks";
import { draftFromCells, draftsEqual, draftToBody, setGroupMode, type PreferenceDraft } from "@/lib/bildirim/tercih-taslak";
import type { NotificationUserSettings } from "@/lib/bildirim/types";
import { isQuietTime } from "./QuietHoursCard";
import { bildirimService, httpStatusOf, notificationErrorCode, notificationErrorDetail } from "@/services/bildirimService";

export const PREF_QUERY_KEY = [...NOTIFICATION_QUERY_KEY, "tercihler"] as const;
export const SETTINGS_QUERY_KEY = [...NOTIFICATION_QUERY_KEY, "ayarlar"] as const;

function unavailable(e: unknown): "eski" | "kapali" | null {
  if (httpStatusOf(e) === 404) return "eski";
  if (notificationErrorCode(e) === "BILDIRIM_KAPALI") return "kapali";
  return null;
}

function saveErrorMessage(kod: string | undefined): string {
  if (kod === "NOTIFICATION_KIND_LOCKED") return "Bu bildirim yöneticiniz tarafından kilitlendi; uygulama içinde kapatılamaz. Tekrar kaydedin.";
  if (kod === "NOTIFICATION_KIND_NOT_VISIBLE") return "Bir bildirim türünü artık göremiyorsunuz; liste yenilendi.";
  if (kod === "NOTIFICATION_SCOPE_INVALID") return "Kapsam süzgeci geçersiz; kapsamı yeniden seçin.";
  return "Tercihler kaydedilemedi.";
}

export function useNotificationSettingsForm() {
  const { acik, yuklendi } = useNotificationInboxFlag();
  const qc = useQueryClient();
  const katalog = useNotificationCatalog(acik);
  const tercih = useQuery({ queryKey: PREF_QUERY_KEY, queryFn: () => bildirimService.tercihler(), enabled: acik, retry: false });
  const settingsQuery = useQuery({ queryKey: SETTINGS_QUERY_KEY, queryFn: () => bildirimService.ayarlar(), enabled: acik, retry: false });
  const [taslak, setTaslak] = useState<PreferenceDraft>({});
  const [ayarTaslak, setAyarTaslak] = useState<NotificationUserSettings | null>(null);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const serverDraft = useMemo(() => draftFromCells(tercih.data?.hucreler ?? []), [tercih.data]);
  useEffect(() => setTaslak(serverDraft), [serverDraft]);
  useEffect(() => setAyarTaslak(settingsQuery.data ?? null), [settingsQuery.data]);
  const tercihKirli = !draftsEqual(taslak, serverDraft);
  const settingsDirty = !!ayarTaslak && !!settingsQuery.data && JSON.stringify(ayarTaslak) !== JSON.stringify(settingsQuery.data);

  const kaydet = async () => {
    setKaydediliyor(true);
    try {
      if (tercihKirli) {
        qc.setQueryData(PREF_QUERY_KEY, await bildirimService.tercihleriYaz(draftToBody(taslak)));
        void qc.invalidateQueries({ queryKey: [...NOTIFICATION_QUERY_KEY, "katalog"] });
      }
      if (settingsDirty && ayarTaslak) qc.setQueryData(SETTINGS_QUERY_KEY, await bildirimService.ayarlariYaz(ayarTaslak));
      toast.success("Bildirim tercihleri kaydedildi.");
    } catch (e) {
      const kod = notificationErrorCode(e);
      const tur = notificationErrorDetail(e, "tur");
      if (kod === "NOTIFICATION_KIND_LOCKED" && tur) {
        setTaslak((d) => (d[tur] ? { ...d, [tur]: { ...d[tur], kilit: true, mod: "ANLIK", kapsam: null } } : d));
      }
      if (kod === "NOTIFICATION_KIND_NOT_VISIBLE") void tercih.refetch();
      toast.error(saveErrorMessage(kod));
    } finally {
      setKaydediliyor(false);
    }
  };

  const grupToplu = (kodlar: readonly string[], acikMi: boolean) => {
    const { taslak: t, degisen } = setGroupMode(taslak, kodlar, acikMi);
    setTaslak(t);
    toast(degisen === 0 ? "Değişen satır yok (kilitliler atlandı)." : `${degisen} satır değişti.`);
  };

  const status = yuklendi && !acik ? "kapali" : (unavailable(tercih.error) ?? unavailable(katalog.error));
  const hata = tercih.isError || katalog.isError;
  const yukleniyor = !yuklendi || tercih.isLoading || katalog.isLoading;
  return { katalog: katalog.data, taslak, setTaslak, ayarTaslak, setAyarTaslak, kirli: (tercihKirli || settingsDirty) && (!ayarTaslak || (isQuietTime(ayarTaslak.sessizBaslangic) && isQuietTime(ayarTaslak.sessizBitis))), kaydediliyor, kaydet, grupToplu, status, hata, yukleniyor };
}
