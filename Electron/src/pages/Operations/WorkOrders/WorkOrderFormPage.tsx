import { useEffect, type MouseEvent } from "react";
import { useParams, useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { fireConfetti } from "@/lib/confetti";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTabsStore } from "@/store/tabs";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { useTargetQuantityEnabled } from "@/hooks/usePricingEnabled";
import { workOrderService } from "./service";
import { WorkOrderFormView } from "./WorkOrderFormView";
import { buildPayload, type CreatePayload } from "./workOrderPayload";
import type { WoSeedTarget } from "./workOrderPrefill";
import type { PickedOrderLine } from "./OrderPickerDialog";
import type { WorkOrder } from "./types";

const LIST_PATH = "/operations/work-orders";

/**
 * İş emri Oluştur / Düzenle — tam sayfa (kendi sekmesinde). Modal'ın yerini alır:
 * sticky başlık (geri + kimlik) + `WorkOrderFormView`. Create modunda gezinme
 * state'inden tohumlanır (siparişten WO / Denge stoğa üret); edit modunda WO'yu
 * locks'larıyla çeker. Oluşturma başarılıysa yeni iş emrinin detayına geçer.
 */
export function WorkOrderFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const location = useLocation();
  const openTarget = useOpenTarget();
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const qc = useQueryClient();
  const targetQuantityEnabled = useTargetQuantityEnabled();

  // Create: seed gezinme state'inden (siparişten WO / Denge "stoğa üret").
  const seed = location.state as {
    seedPickedLines?: PickedOrderLine[];
    seedTarget?: WoSeedTarget;
  } | null;

  // Edit: WO'yu (locks dahil) çek. Form WO yüklenmeden tohumlanamaz.
  const detail = useQuery({
    queryKey: ["work-order-detail", id],
    queryFn: () => workOrderService.getById(id!),
    enabled: isEdit,
    staleTime: 60_000,
  });
  const wo = detail.data?.data ?? null;

  // Sekme başlığını anlamlı yap (detay sayfasıyla aynı desen).
  useEffect(() => {
    const title = isEdit
      ? wo?.workOrderNumber
        ? `Düzenle · ${wo.workOrderNumber.slice(-6)}`
        : "İş Emrini Düzenle"
      : "Yeni İş Emri";
    const path = isEdit
      ? `/operations/work-orders/${id}/edit`
      : "/operations/work-orders/new";
    const tab = useTabsStore.getState().tabs.find((t) => t.path === path);
    if (tab) useTabsStore.getState().updateTabTitle(tab.id, title);
  }, [isEdit, id, wo?.workOrderNumber]);

  const createMut = useMutation({
    mutationFn: (payload: CreatePayload) =>
      workOrderService.create(payload as unknown as Partial<WorkOrder>),
    onSuccess: (res) => {
      toast.success("İş emri oluşturuldu.");
      fireConfetti();
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      const newId = res.data?.id;
      // Yeni iş emrinin tam sayfa detayına geç (bu sekmede yerinde).
      navigateActive(newId ? `/operations/work-orders/${newId}` : LIST_PATH);
    },
  });

  const replaceMut = useMutation({
    mutationFn: (payload: CreatePayload) =>
      workOrderService.replace(id!, payload as unknown as Partial<WorkOrder>),
    onSuccess: () => {
      toast.success("İş emri güncellendi.");
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      void qc.invalidateQueries({ queryKey: ["work-order-detail", id] });
      navigateActive(`/operations/work-orders/${id}`);
    },
  });

  const handleCancel = () =>
    navigateActive(isEdit ? `/operations/work-orders/${id}` : LIST_PATH);

  const backPath = isEdit ? `/operations/work-orders/${id}` : LIST_PATH;
  const backLabel = isEdit ? "İş Emri" : "İş Emirleri";

  const notFound = isEdit && !detail.isLoading && !wo;

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="gap-1"
          onClick={(e: MouseEvent) => openTarget(backPath, e)}
        >
          <ArrowLeft className="h-4 w-4" /> {backLabel}
        </Button>
        <span className="text-base font-semibold">
          {isEdit ? "İş Emrini Düzenle" : "Yeni İş Emri"}
        </span>
        {isEdit && wo && (
          <span className="font-mono text-sm text-muted-foreground">{wo.workOrderNumber}</span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {isEdit && detail.isLoading && (
          <div className="mx-auto w-full max-w-3xl space-y-3 p-6">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}
        {notFound && (
          <div className="py-16 text-center text-sm text-muted-foreground">
            İş emri bulunamadı.
          </div>
        )}
        {(!isEdit || wo) && (
          <WorkOrderFormView
            workOrder={wo}
            initialPickedLines={isEdit ? undefined : seed?.seedPickedLines}
            initialTarget={isEdit ? undefined : seed?.seedTarget ?? undefined}
            onSubmit={async (v, meta) => {
              const payload = buildPayload(v, meta, targetQuantityEnabled);
              if (isEdit) await replaceMut.mutateAsync(payload);
              else await createMut.mutateAsync(payload);
            }}
            isSubmitting={isEdit ? replaceMut.isPending : createMut.isPending}
            onCancel={handleCancel}
          />
        )}
      </div>
    </div>
  );
}
