// Bir makinenin saat ücreti sürümleri (damgalı dahil) + aktif ücreti kaldırma (silinmez, damgalanır).
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
import { machineRateService, type MachineCostRate } from "./service";

export function MachineRateHistorySheet({ row, onClose }: { row: MachineCostRate; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["cost-machine-rates", "history", row.machineId], queryFn: () => machineRateService.history(row.machineId) });
  const [revokeOpen, setRevokeOpen] = useState(false);
  const revoke = useMutation({
    mutationFn: () => machineRateService.revoke(row.id),
    onSuccess: (r) => {
      toast.success(r.message ?? "Saat ücreti kaldırıldı.");
      void qc.invalidateQueries({ queryKey: ["cost-machine-rates"] });
      onClose();
    },
  });
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{row.machine.code} — saat ücreti geçmişi</SheetTitle>
          <SheetDescription>{row.machine.name}. Her değişiklik yeni sürümdür; eski ücretler silinmez.</SheetDescription>
        </SheetHeader>
        <ul className="mt-4 space-y-2 text-sm">
          {(q.data ?? []).map((p) => (
            <li key={p.id} className="rounded-md border p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium tabular-nums">
                  {fmtDecFull(p.hourRateTry)} TL/saat{p.normMPerHour ? ` · ${fmtDecFull(p.normMPerHour, 2)} m/saat` : ""}
                </span>
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
            <Button variant="ghost" className="mt-4 text-destructive" onClick={() => setRevokeOpen(true)}>Ücreti kaldır</Button>
          </PermissionGate>
        )}
        <ConfirmDialog
          open={revokeOpen}
          onOpenChange={setRevokeOpen}
          title={`${row.machine.code} saat ücreti kaldırılsın mı?`}
          description={`${fmtDecFull(row.hourRateTry)} TL/saat damgalanır, silinmez. Bu makinenin bundan sonraki çalışması kârlılıkta "ücret eksik" görünür; geçmiş aylar değişmez.`}
          confirmLabel="Kaldır"
          destructive
          isPending={revoke.isPending}
          onConfirm={() => revoke.mutateAsync().then(() => setRevokeOpen(false))}
        />
      </SheetContent>
    </Sheet>
  );
}
