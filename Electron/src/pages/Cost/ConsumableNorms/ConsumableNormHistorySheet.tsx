// Bir (hizmet × sarf) çiftinin norm sürümleri (damgalı dahil) + aktif normu kaldırma (silinmez, damgalanır).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { PermissionGate } from "@/components/PermissionGate";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { fmtDecFull } from "../shared/format";
import { consumableNormService, type ConsumableNorm } from "./service";

export function ConsumableNormHistorySheet({ row, onClose }: { row: ConsumableNorm; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["cost-consumable-norms", "history", row.serviceItemId, row.consumableItemId],
    queryFn: () => consumableNormService.history(row.serviceItemId, row.consumableItemId),
  });
  const [revokeOpen, setRevokeOpen] = useState(false);
  const revoke = useMutation({
    mutationFn: () => consumableNormService.revoke(row.id),
    onSuccess: (r) => {
      toast.success(r.message ?? "Sarf normu kaldırıldı.");
      void qc.invalidateQueries({ queryKey: ["cost-consumable-norms"] });
      onClose();
    },
  });
  const pair = `${row.serviceItem.code} × ${row.consumableItem.code}`;
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{pair} — norm geçmişi</SheetTitle>
          <SheetDescription>{row.serviceItem.name} için {row.consumableItem.name}. Her değişiklik yeni sürümdür; eski normlar silinmez.</SheetDescription>
        </SheetHeader>
        <ul className="mt-4 space-y-2 text-sm">
          {(q.data ?? []).map((p) => (
            <li key={p.id} className="rounded-md border p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium tabular-nums">{fmtDecFull(p.qtyPerM, 6)} {p.unit}/m</span>
                {p.revokedAt ? <Badge variant="muted">Damgalı</Badge> : <Badge>Geçerli</Badge>}
              </div>
              <p className="text-xs text-muted-foreground">
                {fmtFactoryDateTime(p.createdAt)}{p.revokedAt ? ` → ${fmtFactoryDateTime(p.revokedAt)}` : " → şu an"}{p.note ? ` · ${p.note}` : ""}
              </p>
            </li>
          ))}
          {q.isLoading && <li className="text-muted-foreground">Yükleniyor…</li>}
        </ul>
        {!row.revokedAt && (
          <PermissionGate permission="cost:write">
            <Button variant="ghost" className="mt-4 text-destructive" onClick={() => setRevokeOpen(true)}>Normu kaldır</Button>
          </PermissionGate>
        )}
        <ConfirmDialog
          open={revokeOpen}
          onOpenChange={setRevokeOpen}
          title={`${pair} normu kaldırılsın mı?`}
          description={`${fmtDecFull(row.qtyPerM, 6)} ${row.unit}/m damgalanır, silinmez. Bu hizmetin bundan sonraki işlerinde bu sarf kârlılığa girmez; geçmiş aylar değişmez.`}
          confirmLabel="Kaldır"
          destructive
          isPending={revoke.isPending}
          onConfirm={() => revoke.mutateAsync().then(() => setRevokeOpen(false))}
        />
      </SheetContent>
    </Sheet>
  );
}
