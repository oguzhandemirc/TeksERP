import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Boxes, Lock, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { sackHubService } from "./service";
import { invalidateSackHub } from "./useSackData";
import { SackContentDumpMenu } from "./SackContentDumpMenu";
import { PackingGroupEditDialog } from "./PackingGroupBar";
import { fromDumpRows } from "./sackDump";
import { lotDeletable, lotSackLabel } from "./packingLotUi";
import { UNGROUPED_FILTER_VALUE, type PackingGroup } from "./types";

/**
 * PARTİ İÇİ BAŞLIK (sevk partisi modu) — çuval listesinin üstünde "SP-2 · Cuma tırı ·
 * 3 çuval" + menü (adlandır · sil) + parti dökümü. Parti listesine dönüş PageHeader'ın
 * geri okudur (tek geri yüzeyi kuralı). `UNGROUPED_FILTER_VALUE` için "Partisiz
 * çuvallar (havuz)" başlığı ve "seç → Partiye Al" ipucu. Sevk edilmiş partide
 * (CLOSED) çuval açılamaz — başlık bunu söyler; sevk edilenler Sevkiyatlar'da.
 */
export function PackingLotHeader({ customerId, groupFilter }: { customerId: string; groupFilter: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<PackingGroup | null>(null);
  const isUngrouped = groupFilter === UNGROUPED_FILTER_VALUE;
  const lot = useQuery({
    queryKey: ["packing-group", groupFilter],
    queryFn: () => sackHubService.getPackingGroup(groupFilter),
    enabled: !isUngrouped,
  });
  const refresh = () => {
    invalidateSackHub(qc);
    void qc.invalidateQueries({ queryKey: ["packing-groups"] });
    void qc.invalidateQueries({ queryKey: ["packing-group", groupFilter] });
    void qc.invalidateQueries({ queryKey: ["packing-lot-summary", customerId] });
  };
  const g = lot.data?.data;

  return (
    <div className="mx-4 mb-2 flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-1.5 text-sm">
      <Boxes className="h-4 w-4 text-muted-foreground" />
      {isUngrouped ? (
        <>
          <span className="font-medium">Partisiz çuvallar (havuz)</span>
          <span className="text-xs text-muted-foreground">çuvalları seç → "Partiye Al" ya da doğrudan "Sevk Et"</span>
        </>
      ) : g ? (
        <>
          {g.status === "CLOSED" && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
          <span className="font-medium">{g.name}</span>
          <span className="text-xs text-muted-foreground">{lotSackLabel(g)}</span>
          {g.status === "CLOSED" && <span className="text-xs text-muted-foreground">— sevk edildi; yeni çuval açılamaz</span>}
          {g.note && <span className="text-xs italic text-muted-foreground">— {g.note}</span>}
          <span className="ml-auto inline-flex items-center gap-1">
            <SackContentDumpMenu
              label="Parti Dökümü"
              align="end"
              scopeLabel={g.name}
              load={async () => fromDumpRows((await sackHubService.contentDump([], g.id)).data)}
              hasNotes
            />
            <LotRowMenu lot={g} onDone={refresh} onEdit={() => setEditing(g)} />
          </span>
        </>
      ) : (
        <span className="text-xs text-muted-foreground">Parti yükleniyor…</span>
      )}
      <PackingGroupEditDialog grup={editing} onOpenChange={(o) => !o && setEditing(null)} onDone={refresh} lot />
    </div>
  );
}

/**
 * Parti satır/başlık menüsü: adlandır · sil. Durum ELLE DEĞİŞMEZ (kapat/aç yok —
 * parti son çuvalı sevk edilince kendiliğinden "sevk edildi" olur). Sil
 * `shipping:packing-lot` ister (belgeye basılan kimlik) — yetkisiz kullanıcıda madde
 * kapalı, sunucu ayrıca 403 verir. `onEdit` verilmezse kendi düzenleme penceresini açar.
 */
export function LotRowMenu({ lot, onDone, onEdit }: { lot: PackingGroup; onDone: () => void; onEdit?: () => void }) {
  const [editing, setEditing] = useState<PackingGroup | null>(null);
  const canManage = useRoleAccess().hasPermission("shipping:packing-lot");
  const removeMut = useMutation({
    mutationFn: () => sackHubService.deletePackingGroup(lot.id),
    onSuccess: (res) => {
      toast.success(res.message ?? `${lot.name} silindi`);
      onDone();
    },
  });
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="h-7 px-1.5" aria-label="Parti menüsü">
            <MoreVertical className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => (onEdit ? onEdit() : setEditing(lot))}>Adı / notu düzenle</DropdownMenuItem>
          <DropdownMenuSeparator />
          {/* Sil yalnız HİÇ çuvalı olmamış partide — sunucu da 409 ile korur. */}
          <DropdownMenuItem
            disabled={!canManage || !lotDeletable(lot) || removeMut.isPending}
            className="text-destructive"
            onSelect={() => removeMut.mutate()}
          >
            Sil (yalnız boş parti)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {!onEdit && <PackingGroupEditDialog grup={editing} onOpenChange={(o) => !o && setEditing(null)} onDone={onDone} lot />}
    </>
  );
}
