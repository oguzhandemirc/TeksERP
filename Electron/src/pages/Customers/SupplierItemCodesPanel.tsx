// =============================================================================
// TEDARİKÇİ KARTI — "Kalem kodları" sekmesi (Seyitoğlu d5)
// =============================================================================
// Tedarikçinin irsaliyedeki kalem kodu → bizim iplik kartımız. Eşleme mal kabulde ÖĞRENİLİR (elle ekleme yok);
// burada görülür, başka karta bağlanır ya da kaldırılır (saf yapılandırma — kaldırılan kod sonraki kabulde
// yeniden öğrenilir; geçmiş mal kabul satırındaki kod izi değişmez).
// =============================================================================
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { ItemSelect } from "@/components/forms/ItemSelect";
import { InfoPopover } from "@/components/ui/info-popover";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { formatFactory } from "@/lib/factory-time";
import { supplierItemCodeService, type SupplierItemCodeRow } from "@/pages/Operations/GoodsReceipts/supplierItemCodeService";

interface Props {
  supplierId: string;
}

export function SupplierItemCodesPanel({ supplierId }: Props) {
  const qc = useQueryClient();
  const { hasPermission } = useRoleAccess();
  const canWrite = hasPermission("goods-receipt:write");
  const [removing, setRemoving] = useState<SupplierItemCodeRow | null>(null);
  const queryKey = ["supplier-item-codes", supplierId];
  const invalidate = () => qc.invalidateQueries({ queryKey });

  const { data, isLoading } = useQuery({ queryKey, queryFn: () => supplierItemCodeService.list(supplierId) });

  const updateMut = useMutation({
    mutationFn: ({ id, itemId }: { id: string; itemId: string }) => supplierItemCodeService.update(id, itemId),
    onSuccess: () => {
      toast.success("Kalem kodu yeni iplik kartına bağlandı.");
      void invalidate();
    },
  });
  const removeMut = useMutation({
    mutationFn: (id: string) => supplierItemCodeService.remove(id),
    onSuccess: () => {
      toast.success("Kalem kodu eşlemesi kaldırıldı.");
      void invalidate();
      setRemoving(null);
    },
  });

  const rows = data?.data ?? [];
  return (
    <div className="space-y-3" data-testid="supplier-item-codes-panel">
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span>Tedarikçinin irsaliyedeki kalem kodları ve karşılık gelen iplik kartlarımız.</span>
        <InfoPopover
          label="Kalem kodları nasıl oluşur?"
          desc='Mal kabulde iplik satırına "Tedarikçi kodu" yazıp kaydettiğinizde eşleme kendiliğinden öğrenilir; aynı kod sonraki kabulde iplik kartını otomatik getirir. Kod başka karta kaydedilirse son kayıt geçerli olur.'
        />
      </div>
      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
          Henüz öğrenilmiş kalem kodu yok. Mal kabulde iplik satırına tedarikçi kodunu yazın.
        </div>
      ) : (
        <div className="rounded-md border">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_90px_120px_40px] gap-3 border-b bg-muted/50 px-3 py-2 text-[11px] font-medium uppercase text-muted-foreground">
            <span>Tedarikçi kodu</span>
            <span>İplik kartı</span>
            <span className="text-right">Kullanım</span>
            <span>Son kullanım</span>
            <span />
          </div>
          <ul className="divide-y">
            {rows.map((r) => (
              <CodeRow
                key={r.id}
                row={r}
                canWrite={canWrite}
                busy={updateMut.isPending}
                onRebind={(itemId) => updateMut.mutate({ id: r.id, itemId })}
                onRemove={() => setRemoving(r)}
              />
            ))}
          </ul>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Kalem kodu eşlemesi kaldırılsın mı?"
        description={removing ? `"${removing.rawCode}" → ${removing.item.name} eşlemesi kaldırılacak. Geçmiş mal kabul kayıtları değişmez; kod bir sonraki kabulde yeniden öğrenilir.` : ""}
        confirmLabel="Kaldır"
        destructive
        onConfirm={() => { if (removing) removeMut.mutate(removing.id); }}
      />
    </div>
  );
}

interface CodeRowProps {
  row: SupplierItemCodeRow;
  canWrite: boolean;
  busy: boolean;
  onRebind: (itemId: string) => void;
  onRemove: () => void;
}

function CodeRow({ row: r, canWrite, busy, onRebind, onRemove }: CodeRowProps) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_90px_120px_40px] items-center gap-3 px-3 py-2 text-sm">
      <span className="truncate font-mono" title={r.rawCode}>{r.rawCode}</span>
      {canWrite ? (
        <ItemSelect
          value={r.itemId}
          onChange={(v) => { if (v && v !== r.itemId) onRebind(v); }}
          allowedTypes={["YARN"]}
          aria-label={`${r.rawCode} iplik kartı`}
          disabled={busy}
        />
      ) : (
        <span className="truncate">{r.item.name}</span>
      )}
      <span className="text-right tabular-nums text-muted-foreground">{r.hitCount} kez</span>
      <span className="text-muted-foreground">{formatFactory(r.lastUsedAt ?? r.createdAt, "dd.MM.yyyy")}</span>
      {canWrite ? (
        <Button type="button" variant="ghost" size="icon" aria-label={`${r.rawCode} eşlemesini kaldır`} onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
        </Button>
      ) : (
        <span />
      )}
    </li>
  );
}
