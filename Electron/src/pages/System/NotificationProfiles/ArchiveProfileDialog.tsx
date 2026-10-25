// Arşivleme onayı: üyesi olan profil CANLI REFERANSLIDIR, arşivlenemez (sunucu 409 `NOTIFICATION_PROFILE_IN_USE`);
// pencere üyeleri listeler ve önce çıkarılmalarını söyler. Üyesizse etki: matris çözüme katılmaz.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { actionErrorMessage } from "@/pages/Operations/LoomAlarms/useLoomAlarmActions";
import { bildirimProfilService, type NotificationProfile } from "@/services/bildirimProfilService";
import { PROFILES_QUERY_ROOT } from "./queries";

interface Props {
  profile: NotificationProfile | null;
  onOpenChange: (open: boolean) => void;
}

export function ArchiveProfileDialog({ profile, onOpenChange }: Props) {
  const qc = useQueryClient();
  const archive = useMutation({
    mutationFn: (id: string) => bildirimProfilService.arsivle(id),
    onSuccess: () => {
      toast.success("Profil arşivlendi.");
      void qc.invalidateQueries({ queryKey: PROFILES_QUERY_ROOT });
      onOpenChange(false);
    },
    // eslint-disable-next-line yerel/mutation-onerror-toast -- istekler `suppressErrorToast` taşır: sunucu cümlesi TEK toast
    onError: (e) => toast.error(actionErrorMessage(e)),
  });
  const members = profile?.uyeler ?? [];
  const blocked = members.length > 0;
  return (
    <Dialog open={profile !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Archive className="h-4 w-4" /> {profile?.ad} — arşivle</DialogTitle>
          <DialogDescription>
            {blocked
              ? `Bu profilin ${members.length} üyesi var; üyesi olan profil arşivlenemez. Önce Üyeler sekmesinden çıkarın.`
              : "Profilin üyesi yok. Arşivlenen profil çözüme katılmaz, matrisi salt okunur kalır; kayıt silinmez."}
          </DialogDescription>
        </DialogHeader>
        {blocked && (
          <ul className="max-h-60 divide-y overflow-y-auto rounded-md border text-sm" aria-label="Arşivi engelleyen üyeler">
            {members.map((m) => (
              <li key={m.userId} className="px-3 py-1.5">{m.ad}</li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Vazgeç</Button>
          <Button variant="destructive" disabled={blocked || archive.isPending || !profile} onClick={() => profile && archive.mutate(profile.id)}>
            Arşivle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
