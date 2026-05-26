import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, FileText, Pencil } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, workOrderStatusTones, stepStatusTones } from "@/components/operations/StatusBadge";
import { DeadlineBadge } from "@/components/operations/DeadlineBadge";
import { PermissionGate } from "@/components/PermissionGate";
import { workOrderStatusLabels, workOrderTypeLabels, stepStatusLabels } from "@/types/enums";
import { safeFormat, formatNumber } from "@/lib/format";
import { workOrderService } from "./service";
import { WOTargetPropertiesEditDialog } from "./WOTargetPropertiesEditDialog";
import { WorkOrderDocumentsDialog } from "./WorkOrderDocumentsDialog";
import { TravelerCardPrintDialog } from "./TravelerCardPrintDialog";
import type { WorkOrder } from "./types";

interface Props {
  workOrder: WorkOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Düzenle butonuna basıldığında parent'a tam (zenginleştirilmiş) WO geçer. */
  onEdit?: (wo: WorkOrder) => void;
}

export function WorkOrderDetailSheet({ workOrder, open, onOpenChange, onEdit }: Props) {
  const [editTargetPropsOpen, setEditTargetPropsOpen] = useState(false);
  const [stepsExpanded, setStepsExpanded] = useState(false);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [travelerCardOpen, setTravelerCardOpen] = useState(false);

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
                    onClick={() => onEdit(wo)}
                    className="gap-1"
                    title={
                      wo.status === "IN_PROGRESS"
                        ? "Üretim devam ediyor — değişiklik bağlı rulolara yansıyabilir"
                        : undefined
                    }
                  >
                    <Pencil className="h-3.5 w-3.5" /> İş Emrini Düzenle
                    {wo.status === "IN_PROGRESS" && (
                      <span className="text-amber-600" aria-label="üretim devam ediyor">
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
          </div>
        )}

        {wo && (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-3 gap-2 text-sm">
              <Card>
                <CardContent className="p-3">
                  <div className="text-xs text-muted-foreground">Hedef Metraj</div>
                  <div className="mt-0.5 font-medium tabular-nums">
                    {formatNumber(wo.targetQuantity, 0)}
                    {wo.targetQuantity != null && (
                      <span className="ml-1 text-xs text-muted-foreground">m</span>
                    )}
                  </div>
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
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Üretim Özellikleri
                  </div>
                  <PermissionGate permission="workorder:write">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs"
                      onClick={() => setEditTargetPropsOpen(true)}
                    >
                      <Pencil className="mr-1 h-3 w-3" /> Düzenle
                    </Button>
                  </PermissionGate>
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

            {wo.producedRolls && wo.producedRolls.count > 0 && (
              <Card>
                <CardContent className="p-3">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Üretilen Nihai Toplar
                  </div>
                  <div className="mt-1 text-sm font-medium tabular-nums">
                    {wo.producedRolls.count} top
                    <span className="ml-1 text-muted-foreground">·</span>
                    <span className="ml-1">{formatNumber(wo.producedRolls.totalMeters, 0)} m</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    Depo / sevk hazır / sevk edilen toplar dahil.
                  </div>
                </CardContent>
              </Card>
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
                      <StatusBadge
                        status={step.status}
                        labels={stepStatusLabels}
                        tones={stepStatusTones}
                        className="text-[10px]"
                      />
                    </div>
                    {step.currentRolls && step.currentRolls.count > 0 && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-7 text-[11px]">
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
                                  {link.allocatedQty > 0 && (
                                    <Badge variant="muted" className="font-normal">
                                      Atanan: {formatNumber(link.allocatedQty, 0)} m
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

        {wo && (
          <WOTargetPropertiesEditDialog
            workOrder={wo}
            open={editTargetPropsOpen}
            onOpenChange={setEditTargetPropsOpen}
          />
        )}

        <WorkOrderDocumentsDialog
          open={documentsOpen}
          onOpenChange={setDocumentsOpen}
          onPrintTravelerCard={() => {
            setDocumentsOpen(false);
            setTravelerCardOpen(true);
          }}
        />

        <TravelerCardPrintDialog
          workOrder={wo ?? null}
          open={travelerCardOpen}
          onOpenChange={setTravelerCardOpen}
        />
      </SheetContent>
    </Sheet>
  );
}
