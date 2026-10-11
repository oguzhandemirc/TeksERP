import { CrudPage } from "@/components/layout/CrudPage";
import { recipeColumns } from "./columns";
import { productRecipeService } from "./service";
import { ProductRecipeFormDialog } from "./ProductRecipeFormDialog";
import type { ProductRecipe } from "./types";
import { type RecipeFormValues } from "./schema";
import { TERIM } from "@/lib/terim";

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

function buildPayload(v: RecipeFormValues): RecipePayload {
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
  // Kod backend'de üretilir (REC+GGAAYY+NNNN); create'te gönderilmez, edit'te backend korur.
  return base;
}

export function ProductRecipesPage() {
  return (
    <CrudPage<ProductRecipe>
      title={`${TERIM.terbiyeIsEmri.tekil} Şablonları`}
      description="Kumaş + renk + özellik + en + rota — terbiye iş emri açılışını hızlandıran hazır şablonlar."
      entityName={`${TERIM.terbiyeIsEmri.tekil} Şablonu`}
      importEntity="productRecipe"
      queryKey="product-recipes"
      service={productRecipeService}
      columns={recipeColumns}
      writePermission="station:write"
      searchPlaceholder="Şablon adı veya kodu ara..."
      renderForm={({ open, onOpenChange, initial, onSubmit, isSubmitting }) => (
        <ProductRecipeFormDialog
          open={open}
          onOpenChange={onOpenChange}
          initial={initial}
          isSubmitting={isSubmitting}
          onSubmit={(values) =>
            onSubmit(
              buildPayload(values) as unknown as Partial<ProductRecipe>,
            )
          }
        />
      )}
    />
  );
}
