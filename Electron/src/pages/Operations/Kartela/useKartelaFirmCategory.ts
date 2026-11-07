// Kartela firması kapsamı — tablet `useKartelaFirms` mantığı: "KARTELA" kodlu kategori koddan
// çözülür, firma seçici `categoryId` ile süzülür (boyahane/zımpara firması listelenmez).
import { useQuery } from "@tanstack/react-query";
import { loadAllForPicker } from "@/lib/picker-loader";
import { subcontractorCategoryService } from "@/pages/SubcontractorCategories/service";
import { KARTELA_CATEGORY_CODE } from "./kartelaActions";

export function useKartelaFirmCategory(enabled: boolean): {
  categoryId: string | null;
  isLoading: boolean;
  /** Kategori hiç tanımlı değil (Fason Kategorileri'nde "KARTELA" açılmamış). */
  categoryMissing: boolean;
} {
  const q = useQuery({
    queryKey: ["subcontractor-categories", "kartela"],
    // Tablet pasif kategoriyi de görür (listCategories süzgeçsiz) — aynı küme.
    queryFn: () => loadAllForPicker(subcontractorCategoryService, { filters: {} }),
    enabled,
    staleTime: 60_000,
  });
  const categoryId = q.data?.data.find((c) => c.code === KARTELA_CATEGORY_CODE)?.id ?? null;
  return { categoryId, isLoading: q.isLoading, categoryMissing: q.isSuccess && !categoryId };
}
