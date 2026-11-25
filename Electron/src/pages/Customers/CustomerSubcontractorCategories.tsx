// Cari kartı → Fason bölümündeki kategori ÇOKLU seçimi. Tek kayıt modeli (B18/7): seçim form değeridir
// (`subcontractorCategoryIds`), alt çubuktaki Kaydet profile yazar (`PATCH /api/subcontractors/:id {categoryIds}`; YENİ kartta
// kart gövdesiyle tek istekte `POST /api/customers {subcontractorCategoryIds}`), İptal
// geri alır. Zorunlu değil; kategoriler fason seçicilerini süzer (devere/dokuma/rota adımı) — boş küme bugünkü davranıştır.
import { useQuery } from "@tanstack/react-query";
import { MultiSelectCheckboxList } from "@/components/forms/MultiSelectCheckboxList";
import { InfoPopover } from "@/components/ui/info-popover";
import { Skeleton } from "@/components/ui/skeleton";
import { loadAllForPicker } from "@/lib/picker-loader";
import { subcontractorCategoryService } from "@/pages/SubcontractorCategories/service";

export const SUBCONTRACTOR_CATEGORIES_LABEL = "Fason kategorileri";

/** Liste satırının açıklaması: yalnız dolu `description`; boşsa satır çizilmez (kodu tekrar etmek "DEVERE" gibi gürültüdür). */
export function categoryHint(c: { description?: string | null }): string | undefined {
  return c.description?.trim() || undefined;
}

export function CustomerSubcontractorCategories({ value, onChange, disabled }: { value: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  const categories = useQuery({
    queryKey: ["subcontractor-categories", "all-active"],
    queryFn: () => loadAllForPicker(subcontractorCategoryService, { sortBy: "name", sortOrder: "asc", filters: { isActive: "true" } }),
    staleTime: 60_000,
  });

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-medium">
        {SUBCONTRACTOR_CATEGORIES_LABEL}
        <span className="font-normal text-muted-foreground">(isteğe bağlı · Kaydet ile kaydedilir)</span>
        <InfoPopover
          label="Fason kategorileri açıklaması"
          desc="Bu firmanın verdiği fason hizmetler (Boyahane, Devere, Dokuma…). Devere siparişi, dokuma iş emri ve rota adımındaki fason seçicileri yalnız ilgili kategorideki firmaları gösterir; seçilmezse firma yalnız 'Tümünü göster' ile görünür."
        />
      </div>
      <div className="h-56">
        {categories.isLoading ? (
          <Skeleton className="h-full w-full" />
        ) : (
          <MultiSelectCheckboxList
            items={(categories.data?.data ?? []).map((c) => ({ id: c.id, label: c.name, hint: categoryHint(c) }))}
            value={value}
            onChange={onChange}
            columns={2}
            disabled={disabled}
            placeholder="Kategori ara..."
            emptyHint="Tanımlı fason kategorisi yok (Tanımlar › Fason Kategorileri)."
          />
        )}
      </div>
    </div>
  );
}
