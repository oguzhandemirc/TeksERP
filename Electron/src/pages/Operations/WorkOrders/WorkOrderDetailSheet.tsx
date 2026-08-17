import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Ban, CheckCircle2, FileText, Link2, Maximize2, Palette, Pencil, Ruler } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { PermissionGate } from "@/components/PermissionGate";
import { workOrderStatusLabels, workOrderTypeLabels } from "@/types/enums";
import { workOrderService } from "./service";
import { WorkOrderDocumentsDialog } from "./WorkOrderDocumentsDialog";
import { TravelerCardPrintDialog } from "./TravelerCardPrintDialog";
import { FasonSevkPrintDialog } from "./FasonSevkPrintDialog";
import { WorkOrderCancelDialog } from "./WorkOrderCancelDialog";
import { WorkOrderCompleteDialog } from "./WorkOrderCompleteDialog";
import { LinkOrderDialog } from "./LinkOrderDialog";
import { ChangeTargetDialog } from "./ChangeTargetDialog";
import { summarizeLinkedFulfillment } from "./order-fulfillment";
import { V3Section } from "./detail-v3/V3Section";
import { KunyeCard } from "./detail-v3/KunyeCard";
import { RouteStepline } from "./detail-v3/RouteStepline";
import { ProducedV3 } from "./detail-v3/ProducedV3";
import { SheetKpis } from "./detail-v3/SheetKpis";
import { OrderLinksV3 } from "./detail-v3/OrderLinksV3";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import "./detail-v3/work-order-detail-v3.css";
import type { WorkOrder } from "./types";

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
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [linkOrderOpen, setLinkOrderOpen] = useState(false);
  // null = kapalı; "color"/"width" hangi hedefin değiştirileceğini söyler.
  const [changeMode, setChangeMode] = useState<"color" | "width" | null>(null);
  const [travelerCardOpen, setTravelerCardOpen] = useState(false);
  const [printDispatchId, setPrintDispatchId] = useState<string | null>(null);
  const [inProgressConfirmOpen, setInProgressConfirmOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const openTarget = useOpenTarget();

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
  const hasProduced = (wo?.producedRolls?.count ?? 0) > 0;
  const showOrders = hasOrders || wo?.type === "STOCK_PRODUCTION";

  const canEdit = Boolean(wo && onEdit && (wo.status === "PLANNED" || wo.status === "IN_PROGRESS"));
  const canCancel = Boolean(
    wo && wo.status !== "COMPLETED" && wo.status !== "CANCELLED" && wo.status !== "SUPERSEDED",
  );
  const canComplete = Boolean(wo && wo.status === "IN_PROGRESS");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-2xl">
        {/* A11y için gerçek başlık (Radix Dialog Title/Description) — görünmez;
            görünür kurumsal başlık aşağıda .sheet-head içinde. */}
        <SheetHeader className="sr-only">
          <SheetTitle>{wo?.workOrderNumber ?? "İş Emri"}</SheetTitle>
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
                    <span className={`pill ${STATUS_PILL[wo.status] ?? "neutral"}`}>
                      <span className="dot" />
                      {workOrderStatusLabels[wo.status]}
                    </span>
                  </div>
                  <div className="sheet-sub">
                    {workOrderTypeLabels[wo.type]}
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

                    {canEdit && (
                      <PermissionGate permission="workorder:write">
                        <button
                          type="button"
                          className="btn"
                          onClick={() => {
                            if (wo.status === "IN_PROGRESS") setInProgressConfirmOpen(true);
                            else onEdit?.(wo);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" /> Düzenle
                          {wo.status === "IN_PROGRESS" && (
                            <span style={{ color: "var(--warn)" }} aria-label="üretim devam ediyor">
                              ⚠
                            </span>
                          )}
                        </button>
                      </PermissionGate>
                    )}

                    {/* Dar kapılar (2026-08-17): tek bir şeyi değiştirirler ve
                        "Düzenle"nin aksine rota/hedef/metrajı açmazlar. Üretim
                        başlamış iş emrinde de kullanılabilirler — asıl amaç bu. */}
                    <PermissionGate permission="workorder:write">
                      <button type="button" className="btn" onClick={() => setLinkOrderOpen(true)}>
                        <Link2 className="h-3.5 w-3.5" /> Sipariş Bağla
                      </button>
                      <button type="button" className="btn" onClick={() => setChangeMode("color")}>
                        <Palette className="h-3.5 w-3.5" /> Rengi Değiştir
                      </button>
                      <button type="button" className="btn" onClick={() => setChangeMode("width")}>
                        <Ruler className="h-3.5 w-3.5" /> Eni Değiştir
                      </button>
                    </PermissionGate>

                    <button type="button" className="btn" onClick={() => setDocumentsOpen(true)}>
                      <FileText className="h-3.5 w-3.5" /> Belgeler
                    </button>

                    {canComplete && (
                      <PermissionGate permission="workorder:write">
                        <button
                          type="button"
                          className="btn"
                          style={{
                            color: "var(--ok)",
                            borderColor: "color-mix(in srgb, var(--ok) 40%, var(--border-strong))",
                          }}
                          onClick={() => setCompleteOpen(true)}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> Kapat
                        </button>
                      </PermissionGate>
                    )}

                    {canCancel && (
                      <PermissionGate permission="workorder:write">
                        <button
                          type="button"
                          className="btn danger"
                          style={{ marginLeft: "auto" }}
                          onClick={() => setCancelOpen(true)}
                        >
                          <Ban className="h-3.5 w-3.5" /> İptal Et
                        </button>
                      </PermissionGate>
                    )}
                  </div>
                </div>

                <SheetKpis wo={wo} fulfill={fulfill} hasOrders={hasOrders} />

                <V3Section title="İş Emri Künyesi">
                  <KunyeCard wo={wo} />
                </V3Section>

                {sortedSteps.length > 0 && (
                  <V3Section title="Rota & İstasyonlar" active={wipSteps.length > 0}>
                    <RouteStepline steps={sortedSteps} />
                  </V3Section>
                )}

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
              onOpenChange={(o) => !o && setChangeMode(null)}
              mode={changeMode ?? "color"}
              workOrderId={wo.id}
              workOrderNumber={wo.workOrderNumber}
              currentColorId={wo.targetColorId}
              currentColorName={wo.targetColor?.name ?? null}
              currentWidth={wo.width}
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
          description="Bu iş emri şu an üretimde. Yapacağın değişiklikler bağlı rulolara ve istasyon adımlarına yansıyabilir. Devam edilsin mi?"
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
