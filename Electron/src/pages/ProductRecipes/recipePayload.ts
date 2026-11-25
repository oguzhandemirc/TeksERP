// İş emri şablonu (ürün reçetesi) yazma gövdesi — şablon ekranı ve seçicideki kayıt formu (Yeni · Örnek al) aynısını kullanır.
import type { RecipeFormValues } from "./schema";

interface RecipePropertyCreate {
  propertyId: string;
}

export interface RecipePayload {
  code?: string;
  name: string;
  itemId: string;
  colorId: string | null;
  width: number | null;
  foldType: string | null;
  routeId: string | null;
  isActive: boolean;
  properties: RecipePropertyCreate[];
}

export function buildRecipePayload(v: RecipeFormValues): RecipePayload {
  // Kod backend'de üretilir (REC+GGAAYY+NNNN); create'te gönderilmez, edit'te backend korur.
  return {
    name: v.name,
    itemId: v.targetItemId ?? "",
    colorId: v.targetColorId ?? null,
    width: typeof v.width === "number" ? v.width : null,
    foldType: v.foldType?.trim() ? v.foldType.trim() : null,
    routeId: v.routeTemplateId || null,
    isActive: v.isActive,
    properties: (v.targetPropertyIds ?? []).map((id) => ({ propertyId: id })),
  };
}
