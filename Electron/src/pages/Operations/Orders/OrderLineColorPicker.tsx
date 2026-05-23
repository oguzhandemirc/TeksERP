import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { itemService } from "@/pages/Items/service";
import { colorService } from "@/pages/Colors/service";

interface Props {
  itemId: string;
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
}

const NONE_VALUE = "__none__";

export function OrderLineColorPicker({ itemId, value, onChange, disabled }: Props) {
  const itemQ = useQuery({
    queryKey: ["item-allowed-colors", itemId],
    queryFn: () => itemService.getById(itemId),
    enabled: Boolean(itemId),
    staleTime: 60_000,
  });

  const allowedIds = useMemo(
    () => (itemQ.data?.data?.allowedColors ?? []).map((c) => c.colorId),
    [itemQ.data?.data?.allowedColors],
  );

  const allColorsQ = useQuery({
    queryKey: ["colors", "all-active"],
    queryFn: () =>
      colorService.getAll({
        page: 1,
        pageSize: 500,
        sortBy: "name",
        sortOrder: "asc",
        filters: { isActive: "true" },
      }),
    staleTime: 60_000,
    enabled: Boolean(itemId),
  });

  const colors = useMemo(() => {
    const all = allColorsQ.data?.data ?? [];
    if (allowedIds.length === 0) return all;
    const set = new Set(allowedIds);
    return all.filter((c) => set.has(c.id));
  }, [allColorsQ.data?.data, allowedIds]);

  if (!itemId) {
    return (
      <div className="h-9 rounded-md border border-dashed px-3 py-1.5 text-xs text-muted-foreground italic">
        Önce ürün
      </div>
    );
  }

  return (
    <Select
      value={value ?? NONE_VALUE}
      onValueChange={(v) => onChange(v === NONE_VALUE ? null : v)}
      disabled={disabled}
    >
      <SelectTrigger className="h-9 text-sm">
        <SelectValue placeholder="Renk seç..." />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE_VALUE}>
          <span className="text-muted-foreground">— Renksiz —</span>
        </SelectItem>
        {colors.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            <span className="flex items-center gap-1.5">
              {c.hex && (
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: c.hex }}
                />
              )}
              {c.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
