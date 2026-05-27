import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, Factory, Lock, Package } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { FormField } from "@/components/forms/FormField";
import { EnumSelect } from "@/components/forms/EnumSelect";
import { workOrderTypeLabels, WorkOrderType } from "@/types/enums";
import { routeService } from "@/pages/Routes/service";
import type { RouteStep } from "@/pages/Routes/types";
import { LinkedOrderLinesField } from "./LinkedOrderLinesField";
import { RouteSelectField } from "./RouteSelectField";
import { TargetColorSelect, TargetPropertiesField } from "./TargetItemFields";
import { TargetItemPicker } from "./TargetItemPicker";
import { FasonPlanningDialog, type FasonStepPlan } from "./FasonPlanningDialog";
import {
  RouteDesignerDialog,
  type CustomRouteStep,
  type DesignerStep,
  type RouteDesignerResult,
} from "./RouteDesignerDialog";
import { useLinkedLinesAutoFill } from "./useLinkedLinesAutoFill";
import {
  workOrderFormDefaults,
  workOrderFormSchema,
  type WorkOrderFormValues,
} from "./schema";
import {
  formValuesFromWorkOrder,
  pickedLinesFromWorkOrder,
  routeStateFromWorkOrder,
} from "./workOrderPrefill";
import type { WorkOrder } from "./types";

const formTypeLabels: Record<string, string> = {
  ORDER_PRODUCTION: workOrderTypeLabels.ORDER_PRODUCTION,
  STOCK_PRODUCTION: workOrderTypeLabels.STOCK_PRODUCTION,
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrder?: WorkOrder | null;
  onSubmit: (
    values: WorkOrderFormValues,
    meta: { fasonPlans: FasonStepPlan[]; customSteps: CustomRouteStep[] },
  ) => Promise<void>;
  isSubmitting?: boolean;
}

export function WorkOrderFormDialog({
  open,
  onOpenChange,
  workOrder,
  onSubmit,
  isSubmitting,
}: Props) {
  const isEdit = Boolean(workOrder);
  const isInProgress = workOrder?.status === "IN_PROGRESS";

  const form = useForm<WorkOrderFormValues>({
    resolver: zodResolver(workOrderFormSchema) as Resolver<WorkOrderFormValues>,
    defaultValues: workOrderFormDefaults,
  });

  const {
    pickedLines,
    setPickedLines,
    derived,
    handleLinesChange,
    handlePickerConfirm,
  } = useLinkedLinesAutoFill(form);
  const [fasonOpen, setFasonOpen] = useState(false);
  const [fasonPlans, setFasonPlans] = useState<FasonStepPlan[]>([]);
  const [designerOpen, setDesignerOpen] = useState(false);
  const [customSteps, setCustomSteps] = useState<CustomRouteStep[]>([]);
  const [designerSnapshot, setDesignerSnapshot] = useState<DesignerStep[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(true);
  const prevRouteIdRef = useRef<string>("");

  useEffect(() => {
    if (!open) return;
    if (workOrder) {
      const values = formValuesFromWorkOrder(workOrder);
      const route = routeStateFromWorkOrder(workOrder);
      form.reset(values);
      setPickedLines(pickedLinesFromWorkOrder(workOrder));
      setFasonPlans(route.fasonPlans);
      setCustomSteps(route.customSteps);
      setDesignerSnapshot(route.designerSnapshot);
      prevRouteIdRef.current = values.routeTemplateId ?? "";
      setAdvancedOpen(
        Boolean(values.foldType || values.plannedStartDate || values.plannedEndDate),
      );
    } else {
      form.reset(workOrderFormDefaults);
      setPickedLines([]);
      setFasonPlans([]);
      setCustomSteps([]);
      setDesignerSnapshot([]);
      prevRouteIdRef.current = "";
      setAdvancedOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workOrder?.id]);

  const watchedRouteId = form.watch("routeTemplateId");
  const routeQuery = useQuery({
    queryKey: ["route", watchedRouteId],
    queryFn: () => routeService.getById(watchedRouteId),
    enabled: Boolean(watchedRouteId),
    staleTime: 60_000,
  });
  const externalSteps: RouteStep[] = useMemo(
    () =>
      (routeQuery.data?.data?.steps ?? []).filter(
        (s) => s.station?.type === "EXTERNAL",
      ),
    [routeQuery.data?.data?.steps],
  );

  useEffect(() => {
    if (watchedRouteId === prevRouteIdRef.current) return;
    prevRouteIdRef.current = watchedRouteId ?? "";
    setFasonPlans([]);
  }, [watchedRouteId]);

  const handleDesignerConfirm = (
    result: RouteDesignerResult,
    snapshot: DesignerStep[],
  ) => {
    setDesignerSnapshot(snapshot);
    if (result.mode === "template") {
      form.setValue("routeTemplateId", result.routeTemplateId);
      setFasonPlans(result.fasonPlans);
      setCustomSteps([]);
    } else {
      form.setValue("routeTemplateId", "");
      setCustomSteps(result.customSteps);
      setFasonPlans([]);
    }
  };

  const clearCustomRoute = () => {
    setCustomSteps([]);
    setDesignerSnapshot([]);
  };

  const watchedType = form.watch("type");
  const isOrderProduction = watchedType === WorkOrderType.ORDER_PRODUCTION;

  useEffect(() => {
    if (!isOrderProduction) {
      form.setValue("orderLineIds", []);
      setPickedLines([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOrderProduction]);

  const widthLocked = derived?.width != null;
  const quantityLocked = derived !== null;
  const mixedWidths = derived !== null && derived.width == null;

  // Backend findById response'unda gelir; material commitment durumuna göre
  // hangi alanların değiştirilemediğini söyler.
  const locks = workOrder?.locks;
  const widthFullyLocked = widthLocked || Boolean(locks?.width);
  const widthTooltip = locks?.width
    ? locks.reasons.width
    : "Sipariş kaleminden alındı";
  // targetQuantity sertçe kilitli değil — sadece sipariş bağlıysa derived
  // değerden gelir. Material committed iken kullanıcı bilinçli olarak
  // değiştirebilir (fazla → Tambur stoğu, eksik → yeni sevk).
  const quantityFullyLocked = quantityLocked;
  const quantityTooltip = "Sipariş kalemleri toplamı";

  // "Sevk edilen > yeni hedef" uyarısı için canlı izleme.
  const watchedQuantity = form.watch("targetQuantity");
  const dispatchedQty = workOrder?.dispatchedTotalQty ?? 0;
  const quantityShortfall =
    locks?.materialCommitted &&
    dispatchedQty > 0 &&
    watchedQuantity != null &&
    Number(watchedQuantity) > 0 &&
    Number(watchedQuantity) < dispatchedQty
      ? dispatchedQty - Number(watchedQuantity)
      : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-h-[85vh] max-w-6xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>{isEdit ? "İş Emrini Düzenle" : "Yeni İş Emri"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Planlandı ve Devam Ediyor durumundaki iş emirleri düzenlenebilir. Tamamlandı/İptal için kapalıdır."
              : "Üretim partisi tanımı. Rota şablonu seç, hedefleri belirle."}
          </DialogDescription>
        </DialogHeader>

        {locks?.materialCommitted && (
          <div className="mx-6 mt-3 flex shrink-0 items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-medium">
                {locks.reasons.materialCommitted ?? "Fiziksel taahhüt var"}
              </div>
              <div>
                Kumaş / en / hedef metraj sabit. Renk, üretim özellikleri ve kat
                tipi yalnızca ilgili istasyon adımı tamamlanmadıysa değiştirilebilir.
              </div>
            </div>
          </div>
        )}

        <TooltipProvider delayDuration={150}>
          <form
            onSubmit={form.handleSubmit(async (v) => {
              if (!v.routeTemplateId && customSteps.length === 0) {
                form.setError("routeTemplateId", {
                  type: "manual",
                  message: "Rota şablonu seç veya özel rota tasarla.",
                });
                return;
              }
              await onSubmit(v, { fasonPlans, customSteps });
            })}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex min-h-0 flex-1">
              {/* Sol panel — bağımsız scroll */}
              <aside className="hidden w-[340px] shrink-0 flex-col border-r bg-muted/10 lg:flex">
                {isOrderProduction ? (
                  <LinkedOrderLinesField
                    lines={pickedLines}
                    onChange={handleLinesChange}
                    onPickerConfirm={handlePickerConfirm}
                    excludeWorkOrderId={workOrder?.id}
                    requiredItemId={
                      locks?.materialCommitted ? workOrder?.targetItemId : null
                    }
                    requiredWidth={
                      locks?.materialCommitted ? workOrder?.width : null
                    }
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center p-6 text-center text-xs text-muted-foreground">
                    <Package className="mb-2 h-8 w-8 text-muted-foreground/50" />
                    <div className="text-sm font-medium text-foreground">
                      Stoğa Üretim
                    </div>
                    <div className="mt-1">
                      Bağlı sipariş kalemi yok.<br />
                      Üretilen toplar serbest stok olarak depoya geçer.
                    </div>
                  </div>
                )}
              </aside>

              {/* Sağ panel — form içeriği */}
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
                {/* lg altında inline gösterim */}
                {isOrderProduction && (
                  <div className="rounded-md border bg-muted/10 lg:hidden">
                    <LinkedOrderLinesField
                      lines={pickedLines}
                      onChange={handleLinesChange}
                      onPickerConfirm={handlePickerConfirm}
                      excludeWorkOrderId={workOrder?.id}
                    />
                  </div>
                )}

                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <div className="sm:w-44 sm:shrink-0">
                    <FormField label="Tip" error={form.formState.errors.type} required>
                      <Controller
                        control={form.control}
                        name="type"
                        render={({ field }) => (
                          <EnumSelect<string>
                            value={field.value}
                            onChange={(v) => field.onChange(v)}
                            labels={formTypeLabels}
                          />
                        )}
                      />
                    </FormField>
                  </div>
                  <div className="min-w-0 flex-1">
                    <RouteSelectField
                      control={form.control}
                      error={form.formState.errors.routeTemplateId}
                      customStepCount={customSteps.length}
                      onOpenDesigner={() => setDesignerOpen(true)}
                      onClearCustom={clearCustomRoute}
                    />
                  </div>
                </div>

                {customSteps.length === 0 && externalSteps.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setFasonOpen(true)}
                    className="flex w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm hover:bg-muted/50"
                  >
                    <Factory className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">
                      Fason Adım Planlaması ({externalSteps.length})
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {fasonPlans.length === 0
                        ? "Plan yapılmadı"
                        : `${
                            fasonPlans.filter((p) => p.plannedSubcontractorId).length
                          } / ${externalSteps.length} firma seçildi`}
                    </span>
                  </button>
                )}

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField label="Hedef Ürün (opsiyonel)">
                    <TargetItemPicker
                      control={form.control}
                      onItemChange={() => {
                        form.setValue("targetColorId", null);
                        form.setValue("targetPropertyIds", []);
                      }}
                      disabled={Boolean(locks?.targetItem)}
                      lockedTooltip={locks?.reasons.targetItem}
                    />
                  </FormField>
                  <FormField label="Hedef Renk (opsiyonel)">
                    <TargetColorSelect
                      control={form.control}
                      disabled={Boolean(locks?.targetColor)}
                      lockedTooltip={locks?.reasons.targetColor}
                    />
                  </FormField>
                </div>

                <TargetPropertiesField
                  control={form.control}
                  lockedIds={locks?.lockedPropertyIds}
                  applicableIds={locks?.applicablePropertyIds}
                />

                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    label="En (cm)"
                    htmlFor="width"
                    error={form.formState.errors.width}
                    hint={mixedWidths ? "Kalemlerin enleri farklı, manuel gir" : undefined}
                  >
                    <LockedInput
                      id="width"
                      type="number"
                      step="0.1"
                      min={0}
                      placeholder="150"
                      locked={widthFullyLocked}
                      lockedTooltip={widthTooltip}
                      {...form.register("width")}
                    />
                  </FormField>
                  <FormField
                    label="Hedef Metraj"
                    htmlFor="targetQuantity"
                    error={form.formState.errors.targetQuantity}
                    hint={
                      locks?.materialCommitted && dispatchedQty > 0
                        ? `Sevk edilen: ${dispatchedQty.toLocaleString("tr-TR")} m`
                        : undefined
                    }
                  >
                    <LockedInput
                      id="targetQuantity"
                      type="number"
                      step="0.1"
                      min={0}
                      placeholder="1000"
                      locked={quantityFullyLocked}
                      lockedTooltip={quantityTooltip}
                      {...form.register("targetQuantity")}
                    />
                    {quantityShortfall > 0 && (
                      <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                        Yeni hedef sevk edilenden{" "}
                        {quantityShortfall.toLocaleString("tr-TR")} m düşük.
                      </p>
                    )}
                  </FormField>
                </div>

                {/* Gelişmiş accordion */}
                <div className="rounded-md border">
                  <button
                    type="button"
                    onClick={() => setAdvancedOpen((v) => !v)}
                    className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/30"
                    aria-expanded={advancedOpen}
                  >
                    <span className="uppercase tracking-wide">
                      Gelişmiş — Tambur Bilgisi &amp; Planlama
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                  {advancedOpen && (
                    <div className="space-y-3 border-t bg-muted/10 p-3">
                      <FormField
                        label="Kat Tipi"
                        error={form.formState.errors.foldType}
                        hint={
                          locks?.foldType
                            ? locks.reasons.foldType
                            : "Tambur operatörüne bilgi; operatör gerekirse değiştirebilir."
                        }
                      >
                        <Controller
                          control={form.control}
                          name="foldType"
                          render={({ field }) => (
                            <div className="grid grid-cols-2 gap-2">
                              {(["2-KAT", "4-KAT"] as const).map((opt) => {
                                const active = field.value === opt;
                                return (
                                  <Button
                                    key={opt}
                                    type="button"
                                    variant={active ? "default" : "outline"}
                                    disabled={Boolean(locks?.foldType)}
                                    title={
                                      locks?.foldType
                                        ? locks.reasons.foldType
                                        : undefined
                                    }
                                    onClick={() => field.onChange(active ? "" : opt)}
                                  >
                                    {opt}
                                  </Button>
                                );
                              })}
                            </div>
                          )}
                        />
                      </FormField>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <FormField label="Planlı Başlangıç" htmlFor="plannedStartDate">
                          <Input
                            id="plannedStartDate"
                            type="date"
                            placeholder="Boş bırakılırsa bugün"
                            {...form.register("plannedStartDate")}
                          />
                        </FormField>
                        <FormField label="Planlı Bitiş" htmlFor="plannedEndDate">
                          <Input
                            id="plannedEndDate"
                            type="date"
                            placeholder="Boş bırakılırsa varsayılan N gün"
                            {...form.register("plannedEndDate")}
                          />
                        </FormField>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <DialogFooter className="shrink-0 border-t bg-background px-6 py-3">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                İptal
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? isEdit
                    ? "Güncelleniyor..."
                    : "Oluşturuluyor..."
                  : isEdit
                    ? "Güncelle"
                    : "İş Emri Oluştur"}
              </Button>
            </DialogFooter>
          </form>
        </TooltipProvider>

        <FasonPlanningDialog
          open={fasonOpen}
          onOpenChange={setFasonOpen}
          externalSteps={externalSteps}
          initialPlans={fasonPlans}
          onConfirm={setFasonPlans}
        />

        <RouteDesignerDialog
          open={designerOpen}
          onOpenChange={setDesignerOpen}
          customerId={pickedLines[0]?.customerId ?? null}
          initialSteps={designerSnapshot}
          onConfirm={handleDesignerConfirm}
        />
      </DialogContent>
    </Dialog>
  );
}

interface LockedInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  locked?: boolean;
  lockedTooltip?: string;
}

const LockedInput = ({
  locked,
  lockedTooltip,
  className,
  ...rest
}: LockedInputProps) => (
  <div className="relative">
    <Input
      {...rest}
      disabled={locked || rest.disabled}
      className={`${locked ? "pr-9" : ""} ${className ?? ""}`.trim()}
    />
    {locked && (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="pointer-events-auto absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
            <Lock className="h-3.5 w-3.5" />
          </span>
        </TooltipTrigger>
        {lockedTooltip && (
          <TooltipContent side="top">{lockedTooltip}</TooltipContent>
        )}
      </Tooltip>
    )}
  </div>
);
