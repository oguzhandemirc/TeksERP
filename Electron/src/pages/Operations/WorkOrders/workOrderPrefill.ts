import { WorkOrderType } from "@/types/enums";
import { buildPicked, type PickedOrderLine } from "./OrderPickerDialog";
import type { CustomRouteStep, DesignerStep } from "./RouteDesignerDialog";
import type { FasonStepPlan } from "./FasonPlanningDialog";
import type { WorkOrderFormValues } from "./schema";
import type { WorkOrder } from "./types";
import type { Order } from "@/pages/Operations/Orders/types";

/**
 * Ürün Dengesi "WO Aç (stoğa üret)" → WO formuna sipariş bağı olmadan hedef
 * spec + miktar seed'i. Bağlı (siparişlere bağla) mod seedPickedLines kullanır.
 */
export interface WoSeedTarget {
  itemId: string;
  colorId: string | null;
  width: number | null;
  targetQuantity: number | null;
}

function dateToInput(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function pickFormType(t: WorkOrder["type"]): WorkOrderFormValues["type"] {
  if (t === WorkOrderType.STOCK_PRODUCTION) return t;
  return WorkOrderType.ORDER_PRODUCTION;
}

export function formValuesFromWorkOrder(wo: WorkOrder): WorkOrderFormValues {
  const type = pickFormType(wo.type);
  return {
    type,
    batchNumber: wo.batchNumber,
    routeTemplateId: wo.routeTemplateId ?? "",
    targetItemId: wo.targetItemId,
    targetColorId: wo.targetColorId,
    targetPropertyIds: (wo.targetProperties ?? []).map((p) => p.propertyId),
    orderLineIds: (wo.orderLinks ?? []).map((l) => l.orderLineId),
    width: wo.width,
    targetQuantity: wo.targetQuantity,
    targetWeight: wo.targetWeight,
    plannedStartDate: dateToInput(wo.plannedStartDate),
    plannedEndDate: dateToInput(wo.plannedEndDate),
    foldType: wo.foldType ?? "",
    dyehouseNote: wo.dyehouseNote ?? "",
  };
}

export function pickedLinesFromWorkOrder(wo: WorkOrder): PickedOrderLine[] {
  const out: PickedOrderLine[] = [];
  for (const link of wo.orderLinks ?? []) {
    const ol = link.orderLine;
    if (!ol) continue;
    out.push({
      lineId: link.orderLineId,
      orderId: ol.order?.id ?? "",
      orderNumber: ol.order?.orderNumber ?? "",
      orderDeadline: ol.order?.deadline ?? null,
      customerId: ol.order?.customer?.id ?? "",
      customerName: ol.order?.customer?.name ?? "—",
      itemId: ol.item?.id ?? "",
      itemName: ol.item?.name ?? "—",
      colorId: ol.colorId ?? null,
      itemColorHex: ol.color?.hex ?? null,
      itemColorName: ol.color?.name ?? null,
      quantity: ol.quantity,
      openQty: ol.quantity,
      width: ol.width ?? null,
      requiredProperties: (ol.requiredProperties ?? []).map((rp) => ({
        id: rp.propertyId,
        name: rp.property.name,
      })),
    });
  }
  return out;
}

/**
 * "Bu üründen iş emri oluştur" kısayolu: bir siparişin TEK ürününden (anchor
 * kalem) WO picker satırları üretir. Tek WO = tek kumaş/renk/en — anchor ile
 * aynı ürün+renk+en'e sahip açık (quantity − shippedQty > 0) kalemler alınır;
 * farklı ürün/renk/en kalemler dışarıda kalır (her biri için ayrı iş emri açılır).
 * openQty kalan (sevk edilmemiş) kadar gelir (link-only — metraj taşımaz).
 */
export function pickedLinesFromOrderLine(
  order: Order,
  anchorLineId: string,
): PickedOrderLine[] {
  const anchor = (order.lines ?? []).find((l) => l.id === anchorLineId);
  if (!anchor) return [];
  return (order.lines ?? [])
    .filter(
      (l) =>
        l.itemId === anchor.itemId &&
        (l.colorId ?? null) === (anchor.colorId ?? null) &&
        (l.width ?? null) === (anchor.width ?? null),
    )
    .map((l) => ({ l, rem: Number(l.quantity) - Number(l.shippedQty ?? 0) }))
    .filter((x) => x.rem > 0)
    .map((x) => buildPicked(order, { ...x.l, openQty: x.rem }));
}

export interface RoutePrefillState {
  customSteps: CustomRouteStep[];
  fasonPlans: FasonStepPlan[];
  designerSnapshot: DesignerStep[];
}

export function routeStateFromWorkOrder(wo: WorkOrder): RoutePrefillState {
  const sortedSteps = [...(wo.steps ?? [])].sort(
    (a, b) => a.stepSequence - b.stepSequence,
  );

  // Şablon-tabanlı WO: customSteps boş; EXTERNAL adımlardan fason planı türet.
  if (wo.routeTemplateId) {
    const fasonPlans: FasonStepPlan[] = sortedSteps
      .filter((s) => s.station?.type === "EXTERNAL")
      .map((s) => ({
        sequence: s.stepSequence,
        stationId: s.station?.id ?? "",
        stationCode: s.station?.code ?? "",
        stationName: s.station?.name ?? "—",
        requiredCategoryId: s.requiredCategoryId ?? null,
        plannedSubcontractorId: s.plannedSubcontractorId ?? null,
        notes: s.notes ?? "",
      }));
    return { customSteps: [], fasonPlans, designerSnapshot: [] };
  }

  // Custom rota — designer'a re-open için snapshot da hazırla.
  const customSteps: CustomRouteStep[] = sortedSteps.map((s) => ({
    id: s.id,
    stationId: s.station?.id ?? "",
    notes: s.notes ?? null,
    requiredCategoryId: s.requiredCategoryId ?? null,
    plannedSubcontractorId: s.plannedSubcontractorId ?? null,
  }));
  const designerSnapshot: DesignerStep[] = sortedSteps.map((s, i) => ({
    clientId: `ds-prefill-${i}`,
    serverId: s.id,
    stationId: s.station?.id ?? "",
    stationCode: s.station?.code ?? "",
    stationName: s.station?.name ?? "—",
    stationType: s.station?.type === "EXTERNAL" ? "EXTERNAL" : "INTERNAL",
    notes: s.notes ?? "",
    requiredCategoryId: s.requiredCategoryId ?? null,
    plannedSubcontractorId: s.plannedSubcontractorId ?? null,
  }));

  return { customSteps, fasonPlans: [], designerSnapshot };
}

/**
 * wo.steps → DesignerStep[] (template/custom farketmez, tüm adımlar). Inline rota
 * editörünün edit modunda formu seed etmesi için.
 */
export function designerStepsFromWorkOrder(wo: WorkOrder): DesignerStep[] {
  return [...(wo.steps ?? [])]
    .sort((a, b) => a.stepSequence - b.stepSequence)
    .map((s, i) => ({
      clientId: `ds-prefill-${i}`,
      serverId: s.id,
      stationId: s.station?.id ?? "",
      stationCode: s.station?.code ?? "",
      stationName: s.station?.name ?? "—",
      stationType: s.station?.type === "EXTERNAL" ? "EXTERNAL" : "INTERNAL",
      notes: s.notes ?? "",
      requiredCategoryId: s.requiredCategoryId ?? null,
      plannedSubcontractorId: s.plannedSubcontractorId ?? null,
    }));
}

/** DesignerStep[] → backend custom steps payload (submit). */
export function stepsToCustom(steps: DesignerStep[]): CustomRouteStep[] {
  return steps.map((s) => ({
    id: s.serverId ?? undefined,
    stationId: s.stationId,
    notes: s.notes.trim() || null,
    requiredCategoryId: s.requiredCategoryId,
    plannedSubcontractorId: s.plannedSubcontractorId,
  }));
}
