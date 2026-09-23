import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Boxes, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { customerService } from "@/pages/Customers/service";
import { sackHubService } from "@/pages/Operations/SackContentEdit/service";
import { safeFormat } from "@/lib/format";
import { PACKING_LOT_STALE_MS } from "@/pages/Operations/SackContentEdit/useSackData";

/**
 * İADE — "SEVK PARTİSİNDEN SEÇ" (barkodsuz yol). Partinin barkodu yoktur: cari →
 * parti listesi. Yalnız SEVK EDİLMİŞ çuvalı olan partiler anlamlıdır (iade konusu);
 * hiç sevk edilmemiş parti listelenmez. Seçim `lookupLot` kapsamını açar — iade
 * oluşturmaz.
 */
export function ReturnLotPicker({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (packingGroupId: string) => void;
}) {
  const [customerId, setCustomerId] = useState<string | null>(null);
  const lots = useQuery({
    queryKey: ["packing-groups", customerId, "ALL"],
    staleTime: PACKING_LOT_STALE_MS,
    queryFn: () => sackHubService.listPackingGroups(customerId as string, "ALL"),
    enabled: open && !!customerId,
  });
  const rows = (lots.data?.data ?? []).filter((g) => g.shippedSackCount > 0);
  const close = () => {
    setCustomerId(null);
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Sevk Partisi Seç</DialogTitle>
          <DialogDescription>Cariyi seçin; sevk edilmiş çuvalı olan partiler listelenir. Partinin sevk edilmiş çuvalları iade kapsamına gelir.</DialogDescription>
        </DialogHeader>
        <ReferenceSelect
          value={customerId}
          onChange={setCustomerId}
          service={customerService}
          queryKey="customers"
          getLabel={(c) => (c.code ? `${c.code} — ${c.name}` : c.name)}
          placeholder="Cari ara/seç…"
        />
        <div className="max-h-[46vh] overflow-auto rounded-md border">
          {!customerId ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Önce cari seçin.</p>
          ) : lots.isLoading ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Yükleniyor…</p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Bu carinin sevk edilmiş çuvalı olan partisi yok.</p>
          ) : (
            rows.map((g) => (
              <button
                key={g.id}
                type="button"
                className="flex w-full items-center gap-3 border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-muted/50"
                onClick={() => {
                  onPick(g.id);
                  close();
                }}
              >
                <Boxes className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{g.name}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {g.shippedSackCount} çuval sevk edildi{g.sackCount > 0 ? ` · ${g.sackCount} açık` : ""} · {g.status === "CLOSED" ? "sevk edildi" : "açık"}
                </span>
                <span className="whitespace-nowrap text-xs text-muted-foreground">{safeFormat(g.createdAt, "dd.MM.yyyy")}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
