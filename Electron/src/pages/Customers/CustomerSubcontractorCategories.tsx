// Cari kartı → "Fason iş yapar" altındaki kategori ÇOKLU seçimi. Profil aktifken görünür; her tık fason profilinin
// kategori kümesini değiştirir (`PATCH /api/subcontractors/:id {categoryIds}` — mevcut uç, küme değişimi). Zorunlu değil.
// Kategoriler fason seçicilerini süzer (devere/dokuma/rota adımı) — boş küme bugünkü davranıştır.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { MultiSelectCheckboxList } from "@/components/forms/MultiSelectCheckboxList";
import { InfoPopover } from "@/components/ui/info-popover";
import { Skeleton } from "@/components/ui/skeleton";
import { loadAllForPicker } from "@/lib/picker-loader";
import { subcontractorService } from "@/pages/Subcontractors/service";
import { subcontractorCategoryService } from "@/pages/SubcontractorCategories/service";
import type { Subcontractor } from "@/pages/Subcontractors/types";

export const SUBCONTRACTOR_CATEGORIES_LABEL = "Fason kategorileri";

export function CustomerSubcontractorCategories({ profile, onSaved }: { profile: Subcontractor; onSaved: () => void }) {
  const saved = (profile.categories ?? []).map((c) => c.categoryId);
  // Sunucu kümesi değişince çağıran `key` ile yeniden kurar; yerel küme yalnız tık anındaki iyimser görüntüdür.
  const [value, setValue] = useState<string[]>(saved);

  const categories = useQuery({
    queryKey: ["subcontractor-categories", "all-active"],
    queryFn: () => loadAllForPicker(subcontractorCategoryService, { sortBy: "name", sortOrder: "asc", filters: { isActive: "true" } }),
    staleTime: 60_000,
  });
  const mut = useMutation({
    mutationFn: (categoryIds: string[]) => subcontractorService.update(profile.id, { categoryIds } as Partial<Subcontractor>),
    onSuccess: () => {
      toast.success("Fason kategorileri kaydedildi");
      onSaved();
    },
    onError: () => setValue(saved),
  });

  return (
    <div className="space-y-1.5 pl-6">
      <div className="flex items-center gap-1.5 text-xs font-medium">
        {SUBCONTRACTOR_CATEGORIES_LABEL}
        <span className="font-normal text-muted-foreground">(isteğe bağlı · seçim anında kaydedilir)</span>
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
            items={(categories.data?.data ?? []).map((c) => ({ id: c.id, label: c.name, hint: c.description ?? c.code }))}
            value={value}
            onChange={(next) => {
              setValue(next);
              mut.mutate(next);
            }}
            columns={2}
            disabled={mut.isPending}
            placeholder="Kategori ara..."
            emptyHint="Tanımlı fason kategorisi yok (Tanımlar › Fason Kategorileri)."
          />
        )}
      </div>
    </div>
  );
}
