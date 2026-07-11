import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  // loadAllForPicker PaginatedResponse döndürür → dizi `.data` içinde (eski kod
  // tüm yanıtı items sanıp `items.map is not a function` ile sayfayı çökertiyordu).
  const items = (data?.data ?? []) as Array<{ id: string; name?: string; code?: string }>;
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? undefined : v)}>
      <SelectTrigger className="h-8 w-auto min-w-[150px] gap-1 text-xs">
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

/** Filtre çubuğu — içerik (ürün/renk/en) + kimlik (müşteri/sevk no/çuval kodu) + kapsam. */
export function SearchFilters({ filters, onChange }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-6 py-3">
      <LookupSelect
        label="Ürün"
        queryKey="items"
        service={itemService}
        value={filters.itemId}
        onChange={(v) => onChange({ itemId: v })}
      />
      <LookupSelect
        label="Renk"
        queryKey="colors"
        service={colorService}
        value={filters.colorId}
        onChange={(v) => onChange({ colorId: v })}
      />
      <Input
        type="number"
        min={1}
        value={filters.width ?? ""}
        onChange={(e) => onChange({ width: e.target.value === "" ? undefined : Number(e.target.value) })}
        placeholder="En (cm)"
        className="h-8 w-24 text-xs"
      />
      <LookupSelect
        label="Müşteri"
        queryKey="customers"
        service={customerService}
        value={filters.customerId}
        onChange={(v) => onChange({ customerId: v })}
      />
      <Input
        value={filters.shipmentNo ?? ""}
        onChange={(e) => onChange({ shipmentNo: e.target.value || undefined })}
        placeholder="Sevk no"
        className="h-8 w-32 text-xs"
      />
      <Input
        value={filters.sackCode ?? ""}
        onChange={(e) => onChange({ sackCode: e.target.value || undefined })}
        placeholder="Çuval kodu (AMB…)"
        className="h-8 w-36 text-xs"
      />
      <div className="ml-auto">
        <Select
          value={filters.scope ?? "POOL"}
          onValueChange={(v) => onChange({ scope: v as SackSearchScope })}
        >
          <SelectTrigger className="h-8 w-auto min-w-[170px] gap-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCOPES.map((s) => (
              <SelectItem key={s} value={s}>
                {scopeLabels[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
