import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { subcontractorService } from "@/pages/Subcontractors/service";
import { subcontractorCategoryService } from "@/pages/SubcontractorCategories/service";

/** `filter[x]=a,b` → ["a","b"]; boş/yok → []. */
function idList(csv: string | null): string[] {
  return csv ? csv.split(",").filter(Boolean) : [];
}

/**
 * Fasonda sekmesi rozet etiketi: seçili "İşlem" (kategori) + "Fason Firması"
 * filtresine göre "İşlem (Firma)" biçiminde yer bilgisi üretir. Örnekler:
 *   - işlem + firma → "Boyahane (Boyer Boyacılık)"
 *   - yalnız firma  → firmanın (tek) kategorisi türetilerek "Boyahane (Boyer Boyacılık)"
 *   - yalnız işlem  → "Boyahane"
 *   - çoklu seçim   → "2 işlem (3 firma)"
 *   - hiçbiri       → null (çağıran "Fasonda" default'unu kullanır)
 *
 * ⚠️ İki filtre de ÇOKLU (`multi-lookup`) — değer CSV olabilir. Tekil `find(id)`
 * ile çözmek çoklu seçimde `undefined` verir ve rozet, filtre AKTİFKEN sessizce
 * "Fasonda"ya düşerdi (kullanıcı daralttığı hâlde daraltmamış gibi görünür).
 *
 * Firma/kategori adları FilterBar `multi-lookup` dropdown'larıyla AYNI
 * react-query anahtarından (["subcontractors","filter-lookup-multi",undefined])
 * çözülür → cache paylaşılır, ekstra fetch olmaz. Anahtar FilterBar'daki
 * `MultiLookupFilter` ile birebir kalmalı; ayrışırsa aynı veri iki kez çekilir.
 * Sorgular yalnız bir filtre aktifken açılır.
 */
export function useFasonScopeLabel(active: boolean): string | null {
  const [sp] = useSearchParams();
  const firmIds = idList(sp.get("filter[subcontractorId]"));
  const catIds = idList(sp.get("filter[subcontractorCategoryId]"));
  const enabled = active && (firmIds.length > 0 || catIds.length > 0);

  const firmsQ = useQuery({
    queryKey: ["subcontractors", "filter-lookup-multi", undefined],
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
    queryKey: ["subcontractor-categories", "filter-lookup-multi", undefined],
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

  // Tek seçimde AD, çok seçimde SAYI. Adları yan yana dizmek rozeti taşırır ve
  // asıl bilgiyi (hangi sekmedeyim) okunmaz hâle getirir.
  const firm = firmIds.length === 1 ? firmsQ.data?.data.find((f) => f.id === firmIds[0]) : undefined;
  const cat = catIds.length === 1 ? catsQ.data?.data.find((c) => c.id === catIds[0]) : undefined;

  // İşlem adı: seçili kategori; yoksa firmanın kategorisi (yalnız tek kategoriliyse).
  const firmCat =
    firm?.categories?.length === 1 ? firm.categories[0]?.category : undefined;
  const opName =
    catIds.length > 1 ? `${catIds.length} işlem` : (cat?.name ?? firmCat?.name ?? null);
  const firmName =
    firmIds.length > 1 ? `${firmIds.length} firma` : (firm?.name ?? null);

  if (opName && firmName) return `${opName} (${firmName})`;
  if (opName) return opName;
  if (firmName) return firmName;
  return null;
}
