import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { toneFor } from "@/lib/station-colors";
import { loadAllForPicker } from "@/lib/picker-loader";
import { stationService } from "@/pages/Stations/service";
import { workOrderStatusLabels, type WorkOrderStatus } from "@/types/enums";
import { LOCATION_CLASS_FILTER_OPTIONS, needsFasonTag, stationsForLocationFilter } from "./location";

// "Durum" süzgeci üç grup taşır, her grup AYRI sunucu anahtarına yazar (CSV):
//   Durum → filter[status] · Şu an nerede → filter[konumIstasyon] · Özel → filter[konumSinifi].
// Gruplar arası VE, grup içi VEYA (backend `workorder-location.helper`). Süzme sunucuda.

const STATUS_KEYS: WorkOrderStatus[] = ["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
type GroupKey = "status" | "konumIstasyon" | "konumSinifi";
const GROUP_KEYS: GroupKey[] = ["status", "konumIstasyon", "konumSinifi"];
const GROUP_PREFIX: Record<GroupKey, string> = { status: "Durum", konumIstasyon: "Nerede", konumSinifi: "Konum" };

function readCsv(sp: URLSearchParams, key: GroupKey): string[] {
  const v = sp.get(`filter[${key}]`);
  return v ? v.split(",").filter(Boolean) : [];
}

function useStatusLocationState() {
  const [sp, setSp] = useSearchParams();
  const stationsQ = useQuery({ queryKey: ["stations", "picker"], queryFn: () => loadAllForPicker(stationService) });
  const stations = useMemo(() => stationsForLocationFilter(stationsQ.data?.data ?? []), [stationsQ.data]);
  const selected = Object.fromEntries(GROUP_KEYS.map((k) => [k, readCsv(sp, k)])) as Record<GroupKey, string[]>;

  const labelOf = (key: GroupKey, value: string): string => {
    if (key === "status") return workOrderStatusLabels[value as WorkOrderStatus] ?? value;
    if (key === "konumSinifi") return LOCATION_CLASS_FILTER_OPTIONS.find((o) => o.value === value)?.label ?? value;
    // Seçili istasyon pasife alındıysa listede yoktur — ham id yerine nötr ad.
    return stationsQ.data?.data.find((s) => s.id === value)?.name ?? "İstasyon";
  };

  const write = (key: GroupKey, values: string[]) => {
    const next = new URLSearchParams(sp);
    if (values.length === 0) next.delete(`filter[${key}]`);
    else next.set(`filter[${key}]`, values.join(","));
    setSp(next, { replace: true });
  };
  const toggle = (key: GroupKey, value: string) => {
    const cur = selected[key];
    write(key, cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]);
  };
  const clearAll = () => {
    const next = new URLSearchParams(sp);
    for (const k of GROUP_KEYS) next.delete(`filter[${k}]`);
    setSp(next, { replace: true });
  };
  const count = GROUP_KEYS.reduce((n, k) => n + selected[k].length, 0);
  return { stations, stationsError: stationsQ.isError, selected, labelOf, toggle, clearAll, count };
}

function Item({ on, onSelect, children, value }: { on: boolean; onSelect: () => void; children: ReactNode; value: string }) {
  return (
    <CommandItem value={value} onSelect={onSelect} className="py-1.5 text-xs">
      <Check className={cn("mr-2 h-3.5 w-3.5", on ? "opacity-100" : "opacity-0")} />
      {children}
    </CommandItem>
  );
}

export function StatusLocationFilter() {
  const [open, setOpen] = useState(false);
  const s = useStatusLocationState();
  const label = s.count === 0 ? "Durum" : `Durum (${s.count})`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("h-7 min-w-[140px] justify-between gap-1 px-2 text-xs font-normal", s.count > 0 && "border-primary/50")}
        >
          <span className={cn(s.count === 0 && "text-muted-foreground")}>{label}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandList className="max-h-[420px]">
            <CommandGroup heading="Durum">
              {STATUS_KEYS.map((v) => (
                <Item key={v} value={`status-${v}`} on={s.selected.status.includes(v)} onSelect={() => s.toggle("status", v)}>
                  {workOrderStatusLabels[v]}
                </Item>
              ))}
            </CommandGroup>
            <CommandGroup heading="Şu an nerede">
              {s.stationsError && <div className="px-2 py-1.5 text-xs text-destructive">İstasyonlar yüklenemedi.</div>}
              {s.stations.map((st) => (
                <Item
                  key={st.id}
                  value={`station-${st.id}`}
                  on={s.selected.konumIstasyon.includes(st.id)}
                  onSelect={() => s.toggle("konumIstasyon", st.id)}
                >
                  <span className={cn("mr-2 h-2 w-2 shrink-0 rounded-full", toneFor(st.type, st.kind).solid)} />
                  <span className="truncate">{st.name}</span>
                  {needsFasonTag(st) && <span className="ml-1 text-muted-foreground">(fason)</span>}
                </Item>
              ))}
            </CommandGroup>
            <CommandGroup heading="Özel">
              {LOCATION_CLASS_FILTER_OPTIONS.map((o) => (
                <Item
                  key={o.value}
                  value={`class-${o.value}`}
                  on={s.selected.konumSinifi.includes(o.value)}
                  onSelect={() => s.toggle("konumSinifi", o.value)}
                >
                  {o.label}
                </Item>
              ))}
            </CommandGroup>
          </CommandList>
          {s.count > 0 && (
            <div className="border-t p-1">
              <Button type="button" variant="ghost" size="sm" className="h-7 w-full text-xs" onClick={s.clearAll}>
                Temizle
              </Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Seçim çipleri — listenin üstünde, tek tıkla kaldırılır; seçim yoksa hiç çizilmez. */
export function StatusLocationChips() {
  const s = useStatusLocationState();
  if (s.count === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-1.5 text-xs" data-testid="status-location-chips">
      {GROUP_KEYS.flatMap((k) =>
        s.selected[k].map((v) => (
          <button
            key={`${k}-${v}`}
            type="button"
            onClick={() => s.toggle(k, v)}
            className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 hover:bg-muted"
            title="Kaldır"
          >
            <span className="text-muted-foreground">{GROUP_PREFIX[k]}:</span>
            <span className="font-medium">{s.labelOf(k, v)}</span>
            <X className="h-3 w-3 opacity-60" />
          </button>
        )),
      )}
      {s.count > 1 && (
        <button type="button" onClick={s.clearAll} className="ml-1 text-muted-foreground underline-offset-2 hover:underline">
          Tümünü temizle
        </button>
      )}
    </div>
  );
}
