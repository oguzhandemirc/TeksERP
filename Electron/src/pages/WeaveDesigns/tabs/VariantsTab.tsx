// Varyantlar sekmesi (desen kartı): varyant = kumaşın iş emri şablonu (`ProductRecipe`, kolon `variantCode`).
// D3/K7: varyant kumaşa aittir → burada SALT OKUNUR özet; yeni varyant, örnek alma ve atkı değişimi kumaşın ürün
// penceresinin Varyantlar sekmesinde ("Üründe aç"). İş Emri Şablonları ekranı aynı kayıtları gösterir.
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { TERIM } from "@/lib/terim";
import { VARIANT_READ_PERMISSIONS } from "@/pages/Items/variants/ItemVariantsSection";
import { listItemVariants } from "../service";
import type { DesignFabric, DesignVariant } from "../types";

export function VariantsTab({ fabric, onOpenItem }: { fabric: DesignFabric | null; onOpenItem?: () => void }) {
  const { hasAnyPermission } = useRoleAccess();
  const canRead = hasAnyPermission(VARIANT_READ_PERMISSIONS);
  const list = useQuery({
    queryKey: ["product-recipes", "by-item", fabric?.id],
    queryFn: () => listItemVariants(fabric!.id),
    enabled: !!fabric && canRead,
  });
  if (!fabric) return <p className="text-sm text-muted-foreground">Önce desene bir kumaş bağlayın.</p>;
  if (!canRead) return <p className="text-sm text-muted-foreground">Varyantları görmek için {TERIM.terbiyeIsEmri.tekilKucuk} şablonu okuma yetkisi gerekir.</p>;
  const rows: DesignVariant[] = list.data ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">Varyantlar kumaşa aittir; {fabric.code} kumaşının ürün penceresinde (Varyantlar sekmesi) eklenir ve değiştirilir.</p>
        {onOpenItem && (
          <Button size="sm" variant="outline" className="ml-auto" onClick={onOpenItem}>
            <ExternalLink className="mr-1.5 h-4 w-4" />Üründe aç
          </Button>
        )}
      </div>
      {list.isLoading ? (
        <p className="text-sm text-muted-foreground">Yükleniyor…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{fabric.code} kumaşının varyantı yok.</p>
      ) : (
        <ul className="space-y-2" aria-label="Varyantlar">
          {rows.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-3 rounded-md border p-2 text-sm">
              <span className="font-mono font-semibold">{v.variantCode ?? "—"}</span>
              <span>{v.name}</span>
              <span className="text-muted-foreground">Renk: {v.color?.name ?? "—"}</span>
              <span className="text-muted-foreground">Tarife: {v.finishingRateCode ?? "kumaşın tarifesi"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
