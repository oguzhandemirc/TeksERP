import { CrudPage } from "@/components/layout/CrudPage";
import { recipeColumns } from "./columns";
import { productRecipeService } from "./service";
import { ProductRecipeFormDialog } from "./ProductRecipeFormDialog";
import type { ProductRecipe } from "./types";
import { generateRecipeCode, type RecipeFormValues } from "./schema";

interface RecipePropertyCreate {
  propertyId: string;
}

interface RecipePayload {
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

function buildPayload(v: RecipeFormValues, isEdit: boolean): RecipePayload {
  const base: RecipePayload = {
    name: v.name,
    itemId: v.targetItemId ?? "",
    colorId: v.targetColorId ?? null,
    width: typeof v.width === "number" ? v.width : null,
    foldType: v.foldType?.trim() ? v.foldType.trim() : null,
    routeId: v.routeTemplateId || null,
    isActive: v.isActive,
    properties: (v.targetPropertyIds ?? []).map((id) => ({ propertyId: id })),
  };
  // Yeni kayıtta kod otomatik üretilir; düzenlemede mevcut kod backend'de değişmez.
  return isEdit ? base : { ...base, code: generateRecipeCode() };
}

export function ProductRecipesPage() {
  return (
    <CrudPage<ProductRecipe>
      title="Üretim Reçeteleri"
      description="Ürün + renk + özellik + en + rota şablonları — iş emri açılışını hızlandırır."
      entityName="Reçete"
      queryKey="product-recipes"
      service={productRecipeService}
      columns={recipeColumns}
      writePermission="station:write"
      searchPlaceholder="Reçete adı veya kodu ara..."
      renderForm={({ open, onOpenChange, initial, onSubmit, isSubmitting }) => (
        <ProductRecipeFormDialog
          open={open}
          onOpenChange={onOpenChange}
          initial={initial}
          isSubmitting={isSubmitting}
          onSubmit={(values) =>
            onSubmit(
              buildPayload(values, Boolean(initial)) as unknown as Partial<ProductRecipe>,
            )
          }
        />
      )}
    />
  );
}
