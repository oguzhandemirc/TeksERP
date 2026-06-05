import { useEffect, useState } from "react";
import { Controller, useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, FlaskConical, Lock } from "lucide-react";
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
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { routeService } from "@/pages/Routes/service";
import type { ProductionRoute } from "@/pages/Routes/types";
import { generateCode, CODE_PREFIXES } from "@/lib/code-generator";
import { LinkedOrderLinesField } from "./LinkedOrderLinesField";
import { CoveragePanel } from "./CoveragePanel";
import type { PickedOrderLine } from "./OrderPickerDialog";
import { productRecipeService } from "@/pages/ProductRecipes/service";
import type { ProductRecipe } from "@/pages/ProductRecipes/types";
import { useTargetQuantityEnabled, usePartyCodeAuto } from "@/hooks/usePricingEnabled";
import { RouteEditor } from "./RouteEditor";
import { TargetItemPicker } from "./TargetItemPicker";
import { useDesignerSteps } from "./useDesignerSteps";
import type { FasonStepPlan } from "./FasonPlanningDialog";
import type { CustomRouteStep } from "./RouteDesignerDialog";
import { useLinkedLinesAutoFill } from "./useLinkedLinesAutoFill";
import {
  workOrderFormDefaults,
  workOrderFormSchema,
  type WorkOrderFormValues,
} from "./schema";
import {
  formValuesFromWorkOrder,
  pickedLinesFromWorkOrder,
  designerStepsFromWorkOrder,
  stepsToCustom,
} from "./workOrderPrefill";
import type { WorkOrder } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrder?: WorkOrder | null;
  /** Create modunda formu önceden seçili sipariş kalemleriyle açar ("siparişten WO"). */
  initialPickedLines?: PickedOrderLine[];
  /** Create modunda sipariş bağı olmadan hedef spec + miktar seed'i (Denge "stoğa üret"). */
  initialTarget?: {
    itemId: string;
    colorId: string | null;
    width: number | null;
    targetQuantity: number | null;
  };
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
  initialPickedLines,
  initialTarget,
  onSubmit,
  isSubmitting,
}: Props) {
  const isEdit = Boolean(workOrder);
  const targetQuantityEnabled = useTargetQuantityEnabled();
  const partyCodeAuto = usePartyCodeAuto();
  // Otomatik mod + yeni kayıt: parti kodunu elle gir (override) seçeneği.
  const [overrideParty, setOverrideParty] = useState(false);
  // Parti kodu alanı düzenlenebilir + zorunlu mu? Otomatik modda yeni kayıtta
  // override kapalıysa alan kilitli ve boş kalır → backend otomatik üretir.
  const partyCodeEditable = isEdit || !partyCodeAuto || overrideParty;

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
  const {
    steps: routeSteps,
    reset: resetRouteSteps,
    addStep,
    removeStep,
    moveStep,
    reorder: reorderSteps,
    updateStep,
    seedFromRoute,
    handleStationPick,
  } = useDesignerSteps([]);
  const [advancedOpen, setAdvancedOpen] = useState(true);
  const [widthFocused, setWidthFocused] = useState(false);
  const [recipeId, setRecipeId] = useState<string | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [saveRecipeOpen, setSaveRecipeOpen] = useState(false);
  const [recipeName, setRecipeName] = useState("");
  const qc = useQueryClient();

  useEffect(() => {
    if (!open) return;
    setRecipeId(null);
    setRouteError(null);
    setSaveRecipeOpen(false);
    setRecipeName("");
    setOverrideParty(false);
    if (workOrder) {
      const values = formValuesFromWorkOrder(workOrder);
      form.reset(values);
      setPickedLines(pickedLinesFromWorkOrder(workOrder));
      resetRouteSteps(designerStepsFromWorkOrder(workOrder));
      setAdvancedOpen(
        Boolean(
          values.foldType ||
            values.plannedStartDate ||
            values.plannedEndDate ||
            values.dyehouseNote,
        ),
      );
    } else {
      form.reset(workOrderFormDefaults);
      if (initialPickedLines && initialPickedLines.length > 0) {
        // "Bu siparişten iş emri oluştur" — kalemleri + hedefleri seed et.
        handleLinesChange(initialPickedLines);
        handlePickerConfirm(initialPickedLines);
      } else {
        setPickedLines([]);
        if (initialTarget) {
          // Denge "stoğa üret": sipariş bağı yok, sadece hedef spec + miktar.
          // (Lines boş → buildPayload type'ı STOCK_PRODUCTION yapar.)
          form.setValue("targetItemId", initialTarget.itemId);
          form.setValue("targetColorId", initialTarget.colorId);
          form.setValue("width", initialTarget.width);
          if (initialTarget.targetQuantity != null) {
            form.setValue("targetQuantity", initialTarget.targetQuantity);
          }
        }
      }
      resetRouteSteps([]);
      setAdvancedOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workOrder?.id]);

  // Rota şablonu olarak kaydet (inline — ayrı dialog yok).
  const saveTemplateMut = useMutation({
    mutationFn: (params: { name: string; forCustomer: boolean }) => {
      const payload = {
        name: params.name,
        code: generateCode(CODE_PREFIXES.ROUTE),
        customerId: params.forCustomer ? pickedLines[0]?.customerId ?? null : null,
        isActive: true,
        isFavorite: false,
        steps: routeSteps.map((s, i) => ({
          stationId: s.stationId,
          sequence: i + 1,
          defaultNotes: s.notes.trim() || null,
        })),
      };
      return routeService.create(payload as unknown as Partial<ProductionRoute>);
    },
    onSuccess: (_res, vars) => {
      toast.success(`Şablon kaydedildi: ${vars.name}`);
      void qc.invalidateQueries({ queryKey: ["routes"] });
    },
  });

  // Bu iş emrini reçete olarak kaydet: önce akıştan rota şablonu, sonra reçete.
  const saveRecipeMut = useMutation({
    mutationFn: async (name: string) => {
      const v = form.getValues();
      const routeRes = await routeService.create({
        name: `${name} rotası`,
        code: generateCode(CODE_PREFIXES.ROUTE),
        isActive: true,
        isFavorite: false,
        steps: routeSteps.map((s, i) => ({
          stationId: s.stationId,
          sequence: i + 1,
          defaultNotes: s.notes.trim() || null,
        })),
      } as unknown as Partial<ProductionRoute>);
      const routeId = (routeRes.data as { id: string }).id;
      return productRecipeService.create({
        code: generateCode(CODE_PREFIXES.RECIPE),
        name,
        itemId: v.targetItemId,
        colorId: v.targetColorId ?? null,
        width: typeof v.width === "number" ? v.width : null,
        foldType: v.foldType?.trim() ? v.foldType.trim() : null,
        routeId,
        properties: (v.targetPropertyIds ?? []).map((id) => ({ propertyId: id })),
      } as unknown as Partial<ProductRecipe>);
    },
    onSuccess: (_res, name) => {
      toast.success(`Reçete kaydedildi: ${name}`);
      void qc.invalidateQueries({ queryKey: ["routes"] });
      void qc.invalidateQueries({ queryKey: ["product-recipes"] });
      setSaveRecipeOpen(false);
      setRecipeName("");
    },
  });

  // Şablondan tohumla (boş seçilirse akışı temizle).
  const handleSeedRoute = (routeId: string | null) => {
    if (routeId) void seedFromRoute(routeId);
    else resetRouteSteps([]);
  };

  // Akış değişince rota validasyon hatasını temizle.
  useEffect(() => {
    setRouteError(null);
  }, [routeSteps]);

  // Reçeteden doldur — seçilen reçetenin hedef alanları + rotasını forma yazar.
  const applyRecipe = async (id: string | null) => {
    setRecipeId(id);
    if (!id) return;
    const res = await productRecipeService.getById(id);
    const r = res.data;
    if (!r) return;
    // Sipariş bağlıysa ürün/renk/en/özellik siparişten gelir (kilitli) — reçeteden
    // yalnız ROTA + kat tipi al. Stoğa üretimde hepsini doldur.
    const orderBound = pickedLines.length > 0;
    if (!orderBound) {
      form.setValue("targetItemId", r.itemId);
      form.setValue("targetColorId", r.colorId);
      form.setValue(
        "targetPropertyIds",
        (r.properties ?? []).map((p) => p.propertyId),
      );
      if (r.width != null) form.setValue("width", r.width);
    }
    if (r.routeId) void seedFromRoute(r.routeId);
    if (r.foldType) form.setValue("foldType", r.foldType);
  };

  // Tip artık seçilmez — sipariş kalemi bağlıysa siparişe özel, değilse stoğa
  // üretim. WorkOrdersPage.buildPayload submit'te type'ı bu kurala göre türetir.
  const isOrderProduction = pickedLines.length > 0;

  const orderWidth = derived?.width ?? null;
  const mixedWidths = derived !== null && derived.width == null;

  // Backend findById response'unda gelir; material commitment durumuna göre
  // hangi alanların değiştirilemediğini söyler.
  const locks = workOrder?.locks;
  // Sipariş eni artık SADECE öneri — KİLİTLİ DEĞİL. Kullanıcı bilinçli olarak
  // farklı en girebilir: boyahaneden (fason) dönen kumaşa WO eni damgalanır
  // (subcontractor.service receive → bornWidth, tambur.service finalize), ham
  // top en'siz girdiği için fason dönüşünün eni buradan belirlenir. Yalnız
  // backend hard lock'u (malzeme bağlandı / sevk yapıldı) alanı kilitler.
  const widthFullyLocked = Boolean(locks?.width);
  const widthTooltip = locks?.reasons.width ?? "";
  // Sipariş eninden farklı en girildi mi? (boyahane override uyarısı için)
  const watchedWidth = form.watch("width");
  const widthOverridden =
    orderWidth != null &&
    watchedWidth != null &&
    String(watchedWidth) !== "" &&
    Number(watchedWidth) !== Number(orderWidth);
  // targetQuantity ASLA kilitli değil — sipariş bağlıyken bile yalnız öneri
  // (bağlı kalemlerin açık toplamı) gelir; kullanıcı değiştirebilir (fazla →
  // Tambur stoğu, eksik → kalan için yeni iş emri).
  const quantityFullyLocked = false;
  const quantityTooltip = "Bağlı kalemlerden önerilir; değiştirebilirsin";

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
              : "Üretim partisi tanımı. Akışı kur, her istasyonun renk/özelliğini seç."}
          </DialogDescription>
        </DialogHeader>

        {locks?.materialCommitted && (
          <div className="mx-6 mt-3 flex shrink-0 items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-foreground">
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
              if (routeSteps.length === 0 || routeSteps.some((s) => !s.stationId)) {
                setRouteError("En az bir adım ekle ve her adıma istasyon seç.");
                return;
              }
              // Manuel mod / override / düzenlemede parti kodu zorunlu. Otomatik modda
              // (override kapalı) boş bırakılır → backend otomatik üretir.
              if (partyCodeEditable && !(v.batchNumber ?? "").trim()) {
                form.setError("batchNumber", {
                  type: "manual",
                  message: "Parti kodu zorunlu",
                });
                return;
              }
              // Sipariş bağlı değil = stoğa üretim; backend hedef ürün zorunlu kılar.
              if (pickedLines.length === 0 && !v.targetItemId) {
                form.setError("targetItemId", {
                  type: "manual",
                  message: "Sipariş bağlı değil — stoğa üretim için hedef ürün seçilmeli.",
                });
                return;
              }
              await onSubmit(v, {
                fasonPlans: [],
                customSteps: stepsToCustom(routeSteps),
              });
            })}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex min-h-0 flex-1">
              {/* Sol panel — yalnız sipariş bağlıyken; stoğa üretimde yer kaplamaz */}
              {isOrderProduction && (
                <aside className="hidden w-[340px] shrink-0 flex-col border-r bg-muted/10 lg:flex">
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
                </aside>
              )}

              {/* Sağ panel — form içeriği */}
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
                {/* Parti Kodu — takip için. Otomatik modda kilitli (backend üretir),
                    'elle gir' ile override; manuel modda + düzenlemede zorunlu. */}
                <FormField
                  label="Parti Kodu"
                  htmlFor="batchNumber"
                  required={partyCodeEditable}
                  error={form.formState.errors.batchNumber}
                  hint={
                    !partyCodeEditable
                      ? "Otomatik üretilecek (P-YYMMDD-NNN). Kendi kodunu girmek için 'elle gir'i işaretle."
                      : "Takip kodu — benzersiz olmalı."
                  }
                >
                  <Input
                    id="batchNumber"
                    placeholder={
                      partyCodeEditable ? "örn: P-260605-001" : "Kaydedince otomatik atanır"
                    }
                    disabled={!partyCodeEditable}
                    {...form.register("batchNumber")}
                  />
                  {partyCodeAuto && !isEdit && (
                    <label className="mt-1.5 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={overrideParty}
                        onChange={(e) => {
                          setOverrideParty(e.target.checked);
                          if (!e.target.checked) {
                            form.setValue("batchNumber", "");
                            form.clearErrors("batchNumber");
                          }
                        }}
                        className="h-4 w-4 cursor-pointer"
                      />
                      Parti kodunu elle gir
                    </label>
                  )}
                </FormField>
                {/* Reçeteden doldur — yeni + stoğa üretimde hızlı başlangıç */}
                {!isEdit && (
                  <FormField
                    label="Reçeteden doldur (opsiyonel)"
                    hint={
                      isOrderProduction
                        ? "Reçeteden yalnız ROTA + kat tipi gelir (ürün/renk/en sipariş kaleminden)."
                        : "Hazır reçete seç — kumaş, renk, üretim özellikleri, en ve rota otomatik dolar."
                    }
                  >
                    <ReferenceSelect<ProductRecipe>
                      value={recipeId}
                      onChange={(id) => void applyRecipe(id)}
                      service={productRecipeService}
                      queryKey="product-recipes"
                      getLabel={(r) => (r.code ? `${r.name} — ${r.code}` : r.name)}
                      placeholder="Reçete seç..."
                      nullable
                      noneLabel="— Reçete kullanma"
                    />
                  </FormField>
                )}
                {/* Sipariş bağlı değil — slim "Sipariş Bağla" çubuğu (stoğa üretim) */}
                {!isOrderProduction && (
                  <LinkedOrderLinesField
                    compact
                    lines={pickedLines}
                    onChange={handleLinesChange}
                    onPickerConfirm={handlePickerConfirm}
                    excludeWorkOrderId={workOrder?.id}
                  />
                )}
                {/* lg altında inline gösterim — kalem varken */}
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

                {/* Üretim kapsama — "ne kadar üretmeliyim" (sevk/WO/stok kovaları) */}
                {isOrderProduction && (
                  <CoveragePanel
                    lineIds={pickedLines.map((l) => l.lineId)}
                    excludeWorkOrderId={workOrder?.id}
                  />
                )}

                <RouteEditor
                  steps={routeSteps}
                  onAdd={addStep}
                  onRemove={removeStep}
                  onMove={moveStep}
                  onReorder={reorderSteps}
                  onPickStation={(clientId, id) => void handleStationPick(clientId, id)}
                  onSetNotes={(clientId, notes) => updateStep(clientId, { notes })}
                  onSetFirm={(clientId, patch) => updateStep(clientId, patch)}
                  onSeed={handleSeedRoute}
                  onSaveTemplate={(name, forCustomer) =>
                    saveTemplateMut.mutate({ name, forCustomer })
                  }
                  savePending={saveTemplateMut.isPending}
                  customerId={pickedLines[0]?.customerId ?? null}
                  target={{
                    colorId: form.watch("targetColorId") ?? null,
                    propertyIds: form.watch("targetPropertyIds") ?? [],
                    onColor: (id) => form.setValue("targetColorId", id),
                    onProperties: (ids) => form.setValue("targetPropertyIds", ids),
                    colorLocked: Boolean(locks?.targetColor),
                    lockedPropertyIds: locks?.lockedPropertyIds,
                  }}
                  error={routeError ?? undefined}
                />

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField
                    label="Hedef Ürün"
                    required={!isOrderProduction}
                    error={form.formState.errors.targetItemId}
                    hint={
                      isOrderProduction
                        ? "Sipariş kalemlerinden otomatik"
                        : "Stoğa üretimde zorunlu"
                    }
                  >
                    <TargetItemPicker
                      control={form.control}
                      onItemChange={() => {
                        form.setValue("targetColorId", null);
                        form.setValue("targetPropertyIds", []);
                      }}
                      disabled={Boolean(locks?.targetItem) || isOrderProduction}
                      lockedTooltip={
                        locks?.reasons.targetItem ??
                        "Sipariş kaleminden alındı — değiştirilemez"
                      }
                    />
                  </FormField>
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
                      onFocus={() => setWidthFocused(true)}
                    />
                    {/* Boyahane (fason) uyarısı: sipariş eni öneri olarak geldi,
                        override edilebilir. Bu en boyahaneden dönen kumaşa
                        damgalanır (ham top en'siz girer). Tıklayınca açılır;
                        farklı en girilirse kalıcı amber uyarıya döner. */}
                    {orderWidth != null &&
                      !widthFullyLocked &&
                      (widthFocused || widthOverridden) && (
                        <p
                          className={`mt-1 flex items-start gap-1.5 text-xs ${
                            widthOverridden ? "text-warning" : "text-muted-foreground"
                          }`}
                        >
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>
                            Bu en, boyahaneden (fason) dönen kumaşa damgalanır.{" "}
                            {widthOverridden ? (
                              <>
                                Sipariş eni <strong>{orderWidth} cm</strong> — sen
                                farklı en girdin, üretim ve sevk bu en ile işlenir.
                              </>
                            ) : (
                              <>
                                Sipariş eninden (<strong>{orderWidth} cm</strong>)
                                otomatik geldi; gerekirse değiştirebilirsin.
                              </>
                            )}
                          </span>
                        </p>
                      )}
                  </FormField>
                  {targetQuantityEnabled && (
                  <FormField
                    label="Hedef Metraj"
                    htmlFor="targetQuantity"
                    error={form.formState.errors.targetQuantity}
                    hint={
                      locks?.materialCommitted && dispatchedQty > 0
                        ? `Sevk edilen: ${dispatchedQty.toLocaleString("tr-TR")} m`
                        : isOrderProduction
                          ? "Bağlı kalemlerin açığından önerilir — değiştirebilirsin (fazlası stoğa)"
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
                      <p className="mt-1 text-xs text-warning">
                        Yeni hedef sevk edilenden{" "}
                        {quantityShortfall.toLocaleString("tr-TR")} m düşük.
                      </p>
                    )}
                  </FormField>
                  )}
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
                      <FormField
                        label="Boyahane Notu"
                        htmlFor="dyehouseNote"
                        error={form.formState.errors.dyehouseNote}
                        hint="Fason sevkinde boyahaneye iletilir (örn. yıkama yapma, matlaştır). Sevk fişinde 'İstenen Renk'in yanında basılır."
                      >
                        <textarea
                          id="dyehouseNote"
                          rows={2}
                          placeholder="Boyahaneye özel talimat…"
                          {...form.register("dyehouseNote")}
                          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                      </FormField>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <DialogFooter className="shrink-0 border-t bg-background px-6 py-3 sm:justify-between">
              <Popover open={saveRecipeOpen} onOpenChange={setSaveRecipeOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      !form.watch("targetItemId") ||
                      routeSteps.length === 0 ||
                      routeSteps.some((s) => !s.stationId)
                    }
                    className="gap-1"
                    title="Bu iş emrini reçete olarak kaydet"
                  >
                    <FlaskConical className="h-3.5 w-3.5" /> Reçete Kaydet
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-80 space-y-2">
                  <div className="text-xs font-medium">Bu iş emrini reçete olarak kaydet</div>
                  <p className="text-[11px] text-muted-foreground">
                    Ürün + renk + özellik + en + akış tek isimle saklanır; sonraki iş
                    emirlerinde "Reçeteden doldur" ile gelir.
                  </p>
                  <Input
                    value={recipeName}
                    onChange={(e) => setRecipeName(e.target.value)}
                    placeholder="Reçete adı (örn: Patos Gri 038)"
                    className="h-8 text-xs"
                    autoFocus
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="w-full"
                    disabled={saveRecipeMut.isPending || !recipeName.trim()}
                    onClick={() => saveRecipeMut.mutate(recipeName.trim())}
                  >
                    {saveRecipeMut.isPending ? "Kaydediliyor..." : "Kaydet"}
                  </Button>
                </PopoverContent>
              </Popover>
              <div className="flex gap-2">
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
              </div>
            </DialogFooter>
          </form>
        </TooltipProvider>
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
