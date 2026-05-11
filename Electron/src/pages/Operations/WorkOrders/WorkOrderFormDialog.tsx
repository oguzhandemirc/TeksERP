import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { Factory } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/forms/FormField";
import { EnumSelect } from "@/components/forms/EnumSelect";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { workOrderTypeLabels, WorkOrderType } from "@/types/enums";
import { routeService } from "@/pages/Routes/service";
import type { RouteStep } from "@/pages/Routes/types";
import { itemService } from "@/pages/Items/service";
import type { Item } from "@/pages/Items/types";
import { LinkedOrderLinesField } from "./LinkedOrderLinesField";
import { RouteSelectField } from "./RouteSelectField";
import { TargetItemSummary, TargetPropertiesField } from "./TargetItemFields";
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

// SERVICE_PRODUCTION ayrı akış (mal kabul) — bu form'da yok.
const formTypeLabels: Record<string, string> = {
  ORDER_PRODUCTION: workOrderTypeLabels.ORDER_PRODUCTION,
  STOCK_PRODUCTION: workOrderTypeLabels.STOCK_PRODUCTION,
  SAMPLE_PRODUCTION: workOrderTypeLabels.SAMPLE_PRODUCTION,
  REPAIR_REWORK: workOrderTypeLabels.REPAIR_REWORK,
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Düzenleme modu: prefill için var olan WO (detay endpoint'inden). */
  workOrder?: WorkOrder | null;
  onSubmit: (
    values: WorkOrderFormValues,
    meta: { fasonPlans: FasonStepPlan[]; customSteps: CustomRouteStep[] },
  ) => Promise<void>;
  isSubmitting?: boolean;
}

export function WorkOrderFormDialog({ open, onOpenChange, workOrder, onSubmit, isSubmitting }: Props) {
  const isEdit = Boolean(workOrder);
  const form = useForm<WorkOrderFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(workOrderFormSchema as any) as unknown as Resolver<WorkOrderFormValues>,
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
  // Designer'a tekrar açılınca pre-fill için son DesignerStep snapshot'ı.
  const [designerSnapshot, setDesignerSnapshot] = useState<DesignerStep[]>([]);
  // Prefill ile gelen routeTemplateId'yi takip et: kullanıcı rotayı değiştirirse
  // fasonPlans'i sıfırla, ama prefill'in kendisi sıfırlamayı tetiklemesin.
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
    } else {
      form.reset(workOrderFormDefaults);
      setPickedLines([]);
      setFasonPlans([]);
      setCustomSteps([]);
      setDesignerSnapshot([]);
      prevRouteIdRef.current = "";
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

  // Rota değişince fason planlamasını sıfırla (yeni rotanın adımları farklı).
  // Prefill sırasındaki ilk setlemede tetiklenmesin diye ref ile karşılaştır.
  useEffect(() => {
    if (watchedRouteId === prevRouteIdRef.current) return;
    prevRouteIdRef.current = watchedRouteId ?? "";
    setFasonPlans([]);
  }, [watchedRouteId]);

  const handleDesignerConfirm = (result: RouteDesignerResult, snapshot: DesignerStep[]) => {
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

  // type değişince ORDER_PRODUCTION değilse bağlı kalemleri temizle.
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "İş Emrini Düzenle" : "Yeni İş Emri"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Sadece üretime başlanmamış (PLANNED) iş emirleri düzenlenebilir."
              : "Üretim partisi tanımı. Rota şablonu seç, hedefleri belirle."}
          </DialogDescription>
        </DialogHeader>

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
          className="space-y-3"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            <RouteSelectField
              control={form.control}
              error={form.formState.errors.routeTemplateId}
              customStepCount={customSteps.length}
              onOpenDesigner={() => setDesignerOpen(true)}
              onClearCustom={clearCustomRoute}
            />
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

          {isOrderProduction && (
            <LinkedOrderLinesField
              lines={pickedLines}
              onChange={handleLinesChange}
              onPickerConfirm={handlePickerConfirm}
            />
          )}

          <FormField label="Hedef Ürün (opsiyonel)">
            <Controller
              control={form.control}
              name="targetItemId"
              render={({ field }) => (
                <ReferenceSelect<Item>
                  value={field.value}
                  onChange={(v) => {
                    field.onChange(v);
                    // Item değişince eski targetPropertyIds tutulmaz —
                    // her ürün kendi allowed seti ile gelir
                    form.setValue("targetPropertyIds", []);
                  }}
                  service={itemService}
                  queryKey="items-final"
                  getLabel={(i) => `${i.code} — ${i.name}`}
                  placeholder="Final ürün seç..."
                  nullable
                  noneLabel="— Atanmadı"
                  extraFilters={{ isDerived: "true" }}
                />
              )}
            />
          </FormField>

          <TargetItemSummary control={form.control} />

          <TargetPropertiesField control={form.control} />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormField
              label={widthLocked ? "En (cm) · otomatik" : "En (cm)"}
              htmlFor="width"
              error={form.formState.errors.width}
              hint={
                mixedWidths
                  ? "Kalemlerin enleri farklı, manuel gir"
                  : widthLocked
                    ? "Sipariş kaleminden alındı"
                    : undefined
              }
            >
              <Input
                id="width"
                type="number"
                step="0.1"
                min={0}
                placeholder="150"
                disabled={widthLocked}
                {...form.register("width")}
              />
            </FormField>
            <FormField
              label={quantityLocked ? "Hedef Metraj · otomatik" : "Hedef Metraj"}
              htmlFor="targetQuantity"
              error={form.formState.errors.targetQuantity}
              hint={quantityLocked ? "Sipariş kalemleri toplamı" : undefined}
            >
              <Input
                id="targetQuantity"
                type="number"
                step="0.1"
                min={0}
                placeholder="1000"
                disabled={quantityLocked}
                {...form.register("targetQuantity")}
              />
            </FormField>
            <FormField label="Reçete No" htmlFor="recipeNo" error={form.formState.errors.recipeNo}>
              <Input id="recipeNo" placeholder="R-123" {...form.register("recipeNo")} />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Planlı Başlangıç" htmlFor="plannedStartDate">
              <Input id="plannedStartDate" type="date" {...form.register("plannedStartDate")} />
            </FormField>
            <FormField label="Planlı Bitiş" htmlFor="plannedEndDate">
              <Input id="plannedEndDate" type="date" {...form.register("plannedEndDate")} />
            </FormField>
          </div>

          <DialogFooter>
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
