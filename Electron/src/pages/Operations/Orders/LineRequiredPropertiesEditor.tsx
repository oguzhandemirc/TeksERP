import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MultiSelectCheckboxList, type MultiSelectItem } from "@/components/forms/MultiSelectCheckboxList";
import { itemService } from "@/pages/Items/service";
import { fabricPropertyService } from "@/pages/FabricProperties/service";

interface Props {
  /** Seçili Item ID — allowedProperties filter kaynağı. Boşsa popover disabled. */
  itemId: string;
  value: string[];
  onChange: (next: string[]) => void;
}

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
    if (allowedIds.length === 0) return allProps;
    const set = new Set(allowedIds);
    return allProps.filter((p) => set.has(p.id));
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
    return value.map((id) => map.get(id)).filter((p): p is (typeof allProps)[number] => Boolean(p));
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
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-5 gap-1 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-3 w-3" />
            {selectedById.length === 0 ? "Özellik isteği ekle" : "Düzenle"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-2" align="start">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Müşteri İstenen Özellikler
          </div>
          <div className="h-56">
            <MultiSelectCheckboxList
              items={propMultiItems}
              value={value}
              onChange={onChange}
              placeholder="Özellik ara..."
              emptyHint={
                candidateProps.length === 0 && allowedIds.length > 0
                  ? "Bu ürün için tanımlı özellik yok."
                  : undefined
              }
            />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
