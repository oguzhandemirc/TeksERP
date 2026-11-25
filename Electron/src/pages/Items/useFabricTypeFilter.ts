// K8 ürün listesi "Kumaş türü" süzgeci: seçenekler türler tablosundan (pasifler de — eski kartlar süzülebilsin);
// süzme SUNUCUDA (`filter[fabricTypeId]`, skaler kolon). Liste yüklenemezse süzgeç çizilmez.
import { useQuery } from "@tanstack/react-query";
import { loadAllForPicker } from "@/lib/picker-loader";
import { fabricTypeService } from "@/pages/FabricFiberTypes/service";
import { ITEM_FILTER_ALL, type ItemUrlFilterDef } from "./itemsFilters";

export function useFabricTypeFilter(): ItemUrlFilterDef | null {
  const q = useQuery({
    queryKey: ["fabric-types", "item-list-filter"],
    queryFn: () => loadAllForPicker(fabricTypeService, { sortBy: "sortOrder", sortOrder: "asc", filters: {} }),
    staleTime: 60_000,
  });
  const rows = q.data?.data;
  if (!rows || rows.length === 0) return null;
  return {
    key: "fabricTypeId",
    label: "Kumaş türü",
    options: [
      { value: ITEM_FILTER_ALL, label: "Tümü" },
      ...rows.map((t) => ({ value: t.id, label: t.isActive ? t.name : `${t.name} (pasif)` })),
    ],
  };
}
