import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MultiSelectCheckboxList, type MultiSelectItem } from "@/components/forms/MultiSelectCheckboxList";
import { itemService } from "@/pages/Items/service";
import { fabricPropertyService } from "@/pages/FabricProperties/service";

interface Props {
  /** Seçili Item ID — allowedProperties filter kaynağı. Boşsa popover disabled. */
  itemId: string;
  value: string[];
  onChange: (next: string[]) => void;
}

/**
 * Kurşun'a özgü ayrıcalık: özellik seçim listesinde (ve seçili rozetlerde)
 * her zaman en başa sabitlenir. 0 = en üst, diğerleri (1) orijinal sırasını korur.
 */
const kursunRank = (name: string): number => (/kurşun/i.test(name) ? 0 : 1);

export function LineRequiredPropertiesEditor({ itemId, value, onChange }: Props) {
  const [open, setOpen] = useState(false);

  const itemQuery = useQuery({
    queryKey: ["item-allowed", itemId],
    queryFn: () => itemService.getById(itemId),
    enabled: Boolean(itemId),
    staleTime: 60_000,
  });
  const allowedIds = useMemo(
    () => (itemQuery.data?.data?.allowedProperties ?? []).map((p) => p.propertyId),
    [itemQuery.data?.data?.allowedProperties],
  );

  const propsQ = useQuery({
    queryKey: ["fabric-properties", "all"],
    queryFn: () =>
      fabricPropertyService.getAll({
        page: 1,
        pageSize: 200,
        sortBy: "sortOrder",
        sortOrder: "asc",
        filters: { isActive: "true" },
      }),
    staleTime: 60_000,
  });
  const allProps = useMemo(() => propsQ.data?.data ?? [], [propsQ.data?.data]);

  const candidateProps = useMemo(() => {
    const set = new Set(allowedIds);
    const base = allowedIds.length === 0 ? allProps : allProps.filter((p) => set.has(p.id));
    // Kurşun en başta — stabil sort, geri kalan sortOrder sırasını korur.
    return [...base].sort((a, b) => kursunRank(a.name) - kursunRank(b.name));
  }, [allowedIds, allProps]);

  const propMultiItems: MultiSelectItem[] = useMemo(
    () =>
      candidateProps.map((p) => ({
        id: p.id,
        label: p.name,
        group: p.category ?? undefined,
        hint: p.code,
        swatch: p.color ?? null,
      })),
    [candidateProps],
  );

  const selectedById = useMemo(() => {
    const map = new Map(allProps.map((p) => [p.id, p]));
    const list = value
      .map((id) => map.get(id))
      .filter((p): p is (typeof allProps)[number] => Boolean(p));
    // Seçili rozetlerde de Kurşun en başta görünür.
    return list.sort((a, b) => kursunRank(a.name) - kursunRank(b.name));
  }, [allProps, value]);

  const removeOne = (id: string) => onChange(value.filter((v) => v !== id));

  if (!itemId) {
    return (
      <div className="text-[10px] italic text-muted-foreground">
        Önce ürün seç — sonra özellik isteği eklenebilir.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {selectedById.map((p) => (
        <Badge key={p.id} variant="muted" className="gap-1 pr-1 text-[10px]">
          {p.name}
          <button
            type="button"
            onClick={() => removeOne(p.id)}
            className="ml-0.5 rounded p-0.5 hover:bg-muted-foreground/20"
            aria-label={`${p.name} kaldır`}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </Badge>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-5 gap-1 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
      >
        <Plus className="h-3 w-3" />
        {selectedById.length === 0 ? "Özellik isteği ekle" : "Düzenle"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col">
          <DialogHeader>
            <DialogTitle>Müşteri İstenen Özellikler</DialogTitle>
            <DialogDescription>
              Bu sipariş satırı için istenen özellikleri seç. Üründe izinli özelliklerle sınırlı.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1">
            <MultiSelectCheckboxList
              items={propMultiItems}
              value={value}
              onChange={onChange}
              placeholder="Özellik ara..."
              columns={3}
              emptyHint={
                candidateProps.length === 0 && allowedIds.length > 0
                  ? "Bu ürün için tanımlı özellik yok."
                  : undefined
              }
            />
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => setOpen(false)}>
              Tamam
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
