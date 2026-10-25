// Bir ipliğin fiyat geçmişi (damgalı satırlar dahil) + aktif fiyatı kaldırma. Satır silinmez: kaldırma damgadır.
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
import { YARN_PRICE_SOURCE_LABEL, yarnPriceService, type YarnCostPrice } from "./service";

export function YarnPriceHistorySheet({ row, onClose }: { row: YarnCostPrice; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["cost-yarn-prices", "history", row.yarnItemId], queryFn: () => yarnPriceService.history(row.yarnItemId) });
  const [revokeOpen, setRevokeOpen] = useState(false);
  const revoke = useMutation({
    mutationFn: () => yarnPriceService.revoke(row.id),
    onSuccess: (r) => {
      toast.success(r.message ?? "İplik fiyatı kaldırıldı.");
      void qc.invalidateQueries({ queryKey: ["cost-yarn-prices"] });
      void qc.invalidateQueries({ queryKey: ["cost-items"] });
      onClose();
    },
  });
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{row.yarnItem.code} — fiyat geçmişi</SheetTitle>
          <SheetDescription>{row.yarnItem.name}. Eski fiyatlar silinmez; her değişiklik yeni satırdır.</SheetDescription>
        </SheetHeader>
        <ul className="mt-4 space-y-2 text-sm">
          {(q.data ?? []).map((p) => (
            <li key={p.id} className="rounded-md border p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium tabular-nums">{fmtDecFull(p.pricePerKg)} {p.currency}/kg</span>
                {p.revokedAt ? <Badge variant="muted">Damgalı</Badge> : <Badge>Aktif</Badge>}
              </div>
              <p className="text-xs text-muted-foreground">
                {fmtFactoryDateTime(p.createdAt)} · {YARN_PRICE_SOURCE_LABEL[p.source] ?? p.source}
                {p.revokedAt ? ` · kapanış ${fmtFactoryDateTime(p.revokedAt)}` : ""}
                {p.note ? ` · ${p.note}` : ""}
              </p>
            </li>
          ))}
          {q.isLoading && <li className="text-muted-foreground">Yükleniyor…</li>}
        </ul>
        <PermissionGate permission="cost:write">
          <Button variant="ghost" className="mt-4 text-destructive" onClick={() => setRevokeOpen(true)}>Aktif fiyatı kaldır</Button>
        </PermissionGate>
        <ConfirmDialog
          open={revokeOpen}
          onOpenChange={setRevokeOpen}
          title="Aktif fiyat kaldırılsın mı?"
          description={`${row.yarnItem.code}: ${fmtDecFull(row.pricePerKg)} ${row.currency}/kg damgalanır (silinmez). Bu ipliği kullanan kumaşların maliyeti fiyat girilene dek "iplik fiyatı yok" eksikliği verir; kayıtlı standart maliyetler değişmez.`}
          confirmLabel="Kaldır"
          destructive
          isPending={revoke.isPending}
          onConfirm={() => revoke.mutateAsync().then(() => setRevokeOpen(false))}
        />
      </SheetContent>
    </Sheet>
  );
}
