// Bir formül kodunun sürümleri (damgalı dahil) + aktif formülü kaldırma (silinmez, damgalanır).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { PermissionGate } from "@/components/PermissionGate";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { costFormulaService, type CostFormula } from "./service";

export function FormulaHistorySheet({ row, onClose }: { row: CostFormula; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["cost-formulas", "history", row.code], queryFn: () => costFormulaService.history(row.code) });
  const [revokeOpen, setRevokeOpen] = useState(false);
  const revoke = useMutation({
    mutationFn: () => costFormulaService.revoke(row.id),
    onSuccess: (r) => {
      toast.success(r.message ?? "Formül kaldırıldı.");
      void qc.invalidateQueries({ queryKey: ["cost-formulas"] });
      onClose();
    },
  });
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{row.name} — formül geçmişi</SheetTitle>
          <SheetDescription>Kod {row.code}. Her değişiklik yeni sürümdür; eski sürümler silinmez, o sürümle yazılmış standart maliyetler değişmez.</SheetDescription>
        </SheetHeader>
        <ul className="mt-4 space-y-2 text-sm">
          {(q.data ?? []).map((p) => (
            <li key={p.id} className="rounded-md border p-2">
              <div className="flex items-center justify-between gap-2">
                <code className="font-mono text-xs">{p.expression}</code>
                {p.revokedAt ? <Badge variant="muted">Sürüm {p.versionNo} · damgalı</Badge> : <Badge>Sürüm {p.versionNo} · aktif</Badge>}
              </div>
              <p className="text-xs text-muted-foreground">
                {fmtFactoryDateTime(p.createdAt)} · {p.currency}/m{p.createdBy ? ` · ${p.createdBy.fullName}` : ""}
                {p.revokedAt ? ` · kapanış ${fmtFactoryDateTime(p.revokedAt)}${p.revokeReason ? ` (${p.revokeReason})` : ""}` : ""}{p.note ? ` · ${p.note}` : ""}
              </p>
            </li>
          ))}
          {q.isLoading && <li className="text-muted-foreground">Yükleniyor…</li>}
        </ul>
        <PermissionGate permission="cost:settings">
          <Button variant="ghost" className="mt-4 text-destructive" onClick={() => setRevokeOpen(true)}>Formülü kaldır</Button>
        </PermissionGate>
        <ConfirmDialog
          open={revokeOpen}
          onOpenChange={setRevokeOpen}
          title={`"${row.name}" formülü kaldırılsın mı?`}
          description="Formül damgalanır, silinmez. Bundan sonraki maliyet hesaplarına girmez; kayıtlı standart maliyet sürümleri yazıldıkları formülle kalır."
          confirmLabel="Kaldır"
          destructive
          isPending={revoke.isPending}
          onConfirm={() => revoke.mutateAsync().then(() => setRevokeOpen(false))}
        />
      </SheetContent>
    </Sheet>
  );
}
