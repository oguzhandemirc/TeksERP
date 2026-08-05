import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Ban, CheckCircle2, FileText, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/PageHeader";
import { RefreshButton } from "@/components/RefreshButton";
import { StatusBadge, workOrderStatusTones } from "@/components/operations/StatusBadge";
import { workOrderStatusLabels, workOrderTypeLabels } from "@/types/enums";
import { PermissionGate } from "@/components/PermissionGate";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { useTabsStore } from "@/store/tabs";
import { WorkOrderDocumentsDialog } from "./WorkOrderDocumentsDialog";
import { TravelerCardPrintDialog } from "./TravelerCardPrintDialog";
import { WorkOrderCancelDialog } from "./WorkOrderCancelDialog";
import { WorkOrderCompleteDialog } from "./WorkOrderCompleteDialog";
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
  onBack: () => void;
  /** Parti ayırma akışından gelindi — refakat kartı yazdırma diyaloğunu otomatik aç. */
  autoOpenTravelerCard?: boolean;
}) {
  const qc = useQueryClient();
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [travelerCardOpen, setTravelerCardOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
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
  const canCancel =
    wo && wo.status !== "COMPLETED" && wo.status !== "CANCELLED" && wo.status !== "SUPERSEDED";
  // Manuel kapatma yalnız üretimdeki (IN_PROGRESS) WO'ya sunulur.
  const canComplete = wo && wo.status === "IN_PROGRESS";

  return (
    <>
      <PageHeader
        title={wo?.workOrderNumber ?? "İş Emri"}
        titleExtra={
          wo && (
            <StatusBadge status={wo.status} labels={workOrderStatusLabels} tones={workOrderStatusTones} />
          )
        }
        description={
          wo
            ? `${workOrderTypeLabels[wo.type]}${wo.routeTemplate ? ` · Rota: ${wo.routeTemplate.name}` : ""}`
            : undefined
        }
        parent={{ label: "İş Emirleri", to: "/operations/work-orders" }}
        onBack={onBack}
        actions={
          wo ? (
            <>
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
                    className="gap-1 border-transparent bg-primary text-primary-foreground hover:bg-primary/90"
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
                className="gap-1 border-transparent bg-amber-500 text-white hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-500"
                onClick={() => setDocumentsOpen(true)}
              >
                <FileText className="h-3.5 w-3.5" /> Belgeler
              </Button>
              {canComplete && (
                <PermissionGate permission="workorder:write">
                  <Button
                    type="button"
                    size="sm"
                    className="gap-1 border-transparent bg-success text-success-foreground hover:bg-success/90"
                    onClick={() => setCompleteOpen(true)}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Kapat
                  </Button>
                </PermissionGate>
              )}
              {canCancel && (
                <PermissionGate permission="workorder:write">
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    className="gap-1"
                    onClick={() => setCancelOpen(true)}
                  >
                    <Ban className="h-3.5 w-3.5" /> İptal Et
                  </Button>
                </PermissionGate>
              )}
            </>
          ) : undefined
        }
      />

      <WorkOrderDocumentsDialog
        open={documentsOpen}
        onOpenChange={setDocumentsOpen}
        workOrderId={wo?.id}
        onPrintTravelerCard={() => {
          setDocumentsOpen(false);
          setTravelerCardOpen(true);
        }}
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
        onBack={() => {
          setPrintDispatchId(null);
          setDocumentsOpen(true);
        }}
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
      <WorkOrderCompleteDialog
        open={completeOpen}
        onOpenChange={setCompleteOpen}
        workOrderId={wo?.id ?? null}
        workOrderNumber={wo?.workOrderNumber}
        onCompleted={() => {
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
    </>
  );
}
