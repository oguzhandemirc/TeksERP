import { useState, type MouseEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Ban, FileText, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge, workOrderStatusTones } from "@/components/operations/StatusBadge";
import { workOrderStatusLabels, workOrderTypeLabels } from "@/types/enums";
import { PermissionGate } from "@/components/PermissionGate";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { useTargetQuantityEnabled } from "@/hooks/usePricingEnabled";
import { WorkOrderDocumentsDialog } from "./WorkOrderDocumentsDialog";
import { TravelerCardPrintDialog } from "./TravelerCardPrintDialog";
import { WorkOrderCancelDialog } from "./WorkOrderCancelDialog";
import { FasonSevkPrintDialog } from "./FasonSevkPrintDialog";
import { WorkOrderFormDialog } from "./WorkOrderFormDialog";
import { workOrderService } from "./service";
import { buildPayload, type CreatePayload } from "./workOrderPayload";
import type { WorkOrder } from "./types";

/**
 * Tam sayfa detayın sticky başlığı: kimlik (parti no + statü + tip/rota) +
 * aksiyonlar (Düzenle, Belgeler, İptal Et) + ilgili dialoglar. Belgeler içinden
 * refakat kartı ve fason sevk fişi yazdırılır. Düzenleme PLANNED/IN_PROGRESS'te
 * açık; üretimdeyse önce onay sorar.
 */
export function WorkOrderDetailHeader({
  wo,
  onBack,
}: {
  wo: WorkOrder | null;
  onBack: (e: MouseEvent) => void;
}) {
  const qc = useQueryClient();
  const targetQuantityEnabled = useTargetQuantityEnabled();
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [travelerCardOpen, setTravelerCardOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [inProgressConfirmOpen, setInProgressConfirmOpen] = useState(false);
  const [printDispatchId, setPrintDispatchId] = useState<string | null>(null);

  const replaceMut = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: CreatePayload }) =>
      workOrderService.replace(id, payload as unknown as Partial<WorkOrder>),
    onSuccess: () => {
      if (wo) qc.invalidateQueries({ queryKey: ["work-order-detail", wo.id] });
      qc.invalidateQueries({ queryKey: ["work-orders"] });
      toast.success("İş emri güncellendi");
    },
  });

  const canEdit = wo && (wo.status === "PLANNED" || wo.status === "IN_PROGRESS");
  const canCancel = wo && wo.status !== "COMPLETED" && wo.status !== "CANCELLED";

  return (
    <div className="sticky top-0 z-10 border-b bg-background/95 px-4 py-3 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="ghost" className="gap-1" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> İş Emirleri
        </Button>
        <span className="font-mono text-base font-semibold">{wo?.batchNumber ?? "…"}</span>
        {wo && (
          <StatusBadge status={wo.status} labels={workOrderStatusLabels} tones={workOrderStatusTones} />
        )}
        {wo && (
          <span className="text-sm text-muted-foreground">
            {workOrderTypeLabels[wo.type]}
            {wo.routeTemplate && <> · Rota: {wo.routeTemplate.name}</>}
          </span>
        )}
        {wo && (
          <div className="ml-auto flex items-center gap-2">
            {canEdit && (
              <PermissionGate permission="workorder:write">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  onClick={() =>
                    wo.status === "IN_PROGRESS" ? setInProgressConfirmOpen(true) : setEditOpen(true)
                  }
                >
                  <Pencil className="h-3.5 w-3.5" /> Düzenle
                  {wo.status === "IN_PROGRESS" && (
                    <span className="text-warning" aria-label="üretim devam ediyor">
                      ⚠
                    </span>
                  )}
                </Button>
              </PermissionGate>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1"
              onClick={() => setDocumentsOpen(true)}
            >
              <FileText className="h-3.5 w-3.5" /> Belgeler
            </Button>
            {canCancel && (
              <PermissionGate permission="workorder:write">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1 text-destructive hover:text-destructive"
                  onClick={() => setCancelOpen(true)}
                >
                  <Ban className="h-3.5 w-3.5" /> İptal Et
                </Button>
              </PermissionGate>
            )}
          </div>
        )}
      </div>

      <WorkOrderDocumentsDialog
        open={documentsOpen}
        onOpenChange={setDocumentsOpen}
        onPrintTravelerCard={() => {
          setDocumentsOpen(false);
          setTravelerCardOpen(true);
        }}
        steps={wo?.steps}
        onPrintDispatch={(id) => {
          setDocumentsOpen(false);
          setPrintDispatchId(id);
        }}
      />
      <TravelerCardPrintDialog workOrder={wo ?? null} open={travelerCardOpen} onOpenChange={setTravelerCardOpen} />
      <FasonSevkPrintDialog
        dispatchId={printDispatchId}
        open={Boolean(printDispatchId)}
        onOpenChange={(o) => !o && setPrintDispatchId(null)}
      />
      <WorkOrderCancelDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        workOrderId={wo?.id ?? null}
        batchNumber={wo?.batchNumber}
        onCancelled={() => {
          if (wo) qc.invalidateQueries({ queryKey: ["work-order-detail", wo.id] });
        }}
      />
      <WorkOrderFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        workOrder={wo}
        onSubmit={async (v, meta) => {
          if (wo) {
            await replaceMut.mutateAsync({ id: wo.id, payload: buildPayload(v, meta, targetQuantityEnabled) });
          }
        }}
        isSubmitting={replaceMut.isPending}
      />
      <ConfirmDialog
        open={inProgressConfirmOpen}
        onOpenChange={setInProgressConfirmOpen}
        title="Üretim devam ediyor"
        description="Bu iş emri şu an üretimde. Yapacağın değişiklikler bağlı rulolara ve istasyon adımlarına yansıyabilir. Devam edilsin mi?"
        confirmLabel="Devam Et"
        cancelLabel="Vazgeç"
        destructive
        onConfirm={() => {
          setInProgressConfirmOpen(false);
          setEditOpen(true);
        }}
      />
    </div>
  );
}
