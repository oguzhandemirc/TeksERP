// Yeni profil (ad + kod) ya da yeniden adlandırma (yalnız ad; kod doğuşta sabitlenir).
// POST `clientToken` mantıksal deneme başına: yalnız belirsiz hatada (ağ/zaman aşımı/5xx) aynı token yeniden gider.
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAttemptToken } from "@/lib/attemptToken";
import { actionErrorMessage } from "@/pages/Operations/LoomAlarms/useLoomAlarmActions";
import { bildirimProfilService, type NotificationProfile } from "@/services/bildirimProfilService";
import { PROFILES_QUERY_ROOT } from "./queries";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Verilirse yeniden adlandırma. */
  profile?: NotificationProfile | null;
  onSaved: (p: NotificationProfile) => void;
}

export function ProfileFormDialog({ open, onOpenChange, profile, onSaved }: Props) {
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const [ad, setAd] = useState("");
  const [kod, setKod] = useState("");
  useEffect(() => {
    if (!open) return;
    setAd(profile?.ad ?? "");
    setKod(profile?.kod ?? "");
    attempt.renew();
  }, [open, profile, attempt]);

  const save = useMutation({
    mutationFn: () =>
      profile
        ? bildirimProfilService.yenidenAdlandir(profile.id, ad.trim())
        : bildirimProfilService.olustur({ ad: ad.trim(), kod: kod.trim().toUpperCase(), clientToken: attempt.token() }),
    onSuccess: (p) => {
      attempt.onSuccess();
      toast.success(profile ? "Profil adı değişti." : "Profil oluşturuldu.");
      void qc.invalidateQueries({ queryKey: PROFILES_QUERY_ROOT });
      onSaved(p);
      onOpenChange(false);
    },
    onError: (e) => {
      attempt.onFailure(e);
      // eslint-disable-next-line yerel/mutation-onerror-toast -- istekler `suppressErrorToast` taşır: sunucu cümlesi TEK toast
      toast.error(actionErrorMessage(e));
    },
  });

  const valid = ad.trim().length > 0 && (profile || /^[A-Za-z0-9_-]{1,40}$/.test(kod.trim()));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{profile ? "Profili yeniden adlandır" : "Yeni bildirim profili"}</DialogTitle>
          <DialogDescription>Profil yalnız bildirim tercih setidir; izin vermez.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !save.isPending) save.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="profil-ad">Ad</Label>
            <Input id="profil-ad" autoFocus maxLength={120} value={ad} onChange={(e) => setAd(e.target.value)} placeholder="Ör. Vardiya amirleri" />
          </div>
          {!profile && (
            <div className="space-y-1.5">
              <Label htmlFor="profil-kod">Kod</Label>
              <Input id="profil-kod" maxLength={40} value={kod} onChange={(e) => setKod(e.target.value)} placeholder="Ör. VRD" />
              <p className="text-xs text-muted-foreground">Harf, rakam, - ve _; sonradan değişmez.</p>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Vazgeç</Button>
            <Button type="submit" disabled={!valid || save.isPending}>{profile ? "Kaydet" : "Oluştur"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
