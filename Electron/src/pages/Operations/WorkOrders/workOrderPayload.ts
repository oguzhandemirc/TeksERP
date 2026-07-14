import { WorkOrderType } from "@/types/enums";
import type { WorkOrderFormValues } from "./schema";
import type { FasonStepPlan } from "./FasonPlanningDialog";
import type { CustomRouteStep } from "./RouteDesignerDialog";

// İş emri form değerlerini backend create/replace payload'ına çevirir. Hem
// liste (WorkOrdersPage) hem tam sayfa detay (Düzenle) bunu kullanır.

function trimOrNull(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  return t === "" ? null : t;
}

function dateOrNull(s: string | null | undefined): string | null {
  if (!s) return null;
  return new Date(s).toISOString();
}

interface StepPlanPayload {
  sequence: number;
  requiredCategoryId: string | null;
  plannedSubcontractorId: string | null;
  notes: string | null;
}

export interface CreatePayload {
  type: string;
  /** İdempotency anahtarı — timeout sonrası tekrar gönderimde mükerrer İE +
   *  refakat kartı önlenir. Yalnız create yolunda gönderilir (replace ALMAZ). */
  clientToken?: string;
  /** Parti Kodu. Boş/atlanırsa backend otomatik üretir (P-YYMMDD-NNN). */
  batchNumber?: string;
  routeTemplateId?: string;
  steps?: CustomRouteStep[];
  targetItemId: string | null;
  targetColorId: string | null;
  targetPropertyIds: string[];
  orderLineIds?: string[];
  stepPlanning?: StepPlanPayload[];
  width: number | null;
  targetQuantity: number | null;
  targetWeight: number | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  foldType: string | null;
}

export interface WorkOrderFormMeta {
  fasonPlans: FasonStepPlan[];
  customSteps: CustomRouteStep[];
}

export function buildPayload(
  v: WorkOrderFormValues,
  meta: WorkOrderFormMeta,
  targetQuantityEnabled: boolean,
): CreatePayload {
  const orderLineIds = v.orderLineIds ?? [];
  const hasLines = orderLineIds.length > 0;
  const usingCustom = meta.customSteps.length > 0;

  // Custom rota: steps[] gönder; routeTemplateId yok, stepPlanning'e gerek yok.
  // Şablon rota: routeTemplateId + (varsa) stepPlanning overlay.
  const routePart: Pick<CreatePayload, "routeTemplateId" | "steps" | "stepPlanning"> = usingCustom
    ? { steps: meta.customSteps }
    : (() => {
        const stepPlanning: StepPlanPayload[] = meta.fasonPlans
          .filter((p) => p.requiredCategoryId || p.plannedSubcontractorId || p.notes.trim())
          .map((p) => ({
            sequence: p.sequence,
            requiredCategoryId: p.requiredCategoryId,
            plannedSubcontractorId: p.plannedSubcontractorId,
            notes: p.notes.trim() === "" ? null : p.notes.trim(),
          }));
        return {
          routeTemplateId: v.routeTemplateId,
          ...(stepPlanning.length > 0 ? { stepPlanning } : {}),
        };
      })();

  // Parti kodu: doluysa gönder (manuel/override/düzenleme); boşsa hiç gönderme
  // → backend otomatik üretir (otomatik mod).
  const batchNumber = trimOrNull(v.batchNumber);

  return {
    // Tip artık formda seçilmez — bağlı kalem varsa siparişe özel, yoksa stoğa.
    type: hasLines ? WorkOrderType.ORDER_PRODUCTION : WorkOrderType.STOCK_PRODUCTION,
    ...(batchNumber ? { batchNumber } : {}),
    ...routePart,
    targetItemId: v.targetItemId ?? null,
    targetColorId: v.targetColorId ?? null,
    targetPropertyIds: v.targetPropertyIds ?? [],
    ...(hasLines ? { orderLineIds } : {}),
    width: v.width ?? null,
    targetQuantity: targetQuantityEnabled ? (v.targetQuantity ?? null) : null,
    targetWeight: targetQuantityEnabled ? (v.targetWeight ?? null) : null,
    plannedStartDate: dateOrNull(v.plannedStartDate),
    plannedEndDate: dateOrNull(v.plannedEndDate),
    foldType: trimOrNull(v.foldType),
  };
}
