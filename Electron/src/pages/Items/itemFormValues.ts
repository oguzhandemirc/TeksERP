// Kayıtlı ürün kartı → form değerleri (düzenleme ve "Örnek al" taslağı aynı dönüşümden).
import type { ProductItemType } from "@/types/enums";
import { decimalToFormText } from "@/lib/decimal-form-text";
import type { Item } from "./types";
import type { ItemFormValues } from "./schema";
import { fabricDetailToFormText } from "./itemPayload.helper";
import { fabricClassFormValues } from "./fabricClass.payload";
import { cardExtraFormValues } from "./cardExtra.payload";

export function toFormValues(initial: Item): ItemFormValues {
  return {
    code: initial.code,
    name: initial.name,
    // Hizmet kartı bu tabloda yaşamaz (`items_no_service_ck`); tip daraltması yalnız derleyici içindir.
    itemType: initial.itemType as ProductItemType,
    unit: initial.unit,
    linearDensityDen: decimalToFormText(initial.linearDensityDen),
    yarnWastePct: fabricDetailToFormText(initial.yarnWastePct),
    yarnPurchaseUnit: initial.yarnPurchaseUnit ?? "KG",
    yarnPiecesPerM: fabricDetailToFormText(initial.yarnPiecesPerM),
    widthCm: initial.widthCm == null ? "" : String(Number(initial.widthCm)).replace(".", ","),
    rawWidthCm: fabricDetailToFormText(initial.rawWidthCm),
    rawGsm: fabricDetailToFormText(initial.rawGsm),
    finishedGsm: fabricDetailToFormText(initial.finishedGsm),
    warpSpecId: initial.warpSpecId ?? "",
    weftSpecId: initial.weftSpecId ?? "",
    weaveDesignId: initial.weaveDesignId ?? "",
    drawingInPlanId: initial.drawingInPlanId ?? "",
    allowedColorIds: initial.allowedColors?.map((c) => c.colorId) ?? [],
    allowedPropertyIds: initial.allowedProperties?.map((p) => p.propertyId) ?? [],
    ...fabricClassFormValues(initial),
    ...cardExtraFormValues(initial),
  };
}
