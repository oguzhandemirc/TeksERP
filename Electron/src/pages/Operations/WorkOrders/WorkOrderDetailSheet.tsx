import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Ban, ChevronDown, ChevronRight, FileText, Info, Pencil, Printer } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import type { StepDispatch } from "./types";
import { StatusBadge, workOrderStatusTones, stepStatusTones } from "@/components/operations/StatusBadge";
import { DeadlineBadge } from "@/components/operations/DeadlineBadge";
import { PermissionGate } from "@/components/PermissionGate";
import { workOrderStatusLabels, workOrderTypeLabels, stepStatusLabels } from "@/types/enums";
import { safeFormat, formatNumber } from "@/lib/format";
import { AnimatedProgress } from "@/components/motion";
import { cn } from "@/lib/utils";
import { workOrderService } from "./service";
import { WorkOrderDocumentsDialog } from "./WorkOrderDocumentsDialog";
import { TravelerCardPrintDialog } from "./TravelerCardPrintDialog";
import { FasonSevkPrintDialog } from "./FasonSevkPrintDialog";
import { WorkOrderCancelDialog } from "./WorkOrderCancelDialog";
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

  // Bağlı sipariş satırlarını orderId'ye göre grupla — siparişe özel WO'larda
  // hangi sipariş(ler)e ait olduğu + her siparişin kalemleri ayrı görünür.
  const orderGroups = useMemo(() => {
    const links = wo?.orderLinks ?? [];
    const map = new Map<string, typeof links>();
    for (const link of links) {
      const orderId = link.orderLine?.order?.id ?? `__no_order_${link.orderLineId}`;
      const existing = map.get(orderId);
      if (existing) existing.push(link);
      else map.set(orderId, [link]);
    }
    return Array.from(map.entries()).map(([orderId, ls]) => ({
      orderId,
      order: ls[0]?.orderLine?.order,
      links: ls,
    }));
  }, [wo?.orderLinks]);

  // Sipariş toplam = bağlı sipariş kalemlerinin talebi (link-only: tahsis yok).
  const hasOrders = (wo?.orderLinks?.length ?? 0) > 0;
  const orderTotal = useMemo(
    () =>
      (wo?.orderLinks ?? []).reduce(
        (s, l) => s + Number(l.orderLine?.quantity ?? 0),
        0,
      ),
    [wo?.orderLinks],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="font-mono">{wo?.batchNumber}</span>
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
                    variant="outline"
                    onClick={() => {
                      if (wo.status === "IN_PROGRESS") {
                        setInProgressConfirmOpen(true);
                      } else {
                        onEdit(wo);
                      }
                    }}
                    className="gap-1"
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
              variant="outline"
              onClick={() => setDocumentsOpen(true)}
              className="gap-1"
            >
              <FileText className="h-3.5 w-3.5" /> Belgeler
            </Button>
            {wo.status !== "COMPLETED" && wo.status !== "CANCELLED" && (
              <PermissionGate permission="workorder:write">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setCancelOpen(true)}
                  className="gap-1 text-destructive hover:text-destructive"
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
                <Card>
                  <CardContent className="p-3">
                    <div className="text-xs text-muted-foreground">Sipariş Toplam</div>
                    <div className="mt-0.5 font-medium tabular-nums">
                      {formatNumber(orderTotal, 0)}
                      <span className="ml-1 text-xs text-muted-foreground">m</span>
                    </div>
                  </CardContent>
                </Card>
              )}
              <Card>
                <CardContent className="p-3">
                  <div className="text-xs text-muted-foreground">Üretime Giren</div>
                  <div className="mt-0.5 font-medium tabular-nums">
                    {formatNumber(wo.inputRolls?.totalMeters ?? 0, 0)}
                    <span className="ml-1 text-xs text-muted-foreground">m</span>
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
                  <div className="mt-0.5 font-medium tabular-nums">
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

            {wo.targetQuantity != null && wo.targetQuantity > 0 && wo.producedRolls && (
              <Card>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Üretim İlerlemesi (bitmiş depo)</span>
                    <span className="font-medium tabular-nums">
                      {formatNumber(wo.producedRolls.warehouse.totalMeters, 0)} /{" "}
                      {formatNumber(wo.targetQuantity, 0)} m
                    </span>
                  </div>
                  <AnimatedProgress
                    value={(wo.producedRolls.warehouse.totalMeters / wo.targetQuantity) * 100}
                    className="mt-2 h-1.5"
                  />
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent className="space-y-1 p-3 text-sm">
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                  <div className="text-xs text-muted-foreground">Planlanan Başlangıç</div>
                  <div className="text-xs">{safeFormat(wo.plannedStartDate, "dd.MM.yyyy")}</div>
                  <div className="text-xs text-muted-foreground">Oluşturma</div>
                  <div className="text-xs">{safeFormat(wo.createdAt, "dd.MM.yyyy HH:mm")}</div>
                  {wo.targetItem && (
                    <>
                      <div className="text-xs text-muted-foreground">Hedef Ürün</div>
                      <div className="text-xs font-medium">
                        <span className="font-mono mr-1">{wo.targetItem.code}</span>
                        {wo.targetItem.name}
                      </div>
                    </>
                  )}
                  {wo.targetColor && (
                    <>
                      <div className="text-xs text-muted-foreground">Renk</div>
                      <div className="flex items-center gap-1.5 text-xs">
                        {wo.targetColor.hex && (
                          <span
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: wo.targetColor.hex }}
                          />
                        )}
                        {wo.targetColor.name}
                      </div>
                    </>
                  )}
                  {wo.foldType && (
                    <>
                      <div className="text-xs text-muted-foreground">Kat Tipi</div>
                      <div className="text-xs">{wo.foldType}</div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-2 p-3">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Üretim Özellikleri
                </div>
                {wo.targetProperties && wo.targetProperties.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {wo.targetProperties.map((p) => (
                      <Badge key={p.propertyId} variant="muted" className="text-[10px]">
                        {p.property.name}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground italic">
                    Atanmış özellik yok.
                  </div>
                )}
              </CardContent>
            </Card>

            {wo.producedRolls &&
              (wo.producedRolls.count > 0 || wo.producedRolls.swatch.count > 0) && (
                <Card>
                  <CardContent className="p-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Üretilen Nihai Toplar
                    </div>
                    <div className="mt-1 text-sm font-medium tabular-nums">
                      {wo.producedRolls.count} top
                      <span className="ml-1 text-muted-foreground">·</span>
                      <span className="ml-1">
                        {formatNumber(wo.producedRolls.totalMeters, 0)} m
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                      {wo.producedRolls.warehouse.count > 0 && (
                        <Badge variant="muted" className="font-normal">
                          Bitmiş Depo: {wo.producedRolls.warehouse.count} top ·{" "}
                          {formatNumber(wo.producedRolls.warehouse.totalMeters, 0)} m
                        </Badge>
                      )}
                      {wo.producedRolls.a1.count > 0 && (
                        <Badge variant="muted" className="font-normal">
                          A1: {wo.producedRolls.a1.count} top ·{" "}
                          {formatNumber(wo.producedRolls.a1.totalMeters, 0)} m
                        </Badge>
                      )}
                      {wo.producedRolls.fire.count > 0 && (
                        <Badge variant="outline" className="font-normal text-destructive">
                          Fire: {wo.producedRolls.fire.count} top ·{" "}
                          {formatNumber(wo.producedRolls.fire.totalMeters, 0)} m
                        </Badge>
                      )}
                      {wo.producedRolls.swatch.count > 0 && (
                        <Badge variant="outline" className="font-normal">
                          Kartela: {wo.producedRolls.swatch.count} adet
                        </Badge>
                      )}
                    </div>

                    {wo.producedRolls.items.length > 0 && (
                      <ul className="mt-2 max-h-64 divide-y overflow-auto rounded-md border bg-muted/30">
                        {wo.producedRolls.items.map((r) => {
                          const tone =
                            r.qualityGrade === "FIRE"
                              ? "text-destructive"
                              : r.qualityGrade === "A1"
                                ? "text-warning"
                                : "text-foreground";
                          // Snapshot: fiziksel olarak yok olmuş ise (re-cut →
                          // TAMBUR_CONSUMED, operatör iptal → CANCELLED) küçük
                          // gri rozet + soluk satır.
                          const removedFromStock =
                            r.status === "TAMBUR_CONSUMED" ||
                            r.status === "CANCELLED";
                          const removedLabel =
                            r.status === "TAMBUR_CONSUMED"
                              ? "Bölündü"
                              : r.status === "CANCELLED"
                                ? "İptal"
                                : null;
                          return (
                            <li
                              key={r.id}
                              className={cn(
                                "flex items-center justify-between gap-2 px-2 py-1 text-[11px]",
                                removedFromStock && "opacity-60",
                              )}
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="font-mono">
                                  {r.barcode ?? "—"}
                                </span>
                                <Badge
                                  variant="outline"
                                  className={`text-[9px] font-normal ${tone}`}
                                >
                                  {r.qualityGrade}
                                </Badge>
                                {removedLabel && (
                                  <Badge
                                    variant="muted"
                                    className="text-[9px] font-normal"
                                  >
                                    {removedLabel}
                                  </Badge>
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
                              </div>
                              <span className="font-medium tabular-nums">
                                {formatNumber(r.currentQty, 0)} m
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    {wo.producedRolls.swatchItems.length > 0 && (
                      <>
                        <div className="mt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          Kartelalar
                        </div>
                        <ul className="mt-1 divide-y rounded-md border bg-muted/30">
                          {wo.producedRolls.swatchItems.map((s) => (
                            <li
                              key={s.id}
                              className="flex items-center justify-between gap-2 px-2 py-1 text-[11px]"
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="font-mono">{s.barcode}</span>
                                {s.parentBarcode && (
                                  <span className="font-mono text-muted-foreground">
                                    ← {s.parentBarcode}
                                  </span>
                                )}
                                {s.color && (
                                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                                    {s.color.hex && (
                                      <span
                                        className="h-2 w-2 rounded-full border border-black/10"
                                        style={{ backgroundColor: s.color.hex }}
                                      />
                                    )}
                                    {s.color.name}
                                  </span>
                                )}
                                {s.purpose && (
                                  <span className="text-muted-foreground">
                                    · {s.purpose}
                                  </span>
                                )}
                              </div>
                              <span className="font-medium tabular-nums">
                                {formatNumber(s.length, 0)} cm
                              </span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}

                    <div className="mt-2 text-[11px] text-muted-foreground">
                      Metraj toplamı sağlam (depo + A1); fire metresi hariç. Kartela ayrı.
                    </div>
                  </CardContent>
                </Card>
              )}

            {sortedSteps.length > 0 && (
              <div className="flex items-center gap-1.5 px-1" aria-hidden>
                {sortedSteps.map((step, i) => {
                  const done = step.status === "COMPLETED";
                  const active = step.status === "ACTIVE";
                  return (
                    <div
                      key={step.id}
                      className={cn("flex items-center gap-1.5", i < sortedSteps.length - 1 ? "flex-1" : "flex-none")}
                      title={step.station?.name ?? undefined}
                    >
                      <span
                        className={cn(
                          "h-2.5 w-2.5 shrink-0 rounded-full",
                          done
                            ? "bg-success"
                            : active
                              ? "bg-primary animate-pulse"
                              : step.status === "SKIPPED"
                                ? "bg-muted-foreground/40"
                                : "bg-muted-foreground/20",
                        )}
                      />
                      {i < sortedSteps.length - 1 && (
                        <span className={cn("h-0.5 flex-1 rounded", done ? "bg-success" : "bg-border")} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div>
              <button
                type="button"
                onClick={() => setStepsExpanded((v) => !v)}
                className="mb-2 flex w-full items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
              >
                {stepsExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                Rota Adımları ({sortedSteps.length})
              </button>
              <ol className="space-y-1.5">
                {(stepsExpanded ? sortedSteps : summaryStep ? [summaryStep] : []).map((step) => (
                  <li key={step.id} className="rounded-md border p-2.5">
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
                          onPrint={(id) => setPrintDispatchId(id)}
                        />
                      )}
                      <StatusBadge
                        status={step.status}
                        labels={stepStatusLabels}
                        tones={stepStatusTones}
                        className="h-6 text-[10px]"
                      />
                    </div>
                    {step.currentRolls && step.currentRolls.count > 0 && (
                      <div className="mt-1.5 pl-7">
                        <div className="flex flex-wrap items-center gap-1 text-[11px]">
                          <span className="text-muted-foreground">Şu an:</span>
                          <span className="font-medium tabular-nums">
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
                  </li>
                ))}
              </ol>
            </div>

            {orderGroups.length > 0 && (
              <div>
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {orderGroups.length === 1 ? "Bağlı Sipariş" : `Bağlı Siparişler (${orderGroups.length})`}
                </div>
                <div className="space-y-2">
                  {orderGroups.map(({ orderId, order, links }) => (
                    <Card key={orderId}>
                      <CardContent className="space-y-2 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="font-mono text-xs font-semibold">
                              {order?.orderNumber ?? "—"}
                            </span>
                            {order?.customer && (
                              <span className="truncate text-sm">{order.customer.name}</span>
                            )}
                          </div>
                          {order?.deadline && <DeadlineBadge deadline={order.deadline} />}
                        </div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Kalemler ({links.length})
                        </div>
                        <ul className="divide-y rounded-md border">
                          {links.map((link) => {
                            const ol = link.orderLine;
                            return (
                              <li
                                key={link.orderLineId}
                                className="flex flex-wrap items-center justify-between gap-2 p-2 text-xs"
                              >
                                <div className="min-w-0">
                                  <span className="font-medium">
                                    {ol?.item?.name ?? "—"}
                                  </span>
                                  {ol?.color && (
                                    <span className="ml-1.5 inline-flex items-center gap-1">
                                      {ol.color.hex && (
                                        <span
                                          className="h-2.5 w-2.5 rounded-full ring-1 ring-border"
                                          style={{ backgroundColor: ol.color.hex }}
                                        />
                                      )}
                                      <span className="text-muted-foreground">
                                        {ol.color.name}
                                      </span>
                                    </span>
                                  )}
                                  {ol?.requiredProperties && ol.requiredProperties.length > 0 && (
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      {ol.requiredProperties.map((rp) => (
                                        <Badge
                                          key={rp.propertyId}
                                          variant="muted"
                                          className="text-[9px]"
                                        >
                                          {rp.property.name}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5">
                                  {ol?.width != null && (
                                    <Badge variant="outline" className="font-normal">
                                      En: {ol.width} cm
                                    </Badge>
                                  )}
                                  {ol?.quantity != null && (
                                    <Badge variant="outline" className="font-normal">
                                      Boy: {formatNumber(ol.quantity, 0)} m
                                    </Badge>
                                  )}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {wo.type === "STOCK_PRODUCTION" && (
              <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                Stoğa üretim — siparişe bağlı değil.
              </div>
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
          batchNumber={wo?.batchNumber}
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
  onPrint,
}: {
  dispatches: StepDispatch[];
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
