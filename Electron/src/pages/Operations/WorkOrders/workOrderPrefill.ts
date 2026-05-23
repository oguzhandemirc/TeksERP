import { WorkOrderType } from "@/types/enums";
import type { PickedOrderLine } from "./OrderPickerDialog";
import type { CustomRouteStep, DesignerStep } from "./RouteDesignerDialog";
import type { FasonStepPlan } from "./FasonPlanningDialog";
import type { WorkOrderFormValues } from "./schema";
import type { WorkOrder } from "./types";

function dateToInput(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function pickFormType(t: WorkOrder["type"]): WorkOrderFormValues["type"] {
  if (t === WorkOrderType.STOCK_PRODUCTION) return t;
  // SERVICE_PRODUCTION ayrı bir akış — bu form'da düzenlenmez.
  return WorkOrderType.ORDER_PRODUCTION;
}

export function formValuesFromWorkOrder(wo: WorkOrder): WorkOrderFormValues {
  const type = pickFormType(wo.type);
  return {
    type,
    routeTemplateId: wo.routeTemplateId ?? "",
    targetItemId: wo.targetItemId,
    targetColorId: wo.targetColorId,
    targetPropertyIds: (wo.targetProperties ?? []).map((p) => p.propertyId),
    orderLineIds: (wo.orderLinks ?? []).map((l) => l.orderLineId),
    width: wo.width,
    targetQuantity: wo.targetQuantity,
    plannedStartDate: dateToInput(wo.plannedStartDate),
    plannedEndDate: dateToInput(wo.plannedEndDate),
    foldType: wo.foldType ?? "",
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
      width: ol.width ?? null,
      requiredProperties: (ol.requiredProperties ?? []).map((rp) => ({
        id: rp.propertyId,
        name: rp.property.name,
      })),
    });
  }
  return out;
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
