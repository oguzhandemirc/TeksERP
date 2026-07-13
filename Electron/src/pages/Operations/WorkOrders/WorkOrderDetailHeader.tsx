import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, FileText, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RefreshButton } from "@/components/RefreshButton";
import { StatusBadge, workOrderStatusTones } from "@/components/operations/StatusBadge";
import { workOrderStatusLabels, workOrderTypeLabels } from "@/types/enums";
import { PermissionGate } from "@/components/PermissionGate";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { useTabsStore } from "@/store/tabs";
import { WorkOrderDocumentsDialog } from "./WorkOrderDocumentsDialog";
import { TravelerCardPrintDialog } from "./TravelerCardPrintDialog";
import { WorkOrderCancelDialog } from "./WorkOrderCancelDialog";
import { FasonSevkPrintDialog } from "./FasonSevkPrintDialog";
import type { WorkOrder } from "./types";

/**
 * Tam sayfa detayın sticky başlığı: kimlik (parti no + statü + tip/rota) +
 * aksiyonlar (Düzenle, Belgeler, İptal Et) + ilgili dialoglar. Belgeler içinden
 * refakat kartı ve fason sevk fişi yazdırılır. Düzenleme PLANNED/IN_PROGRESS'te
 * açık (tam sayfa /edit ekranına götürür); üretimdeyse önce onay sorar.
 */
export function WorkOrderDetailHeader({
  wo,
  onBack,
  autoOpenTravelerCard = false,
}: {
  wo: WorkOrder | null;
  onBack: (e: MouseEvent) => void;
  /** Parti ayırma akışından gelindi — refakat kartı yazdırma diyaloğunu otomatik aç. */
  autoOpenTravelerCard?: boolean;
}) {
  const qc = useQueryClient();
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [travelerCardOpen, setTravelerCardOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [inProgressConfirmOpen, setInProgressConfirmOpen] = useState(false);
  const [printDispatchId, setPrintDispatchId] = useState<string | null>(null);

  // Ayırma akışı: WO yüklenince kart diyaloğunu BİR KEZ otomatik aç (kullanıcı
  // kapatınca yeniden açılmasın diye ref ile kilitlenir).
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenTravelerCard && wo && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      setTravelerCardOpen(true);
    }
  }, [autoOpenTravelerCard, wo]);

  // Düzenleme tam sayfa /edit ekranında — bu sekmede yerinde aç.
  const goEdit = () => {
    if (wo) navigateActive(`/operations/work-orders/${wo.id}/edit`);
  };

  const canEdit = wo && (wo.status === "PLANNED" || wo.status === "IN_PROGRESS");
  const canCancel = wo && wo.status !== "COMPLETED" && wo.status !== "CANCELLED";

  return (
    <div className="sticky top-0 z-10 border-b bg-background/95 px-4 py-3 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="ghost" className="gap-1" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> İş Emirleri
        </Button>
        <span className="font-mono text-base font-semibold">{wo?.workOrderNumber ?? "…"}</span>
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
            <RefreshButton
              queryKey={["work-order-detail", wo.id]}
              extraKeys={[["work-order-branches", wo.id]]}
              silent
            />
            {canEdit && (
              <PermissionGate permission="workorder:write">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  onClick={() =>
                    wo.status === "IN_PROGRESS" ? setInProgressConfirmOpen(true) : goEdit()
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
        batchNumber={wo?.workOrderNumber}
        onCancelled={() => {
          if (wo) qc.invalidateQueries({ queryKey: ["work-order-detail", wo.id] });
        }}
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
          goEdit();
        }}
      />
    </div>
  );
}
