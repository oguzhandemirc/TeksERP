// Teklif kaleminde varyant (ürün şablonu) — isteğe bağlı; sunucu `recipeId`'yi ürünle eşleştirip doğrular
// (RECIPE_ITEM_MISMATCH). Liste `/api/product-recipes` (station:read): izin yoksa sorgu ATILMAZ, seçici çizilmez;
// seçilen desenin etkin varyantı yoksa da çizilmez (bugünkü yüzey).
import { useQuery } from "@tanstack/react-query";
import { Layers } from "lucide-react";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { loadAllForPicker } from "@/lib/picker-loader";
import { productRecipeService } from "@/pages/ProductRecipes/service";
import type { ProductRecipe } from "@/pages/ProductRecipes/types";

type Variant = ProductRecipe & { variantCode?: string | null };

export const variantText = (r: { name: string; variantCode?: string | null }) => (r.variantCode ? `${r.variantCode} · ${r.name}` : r.name);

interface Props { itemId: string; value: string | null; onChange: (recipeId: string | null) => void }

export function QuoteVariantPicker({ itemId, value, onChange }: Props) {
  const canRead = useRoleAccess().hasPermission("station:read");
  const variants = useQuery({
    queryKey: ["quote-line-variants", itemId],
    queryFn: () => loadAllForPicker(productRecipeService, { filters: { itemId, isActive: "true" }, sortBy: "code" }).then((r) => r.data),
    enabled: canRead && !!itemId,
  });
  if (!canRead || (variants.data ?? []).length === 0) return null;
  return (
    <div className="text-sm" data-testid="quote-line-variant">
      <span className="text-muted-foreground">Varyant (isteğe bağlı)</span>
      <div className="mt-1">
        <EntityPickerModal<Variant>
          value={value}
          onChange={onChange}
          service={productRecipeService}
          queryKey={`product-recipes-quote-${itemId}`}
          filters={{ itemId }}
          getLabel={variantText}
          getSubLabel={(r) => r.code}
          icon={Layers}
          nullable
          noneLabel="Varyant yok (desen geneli)"
          title="Varyant seç"
          placeholder="Varyant yok"
        />
      </div>
    </div>
  );
}
