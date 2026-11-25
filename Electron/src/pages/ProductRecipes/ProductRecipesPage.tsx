import { CrudPage } from "@/components/layout/CrudPage";
import { recipeColumns } from "./columns";
import { productRecipeService } from "./service";
import { ProductRecipeFormDialog } from "./ProductRecipeFormDialog";
import { buildRecipePayload } from "./recipePayload";
import type { ProductRecipe } from "./types";
import { TERIM } from "@/lib/terim";
import { screenTitle } from "@/components/layout/screen-title";

export function ProductRecipesPage() {
  return (
    <CrudPage<ProductRecipe>
      title={screenTitle("/definitions/product-recipes")}
      description={`Kumaş + renk + özellik + en + rota — ${TERIM.terbiyeIsEmri.tekilKucuk} açılışını hızlandıran hazır şablonlar.`}
      entityName={`${TERIM.terbiyeIsEmri.tekil} Şablonu`}
      importEntity="productRecipe"
      queryKey="product-recipes"
      service={productRecipeService}
      columns={recipeColumns}
      writePermission="station:write"
      searchHint="Şablon adı veya kodu"
      renderForm={({ open, onOpenChange, initial, onSubmit, isSubmitting }) => (
        <ProductRecipeFormDialog
          open={open}
          onOpenChange={onOpenChange}
          initial={initial}
          isSubmitting={isSubmitting}
          onSubmit={(values) =>
            onSubmit(
              buildRecipePayload(values) as unknown as Partial<ProductRecipe>,
            )
          }
        />
      )}
    />
  );
}
