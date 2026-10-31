// Bir tarife kodunun sürümleri (damgalı dahil) + aktif tarifeyi kaldırma (silinmez, damgalanır).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { PermissionGate } from "@/components/PermissionGate";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { fmtDecFull, fmtPct } from "../shared/format";
import { FINISHING_BASIS_LABEL, finishingBasisUnit, finishingRateService, type FinishingRate } from "./service";

export function FinishingRateHistorySheet({ row, onClose }: { row: FinishingRate; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["cost-finishing-rates", "history", row.code], queryFn: () => finishingRateService.history(row.code) });
  const [revokeOpen, setRevokeOpen] = useState(false);
  const revoke = useMutation({
    mutationFn: () => finishingRateService.revoke(row.id),
    onSuccess: (r) => {
      toast.success(r.message ?? "Tarife kaldırıldı.");
      void qc.invalidateQueries({ queryKey: ["cost-finishing-rates"] });
      void qc.invalidateQueries({ queryKey: ["cost-items"] });
      onClose();
    },
  });
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{row.code} — tarife geçmişi</SheetTitle>
          <SheetDescription>{row.name}. Her değişiklik yeni satırdır; eski tarifeler silinmez.</SheetDescription>
        </SheetHeader>
        <ul className="mt-4 space-y-2 text-sm">
          {(q.data ?? []).map((p) => (
            <li key={p.id} className="rounded-md border p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium tabular-nums">{fmtDecFull(p.pricePerM)} {p.currency}/{finishingBasisUnit(p.basis)} · {FINISHING_BASIS_LABEL[p.basis]}</span>
                {p.revokedAt ? <Badge variant="muted">Damgalı</Badge> : <Badge>Aktif</Badge>}
              </div>
              <p className="text-xs text-muted-foreground">
                {fmtFactoryDateTime(p.createdAt)} · çekme {fmtPct(p.typicalShrinkPct)}{p.subcontractor ? ` · ${p.subcontractor.name}` : ""}
                {p.revokedAt ? ` · kapanış ${fmtFactoryDateTime(p.revokedAt)}` : ""}{p.note ? ` · ${p.note}` : ""}
              </p>
            </li>
          ))}
          {q.isLoading && <li className="text-muted-foreground">Yükleniyor…</li>}
        </ul>
        <PermissionGate permission="cost:write">
          <Button variant="ghost" className="mt-4 text-destructive" onClick={() => setRevokeOpen(true)}>Tarifeyi kaldır</Button>
        </PermissionGate>
        <ConfirmDialog
          open={revokeOpen}
          onOpenChange={setRevokeOpen}
          title={`${row.code} tarifesi kaldırılsın mı?`}
          description={`${row.code} (${fmtDecFull(row.pricePerM)} ${row.currency}/${finishingBasisUnit(row.basis)}) damgalanır, silinmez. Bu kodu kullanan kumaşlar tarife yeniden yazılana dek "tarife çözülemedi" eksikliği verir; kayıtlı standart maliyetler değişmez.`}
          confirmLabel="Kaldır"
          destructive
          isPending={revoke.isPending}
          onConfirm={() => revoke.mutateAsync().then(() => setRevokeOpen(false))}
        />
      </SheetContent>
    </Sheet>
  );
}
