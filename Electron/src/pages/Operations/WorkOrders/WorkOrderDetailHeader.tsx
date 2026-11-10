import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FollowButton } from "@/components/bildirim/FollowButton";
import { PageHeader } from "@/components/layout/PageHeader";
import { RefreshButton } from "@/components/RefreshButton";
import { StatusBadge, workOrderStatusTones } from "@/components/operations/StatusBadge";
import { workOrderStatusLabels, workOrderTypeLabels } from "@/types/enums";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { useTabsStore } from "@/store/tabs";
import { WorkOrderDocumentsDialog } from "./WorkOrderDocumentsDialog";
import { WorkOrderEventsSheet } from "./WorkOrderEventsSheet";
import { TravelerCardPrintDialog } from "./TravelerCardPrintDialog";
import { WorkOrderCancelDialog } from "./WorkOrderCancelDialog";
import { WorkOrderCompleteDialog } from "./WorkOrderCompleteDialog";
import { FasonSevkPrintDialog } from "./FasonSevkPrintDialog";
import { FasonReceiveDialog } from "./FasonReceiveDialog";
import { LinkOrderDialog } from "./LinkOrderDialog";
import { ChangeTargetDialog } from "./ChangeTargetDialog";
import { AddBatchDialog } from "./AddBatchDialog";
import { UnlinkOrderDialog } from "./UnlinkOrderDialog";
import { WorkOrderHeaderActions } from "./WorkOrderHeaderActions";
import { canEditWorkOrder, headerActionVisibility, type HeaderActionId } from "./header-actions";
import { RecordInfoButton } from "@/components/RecordInfoButton";
import type { WorkOrder } from "./types";
import { TERIM } from "@/lib/terim";
import { FasonTag } from "./FasonTag";
import { PrintHistoryLink } from "@/components/print/PrintHistoryLink";

/**
 * Tam sayfa detayın sticky başlığı: kimlik (parti no + statü + tip/rota) +
 * aksiyonlar (Yenile ikonu, birincil Düzenle, gruplu menüler — `header-actions.ts`) + ilgili dialoglar. Belgeler içinden
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
  const [eventsOpen, setEventsOpen] = useState(false);
  const [travelerCardOpen, setTravelerCardOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [inProgressConfirmOpen, setInProgressConfirmOpen] = useState(false);
  const [printDispatchId, setPrintDispatchId] = useState<string | null>(null);
  // Dar kapılar (2026-08-17): yan panelle AYNI üç aksiyon — iki yüzey ayrışırsa
  // kullanıcı işi bir ekranda bulup diğerinde bulamaz.
  const [linkOrderOpen, setLinkOrderOpen] = useState(false);
  const [changeMode, setChangeMode] = useState<"color" | "width" | null>(null);
  // "Sipariş Bağını Kopar" önerisi onaylanınca "Rengi Değiştir" bu renkle açılır.
  const [prefillColorId, setPrefillColorId] = useState<string | null>(null);
  // Fason Kabul (2026-08-19): ince ayarlı kabul — top bazında gelen metraj (kısmi),
  // parçalar, irsaliye no; kalan-kapama (fire) da bu diyalogdan.
  const [fasonReceiveOpen, setFasonReceiveOpen] = useState(false);
  const [addBatchOpen, setAddBatchOpen] = useState(false);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const { permissions } = useRoleAccess();

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

  // Görünürlük tek kaynak `header-actions.ts` (izin + durum); burada yalnız yerleşim ve diyalog bağlanır.
  const canEdit = wo && canEditWorkOrder(wo, permissions);
  const visible = wo ? headerActionVisibility(wo, permissions) : null;
  const runAction = (id: HeaderActionId) => {
    const open: Record<HeaderActionId, () => void> = {
      addBatch: () => setAddBatchOpen(true),
      fasonReceive: () => setFasonReceiveOpen(true),
      linkOrder: () => setLinkOrderOpen(true),
      unlinkOrder: () => setUnlinkOpen(true),
      changeColor: () => setChangeMode("color"),
      changeWidth: () => setChangeMode("width"),
      documents: () => setDocumentsOpen(true),
      events: () => setEventsOpen(true),
      complete: () => setCompleteOpen(true),
      cancel: () => setCancelOpen(true),
    };
    open[id]();
  };

  return (
    <>
      <PageHeader
        title={wo?.workOrderNumber ?? TERIM.terbiyeIsEmri.tekil}
        titleExtra={
          wo && (
            <>
              <StatusBadge status={wo.status} labels={workOrderStatusLabels} tones={workOrderStatusTones} />
              <FasonTag type={wo.type} long />
              <PrintHistoryLink subjectId={wo.id} />
              {/* ⓘ — kim oluşturdu / en son kim değiştirdi. Tarihler zaten
                  elimizde, sunucuya yalnız "kim" sorulur ve YALNIZ tıklanınca. */}
              <RecordInfoButton
                table="WORK_ORDER"
                id={wo.id}
                createdAt={wo.createdAt}
                updatedAt={wo.updatedAt}
              />
            </>
          )
        }
        statusLine={
          wo
            ? `${workOrderTypeLabels[wo.type]}${wo.customer ? ` · Müşteri: ${wo.customer.name}` : ""}${wo.routeTemplate ? ` · Rota: ${wo.routeTemplate.name}` : ""}`
            : undefined
        }
        parent={{ label: TERIM.terbiyeIsEmri.cogul, to: "/operations/work-orders" }}
        onBack={onBack}
        actions={
          wo ? (
            <>
              <FollowButton type="is-emri" id={wo.id} />
              <RefreshButton
                queryKey={["work-order-detail", wo.id]}
                extraKeys={[["work-order-branches", wo.id]]}
                silent
                iconOnly
              />
              {canEdit && (
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
              )}
              {visible && <WorkOrderHeaderActions visible={visible} onAction={runAction} />}
            </>
          ) : undefined
        }
      />

      <WorkOrderEventsSheet workOrder={eventsOpen && wo ? wo : null} onClose={() => setEventsOpen(false)} />

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
      {wo && (
        <>
          {visible?.addBatch && <AddBatchDialog open={addBatchOpen} onOpenChange={setAddBatchOpen} wo={wo} />}
          {visible?.unlinkOrder && (
            <UnlinkOrderDialog
              open={unlinkOpen}
              onOpenChange={setUnlinkOpen}
              wo={wo}
              onSuggestColor={(id) => {
                setPrefillColorId(id);
                setChangeMode("color");
              }}
            />
          )}
          <FasonReceiveDialog
            open={fasonReceiveOpen}
            onOpenChange={setFasonReceiveOpen}
            workOrderId={wo.id}
          />
          <LinkOrderDialog
            open={linkOrderOpen}
            onOpenChange={setLinkOrderOpen}
            workOrderId={wo.id}
            workOrderNumber={wo.workOrderNumber}
            targetItemId={wo.targetItemId}
            targetItemName={wo.targetItem?.name ?? null}
            targetColorId={wo.targetColorId}
            targetColorName={wo.targetColor?.name ?? null}
            targetWidth={wo.width}
          />
          <ChangeTargetDialog
            open={changeMode !== null}
            onOpenChange={(o) => {
              if (!o) {
                setChangeMode(null);
                setPrefillColorId(null);
              }
            }}
            mode={changeMode ?? "color"}
            initialColorId={prefillColorId}
            workOrderId={wo.id}
            workOrderNumber={wo.workOrderNumber}
            currentColorId={wo.targetColorId}
            currentColorName={wo.targetColor?.name ?? null}
            currentWidth={wo.width}
            orderLinks={wo.orderLinks}
          />
        </>
      )}
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
        // Fason dönüşü mal yüzünden iptal kapalıysa tek çıkış KAPATMA'dır —
        // kullanıcıyı menüye geri göndermek yerine doğrudan oraya taşı.
        onSwitchToClose={() => setCompleteOpen(true)}
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
        description={`Bu ${TERIM.terbiyeIsEmri.tekilKucuk} şu an üretimde. Yapacağın değişiklikler bağlı rulolara ve istasyon adımlarına yansıyabilir. Devam edilsin mi?`}
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
