import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import {
  Plus,
  Trash2,
  GripVertical,
  ShoppingCart,
  CheckSquare,
  Square,
  Factory,
  Layers,
  Lock,
  Unlock,
  Calendar,
  Clock,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { stationService } from "@/services/stationService";
import { routeService } from "@/services/routeService";
import { orderService } from "@/services/orderService";
import { customerService } from "@/services/customerService";
import type {
  Route,
  Order,
  OrderLine,
  Customer,
} from "@/types/models";
import type { OrderLineAllocation } from "@/services/workOrderService";

const woSchema = z.object({
  batchNumber:      z.string().optional(),
  type:             z.enum(["ORDER_PRODUCTION", "STOCK_PRODUCTION", "SAMPLE_PRODUCTION", "REPAIR_REWORK"]),
  width:            z.number().positive("En pozitif bir değer olmalı").optional(),
  targetQuantity:   z.number().positive("Hedef miktar pozitif olmalı").optional(),
  recipeNo:         z.string().max(100).optional(),
  plannedStartDate: z.string().optional(),
  plannedEndDate:   z.string().optional(),
  dyehouseCompanyId: z.string().optional(),
});

type WOFormValues = z.infer<typeof woSchema>;

interface StepEntry {
  stationId: string;
  notes: string;
}

interface WorkOrderFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: {
    batchNumber?:        string;
    type?:               string;
    width?:              number;
    targetQuantity?:     number;
    recipeNo?:           string;
    plannedStartDate?:   string;
    plannedEndDate?:     string;
    routeTemplateId?:    string;
    dyehouseCompanyId?:  string;
    steps?:              { stationId: string; notes?: string }[];
    orderLineAllocations?: OrderLineAllocation[];
  }) => void;
  isLoading: boolean;
}

export default function WorkOrderFormDialog({
  open,
  onOpenChange,
  onSubmit,
  isLoading,
}: WorkOrderFormDialogProps) {
  const [steps, setSteps] = useState<StepEntry[]>([]);
  // "template" -> hazır rotadan kopyala (sadece routeTemplateId gönderilir)
  // "custom"   -> manuel step listesi
  const [routeMode, setRouteMode] = useState<"template" | "custom">("custom");
  const [routeTemplateId, setRouteTemplateId] = useState<string>("");
  // allocatedQty için map (orderLineId -> qty)
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [isBatchEditable, setIsBatchEditable] = useState(false);

  // ── Açık Siparişler ──────────────────────────────────────────────────────
  const { data: openOrdersData, isLoading: ordersLoading } = useQuery({
    queryKey: ["orders", "open-for-workorder"],
    queryFn: () =>
      orderService.getAll({
        page: 1,
        pageSize: 100,
        sortBy: "orderDate",
        sortOrder: "desc",
        filters: { status: "APPROVED" },
      }),
    enabled: open,
  });

  const openOrders: Order[] = openOrdersData?.data ?? [];

  // ── İstasyonlar ──────────────────────────────────────────────────────────
  const { data: stationsData } = useQuery({
    queryKey: ["stations", "all-active"],
    queryFn: () =>
      stationService.getAll({
        page: 1,
        pageSize: 200,
        sortBy: "name",
        sortOrder: "asc",
        filters: { isActive: "true" },
      }),
    enabled: open,
  });

  // ── Rotalar ──────────────────────────────────────────────────────────────
  const { data: routesData } = useQuery({
    queryKey: ["routes", "all-active"],
    queryFn: () =>
      routeService.getAll({
        page: 1,
        pageSize: 200,
        sortBy: "name",
        sortOrder: "asc",
        filters: { isActive: "true" },
      }),
    enabled: open,
  });

  // ── Fason/Boyahane Müşterileri ───────────────────────────────────────────
  const { data: customersData } = useQuery({
    queryKey: ["customers", "subcontractors"],
    queryFn: () =>
      customerService.getAll({
        page: 1,
        pageSize: 200,
        sortBy: "name",
        sortOrder: "asc",
        filters: { isActive: "true" },
      }),
    enabled: open,
  });

  const subcontractorCustomers: Customer[] = (
    customersData?.data ?? []
  ).filter((c) => c.type === "SUBCONTRACTOR" || c.type === "DYEHOUSE");

  const routeOptions =
    routesData?.data?.map((r: Route) => ({
      value: r.id,
      label: `${r.name}${r.code ? ` (${r.code})` : ""} — ${r.steps?.length ?? 0} adım`,
      route: r,
    })) ?? [];

  const stationOptions =
    stationsData?.data?.map((s) => ({
      value: s.id,
      label: `${s.code} - ${s.name}`,
    })) ?? [];

  const dyehouseOptions = [
    { value: "", label: "(Hedef belirtilmedi)" },
    ...subcontractorCustomers.map((c) => ({
      value: c.id,
      label: `${c.code} — ${c.name}`,
    })),
  ];

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<WOFormValues>({
    resolver: zodResolver(woSchema),
    defaultValues: {
      batchNumber: "",
      type: "ORDER_PRODUCTION",
      width: undefined,
      targetQuantity: undefined,
      recipeNo: "",
      plannedStartDate: "",
      plannedEndDate: "",
      dyehouseCompanyId: "",
    },
  });

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setSteps([]);
      setAllocations({});
      setRouteMode("custom");
      setRouteTemplateId("");
      setIsBatchEditable(false);
    }
  }

  useEffect(() => {
    if (open) {
      reset({
        batchNumber: "",
        type: "ORDER_PRODUCTION",
        width: undefined,
        targetQuantity: undefined,
        recipeNo: "",
        plannedStartDate: "",
        plannedEndDate: "",
        dyehouseCompanyId: "",
      });
    }
  }, [open, reset]);

  // ── Sipariş / Kalem Seçimi ───────────────────────────────────────────────
  const selectedLineIds = Object.keys(allocations);
  const hasOrderAllocation = selectedLineIds.length > 0;

  useEffect(() => {
    if (hasOrderAllocation) {
      setValue("width", undefined);
      setValue("targetQuantity", undefined);
    }
  }, [hasOrderAllocation, setValue]);

  const getLineIds = (order: Order): string[] =>
    order.lines?.map((l) => l.id) ?? [];

  const isOrderSelected = (order: Order): boolean => {
    const ids = getLineIds(order);
    return ids.length > 0 && ids.every((id) => selectedLineIds.includes(id));
  };

  const toggleOrderLine = (line: OrderLine) => {
    setAllocations((prev) => {
      const next = { ...prev };
      if (line.id in next) delete next[line.id];
      else next[line.id] = line.quantity;
      return next;
    });
  };

  const toggleOrder = (order: Order) => {
    setAllocations((prev) => {
      const next = { ...prev };
      const ids = getLineIds(order);
      const allSelected = ids.every((id) => id in next);
      if (allSelected) {
        ids.forEach((id) => delete next[id]);
      } else {
        order.lines?.forEach((l) => {
          if (!(l.id in next)) next[l.id] = l.quantity;
        });
      }
      return next;
    });
  };

  const updateAllocation = (lineId: string, qty: number) => {
    setAllocations((prev) => ({ ...prev, [lineId]: qty }));
  };

  // ── Rota Adımı Yardımcıları ──────────────────────────────────────────────
  const handleRouteSelect = (routeId: string) => {
    setRouteTemplateId(routeId);
    const selected = routeOptions.find((r) => r.value === routeId);
    if (!selected?.route?.steps) return;
    const sorted = [...selected.route.steps].sort(
      (a, b) => a.sequence - b.sequence,
    );
    setSteps(
      sorted.map((s) => ({
        stationId: s.stationId,
        notes: s.defaultNotes ?? "",
      })),
    );
  };

  const addStep = () => setSteps((p) => [...p, { stationId: "", notes: "" }]);
  const removeStep = (i: number) =>
    setSteps((p) => p.filter((_, idx) => idx !== i));
  const updateStep = (i: number, stationId: string) =>
    setSteps((p) => p.map((s, idx) => (idx === i ? { ...s, stationId } : s)));
  const updateStepNote = (i: number, notes: string) =>
    setSteps((p) => p.map((s, idx) => (idx === i ? { ...s, notes } : s)));

  // ── Form Submit ──────────────────────────────────────────────────────────
  const handleFormSubmit = (data: WOFormValues) => {
    const cleanValue = (val: string | undefined | null) => {
      if (val === "" || val === null || val === undefined) return undefined;
      return val;
    };

    const validSteps = steps.filter((s) => s.stationId);

    const usesTemplate = routeMode === "template" && routeTemplateId;
    if (!usesTemplate && validSteps.length === 0) return;

    const orderLineAllocations: OrderLineAllocation[] = Object.entries(
      allocations,
    ).map(([lineId, qty]) => ({
      orderLineId: lineId,
      allocatedQty: qty > 0 ? qty : undefined,
    }));

    onSubmit({
      batchNumber:       cleanValue(data.batchNumber),
      type:              data.type,
      width:             data.width ?? undefined,
      targetQuantity:    data.targetQuantity ?? undefined,
      recipeNo:          cleanValue(data.recipeNo),
      plannedStartDate:  cleanValue(data.plannedStartDate),
      plannedEndDate:    cleanValue(data.plannedEndDate),
      dyehouseCompanyId: cleanValue(data.dyehouseCompanyId),
      routeTemplateId:   usesTemplate ? routeTemplateId : undefined,
      steps: usesTemplate
        ? undefined
        : validSteps.map((s) => ({
            stationId: s.stationId,
            notes:     s.notes?.trim() || undefined,
          })),
      orderLineAllocations:
        orderLineAllocations.length > 0 ? orderLineAllocations : undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Yeni İş Emri</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-5">

          {/* ── AÇIK SİPARİŞLER ─────────────────────────────────────────── */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-primary" />
              <Label>
                Onaylı Siparişler
                {selectedLineIds.length > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {selectedLineIds.length} kalem seçildi
                  </Badge>
                )}
              </Label>
            </div>

            <div className="border rounded-md divide-y max-h-64 overflow-y-auto">
              {ordersLoading && (
                <p className="text-sm text-muted-foreground text-center py-3">
                  Yükleniyor...
                </p>
              )}
              {!ordersLoading && openOrders.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-3">
                  Açık sipariş bulunamadı
                </p>
              )}
              {openOrders.map((order) => {
                const selected = isOrderSelected(order);
                const totalQty =
                  order.lines?.reduce((s, l) => s + l.quantity, 0) ?? 0;

                return (
                  <div key={order.id} className="p-2">
                    <button
                      type="button"
                      onClick={() => toggleOrder(order)}
                      className={`w-full flex items-start gap-3 px-2 py-1.5 text-left rounded transition-colors hover:bg-muted/50 ${
                        selected ? "bg-primary/5" : ""
                      }`}
                    >
                      {selected ? (
                        <CheckSquare className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      ) : (
                        <Square className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
                          <span className="text-sm font-bold text-primary">
                            {order.orderNumber}
                          </span>
                          <span className="text-xs font-semibold text-foreground/90">
                            {order.customer?.name ?? "—"}
                          </span>
                          <div className="flex items-center gap-3 text-[10px] text-muted-foreground border-l pl-3 ml-1">
                            <div className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              <span>{new Date(order.orderDate).toLocaleDateString("tr-TR")}</span>
                            </div>
                            {order.deadline && (
                              <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                                <Clock className="h-3 w-3" />
                                <span>{new Date(order.deadline).toLocaleDateString("tr-TR")}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      <span className="text-sm font-bold tabular-nums shrink-0 self-center">
                        {totalQty.toLocaleString("tr-TR")} mt
                      </span>
                    </button>

                    {/* Kalem satırları — ayrı ayrı seçim + allocatedQty */}
                    {order.lines && order.lines.length > 0 && (
                      <div className="ml-6 mt-1 space-y-1">
                        {order.lines.map((line) => {
                          const isSelected = line.id in allocations;
                          return (
                            <div
                              key={line.id}
                              className={`flex items-center gap-2 text-xs rounded px-2 py-1 ${
                                isSelected ? "bg-primary/5" : ""
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => toggleOrderLine(line)}
                                className="shrink-0"
                              >
                                {isSelected ? (
                                  <CheckSquare className="h-3.5 w-3.5 text-primary" />
                                ) : (
                                  <Square className="h-3.5 w-3.5 text-muted-foreground" />
                                )}
                              </button>
                              <span className="flex-1 truncate">
                                {line.item?.name ?? "—"}
                                {line.variant && (
                                  <span className="ml-1 text-secondary-foreground font-semibold">
                                    ({line.variant.code})
                                  </span>
                                )}
                                {line.width != null && (
                                  <span className="ml-1 text-primary font-semibold">
                                    {line.width} cm
                                  </span>
                                )}
                              </span>
                              <span className="text-muted-foreground">
                                Sipariş: {line.quantity} mt
                              </span>
                              {isSelected && (
                                <div className="flex items-center gap-1">
                                  <Label className="text-xs">Tahsis:</Label>
                                  <Input
                                    type="number"
                                    min={0}
                                    max={line.quantity}
                                    step="0.1"
                                    className="h-7 w-24 text-xs"
                                    value={allocations[line.id] ?? ""}
                                    onChange={(e) =>
                                      updateAllocation(
                                        line.id,
                                        Number(e.target.value) || 0,
                                      )
                                    }
                                  />
                                  <span className="text-xs text-muted-foreground">
                                    mt
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Hiç kalem seçilmezse iş emri stok için üretilir. Tahsis miktarı
              boş bırakılırsa kalemin tamamı tahsis edilir.
            </p>
          </div>

          <hr />

          {/* ── TEMEL BİLGİLER ──────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="batchNumber">
                Parti Numarası
                <span className="text-xs text-muted-foreground ml-1">
                  (boş bırakılırsa otomatik üretilir)
                </span>
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="batchNumber"
                  {...register("batchNumber")}
                  disabled={!isBatchEditable}
                  placeholder={
                    isBatchEditable
                      ? "ör: PARTI-2026-001"
                      : "Otomatik üretilecek..."
                  }
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 shrink-0 border-dashed"
                  onClick={() => setIsBatchEditable(!isBatchEditable)}
                  title={isBatchEditable ? "Kilitle" : "Düzenle"}
                >
                  {isBatchEditable ? (
                    <Unlock className="h-4 w-4 text-primary" />
                  ) : (
                    <Lock className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="type">Tür</Label>
              <Select
                id="type"
                {...register("type")}
                options={[
                  { value: "ORDER_PRODUCTION", label: "Siparişe Özel Üretim" },
                  { value: "STOCK_PRODUCTION", label: "Stoka Üretim" },
                  { value: "SAMPLE_PRODUCTION", label: "Numune Üretimi" },
                  { value: "REPAIR_REWORK", label: "Tamir ve Yeniden İşlem" },
                ]}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="width" error={!!errors.width}>
                En (cm)
              </Label>
              <Input
                id="width"
                type="number"
                step="0.1"
                min="0"
                {...register("width", {
                  valueAsNumber: true,
                  setValueAs: (v: string) =>
                    v === "" || v === undefined ? undefined : Number(v),
                })}
                error={!!errors.width}
                disabled={hasOrderAllocation}
                placeholder={
                  hasOrderAllocation ? "Siparişten alınacak" : "ör: 150"
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="recipeNo">
                Reçete No
                <span className="text-xs text-muted-foreground ml-1">
                  (renk / varyant)
                </span>
              </Label>
              <Input
                id="recipeNo"
                {...register("recipeNo")}
                placeholder="ör: R-2026-045"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="targetQuantity">Hedef Uzunluk/Metraj</Label>
              <Input
                id="targetQuantity"
                type="number"
                step="0.1"
                min="0"
                {...register("targetQuantity", {
                  valueAsNumber: true,
                  setValueAs: (v: string) =>
                    v === "" || v === undefined ? undefined : Number(v),
                })}
                disabled={hasOrderAllocation}
                placeholder={
                  hasOrderAllocation ? "Siparişten alınacak" : "ör: 5000"
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dyehouseCompanyId">
                <Factory className="h-3.5 w-3.5 inline mr-1" />
                Gidilecek Boyahane / Fason
              </Label>
              <Select
                id="dyehouseCompanyId"
                {...register("dyehouseCompanyId")}
                options={dyehouseOptions}
                placeholder="Hedef müşteri seçiniz"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="plannedStartDate">Başlangıç Tarihi</Label>
              <Input
                id="plannedStartDate"
                type="date"
                {...register("plannedStartDate")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="plannedEndDate">Termin Tarihi</Label>
              <Input
                id="plannedEndDate"
                type="date"
                {...register("plannedEndDate")}
              />
            </div>
          </div>

          {/* ── ROTA SEÇİMİ ─────────────────────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              <Label>Rota</Label>
              <div className="ml-auto flex rounded-md border text-xs overflow-hidden">
                <button
                  type="button"
                  onClick={() => setRouteMode("template")}
                  className={`px-3 py-1 ${
                    routeMode === "template"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  Şablondan Kopyala
                </button>
                <button
                  type="button"
                  onClick={() => setRouteMode("custom")}
                  className={`px-3 py-1 ${
                    routeMode === "custom"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  Özel Rota
                </button>
              </div>
            </div>

            {routeMode === "template" ? (
              <div className="space-y-2">
                <Select
                  value={routeTemplateId}
                  onChange={(e) => handleRouteSelect(e.target.value)}
                  options={routeOptions.map((r) => ({
                    value: r.value,
                    label: r.label,
                  }))}
                  placeholder="Hazır rota seçiniz..."
                />
                <p className="text-xs text-muted-foreground">
                  Şablon seçildiğinde adımlar iş emri içine kopyalanır —
                  şablondaki sonraki değişiklikler bu iş emrini etkilemez.
                </p>
                {steps.length > 0 && (
                  <div className="rounded border p-2 bg-muted/30 space-y-1">
                    <div className="text-xs text-muted-foreground mb-1">
                      Önizleme:
                    </div>
                    {steps.map((s, i) => {
                      const st = stationOptions.find(
                        (o) => o.value === s.stationId,
                      );
                      return (
                        <div key={i} className="text-xs flex items-center gap-2">
                          <span className="text-muted-foreground">
                            #{i + 1}
                          </span>
                          <span className="font-medium">
                            {st?.label ?? s.stationId}
                          </span>
                          {s.notes && (
                            <span className="text-muted-foreground">
                              — {s.notes}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) handleRouteSelect(e.target.value);
                    }}
                    options={routeOptions.map((r) => ({
                      value: r.value,
                      label: r.label,
                    }))}
                    placeholder="Rota seçerek adımları otomatik doldur..."
                  />
                </div>

                <div className="flex items-center justify-between">
                  <Label>Rota Adımları *</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addStep}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Adım Ekle
                  </Button>
                </div>

                {steps.length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 text-center border border-dashed rounded-md">
                    En az bir rota adımı eklemelisiniz.
                  </p>
                )}

                <div className="space-y-2">
                  {steps.map((step, idx) => (
                    <div
                      key={idx}
                      className="rounded-md border p-2 space-y-1.5"
                    >
                      <div className="flex items-center gap-2">
                        <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium text-muted-foreground w-8 shrink-0">
                          #{idx + 1}
                        </span>
                        <Select
                          value={step.stationId}
                          onChange={(e) => updateStep(idx, e.target.value)}
                          options={stationOptions}
                          placeholder="İstasyon seçiniz"
                          className="flex-1"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeStep(idx)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                      <Input
                        value={step.notes}
                        onChange={(e) => updateStepNote(idx, e.target.value)}
                        placeholder="Bu adım için not / özel talimat..."
                        className="ml-14 w-[calc(100%-3.5rem)] text-xs h-8"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              İptal
            </Button>
            <Button
              type="submit"
              isLoading={isLoading}
              disabled={
                routeMode === "template"
                  ? !routeTemplateId
                  : steps.filter((s) => s.stationId).length === 0
              }
            >
              Oluştur
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
