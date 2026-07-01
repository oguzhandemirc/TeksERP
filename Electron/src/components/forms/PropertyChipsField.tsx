import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { itemService } from "@/pages/Items/service";
import { fabricPropertyService } from "@/pages/FabricProperties/service";

interface Props {
  /** Seçili Item ID — boşsa "önce ürün seç" mesajı gösterilir. */
  itemId: string;
  value: string[];
  onChange: (next: string[]) => void;
  /** Hiç özellik bulunmadığında gösterilecek not. */
  emptyHint?: string;
  /** Salt-okunur: çipler ve temizle butonu pasifleşir (örn. kilitli/yetkisiz form). */
  disabled?: boolean;
}

/**
 * Inline çoklu seçim: tüm uygun (allowed) özellikler chip olarak çıkar,
 * tek tıkla seçilir/kaldırılır. Popover/dialog yok — form içinde anlık görsel.
 */
export function PropertyChipsField({ itemId, value, onChange, emptyHint, disabled = false }: Props) {
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

  const selected = useMemo(() => new Set(value), [value]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(Array.from(next));
  };

  if (!itemId) {
    return (
      <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs italic text-muted-foreground">
        Önce ürün seçin — sonra uygun özellikler listelenecek.
      </div>
    );
  }

  if (candidateProps.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs italic text-muted-foreground">
        {emptyHint ?? "Bu ürüne uygulanabilir özellik tanımlı değil."}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex max-h-40 flex-wrap gap-1.5 overflow-auto rounded-md border bg-muted/20 p-2">
        {candidateProps.map((p) => {
          const isOn = selected.has(p.id);
          return (
            <Badge
              key={p.id}
              variant={isOn ? "default" : "outline"}
              className={cn(
                "gap-1 px-2 py-1 text-xs transition-colors",
                // Seçim rengi YEŞİL — aksiyon butonlarından (primary) ayırt edilsin.
                isOn && "border-transparent bg-emerald-600 text-white",
                disabled
                  ? "cursor-not-allowed opacity-60"
                  : cn("cursor-pointer", isOn ? "hover:bg-emerald-600/85" : "hover:bg-accent"),
              )}
              onClick={disabled ? undefined : () => toggle(p.id)}
            >
              {isOn ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
              {p.name}
            </Badge>
          );
        })}
      </div>
      {value.length > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            <span className="font-medium text-foreground">{value.length}</span> /{" "}
            {candidateProps.length} seçili
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            disabled={disabled}
            onClick={() => onChange([])}
          >
            Tümünü temizle
          </Button>
        </div>
      )}
    </div>
  );
}
