// İş emri şablonu (ürün reçetesi) seçicisinin kayıt formu (Yeni · Örnek al; Düzenle → şablon ekranı):
// ekranla aynı form + aynı gövde. Şablon ortak kayıttır → seçicide yerinde düzenlenmez.
import { useMemo } from "react";
import type { RecordFormSpec } from "@/components/forms/record-form/types";
import { ProductRecipeFormDialog } from "./ProductRecipeFormDialog";
import { buildRecipePayload } from "./recipePayload";
import { productRecipeService } from "./service";
import type { ProductRecipe } from "./types";

export function useProductRecipeRecordForm(): RecordFormSpec<ProductRecipe> {
  return useMemo<RecordFormSpec<ProductRecipe>>(() => ({
    entityName: "İş emri şablonu",
    service: productRecipeService,
    writePermission: "station:write", // şablon ekranı ile aynı
    invalidateKeys: ["product-recipes"],
    templateRule: { clear: ["code"], suggestCopy: ["name"] },
    // Özellik listesi ve rota bağı tam kayıttan gelir.
    loadFull: async (row) => (await productRecipeService.getById(row.id)).data,
    cardPath: (r) => `/definitions/product-recipes?search=${encodeURIComponent(r.code ?? r.name)}`,
    renderForm: ({ open, onOpenChange, initial, draft, onSubmit, isSubmitting }) => (
      <ProductRecipeFormDialog
        open={open}
        onOpenChange={onOpenChange}
        initial={initial}
        draft={draft as ProductRecipe | null}
        isSubmitting={isSubmitting}
        onSubmit={(v) => onSubmit(buildRecipePayload(v) as unknown as Partial<ProductRecipe>)}
      />
    ),
  }), []);
}
