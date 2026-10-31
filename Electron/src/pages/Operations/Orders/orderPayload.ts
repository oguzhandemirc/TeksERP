// =============================================================================
// SİPARİŞ GÖVDESİ — form değerlerinden create/update gövdesi (OrdersPage'den ayrıldı, SY-F2)
// =============================================================================
// `targetValues` yalnız gerektiğinde eklenir: hedefsiz satırın gövdesi bugünküyle bayt-aynıdır (§15.5 sıfır fark).
// =============================================================================
import type { ItemUnitCode } from "@/lib/item-unit";
import type { Order } from "./types";
import type { OrderFormValues, OrderLineFormValues } from "./schema";
import type { TargetValueItem } from "./lineTargetValues";
import { linePlanPayload, type OrderLinePlanPayload } from "./orderLinePlanPayload";

export interface CreatePayload {
  /** Boş = backend otomatik üretir (SIP + günlük sayaç). Doluysa o kullanılır. */
  orderNumber?: string;
  /** İdempotency anahtarı — timeout sonrası tekrar gönderimde mükerrer sipariş önlenir. */
  clientToken?: string;
  customerId: string;
  branchId: string | null;
  currency?: string;
  deadline: string | null;
  lines: ({
    itemId: string;
    colorId: string | null;
    quantity: number;
    /** Gönderilmezse sunucu kalem kartından kopyalar. */
    unit?: ItemUnitCode;
    width: number | null;
    unitPrice?: string | null;
    customerItemName?: string | null;
    customerColorName?: string | null;
    cutNote?: string | null;
    requiredPropertyIds: string[];
  } & OrderLinePlanPayload)[];
}

interface UpdateLinePayload extends Omit<OrderLinePlanPayload, "targetValues"> {
  /** Mevcut OrderLine.id (update). Yeni satırda undefined (create). */
  id?: string;
  itemId: string;
  colorId: string | null;
  quantity: number;
  unit?: ItemUnitCode;
  width: number | null;
  unitPrice?: string | null;
  customerItemName?: string | null;
  customerColorName?: string | null;
  cutNote?: string | null;
  requiredPropertyIds: string[];
  /** Yoksa sunucu mevcut kümeyi korur; `[]` = temizle (yalnız önceden hedefli satırda gönderilir). */
  targetValues?: TargetValueItem[];
}

export interface UpdatePayload {
  customerId?: string;
  branchId?: string | null;
  currency?: string;
  deadline?: string | null;
  /** Kalem listesi (sipariş WO'ya bağlı değilse). Diff backend'de yapılır. */
  lines?: UpdateLinePayload[];
}

export function buildCreatePayload(
  v: OrderFormValues,
  pricingEnabled: boolean,
  clientToken: string,
): CreatePayload {
  // Elle girildiyse o numara; boş bırakıldıysa alanı hiç göndermeyip backend'in
  // otomatik numaralandırmasını (SIP + günlük sayaç) devreye sokuyoruz.
  const manualOrderNumber = v.orderNumber?.trim();
  return {
    ...(manualOrderNumber ? { orderNumber: manualOrderNumber } : {}),
    clientToken,
    customerId: v.customerId,
    branchId: v.branchId || null,
    ...(pricingEnabled ? { currency: v.currency.trim().toUpperCase() } : {}),
    deadline: v.deadline ? new Date(v.deadline).toISOString() : null,
    lines: v.lines.map((l) => ({
      itemId: l.itemId,
      colorId: l.colorId ?? null,
      quantity: l.quantity,
      ...(l.unit ? { unit: l.unit } : {}),
      width: l.width ?? null,
      ...(pricingEnabled
        ? { unitPrice: l.unitPrice ? String(l.unitPrice) : null }
        : {}),
      customerItemName: l.customerItemName?.trim() ? l.customerItemName.trim() : null,
      customerColorName: l.customerColorName?.trim() ? l.customerColorName.trim() : null,
      cutNote: l.cutNote?.trim() ? l.cutNote.trim() : null,
      requiredPropertyIds: l.requiredPropertyIds ?? [],
      // SY-K2 plan alanları + hedef: yalnız dolu olan gider (hedefsiz satır gövdesi bayt-aynı).
      ...linePlanPayload(l, "create"),
    })),
  };
}


export function buildUpdatePayload(
  v: OrderFormValues,
  pricingEnabled: boolean,
  editing: Order,
): UpdatePayload {
  // Kalemler ne zaman gönderilir: sipariş PARTIAL_SHIPPED değil + hiçbir kalem
  // aktif (CANCELLED dışı) bir WO'ya bağlı değil. Dialog aynı kontrolü yapıp
  // editor'u açıyor; backend de aynı kontrolü tekrar enforce ediyor.
  const linesEditable =
    editing.status !== "PARTIAL_SHIPPED" &&
    editing.lines.every((l) =>
      (l.workOrderLinks ?? []).every((link) => link.workOrder.status === "CANCELLED"),
    );

  const existingIds = new Set(editing.lines.map((l) => l.id));
  const savedTargets = new Map(editing.lines.map((l) => [l.id, targetKey(l.targetValues ?? [])]));

  return {
    customerId: v.customerId,
    branchId: v.branchId ?? null,
    ...(pricingEnabled ? { currency: v.currency.trim().toUpperCase() } : {}),
    deadline: v.deadline ? new Date(v.deadline).toISOString() : null,
    ...(linesEditable
      ? {
          lines: v.lines.map((l) => ({
            // Form'daki clientId existing line id'siyle eşleşiyorsa update,
            // değilse yeni satır (id verilmez).
            ...(existingIds.has(l.clientId) ? { id: l.clientId } : {}),
            itemId: l.itemId,
            colorId: l.colorId ?? null,
            quantity: l.quantity,
            ...(l.unit ? { unit: l.unit } : {}),
            width: l.width ?? null,
            ...(pricingEnabled
              ? { unitPrice: l.unitPrice ? String(l.unitPrice) : null }
              : {}),
            customerItemName: l.customerItemName?.trim() ? l.customerItemName.trim() : null,
            customerColorName: l.customerColorName?.trim() ? l.customerColorName.trim() : null,
            cutNote: l.cutNote?.trim() ? l.cutNote.trim() : null,
            requiredPropertyIds: l.requiredPropertyIds ?? [],
            ...updatePlanFields(l, savedTargets.get(l.clientId)),
          })),
        }
      : {}),
  };
}

/** SY-K2 varyant/top boyu her zaman gider; hedef yalnız değiştiyse (targetValuesForUpdate). */
function updatePlanFields(l: OrderLineFormValues, saved: string | undefined): Pick<UpdateLinePayload, "recipeId" | "pieceLengthM" | "targetValues"> {
  const { recipeId, pieceLengthM } = linePlanPayload(l, "update");
  return { recipeId, pieceLengthM, ...targetValuesForUpdate(l.targetValues ?? [], saved) };
}

/** Sıra bağımsız küme anahtarı — kayıtlı hedefle formdakini karşılaştırmak için. */
function targetKey(targets: ReadonlyArray<{ propertyId: string; valueId: string }>): string {
  return targets.map((t) => `${t.propertyId}:${t.valueId}`).sort().join("|");
}

/**
 * Yalnız küme DEĞİŞTİYSE gönder; değişmediyse anahtar yok → sunucu mevcut kümeyi korur ve yeniden doğrulamaz
 * (sonradan pasife alınan değer ilgisiz alanın kaydını 400'le kilitlemesin). Yeni satırda: hedef varsa gönder.
 */
function targetValuesForUpdate(targets: TargetValueItem[], saved: string | undefined): { targetValues?: TargetValueItem[] } {
  if (saved === undefined) return targets.length > 0 ? { targetValues: targets } : {};
  return targetKey(targets) === saved ? {} : { targetValues: targets };
}
