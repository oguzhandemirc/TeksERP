import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Maximize2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { printHistoryHref } from "@/lib/print-history-query";
import { workOrderStatusLabels, workOrderTypeLabels } from "@/types/enums";
import { workOrderService } from "./service";
import { WorkOrderDocumentsDialog } from "./WorkOrderDocumentsDialog";
import { WorkOrderEventsSheet } from "./WorkOrderEventsSheet";
import { TravelerCardPrintDialog } from "./TravelerCardPrintDialog";
import { FasonSevkPrintDialog } from "./FasonSevkPrintDialog";
import { WorkOrderCancelDialog } from "./WorkOrderCancelDialog";
import { WorkOrderCompleteDialog } from "./WorkOrderCompleteDialog";
import { LinkOrderDialog } from "./LinkOrderDialog";
import { ChangeTargetDialog } from "./ChangeTargetDialog";
import { AddBatchDialog } from "./AddBatchDialog";
import { UnlinkOrderDialog } from "./UnlinkOrderDialog";
import { WorkOrderSheetActions } from "./WorkOrderHeaderActions";
import { sheetActionVisibility, type SheetActionId } from "./header-actions";
import { FasonReceiveDialog } from "./FasonReceiveDialog";
import { summarizeLinkedFulfillment } from "./order-fulfillment";
import { V3Section } from "./detail-v3/V3Section";
import { ProcessSummaryCard } from "./detail-v3/ProcessSummaryCard";
import { ConsumableUsageCard } from "./detail-v3/ConsumableUsageCard";
import { useKursunGramajCatalog } from "@/lib/kursun-gramaj";
import { KunyeCard } from "./detail-v3/KunyeCard";
import { RouteStepline } from "./detail-v3/RouteStepline";
import { ProducedV3 } from "./detail-v3/ProducedV3";
import { SheetKpis } from "./detail-v3/SheetKpis";
import { OrderLinksV3 } from "./detail-v3/OrderLinksV3";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import "./detail-v3/work-order-detail-v3.css";
import type { WorkOrder } from "./types";
import { TERIM } from "@/lib/terim";
import { FasonTag } from "./FasonTag";

interface Props {
  workOrder: WorkOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Düzenle butonuna basıldığında parent'a tam (zenginleştirilmiş) WO geçer. */
  onEdit?: (wo: WorkOrder) => void;
}

/** İş emri statüsü → v3 `.pill` ton sınıfı. */
const STATUS_PILL: Record<string, string> = {
  PLANNED: "neutral",
  IN_PROGRESS: "run",
  COMPLETED: "ok",
  CANCELLED: "bad",
};

/**
 * İş emri hızlı-bakış paneli — "Kurumsal Tasarım v3" diliyle (tam sayfa detayla
 * BİREBİR aynı token/bileşen sistemi: `.wo-v3` + KunyeCard/RouteStepline/
 * ProducedV3/V3Section). İçerik önceki panelle aynı; yalnız görsel dil kurumsal.
 * Dar panel için grid'ler `.wo-v3.sheet` override'larıyla 2 sütuna sabitlenir.
 * Operasyonel/derin içerik (top drill-down, fason aksiyonları, sevk irsaliyesi)
 * burada YOK — "Detayı Aç" ile tam sayfada.
 */
export function WorkOrderDetailSheet({ workOrder, open, onOpenChange, onEdit }: Props) {
  const { catalog: kursunCatalog } = useKursunGramajCatalog();
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [linkOrderOpen, setLinkOrderOpen] = useState(false);
  // Fason Kabul (2026-08-19): ince ayarlı kabul (kısmi teslimat + kalan-kapama).
  const [fasonReceiveOpen, setFasonReceiveOpen] = useState(false);
  // null = kapalı; "color"/"width" hangi hedefin değiştirileceğini söyler.
  const [changeMode, setChangeMode] = useState<"color" | "width" | null>(null);
  // "Sipariş Bağını Kopar" önerisi onaylanınca "Rengi Değiştir" bu renkle açılır (başlıkla AYNI).
  const [prefillColorId, setPrefillColorId] = useState<string | null>(null);
  const [travelerCardOpen, setTravelerCardOpen] = useState(false);
  const [printDispatchId, setPrintDispatchId] = useState<string | null>(null);
  const [inProgressConfirmOpen, setInProgressConfirmOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [addBatchOpen, setAddBatchOpen] = useState(false);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const openTarget = useOpenTarget();
  const { permissions } = useRoleAccess();

  const detail = useQuery({
    queryKey: ["work-order-detail", workOrder?.id],
    queryFn: () => workOrderService.getById(workOrder!.id),
    enabled: open && Boolean(workOrder?.id),
    // Detay paneli her açılışta refetch atmaz; mutation sonrası
    // `invalidateQueries(['work-order-detail', id])` ile tazelenir.
    staleTime: 60_000,
  });

  const wo = detail.data?.data ?? workOrder;

  const sortedSteps = useMemo(
    () => (wo?.steps ? [...wo.steps].sort((a, b) => a.stepSequence - b.stepSequence) : []),
    [wo?.steps],
  );
  const wipSteps = useMemo(
    () => sortedSteps.filter((s) => (s.currentRolls?.count ?? 0) > 0),
    [sortedSteps],
  );

  const hasOrders = (wo?.orderLinks?.length ?? 0) > 0;
  const fulfill = useMemo(
    () => summarizeLinkedFulfillment(wo?.orderLinks ?? []),
    [wo?.orderLinks],
  );
  // Kapanmış iş emrinde künye, canlı küme boşalsa da gösterilir (kapanıştaki hâl).
  const hasProduced = (wo?.producedRolls?.count ?? 0) > 0 || !!wo?.closeSnapshot;
  const showOrders = hasOrders || wo?.type === "STOCK_PRODUCTION";

  // Görünürlük tek kaynak `header-actions.ts` (detay başlığıyla aynı koşullar); burada yalnız diyalog bağlanır.
  const visible = wo ? sheetActionVisibility(wo, permissions, Boolean(onEdit)) : null;
  const editWarn = wo?.status === "IN_PROGRESS" && (
    <span style={{ color: "var(--warn)" }} aria-label="üretim devam ediyor">
      ⚠
    </span>
  );
  const runAction = (id: SheetActionId) => {
    if (!wo) return;
    const open: Record<SheetActionId, () => void> = {
      edit: () => (wo.status === "IN_PROGRESS" ? setInProgressConfirmOpen(true) : onEdit?.(wo)),
      addBatch: () => setAddBatchOpen(true),
      fasonReceive: () => setFasonReceiveOpen(true),
      linkOrder: () => setLinkOrderOpen(true),
      unlinkOrder: () => setUnlinkOpen(true),
      changeColor: () => setChangeMode("color"),
      changeWidth: () => setChangeMode("width"),
      documents: () => setDocumentsOpen(true),
      events: () => setEventsOpen(true),
      printHistory: () => {
        onOpenChange(false);
        openTarget(printHistoryHref(wo.id));
      },
      complete: () => setCompleteOpen(true),
      cancel: () => setCancelOpen(true),
    };
    open[id]();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-2xl">
        {/* A11y için gerçek başlık (Radix Dialog Title/Description) — görünmez;
            görünür kurumsal başlık aşağıda .sheet-head içinde. */}
        <SheetHeader className="sr-only">
          <SheetTitle>{wo?.workOrderNumber ?? TERIM.terbiyeIsEmri.tekil}</SheetTitle>
          <SheetDescription>{wo ? workOrderTypeLabels[wo.type] : "Yükleniyor"}</SheetDescription>
        </SheetHeader>

        <div className="wo-v3 sheet">
          <div className="sheet-wrap">
            {detail.isLoading && !workOrder && (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div className="card" style={{ height: "72px" }} />
                <div className="card" style={{ height: "120px" }} />
                <div className="card" style={{ height: "160px" }} />
              </div>
            )}

            {wo && (
              <>
                <div className="sheet-head">
                  <div className="sheet-id">
                    <span className="wonum mono">{wo.workOrderNumber}</span>
                    <FasonTag type={wo.type} long />
                    <span className={`pill ${STATUS_PILL[wo.status] ?? "neutral"}`}>
                      <span className="dot" />
                      {workOrderStatusLabels[wo.status]}
                    </span>
                  </div>
                  <div className="sheet-sub">
                    {workOrderTypeLabels[wo.type]}
                    {wo.customer && <> · Müşteri: {wo.customer.name}</>}
                    {wo.routeTemplate && <> · Rota: {wo.routeTemplate.name}</>}
                  </div>

                  <div className="sheet-actions">
                    <button
                      type="button"
                      className="btn primary"
                      title="Sol tık: bu sekmede · Shift/Ctrl+tık: yeni sekmede"
                      onClick={(e) => {
                        onOpenChange(false);
                        openTarget(`/operations/work-orders/${wo.id}`, e);
                      }}
                    >
                      <Maximize2 className="h-3.5 w-3.5" /> Detayı Aç
                    </button>

                    {visible && (
                      <WorkOrderSheetActions
                        visible={visible}
                        onAction={runAction}
                        marks={editWarn ? { edit: editWarn } : undefined}
                        groupMarks={editWarn && visible.edit ? { duzenle: editWarn } : undefined}
                      />
                    )}
                  </div>
                </div>

                <SheetKpis wo={wo} fulfill={fulfill} hasOrders={hasOrders} />

                <V3Section title={`${TERIM.terbiyeIsEmri.tekil} Künyesi`}>
                  <KunyeCard wo={wo} />
                </V3Section>

                {wo.scanRouted && sortedSteps.length === 0 && (
                  <V3Section title="Rota">
                    <div className="card steps text-sm text-muted-foreground" data-testid="wo-scan-routed-empty">
                      Rota sahada belirlenir — istasyonlar kumaşı okuttukça adımlar eklenir.
                    </div>
                  </V3Section>
                )}
                {sortedSteps.length > 0 && (
                  <V3Section title="Rota & İstasyonlar" active={wipSteps.length > 0}>
                    <RouteStepline steps={sortedSteps} />
                  </V3Section>
                )}

                {/* KQ-D6: kurşun çeşidi tanımlı fabrikada gramaj özeti + hedef. */}
                {kursunCatalog.propertyId && (
                  <V3Section title="Kurşun Gramajı">
                    <ProcessSummaryCard scope={{ workOrderId: wo.id }} editableTarget />
                  </V3Section>
                )}

                <ConsumableUsageCard workOrderId={wo.id} />

                {hasProduced && (
                  <V3Section title="Üretilen Toplar">
                    <ProducedV3 wo={wo} />
                  </V3Section>
                )}

                {showOrders && (
                  <V3Section title="Bağlı Sipariş(ler)">
                    <OrderLinksV3 wo={wo} />
                  </V3Section>
                )}
              </>
            )}
          </div>
        </div>

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

        <TravelerCardPrintDialog
          workOrder={wo ?? null}
          open={travelerCardOpen}
          onOpenChange={setTravelerCardOpen}
        />

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
          onCancelled={() => onOpenChange(false)}
          onSwitchToClose={() => setCompleteOpen(true)}
        />

        <WorkOrderCompleteDialog
          open={completeOpen}
          onOpenChange={setCompleteOpen}
          workOrderId={wo?.id ?? null}
          workOrderNumber={wo?.workOrderNumber}
          onCompleted={() => onOpenChange(false)}
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
            if (wo && onEdit) onEdit(wo);
            setInProgressConfirmOpen(false);
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
