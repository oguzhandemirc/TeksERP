import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Ban, ChevronDown, ChevronRight, ClipboardList, FileText, Info, Maximize2, PackageCheck, Pencil, Printer, Route, ShoppingCart, StickyNote } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import type { StepDispatch } from "./types";
import { fasonNoteLabel } from "./fasonNote";
import { StatusBadge, workOrderStatusTones } from "@/components/operations/StatusBadge";
import { DeadlineBadge } from "@/components/operations/DeadlineBadge";
import { PermissionGate } from "@/components/PermissionGate";
import { workOrderStatusLabels, workOrderTypeLabels } from "@/types/enums";
import { safeFormat, formatNumber } from "@/lib/format";
import { AnimatedProgress } from "@/components/motion";
import { cn } from "@/lib/utils";
import { workOrderService } from "./service";
import { WorkOrderDocumentsDialog } from "./WorkOrderDocumentsDialog";
import { TravelerCardPrintDialog } from "./TravelerCardPrintDialog";
import { FasonSevkPrintDialog } from "./FasonSevkPrintDialog";
import { WorkOrderCancelDialog } from "./WorkOrderCancelDialog";
import { RouteDistributionStrip } from "./RouteDistributionStrip";
import { SectionBlock } from "./WorkOrderSection";
import { WorkOrderInfoCard } from "./WorkOrderInfoCard";
import { ProducedRollsCard } from "./ProducedRollsCard";
import { OrderLinksCard } from "./OrderLinksCard";
import { summarizeLinkedFulfillment } from "./order-fulfillment";
import { StepStateBadge } from "./step-state";
import { FasonStepActions } from "./FasonStepActions";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import type { WorkOrder } from "./types";

interface Props {
  workOrder: WorkOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Düzenle butonuna basıldığında parent'a tam (zenginleştirilmiş) WO geçer. */
  onEdit?: (wo: WorkOrder) => void;
}

export function WorkOrderDetailSheet({ workOrder, open, onOpenChange, onEdit }: Props) {
  const [stepsExpanded, setStepsExpanded] = useState(false);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [travelerCardOpen, setTravelerCardOpen] = useState(false);
  const [printDispatchId, setPrintDispatchId] = useState<string | null>(null);
  const [inProgressConfirmOpen, setInProgressConfirmOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
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

  // Özet adım: ACTIVE > son COMPLETED/SKIPPED > ilk adım
  const summaryStep = useMemo(() => {
    if (sortedSteps.length === 0) return null;
    const active = sortedSteps.find((s) => s.status === "ACTIVE");
    if (active) return active;
    const lastDone = [...sortedSteps]
      .reverse()
      .find((s) => s.status === "COMPLETED" || s.status === "SKIPPED");
    return lastDone ?? sortedSteps[0];
  }, [sortedSteps]);

  // Daraltılmış görünüm: tek "özet adım" yerine ŞU AN malı olan tüm adımları
  // göster — birden çok dal varsa hepsi görünür (tek-pointer yanılgısını önler).
  // Hiçbirinde WIP yoksa (başlamamış/bitmiş) özet adıma düş.
  const collapsedSteps = useMemo(() => {
    const withWip = sortedSteps.filter((s) => (s.currentRolls?.count ?? 0) > 0);
    if (withWip.length > 0) return withWip;
    return summaryStep ? [summaryStep] : [];
  }, [sortedSteps, summaryStep]);


  // Bağlı kalemlerin karşılanma özeti (İPTAL hariç, distinct). Sevk/açık =
  // kalemin TÜM sevkiyat toplamıdır (spec havuzu), bu WO'ya atfedilmez — bağlam.
  const hasOrders = (wo?.orderLinks?.length ?? 0) > 0;
  const fulfill = useMemo(
    () => summarizeLinkedFulfillment(wo?.orderLinks ?? []),
    [wo?.orderLinks],
  );
  const hasProduced = (wo?.producedRolls?.count ?? 0) > 0;
  // Sipariş bölgesi: bağlı sipariş varsa ya da stoğa üretim notu gösterilecekse.
  const showOrders = hasOrders || wo?.type === "STOCK_PRODUCTION";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="font-mono">{wo?.workOrderNumber}</span>
            {wo && (
              <StatusBadge
                status={wo.status}
                labels={workOrderStatusLabels}
                tones={workOrderStatusTones}
              />
            )}
          </SheetTitle>
          <SheetDescription>
            {wo && workOrderTypeLabels[wo.type]}
            {wo?.routeTemplate && <> · Rota: {wo.routeTemplate.name}</>}
          </SheetDescription>
        </SheetHeader>

        {detail.isLoading && !workOrder && (
          <div className="mt-4 space-y-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}

        {wo && (
          <div className="mt-3 flex flex-wrap gap-2">
            {(wo.status === "PLANNED" || wo.status === "IN_PROGRESS") &&
              onEdit && (
                <PermissionGate permission="workorder:write">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      if (wo.status === "IN_PROGRESS") {
                        setInProgressConfirmOpen(true);
                      } else {
                        onEdit(wo);
                      }
                    }}
                    className="gap-1 border-transparent bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    <Pencil className="h-3.5 w-3.5" /> İş Emrini Düzenle
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
              onClick={(e) => {
                onOpenChange(false);
                openTarget(`/operations/work-orders/${wo.id}`, e);
              }}
              className="gap-1 border-transparent bg-violet-600 text-white hover:bg-violet-700 dark:bg-violet-600 dark:hover:bg-violet-500"
              title="Sol tık: bu sekmede · Shift/Ctrl+tık: yeni sekmede"
            >
              <Maximize2 className="h-3.5 w-3.5" /> Tam Ekran Aç
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setDocumentsOpen(true)}
              className="gap-1 border-transparent bg-amber-500 text-white hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-500"
            >
              <FileText className="h-3.5 w-3.5" /> Belgeler
            </Button>
            {wo.status !== "COMPLETED" && wo.status !== "CANCELLED" && (
              <PermissionGate permission="workorder:write">
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={() => setCancelOpen(true)}
                  className="ml-auto gap-1"
                >
                  <Ban className="h-3.5 w-3.5" /> İptal Et
                </Button>
              </PermissionGate>
            )}
          </div>
        )}

        {wo && (
          <div className="mt-4 space-y-4">
            <div
              className={cn(
                "grid gap-2 text-sm",
                hasOrders ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3",
              )}
            >
              {hasOrders && (
                <Card className="border-l-2 border-l-info bg-info/[0.04]">
                  <CardContent className="p-3">
                    <div className="text-xs text-muted-foreground">Sipariş Toplam</div>
                    <div className="mt-0.5 text-base font-bold tabular-nums text-info">
                      {formatNumber(fulfill.requested, 1)}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">m</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <Badge className="border-transparent bg-success font-normal text-success-foreground">
                        Sevk: {formatNumber(fulfill.shipped, 1)} m
                      </Badge>
                      <Badge className="border-transparent bg-destructive font-normal text-destructive-foreground">
                        Açık: {formatNumber(fulfill.open, 1)} m
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              )}
              <Card className="border-l-2 border-l-primary/50">
                <CardContent className="p-3">
                  <div className="text-xs text-muted-foreground">Üretime Giren</div>
                  <div className="mt-0.5 text-base font-bold tabular-nums text-primary">
                    {formatNumber(wo.inputRolls?.totalMeters ?? 0, 0)}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">m</span>
                  </div>
                  {(wo.inputRolls?.count ?? 0) > 0 && (
                    <div className="text-[11px] text-muted-foreground">
                      {wo.inputRolls!.count} top
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <div className="text-xs text-muted-foreground">En</div>
                  <div className="mt-0.5 text-base font-bold tabular-nums">
                    {wo.width != null ? `${wo.width} cm` : "—"}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <div className="text-xs text-muted-foreground">Termin</div>
                  <div className="mt-1">
                    <DeadlineBadge deadline={wo.plannedEndDate} />
                  </div>
                </CardContent>
              </Card>
            </div>

            {wo.targetQuantity != null && wo.targetQuantity > 0 && wo.producedRolls && (() => {
              const pct = (wo.producedRolls.warehouse.totalMeters / wo.targetQuantity) * 100;
              const done = pct >= 100;
              return (
                <Card className={cn("border-l-2", done ? "border-l-success" : "border-l-primary/50")}>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Üretim İlerlemesi (bitmiş depo)</span>
                      <span
                        className={cn(
                          "font-bold tabular-nums",
                          done ? "text-success" : "text-primary",
                        )}
                      >
                        {formatNumber(wo.producedRolls.warehouse.totalMeters, 0)} /{" "}
                        {formatNumber(wo.targetQuantity, 0)} m
                        <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                          (%{formatNumber(Math.min(pct, 999), 0)})
                        </span>
                      </span>
                    </div>
                    <AnimatedProgress value={pct} className="mt-2 h-1.5" />
                  </CardContent>
                </Card>
              );
            })()}

            <SectionBlock title="İş Emri Künyesi" tone="primary" icon={ClipboardList}>
              <WorkOrderInfoCard wo={wo} />
            </SectionBlock>

            {sortedSteps.length > 0 && (
              <SectionBlock
                title="Rota & İstasyonlar"
                tone="process"
                icon={Route}
                trailing={
                  <button
                    type="button"
                    onClick={() => setStepsExpanded((v) => !v)}
                    className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                  >
                    {stepsExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                    {stepsExpanded ? "Daralt" : `Tümü (${sortedSteps.length})`}
                  </button>
                }
              >
                <RouteDistributionStrip steps={sortedSteps} variant="compact" />
                <ol className="space-y-1.5">
                {(stepsExpanded ? sortedSteps : collapsedSteps).map((step) => (
                  <li
                    key={step.id}
                    className={cn(
                      "rounded-md border p-2.5 transition-colors",
                      (step.currentRolls?.count ?? 0) > 0 &&
                        "border-l-2 border-l-primary bg-primary/[0.04]",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="muted"
                        className="h-5 w-5 justify-center font-mono text-[10px]"
                      >
                        {step.stepSequence}
                      </Badge>
                      <span className="flex-1 text-sm font-medium">
                        {step.station?.name ?? "—"}
                      </span>
                      {step.dispatches && step.dispatches.length > 0 && (
                        <DispatchInfoPopover
                          dispatches={step.dispatches}
                          stationName={step.station?.name}
                          onPrint={(id) => setPrintDispatchId(id)}
                        />
                      )}
                      <StepStateBadge step={step} />
                    </div>
                    {step.notes && step.notes.trim() && (
                      <div className="mt-1.5 flex items-start gap-1 pl-7 text-[11px] text-muted-foreground">
                        <StickyNote className="mt-0.5 h-3 w-3 shrink-0 opacity-70" />
                        <span className="whitespace-pre-wrap italic">{step.notes}</span>
                      </div>
                    )}
                    {step.currentRolls && step.currentRolls.count > 0 && (
                      <div className="mt-1.5 pl-7">
                        <div className="flex flex-wrap items-center gap-1 text-[11px]">
                          <span className="font-medium text-primary">Şu an:</span>
                          <span className="font-semibold tabular-nums text-primary">
                            {step.currentRolls.count} parça
                          </span>
                          <span className="text-muted-foreground">·</span>
                          <span className="font-medium tabular-nums">
                            {formatNumber(step.currentRolls.totalMeters, 0)} m
                          </span>
                          {step.currentRolls.rawCount > 0 && (
                            <Badge variant="outline" className="font-normal">
                              Ham: {step.currentRolls.rawCount} ·{" "}
                              {formatNumber(step.currentRolls.rawMeters, 0)} m
                            </Badge>
                          )}
                          {step.currentRolls.dyedCount > 0 && (
                            <Badge variant="outline" className="font-normal">
                              Boyalı: {step.currentRolls.dyedCount} ·{" "}
                              {formatNumber(step.currentRolls.dyedMeters, 0)} m
                            </Badge>
                          )}
                          {step.currentRolls.openFabricCount > 0 && (
                            <Badge variant="outline" className="font-normal">
                              Açık kumaş: {step.currentRolls.openFabricCount} ·{" "}
                              {formatNumber(step.currentRolls.openFabricMeters, 0)} m
                            </Badge>
                          )}
                        </div>
                        {step.currentRollList && step.currentRollList.length > 0 && (
                          <ul className="mt-1.5 divide-y rounded-md border bg-muted/30">
                            {step.currentRollList.map((r) => (
                              <li
                                key={r.id}
                                className="flex items-center justify-between gap-2 px-2 py-1 text-[11px]"
                              >
                                <div className="flex min-w-0 items-center gap-2">
                                  {r.barcode ? (
                                    <span className="font-mono">{r.barcode}</span>
                                  ) : (
                                    <Badge variant="outline" className="text-[9px]">
                                      Açık Kumaş
                                    </Badge>
                                  )}
                                  {r.item && (
                                    <span className="truncate font-medium">
                                      {r.item.name}
                                    </span>
                                  )}
                                  {r.color && (
                                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                                      {r.color.hex && (
                                        <span
                                          className="h-2 w-2 rounded-full border border-black/10"
                                          style={{ backgroundColor: r.color.hex }}
                                        />
                                      )}
                                      {r.color.name}
                                    </span>
                                  )}
                                  {r.kind === "raw" && (
                                    <Badge variant="outline" className="text-[9px] font-normal">
                                      Ham
                                    </Badge>
                                  )}
                                  {r.qualityGrade && r.qualityGrade !== "1.KALITE" && (
                                    <Badge variant="outline" className="text-[9px] font-normal">
                                      {r.qualityGrade}
                                    </Badge>
                                  )}
                                </div>
                                <span className="font-medium tabular-nums">
                                  {formatNumber(r.currentQty, 0)} m
                                  {r.width != null && (
                                    <span className="ml-1 font-normal text-muted-foreground">
                                      · {r.width} cm
                                    </span>
                                  )}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                    <FasonStepActions
                      step={step}
                      steps={sortedSteps}
                      workOrderId={wo!.id}
                    />
                  </li>
                ))}
                </ol>
              </SectionBlock>
            )}

            {hasProduced && (
              <SectionBlock title="Üretilen Toplar" tone="success" icon={PackageCheck}>
                <ProducedRollsCard wo={wo} />
              </SectionBlock>
            )}

            {showOrders && (
              <SectionBlock title="Bağlı Sipariş(ler)" tone="info" icon={ShoppingCart}>
                <OrderLinksCard wo={wo} />
              </SectionBlock>
            )}
          </div>
        )}

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

        <TravelerCardPrintDialog
          workOrder={wo ?? null}
          open={travelerCardOpen}
          onOpenChange={setTravelerCardOpen}
        />

        <FasonSevkPrintDialog
          dispatchId={printDispatchId}
          open={Boolean(printDispatchId)}
          onOpenChange={(open) => !open && setPrintDispatchId(null)}
        />

        <WorkOrderCancelDialog
          open={cancelOpen}
          onOpenChange={setCancelOpen}
          workOrderId={wo?.id ?? null}
          batchNumber={wo?.workOrderNumber}
          onCancelled={() => onOpenChange(false)}
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

function DispatchInfoPopover({
  dispatches,
  stationName,
  onPrint,
}: {
  dispatches: StepDispatch[];
  stationName?: string | null;
  onPrint: (id: string) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-6 w-6 shrink-0 border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary"
          title="Fason sevk bilgisi"
          onClick={(e) => e.stopPropagation()}
        >
          <Info className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-96 border-2 border-primary/30 p-0 shadow-xl"
      >
        <div className="border-b-2 border-primary/20 bg-primary/5 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-primary">
          {dispatches.length === 1
            ? "Fason Sevk Bilgisi"
            : `Fason Sevkler (${dispatches.length})`}
        </div>
        <ul className="max-h-80 divide-y overflow-auto">
          {dispatches.map((d) => (
            <li key={d.id} className="space-y-1.5 px-3 py-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] font-semibold">
                  {d.dispatchNo}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="tabular-nums font-semibold text-foreground">
                    {formatNumber(d.totalQty, 0)} m
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-6 w-6"
                    title="İrsaliyeyi yazdır"
                    onClick={() => onPrint(d.id)}
                  >
                    <Printer className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="text-[11px] font-medium">
                {d.subcontractor.name}
                <span className="ml-1 font-normal text-muted-foreground">
                  · {safeFormat(d.dispatchedAt, "dd.MM.yyyy HH:mm")}
                </span>
              </div>
              <div className="grid grid-cols-[70px_1fr] gap-x-2 gap-y-0.5 rounded-md border bg-muted/40 px-2 py-1.5">
                <span className="text-muted-foreground">Plaka</span>
                <span className="font-mono font-semibold">
                  {d.plateNumber || "—"}
                </span>
                <span className="text-muted-foreground">Sürücü</span>
                <span className="font-medium">{d.driverName || "—"}</span>
                {d.notes && (
                  <>
                    <span className="text-muted-foreground">Not</span>
                    <span className="whitespace-pre-wrap">{d.notes}</span>
                  </>
                )}
                {(d.instruction ?? d.stepNote) && (
                  <>
                    <span className="text-muted-foreground">{fasonNoteLabel(stationName)}</span>
                    <span className="whitespace-pre-wrap font-medium text-orange-700">
                      {d.instruction ?? d.stepNote}
                    </span>
                  </>
                )}
                {d.dispatchedBy && (
                  <>
                    <span className="text-muted-foreground">Sevkeden</span>
                    <span>
                      {d.dispatchedBy.fullName ?? d.dispatchedBy.username}
                    </span>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
