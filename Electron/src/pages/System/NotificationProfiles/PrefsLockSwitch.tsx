// Profil tercih kilidi: açıkken üyeler kendi "uygulama içi" seçimini (Anlık/Özet/Kapalı, kapsam) değiştiremez.
// Birden çok profilde üye olan kişi, profillerinden biri kilitliyse kilitlidir (sunucu kuralı). Anında kaydedilir.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { actionErrorMessage } from "@/pages/Operations/LoomAlarms/useLoomAlarmActions";
import { bildirimProfilService, type NotificationProfile } from "@/services/bildirimProfilService";
import { PROFILES_QUERY_ROOT } from "./queries";

export function PrefsLockSwitch({ profile }: { profile: NotificationProfile }) {
  const qc = useQueryClient();
  const readOnly = profile.arsivlendi !== null || profile.tercihKilidi === undefined;
  const save = useMutation({
    mutationFn: (v: boolean) => bildirimProfilService.tercihKilidiYaz(profile.id, v),
    onSuccess: (p) => {
      toast.success(p.tercihKilidi ? "Üyelerin bildirim tercihleri kilitlendi." : "Tercih kilidi kaldırıldı.");
      void qc.invalidateQueries({ queryKey: PROFILES_QUERY_ROOT });
    },
    // eslint-disable-next-line yerel/mutation-onerror-toast -- istekler `suppressErrorToast` taşır: sunucu cümlesi TEK toast
    onError: (e) => toast.error(actionErrorMessage(e)),
  });
  return (
    <div className="flex items-start gap-3 rounded-md border bg-muted/30 px-3 py-2.5">
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <label htmlFor={`tercih-kilidi-${profile.id}`} className="text-sm font-medium">
          Üyeler bildirim tercihlerini değiştiremez
        </label>
        <p className="text-xs text-muted-foreground">
          Açıkken üyeler uygulama içi seçimlerini (Anlık · Özet · Kapalı) değiştiremez; masaüstü, tablet sesi ve sessiz saat
          serbest kalır. Kişi başına değişikliği Kullanıcılar → kişi → Bildirimler sekmesinden yaparsınız.
        </p>
      </div>
      <Switch
        id={`tercih-kilidi-${profile.id}`}
        checked={profile.tercihKilidi === true}
        disabled={readOnly || save.isPending}
        onCheckedChange={(v) => save.mutate(v)}
        aria-label="Üyeler bildirim tercihlerini değiştiremez"
      />
    </div>
  );
}
