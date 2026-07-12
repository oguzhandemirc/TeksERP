import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { loadAllForPicker } from "@/lib/picker-loader";
import { itemService } from "@/pages/Items/service";
import { colorService } from "@/pages/Colors/service";
import { customerService } from "@/pages/Customers/service";
import { scopeLabels, type SackSearchParams, type SackSearchScope } from "./types";

const NONE = "__all__";
const SCOPES: SackSearchScope[] = ["POOL", "PLANNED", "DISPATCHED", "ALL"];

/** Master-data lookup (ürün/renk/müşteri) — loadAllForPicker + Select. */
function LookupSelect({
  label,
  queryKey,
  service,
  value,
  onChange,
}: {
  label: string;
  queryKey: string;
  service: Parameters<typeof loadAllForPicker>[0];
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  const { data } = useQuery({
    queryKey: [queryKey, "picker"],
    queryFn: () => loadAllForPicker(service),
    staleTime: 60_000,
  });
  // loadAllForPicker PaginatedResponse döndürür → dizi `.data` içinde.
  const items = (data?.data ?? []) as Array<{ id: string; name?: string; code?: string }>;
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? undefined : v)}>
      <SelectTrigger className={cn("h-8 w-auto min-w-[150px] gap-1 text-xs", value && "border-primary/60 font-medium")}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE} className="text-muted-foreground">
          Tümü ({label})
        </SelectItem>
        {items.map((it) => (
          <SelectItem key={it.id} value={it.id}>
            {it.name ?? it.code ?? it.id}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface Props {
  filters: SackSearchParams;
  onChange: (patch: Partial<SackSearchParams>) => void;
}

/** Filtre çubuğu — kapsam (belirgin segment) + içerik (ürün/renk/en) + kimlik. */
export function SackFilters({ filters, onChange }: Props) {
  const scope = filters.scope ?? "POOL";
  return (
    <div className="flex flex-col gap-2 border-b px-6 py-3">
      {/* Kapsam — hangi çuval kümesine bakıyoruz: belirgin segment kontrolü. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Kapsam</span>
        <div className="inline-flex rounded-lg border bg-muted/40 p-0.5">
          {SCOPES.map((s) => (
            <Button
              key={s}
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onChange({ scope: s })}
              className={cn(
                "h-7 px-3 text-xs font-medium",
                scope === s
                  ? "bg-background text-foreground shadow-sm ring-1 ring-primary/30"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {scopeLabels[s]}
            </Button>
          ))}
        </div>
      </div>

      {/* İçerik + kimlik filtreleri. */}
      <div className="flex flex-wrap items-center gap-2">
        <LookupSelect label="Ürün" queryKey="items" service={itemService} value={filters.itemId} onChange={(v) => onChange({ itemId: v })} />
        <LookupSelect label="Renk" queryKey="colors" service={colorService} value={filters.colorId} onChange={(v) => onChange({ colorId: v })} />
        <Input
          type="number"
          min={1}
          value={filters.width ?? ""}
          onChange={(e) => onChange({ width: e.target.value === "" ? undefined : Number(e.target.value) })}
          placeholder="En (cm)"
          className="h-8 w-24 text-xs"
        />
        <LookupSelect label="Müşteri" queryKey="customers" service={customerService} value={filters.customerId} onChange={(v) => onChange({ customerId: v })} />
        <Input
          value={filters.shipmentNo ?? ""}
          onChange={(e) => onChange({ shipmentNo: e.target.value || undefined })}
          placeholder="Sevk no"
          className="h-8 w-32 text-xs"
        />
        <Input
          value={filters.sackCode ?? ""}
          onChange={(e) => onChange({ sackCode: e.target.value || undefined })}
          placeholder="Çuval kodu (CV-…)"
          className="h-8 w-40 text-xs"
        />
      </div>
    </div>
  );
}
