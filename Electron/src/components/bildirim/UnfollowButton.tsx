// Bildirim satırı eylemi "Takipten çık" (plan §6.1 F4): yalnız TAKIPCI/OLUSTURAN sebepli ve konusu takip
// edilebilen satırda çizilir; takip durumu sunucuda değişir, aynı kaydın "Takip et" düğmesi de tazelenir.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BellOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { unfollowTarget } from "@/lib/bildirim/takip";
import type { NotificationItem } from "@/lib/bildirim/types";
import { bildirimService } from "@/services/bildirimService";
import { followQueryKey, showFollowError } from "./FollowButton";

export function UnfollowButton({ b }: { b: NotificationItem }) {
  const qc = useQueryClient();
  const target = unfollowTarget(b);
  const mut = useMutation({
    mutationFn: () => bildirimService.takibiBirak(target!.type, target!.id),
    onSuccess: (r) => {
      qc.setQueryData(followQueryKey(target!.type, target!.id), r);
      toast.success("Takip bırakıldı; bu kayıtla ilgili yeni bildirimler gelmez.");
    },
    onError: () => showFollowError("Takip bırakılamadı."),
  });
  if (!target) return null;
  return (
    <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" disabled={mut.isPending} onClick={() => mut.mutate()}>
      <BellOff className="h-3.5 w-3.5" /> Takipten çık
    </Button>
  );
}
