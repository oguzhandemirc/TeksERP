// "Takip et" / "Takip ediliyor ▾ (Takibi bırak)" (N4-PANEL, plan §6.6). Durum sunucudan (`GET /takip`);
// bayrak kapalı, eski sunucu (404) ya da kayıt görülemiyorsa düğme ÇİZİLMEZ — ölü düğme yok.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellPlus, BellRing, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { NOTIFICATION_QUERY_KEY, useNotificationInboxFlag } from "@/lib/bildirim/hooks";
import type { FollowRecordType } from "@/lib/bildirim/types";
import { bildirimService, type FollowState } from "@/services/bildirimService";

/** Bildirim istemcisi genel hata tostunu bastırır (`suppressErrorToast`) → eylem cümlesini çağıran basar. */
export function showFollowError(message: string) {
  toast.error(message);
}

export const followQueryKey = (type: FollowRecordType, id: string) => [...NOTIFICATION_QUERY_KEY, "takip", type, id] as const;

export function FollowButton({ type, id, className }: { type: FollowRecordType; id: string | null | undefined; className?: string }) {
  const { acik } = useNotificationInboxFlag();
  const qc = useQueryClient();
  const enabled = acik && !!id;
  const key = followQueryKey(type, id ?? "");
  const q = useQuery({ queryKey: key, queryFn: () => bildirimService.takip(type, id!), enabled, retry: false, staleTime: 30_000 });
  const mut = useMutation({
    mutationFn: (follow: boolean): Promise<FollowState> => (follow ? bildirimService.takipEt(type, id!) : bildirimService.takibiBirak(type, id!)),
    onSuccess: (r, follow) => {
      qc.setQueryData(key, r);
      toast.success(follow ? "Takip ediliyorsunuz; bu kayıtla ilgili bildirimler size gelir." : "Takip bırakıldı.");
    },
    onError: () => showFollowError("Takip durumu değiştirilemedi."),
  });
  if (!enabled || !q.data) return null;
  if (!q.data.takip) {
    return (
      <Button type="button" size="sm" variant="outline" className={className ?? "gap-1"} disabled={mut.isPending} onClick={() => mut.mutate(true)}>
        <BellPlus className="h-4 w-4" /> Takip et
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="sm" variant="secondary" className={className ?? "gap-1"} disabled={mut.isPending}>
          <BellRing className="h-4 w-4" /> Takip ediliyor <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => mut.mutate(false)}>Takibi bırak</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
