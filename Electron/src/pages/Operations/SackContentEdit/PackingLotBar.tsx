import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Boxes, Eye, EyeOff, Lock, MoreVertical, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { sackHubService } from "./service";
import { invalidateSackHub } from "./useSackData";
import { SackContentDumpMenu } from "./SackContentDumpMenu";
import { PackingGroupEditDialog } from "./PackingGroupBar";
import { fromDumpRows } from "./sackDump";
import { lotChipSummary, lotDeletable } from "./packingLotUi";
import { UNGROUPED_FILTER_VALUE, type PackingGroup } from "./types";

/**
 * SEVK PARTİSİ ŞERİDİ (2026-09-21) — `PackingGroupBar`ın parti-modu ikizi.
 *
 * Fark: parti bir KAPTIR — boş doğar ve yaşar ("Sevk Partisi Oluştur" çuvalsız
 * kurar), açık/kapalı durum taşır (toggleMut · yeniden aç), hiç çuvalı olmamışsa
 * silinir, sevk edilmiş çuvallar partide sayılır. Çip seçimi listeyi SUNUCUDA
 * süzer (`filter[packingGroupId]`) — sayfalama kuralı grup şeridiyle aynı.
 *
 * Grup modunun şeridi DOKUNULMADAN duruyor: iki mod aynı bileşende dallansaydı
 * "grup modunda bayt bayt eski" iddiası her dokunuşta yeniden ölçülmek zorunda kalırdı.
 */
export function PackingLotBar({ customerId }: { customerId: string | null }) {
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [editing, setEditing] = useState<PackingGroup | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  const q = useQuery({
    queryKey: ["packing-groups", customerId, showClosed ? "ALL" : "OPEN"],
    queryFn: () => sackHubService.listPackingGroups(customerId!, showClosed ? "ALL" : "OPEN"),
    enabled: !!customerId,
  });
  const lots: PackingGroup[] = q.data?.data ?? [];

  const selected = searchParams.get("filter[packingGroupId]") ?? "";
  const select = (deger: string) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (deger) next.set("filter[packingGroupId]", deger);
        else next.delete("filter[packingGroupId]");
        next.delete("cursor"); // eski süzgecin imleci yeni süzgeçte yanlış sayfa açar
        return next;
      },
      { replace: true },
    );
  const refresh = () => {
    invalidateSackHub(qc);
    void qc.invalidateQueries({ queryKey: ["packing-groups"] });
  };

  if (!customerId) return null;

  return (
    <>
      <div className="mx-4 mb-2 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Boxes className="h-3.5 w-3.5" /> Sevk partileri:
        </span>

        <Button size="sm" variant={selected === "" ? "default" : "outline"} className="h-7" onClick={() => select("")}>
          Tümü
        </Button>

        {lots.map((p) => (
          <LotChip key={p.id} lot={p} selected={selected === p.id} onSelect={() => select(p.id)} onEdit={() => setEditing(p)} onDone={refresh} />
        ))}

        <Button
          size="sm"
          variant={selected === UNGROUPED_FILTER_VALUE ? "default" : "outline"}
          className="h-7"
          onClick={() => select(UNGROUPED_FILTER_VALUE)}
        >
          Partisiz
        </Button>

        <LotBarActions
          customerId={customerId}
          showClosed={showClosed}
          onToggleClosed={() => setShowClosed((v) => !v)}
          onCreated={(id) => {
            refresh();
            select(id);
          }}
        />

        {selected && selected !== UNGROUPED_FILTER_VALUE && (
          <SackContentDumpMenu
            label="Parti Dökümü"
            align="end"
            scopeLabel={lots.find((p) => p.id === selected)?.name}
            load={async () => fromDumpRows((await sackHubService.contentDump([], selected)).data)}
            hasNotes
          />
        )}
      </div>

      <PackingGroupEditDialog grup={editing} onOpenChange={(o) => !o && setEditing(null)} onDone={refresh} lot />
    </>
  );
}

/** "Sevk Partisi Oluştur" (boş parti) + kapalıları göster/gizle. Ayrı bileşen: şerit 80 satır altında kalsın. */
function LotBarActions({
  customerId,
  showClosed,
  onToggleClosed,
  onCreated,
}: {
  customerId: string;
  showClosed: boolean;
  onToggleClosed: () => void;
  onCreated: (id: string) => void;
}) {
  const create = useMutation({
    mutationFn: () => sackHubService.createPackingGroup({ customerId, sackIds: [], clientToken: crypto.randomUUID() }),
    onSuccess: (res) => {
      toast.success(`${res.data.name} oluşturuldu — çuval açmaya başlayabilirsiniz.`);
      onCreated(res.data.id);
    },
  });
  return (
    <>
      <Button
        size="sm"
        className="h-7 gap-1"
        disabled={create.isPending}
        title="Boş bir sevk partisi açar; çuvallar bu partinin içinde açılır ve ambalaj numarası alır"
        onClick={() => create.mutate()}
      >
        <Plus className="h-3.5 w-3.5" /> {create.isPending ? "Açılıyor…" : "Sevk Partisi Oluştur"}
      </Button>
      <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={onToggleClosed}>
        {showClosed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        {showClosed ? "Kapalıları gizle" : "Kapalıları göster"}
      </Button>
    </>
  );
}

/** Tek parti çipi + menüsü (kapat · yeniden aç · sil · adlandır). */
function LotChip({
  lot,
  selected,
  onSelect,
  onEdit,
  onDone,
}: {
  lot: PackingGroup;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDone: () => void;
}) {
  const closed = lot.status === "CLOSED";
  // Kapat / yeniden aç / sil `shipping:packing-lot` ister (belgeye basılan kimlik) —
  // yetkisiz kullanıcıda menü maddeleri kapalı; sunucu ayrıca 403 verir.
  const canManage = useRoleAccess().hasPermission("shipping:packing-lot");
  const toggleMut = useMutation({
    mutationFn: () => (closed ? sackHubService.reopenPackingGroup(lot.id) : sackHubService.closePackingGroup(lot.id)),
    onSuccess: (res) => {
      toast.success(res.message ?? (closed ? `${lot.name} yeniden açıldı` : `${lot.name} kapatıldı`));
      onDone();
    },
  });
  const removeMut = useMutation({
    mutationFn: () => sackHubService.deletePackingGroup(lot.id),
    onSuccess: (res) => {
      toast.success(res.message ?? `${lot.name} silindi`);
      onDone();
    },
  });
  return (
    <div className="inline-flex items-center">
      <Button
        size="sm"
        variant={selected ? "default" : "outline"}
        className={cn("h-7 rounded-r-none gap-1", lot.note && "italic", closed && "opacity-60")}
        title={lot.note ?? (closed ? "Kapalı parti" : undefined)}
        onClick={onSelect}
      >
        {closed && <Lock className="h-3 w-3" />}
        {lot.name}
        <span className="ml-1 text-[11px] opacity-70">{lotChipSummary(lot)}</span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="h-7 rounded-l-none border-l-0 px-1.5">
            <MoreVertical className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={onEdit}>Adı / notu düzenle</DropdownMenuItem>
          <DropdownMenuItem disabled={!canManage || toggleMut.isPending} onSelect={() => toggleMut.mutate()}>
            {closed ? "Yeniden aç" : "Partiyi kapat"}
          </DropdownMenuItem>
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
    </div>
  );
}
