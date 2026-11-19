// Fason seçicisi — beklenen kategoriye göre SUNUCUDA süzer (`filter[categoryId]`), modal başında "Tümünü göster".
// Kullanıcıyı kilitlemez: kategori tanımlı değilse ya da kategoride aktif fason yoksa hepsini gösterir + uyarı.
// Kategori kimlikle eşlenir: `categoryId` (ör. RouteStep.requiredCategoryId) ya da sabit kod (`lib/subcontractor-category-codes`).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Callout } from "@/components/ui/callout";
import { Switch } from "@/components/ui/switch";
import { EntityPickerModal, type EntityPickerModalProps } from "@/components/forms/entity-picker/EntityPickerModal";
import { loadAllForPicker } from "@/lib/picker-loader";
import { subcontractorService } from "@/pages/Subcontractors/service";
import { subcontractorCategoryService } from "@/pages/SubcontractorCategories/service";
import type { Subcontractor } from "@/pages/Subcontractors/types";

export type CategoryScopeState =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "missing"; code: string }
  | { kind: "empty"; categoryId: string; name: string }
  | { kind: "ready"; categoryId: string; name: string };

/** Beklenen kategoriyi çözer ve içinde aktif fason olup olmadığını sayar (tek satırlık sayfa, toplam). */
export function useSubcontractorCategoryScope(categoryId: string | null | undefined, categoryCode: string | undefined): CategoryScopeState {
  const wanted = Boolean(categoryId || categoryCode);
  const cats = useQuery({
    queryKey: ["subcontractor-categories", "picker-scope"],
    // Pasif kategori de süzgeçte geçerlidir (sunucu yalnız var-mı'ya bakar) — Kartela emsali tüm küme.
    queryFn: () => loadAllForPicker(subcontractorCategoryService, { filters: {} }),
    enabled: wanted,
    staleTime: 60_000,
  });
  const list = cats.data?.data ?? [];
  const cat = categoryId ? list.find((c) => c.id === categoryId) : list.find((c) => c.code === categoryCode);
  const resolvedId = categoryId ?? cat?.id ?? null;
  const count = useQuery({
    queryKey: ["subcontractors", "category-scope-count", resolvedId],
    queryFn: () =>
      subcontractorService.getAll({ page: 1, pageSize: 1, sortBy: "name", sortOrder: "asc", filters: { isActive: "true", categoryId: resolvedId as string } }),
    enabled: Boolean(resolvedId),
    staleTime: 30_000,
  });
  if (!wanted) return { kind: "none" };
  if (!resolvedId) return cats.isSuccess ? { kind: "missing", code: categoryCode ?? "" } : { kind: "loading" };
  if (!count.isSuccess) return count.isError ? { kind: "none" } : { kind: "loading" };
  const name = cat?.name ?? categoryCode ?? "Seçili kategori";
  return count.data.pagination.total > 0
    ? { kind: "ready", categoryId: resolvedId, name }
    : { kind: "empty", categoryId: resolvedId, name };
}

type Props = Omit<EntityPickerModalProps<Subcontractor>, "service" | "filters" | "headerSlot"> & {
  /** Beklenen kategori id'si (bilinen yerde: rota adımı `requiredCategoryId`). */
  categoryId?: string | null;
  /** Beklenen kategorinin sabit kodu (`DEVERE`, `DOKUMA`…); `categoryId` verilmişse yok sayılır. */
  categoryCode?: string;
};

export function SubcontractorCategoryPicker({ categoryId, categoryCode, queryKey, ...rest }: Props) {
  const scope = useSubcontractorCategoryScope(categoryId, categoryCode);
  const [showAll, setShowAll] = useState(false);
  const filtered = scope.kind === "ready" && !showAll;
  const filters = filtered ? { categoryId: scope.categoryId } : undefined;
  return (
    <EntityPickerModal<Subcontractor>
      {...rest}
      service={subcontractorService}
      queryKey={`${queryKey}-${filtered ? scope.categoryId : "all"}`}
      filters={filters}
      headerSlot={<CategoryScopeBar scope={scope} showAll={showAll} onShowAll={setShowAll} />}
    />
  );
}

function CategoryScopeBar({ scope, showAll, onShowAll }: { scope: CategoryScopeState; showAll: boolean; onShowAll: (v: boolean) => void }) {
  if (scope.kind === "none" || scope.kind === "loading") return null;
  if (scope.kind === "missing") {
    return (
      <Callout tone="warning" title={`"${scope.code}" kodlu fason kategorisi tanımlı değil`}>
        Tüm fasoncular gösteriliyor. Tanımlar › Fason Kategorileri'nden bu kodla kategori açıp Fasoncular sayfasından firmalara atayın.
      </Callout>
    );
  }
  if (scope.kind === "empty") {
    return (
      <Callout tone="warning" title={`Bu kategoriye (${scope.name}) atanmış fason yok`}>
        Tüm fasoncular gösteriliyor. Fasoncular sayfasından kategori atayın.
      </Callout>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2 text-xs">
      <span className="text-muted-foreground">
        {showAll ? "Tüm fasoncular gösteriliyor" : <>Yalnız <span className="font-medium text-foreground">{scope.name}</span> kategorisindeki fasoncular</>}
      </span>
      <label className="flex shrink-0 items-center gap-2 font-medium">
        Tümünü göster
        <Switch checked={showAll} onCheckedChange={onShowAll} aria-label="Tümünü göster" />
      </label>
    </div>
  );
}
