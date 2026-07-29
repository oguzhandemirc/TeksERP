import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { subcontractorService } from "@/pages/Subcontractors/service";
import { subcontractorCategoryService } from "@/pages/SubcontractorCategories/service";

/**
 * Fasonda sekmesi rozet etiketi: seçili "İşlem" (kategori) + "Fason Firması"
 * filtresine göre "İşlem (Firma)" biçiminde yer bilgisi üretir. Örnekler:
 *   - işlem + firma → "Boyahane (Boyer Boyacılık)"
 *   - yalnız firma  → firmanın (tek) kategorisi türetilerek "Boyahane (Boyer Boyacılık)"
 *   - yalnız işlem  → "Boyahane"
 *   - hiçbiri       → null (çağıran "Fasonda" default'unu kullanır)
 *
 * Firma/kategori adları FilterBar lookup dropdown'larıyla AYNI react-query
 * anahtarından (["subcontractors","filter-lookup",undefined] vb.) çözülür →
 * cache paylaşılır, ekstra fetch olmaz. Sorgular yalnız bir filtre aktifken açılır.
 */
export function useFasonScopeLabel(active: boolean): string | null {
  const [sp] = useSearchParams();
  const firmId = sp.get("filter[subcontractorId]");
  const catId = sp.get("filter[subcontractorCategoryId]");
  const enabled = active && (!!firmId || !!catId);

  const firmsQ = useQuery({
    queryKey: ["subcontractors", "filter-lookup", undefined],
    queryFn: () =>
      subcontractorService.getAll({
        page: 1,
        pageSize: 200,
        sortBy: "name",
        sortOrder: "asc",
        filters: { isActive: "true" },
      }),
    staleTime: 60_000,
    enabled,
  });
  const catsQ = useQuery({
    queryKey: ["subcontractor-categories", "filter-lookup", undefined],
    queryFn: () =>
      subcontractorCategoryService.getAll({
        page: 1,
        pageSize: 200,
        sortBy: "name",
        sortOrder: "asc",
        filters: { isActive: "true" },
      }),
    staleTime: 60_000,
    enabled,
  });

  if (!enabled) return null;

  const firm = firmId ? firmsQ.data?.data.find((f) => f.id === firmId) : undefined;
  const cat = catId ? catsQ.data?.data.find((c) => c.id === catId) : undefined;

  // İşlem adı: seçili kategori; yoksa firmanın kategorisi (yalnız tek kategoriliyse).
  const firmCat =
    firm?.categories?.length === 1 ? firm.categories[0]?.category : undefined;
  const opName = cat?.name ?? firmCat?.name ?? null;
  const firmName = firm?.name ?? null;

  if (opName && firmName) return `${opName} (${firmName})`;
  if (opName) return opName;
  if (firmName) return firmName;
  return null;
}
