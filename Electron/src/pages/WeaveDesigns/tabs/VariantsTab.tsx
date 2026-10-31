// Varyantlar sekmesi: varyant = kumaşın iş emri şablonu (`ProductRecipe`, kolon `variantCode`); İş Emri
// Şablonları ekranı aynı kayıtları gösterir. Varyant boya rengini, terbiye tarifesini ve atkı ipliğini değiştirir.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { TERIM } from "@/lib/terim";
import { listItemVariants } from "../service";
import type { DesignFabric, DesignVariant } from "../types";
import { VariantCreateDialog } from "./VariantCreateDialog";
import { VariantWeftOverrides } from "./VariantWeftOverrides";

export function VariantsTab({ fabric }: { fabric: DesignFabric | null }) {
  const { hasAnyPermission, hasPermission } = useRoleAccess();
  const canRead = hasAnyPermission(["station:read", "mobile:hizli-is-emri"]);
  const canCreate = hasPermission("station:write");
  const [createOpen, setCreateOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
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
      {canCreate && <Button size="sm" onClick={() => setCreateOpen(true)}>Yeni varyant</Button>}
      {list.isLoading ? (
        <p className="text-sm text-muted-foreground">Yükleniyor…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{fabric.code} kumaşının varyantı yok.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((v) => (
            <li key={v.id} className="rounded-md border p-2">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="font-mono font-semibold">{v.variantCode ?? "—"}</span>
                <span>{v.name}</span>
                <span className="text-muted-foreground">Renk: {v.color?.name ?? "—"}</span>
                <span className="text-muted-foreground">Tarife: {v.finishingRateCode ?? "kumaşın tarifesi"}</span>
                <Button variant="outline" size="sm" className="ml-auto" onClick={() => setOpenId(openId === v.id ? null : v.id)}>
                  {openId === v.id ? "Kapat" : "Atkı değişimi"}
                </Button>
              </div>
              {openId === v.id && <VariantWeftOverrides fabricId={fabric.id} recipeId={v.id} />}
            </li>
          ))}
        </ul>
      )}
      {createOpen && <VariantCreateDialog fabric={fabric} onClose={() => setCreateOpen(false)} />}
    </div>
  );
}
