// SY-N4: standart maliyet sürümünün varyant kapsamı (Desen geneli | <varyant>). Varyant listesi
// `/api/product-recipes` (station:read) — izin yoksa sorgu ATILMAZ ve seçici görünmez (bugünkü yüzey).
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { loadAllForPicker } from "@/lib/picker-loader";
import { productRecipeService } from "@/pages/ProductRecipes/service";
import type { ProductRecipe } from "@/pages/ProductRecipes/types";

export type CostVariant = Pick<ProductRecipe, "id" | "code" | "name" | "isActive"> & { variantCode?: string | null };

export function variantLabel(v: CostVariant): string {
  return `${v.variantCode ? `${v.variantCode} · ${v.name}` : `${v.code} · ${v.name}`}${v.isActive ? "" : " (pasif)"}`;
}

/** Ürünün tüm varyantları (pasif dahil: geçmişi olabilir). Varyantsız üründe boş liste → seçici çizilmez. */
export function useCostVariants(itemId: string): CostVariant[] {
  const canRead = useRoleAccess().hasPermission("station:read");
  const q = useQuery({
    queryKey: ["cost-items", "variants", itemId],
    queryFn: () => loadAllForPicker(productRecipeService, { filters: { itemId }, sortBy: "code" }).then((r) => r.data as CostVariant[]),
    enabled: canRead && !!itemId,
  });
  return q.data ?? [];
}

interface ChoiceProps {
  variants: CostVariant[];
  value: string | null;
  onChange: (recipeId: string | null) => void;
  /** Kayıt için: pasif varyant seçilemez (sunucu da 400 RECIPE_INACTIVE). */
  activeOnly?: boolean;
  label: string;
}

export function VariantScopeChoice({ variants, value, onChange, activeOnly, label }: ChoiceProps) {
  if (variants.length === 0) return null;
  const opt = (id: string | null, text: string, disabled = false) => (
    <Button key={id ?? "desen"} type="button" size="sm" variant={value === id ? "default" : "outline"} className="h-8 text-xs"
      aria-pressed={value === id} disabled={disabled} onClick={() => onChange(id)}>
      {text}
    </Button>
  );
  return (
    <div role="group" aria-label={label} className="space-y-1.5 text-sm" data-testid="cost-variant-scope">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1">
        {opt(null, "Desen geneli")}
        {variants.map((v) => opt(v.id, variantLabel(v), activeOnly && !v.isActive))}
      </div>
    </div>
  );
}
