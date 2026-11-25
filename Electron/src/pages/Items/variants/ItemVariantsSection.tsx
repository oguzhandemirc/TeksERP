// Ürün penceresi > Varyantlar (D3/K7): varyant kumaşa aittir (desen birçok kumaşı besler) → asıl yeri burası; desen
// kartındaki Varyantlar sekmesi salt okunur özet + "Üründe aç". Varyant = kumaşın iş emri şablonu; İş Emri Şablonları
// ekranı aynı kayıtları gösterir. Eklemeler anında kaydedilir (Güncelle'yi beklemez).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useRecordForm } from "@/components/forms/record-form/useRecordForm";
import { listItemVariants } from "@/pages/WeaveDesigns/service";
import type { DesignVariant } from "@/pages/WeaveDesigns/types";
import { ItemType } from "@/types/enums";
import { useVariantRecordForm, variantTemplateNoun, type VariantFabric } from "./variantRecordForm";
import { VariantWeftOverrides } from "./VariantWeftOverrides";

export const VARIANT_READ_PERMISSIONS = ["station:read", "mobile:hizli-is-emri"];

/** Sekme yalnız KAYITLI kumaşta (varyant kumaş kimliğine bağlanır), dokuma yapısı görünürken ve okuma izniyle. */
export function useVariantsTabVisible(itemType: ItemType, saved: boolean, constructionVisible: boolean): boolean {
  const { hasAnyPermission } = useRoleAccess();
  return saved && itemType === ItemType.FABRIC && constructionVisible && hasAnyPermission(VARIANT_READ_PERMISSIONS);
}

export function ItemVariantsSection({ fabric }: { fabric: VariantFabric }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["product-recipes", "by-item", fabric.id], queryFn: () => listItemVariants(fabric.id) });
  const record = useRecordForm(useVariantRecordForm(fabric), () => undefined);
  const rows: DesignVariant[] = list.data ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">
          Varyant boya rengini, terbiye tarifesini ve atkı ipliğini değiştirir; her varyant bir {variantTemplateNoun()}dur.
        </p>
        {record.canWrite && (
          <Button type="button" size="sm" className="ml-auto" onClick={record.openCreate}>
            <Plus className="mr-1.5 h-4 w-4" />Yeni varyant
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
            <li key={v.id} className="rounded-md border p-2">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="font-mono font-semibold">{v.variantCode ?? "—"}</span>
                <span>{v.name}</span>
                <span className="text-muted-foreground">Renk: {v.color?.name ?? "—"}</span>
                <span className="text-muted-foreground">Tarife: {v.finishingRateCode ?? "kumaşın tarifesi"}</span>
                <span className="ml-auto flex flex-wrap gap-1.5">
                  {record.canWrite && (
                    <>
                      <Button type="button" variant="ghost" size="sm" onClick={() => record.openEdit(v)} aria-label={`${v.variantCode ?? v.name} — düzenle`}>
                        <Pencil className="mr-1.5 h-3.5 w-3.5" />Düzenle
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => void record.openTemplate(v)} aria-label={`${v.variantCode ?? v.name} — örnek al`}>
                        <Copy className="mr-1.5 h-3.5 w-3.5" />Örnek al
                      </Button>
                    </>
                  )}
                  <Button type="button" variant="outline" size="sm" onClick={() => setOpenId(openId === v.id ? null : v.id)}>
                    {openId === v.id ? "Kapat" : "Atkı değişimi"}
                  </Button>
                </span>
              </div>
              {openId === v.id && <VariantWeftOverrides fabricId={fabric.id} recipeId={v.id} />}
            </li>
          ))}
        </ul>
      )}
      {record.element}
    </div>
  );
}
