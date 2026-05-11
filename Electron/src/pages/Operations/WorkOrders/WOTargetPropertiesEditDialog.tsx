import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MultiSelectCheckboxList, type MultiSelectItem } from "@/components/forms/MultiSelectCheckboxList";
import { itemService } from "@/pages/Items/service";
import { fabricPropertyService } from "@/pages/FabricProperties/service";
import { workOrderService } from "./service";
import type { WorkOrder } from "./types";

interface Props {
  workOrder: WorkOrder;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WOTargetPropertiesEditDialog({ workOrder, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);

  // İlk açılışta mevcut targetProperties'i seçili yap
  useEffect(() => {
    if (open) {
      setSelectedIds(workOrder.targetProperties?.map((p) => p.propertyId) ?? []);
      setConfirmed(false);
    }
  }, [open, workOrder.targetProperties]);

  // Allowed listesi: targetItem.allowedProperties varsa o, yoksa tüm aktifler
  const itemQuery = useQuery({
    queryKey: ["item-allowed", workOrder.targetItemId],
    queryFn: () => itemService.getById(workOrder.targetItemId as string),
    enabled: open && Boolean(workOrder.targetItemId),
    staleTime: 60_000,
  });
  const allowedIds = useMemo(
    () => (itemQuery.data?.data?.allowedProperties ?? []).map((p) => p.propertyId),
    [itemQuery.data?.data?.allowedProperties],
  );

  const propsQ = useQuery({
    queryKey: ["fabric-properties", "all"],
    queryFn: () =>
      fabricPropertyService.getAll({
        page: 1,
        pageSize: 200,
        sortBy: "sortOrder",
        sortOrder: "asc",
        filters: { isActive: "true" },
      }),
    enabled: open,
    staleTime: 60_000,
  });
  const allProps = useMemo(() => propsQ.data?.data ?? [], [propsQ.data?.data]);
  const candidateProps = useMemo(() => {
    if (allowedIds.length === 0) return allProps;
    const set = new Set(allowedIds);
    return allProps.filter((p) => set.has(p.id));
  }, [allowedIds, allProps]);
  const propMultiItems: MultiSelectItem[] = useMemo(
    () =>
      candidateProps.map((p) => ({
        id: p.id,
        label: p.name,
        group: p.category ?? undefined,
        hint: p.code,
        swatch: p.color ?? null,
      })),
    [candidateProps],
  );

  // Etki sorgusu — kaç rulo etkilenecek
  const impactQuery = useQuery({
    queryKey: ["wo-target-properties-impact", workOrder.id],
    queryFn: () => workOrderService.getTargetPropertiesImpact(workOrder.id),
    enabled: open,
    staleTime: 5_000,
  });
  const impact = impactQuery.data?.data;
  const tamburPassed = impact?.tamburPassedCount ?? 0;
  const inProduction = impact?.inProductionCount ?? 0;

  // Değişiklik var mı?
  const initialIds = useMemo(
    () => (workOrder.targetProperties ?? []).map((p) => p.propertyId).sort(),
    [workOrder.targetProperties],
  );
  const sortedSelected = useMemo(() => [...selectedIds].sort(), [selectedIds]);
  const hasChange =
    initialIds.length !== sortedSelected.length ||
    initialIds.some((id, idx) => id !== sortedSelected[idx]);

  const needsConfirmation = tamburPassed > 0 && hasChange;

  const updateMutation = useMutation({
    mutationFn: () => workOrderService.updateTargetProperties(workOrder.id, selectedIds),
    onSuccess: (res) => {
      toast.success(res.message ?? "Hedef özellikler güncellendi");
      qc.invalidateQueries({ queryKey: ["work-order-detail", workOrder.id] });
      qc.invalidateQueries({ queryKey: ["work-orders"] });
      onOpenChange(false);
    },
  });

  const handleSubmit = () => {
    if (needsConfirmation && !confirmed) return;
    updateMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Üretim Özelliklerini Düzenle</DialogTitle>
          <DialogDescription>
            {workOrder.batchNumber} · {workOrder.targetItem?.name ?? "Ürün atanmamış"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {!workOrder.targetItemId && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              Bu iş emrine hedef ürün atanmamış. Önce hedef ürün atayın.
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            Tambur'da finalize edilen rulolarda bu özellikler olacak.{" "}
            {allowedIds.length > 0
              ? "Bu ürün için tanımlı olası özelliklerden seçilir."
              : "Bu ürünün olası özellik sınırı yok — tüm aktif özellikler seçilebilir."}
          </p>

          <div className="h-56">
            <MultiSelectCheckboxList
              items={propMultiItems}
              value={selectedIds}
              onChange={setSelectedIds}
              placeholder="Özellik ara..."
              emptyHint={
                candidateProps.length === 0 && allowedIds.length > 0
                  ? "Bu ürün için tanımlı özellik yok."
                  : undefined
              }
            />
          </div>

          {hasChange && (
            <div className="rounded-md border bg-muted/30 p-2.5 text-xs">
              <div className="font-medium">Etki</div>
              <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5">
                <div className="text-muted-foreground">Henüz üretimde olan</div>
                <div className="tabular-nums">{inProduction} rulo</div>
                <div className="text-muted-foreground">Tambur'dan geçmiş</div>
                <div className="tabular-nums font-medium">{tamburPassed} rulo</div>
              </div>
            </div>
          )}

          {needsConfirmation && (
            <div className="rounded-md border border-amber-400 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div className="space-y-1.5">
                  <div className="font-medium">
                    {tamburPassed} rulo Tambur'dan geçmiş.
                  </div>
                  <div>
                    Bu değişiklik geriye dönük olarak ilgili tüm ruloların
                    özelliklerini günceller. Sevk edilmiş veya depodaki rulolar
                    da etkilenir.
                  </div>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    <span>Yine de devam et</span>
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            İptal
          </Button>
          <Button
            type="button"
            disabled={
              !hasChange ||
              !workOrder.targetItemId ||
              (needsConfirmation && !confirmed) ||
              updateMutation.isPending
            }
            onClick={handleSubmit}
          >
            {updateMutation.isPending ? "Kaydediliyor..." : "Kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
