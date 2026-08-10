import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { itemService } from "@/pages/Items/service";
import { fabricPropertyService } from "@/pages/FabricProperties/service";
import { QuickAddProperty } from "./QuickAddProperty";

interface Props {
  /** Seçili Item ID — boşsa "önce kumaş seç" mesajı gösterilir. */
  itemId: string;
  value: string[];
  onChange: (next: string[]) => void;
  /** Hiç özellik bulunmadığında gösterilecek not. */
  emptyHint?: string;
  /** Salt-okunur: çipler ve temizle butonu pasifleşir (örn. kilitli/yetkisiz form). */
  disabled?: boolean;
  /**
   * "Yeni Özellik Ekle" hızlı-ekleme butonunu göster. Yalnız kumaşın özellik KISITI
   * YOKKEN (tüm özellikler uygun) ve `property:write` yetkisi varken görünür —
   * kısıtlı kumaşta yeni global özellik izinli listeye girmez (renk deseniyle aynı).
   */
  allowQuickAdd?: boolean;
}

/**
 * Inline çoklu seçim: tüm uygun (allowed) özellikler chip olarak çıkar,
 * tek tıkla seçilir/kaldırılır. Popover/dialog yok — form içinde anlık görsel.
 */
export function PropertyChipsField({
  itemId,
  value,
  onChange,
  emptyHint,
  disabled = false,
  allowQuickAdd = false,
}: Props) {
  const { hasPermission } = useRoleAccess();
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
    queryKey: ["fabric-properties", "targetable"], // SEÇİM tipliler süzülü — RouteEditor "all" anahtarını ham liste için kullanıyor, aynı anahtarı paylaşmak ona eksik liste servis ederdi
    queryFn: () =>
      fabricPropertyService.getAll({
        page: 1,
        pageSize: 200,
        sortBy: "sortOrder",
        sortOrder: "asc",
        filters: { isActive: "true" , valueType: "FLAG" },
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

  // Hızlı-ekleme: kumaş özellik KISITI YOK (tüm özellikler uygun) + property:write + izinli çağıran.
  const canQuickAdd =
    allowQuickAdd && !disabled && allowedIds.length === 0 && hasPermission("property:write");
  const addProperty = (id: string) => onChange(Array.from(new Set([...value, id])));

  if (!itemId) {
    return (
      <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs italic text-muted-foreground">
        Önce kumaş seçin — sonra uygun özellikler listelenecek.
      </div>
    );
  }

  const isEmpty = candidateProps.length === 0;
  // Uygun özellik yok VE hızlı-ekleme de yoksa (kısıtlı kumaş / yetkisiz) → yalın not.
  if (isEmpty && !canQuickAdd) {
    return (
      <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs italic text-muted-foreground">
        {emptyHint ?? "Bu kumaşa uygulanabilir özellik tanımlı değil."}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {isEmpty ? (
        <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs italic text-muted-foreground">
          Henüz özellik tanımlı değil — aşağıdan ekleyebilirsiniz.
        </div>
      ) : (
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
      )}
      {!isEmpty && value.length > 0 && (
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
      {canQuickAdd && <QuickAddProperty onCreated={addProperty} />}
    </div>
  );
}
