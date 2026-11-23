import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DateRangeInput } from "@/components/forms/DateRangeInput";
import { formatCalendarDay } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
import { FilterChip } from "./FilterChip";

/**
 * Ortak "Gün: Bugün ▾" kutusu — sayfanın kendi hazır seçenekleri (Bugün/Dün/Bu hafta/Tümü…) tek açılırda,
 * en altta "Tarih aralığı…" seçilince aralık girdisi AYNI açılırın içinde açılır. Hazır seçim değerleri
 * sayfanındır (URL/sorgu değişmez); yan yana düğme grubu yerine kullanılır (kullanıcı 2026-11-23).
 */
export function DayPresetChip<T extends string>({
  id,
  label = "Gün",
  presets,
  value,
  rangeValue,
  resetValue,
  from,
  to,
  onPreset,
  onRange,
}: {
  id: string;
  label?: string;
  presets: readonly { value: T; label: string }[];
  value: T;
  /** Aralık kipini temsil eden değer (ör. "aralik"). */
  rangeValue: T;
  /** ✕'in döndüğü varsayılan (ör. "bugun"). */
  resetValue: T;
  from: string;
  to: string;
  onPreset: (v: T) => void;
  onRange: (r: { from: string; to: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showRange, setShowRange] = useState(value === rangeValue);
  const isRange = value === rangeValue;
  const text = isRange ? rangeText(from, to) : (presets.find((p) => p.value === value)?.label ?? "");
  const active = value !== resetValue;
  return (
    <FilterChip id={id} label={label} active={active} removable={active} onRemove={() => onPreset(resetValue)}>
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setShowRange(isRange); }}>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="h-7 min-w-0 gap-1 border-0 bg-transparent px-2 text-xs font-normal shadow-none hover:bg-transparent">
            <span>
              <span className="text-muted-foreground">{label}: </span>
              {text}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className={cn("p-1", showRange ? "w-auto" : "w-56")} align="start">
          <div role="listbox" aria-label={label}>
            {presets.map((p) => (
              <Row key={p.value} label={p.label} selected={!isRange && p.value === value} onPick={() => { onPreset(p.value); setOpen(false); }} />
            ))}
            <Row label="Tarih aralığı…" selected={isRange} onPick={() => setShowRange(true)} />
          </div>
          {showRange && (
            <div className="border-t p-2">
              <DateRangeInput
                from={isRange ? from : ""}
                to={isRange ? to : ""}
                onFrom={(v) => onRange({ from: v, to: isRange ? to : "" })}
                onTo={(v) => onRange({ from: isRange ? from : "", to: v })}
                inputClassName="h-8 w-36"
                fromLabel="Başlangıç"
                toLabel="Bitiş"
                idPrefix={`${id}-aralik`}
              />
            </div>
          )}
        </PopoverContent>
      </Popover>
    </FilterChip>
  );
}

function rangeText(from: string, to: string): string {
  if (from && to) return `${formatCalendarDay(from)} – ${formatCalendarDay(to)}`;
  if (from) return `${formatCalendarDay(from)} sonrası`;
  if (to) return `${formatCalendarDay(to)} öncesi`;
  return "Tarih aralığı";
}

function Row({ label, selected, onPick }: { label: string; selected: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onPick}
      className={cn("flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none", selected && "font-medium")}
    >
      <Check className={cn("h-3.5 w-3.5 shrink-0", selected ? "opacity-100" : "opacity-0")} />
      <span className="flex-1">{label}</span>
    </button>
  );
}
