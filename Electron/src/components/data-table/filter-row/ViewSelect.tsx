import { useState } from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";

export interface ViewOption {
  /** `null` = "Tümü" (süzgeç yok). */
  value: string | null;
  label: string;
}

/**
 * "Görünüm" — hızlı sekmeleri TEK açılıra toplar; seçeneğin yanında sayı (seçilince
 * listenin toplamı). Sayılar yalnız liste AÇIKKEN istenir (`onOpenChange`), kapalı
 * kutu istek atmaz. Kutu kipinde (FilterChip içinde) çizilir.
 */
export function ViewSelect({
  label,
  options,
  value,
  onChange,
  counts,
  onOpenChange,
  autoOpen,
}: {
  label: string;
  options: readonly ViewOption[];
  value: string | null;
  onChange: (v: string | null) => void;
  /** Değer → sayı; `undefined` yükleniyor, `null` sayılamadı (yazılmaz). */
  counts?: ReadonlyMap<string | null, number | null | undefined>;
  onOpenChange?: (open: boolean) => void;
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(autoOpen));
  const current = options.find((o) => o.value === value) ?? options[0];
  const toggle = (o: boolean) => {
    setOpen(o);
    onOpenChange?.(o);
  };
  return (
    <Popover open={open} onOpenChange={toggle}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 min-w-0 gap-1 border-0 bg-transparent px-2 text-xs font-normal shadow-none hover:bg-transparent"
        >
          <span>{`${label}: ${current?.label ?? ""}`}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-1" align="start">
        <div role="listbox" aria-label={label}>
          {options.map((o) => (
            <ViewOptionRow
              key={o.label}
              option={o}
              selected={o.value === value}
              count={counts?.get(o.value)}
              showCount={counts !== undefined}
              onPick={() => {
                onChange(o.value);
                toggle(false);
              }}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ViewOptionRow({
  option,
  selected,
  count,
  showCount,
  onPick,
}: {
  option: ViewOption;
  selected: boolean;
  count: number | null | undefined;
  showCount: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onPick}
      className={cn(
        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
        selected && "font-medium",
      )}
    >
      <Check className={cn("h-3.5 w-3.5 shrink-0", selected ? "opacity-100" : "opacity-0")} />
      <span className="flex-1">{option.label}</span>
      {showCount &&
        (count === undefined ? (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-label="Sayılıyor" />
        ) : count === null ? null : (
          <span className="tabular-nums text-xs text-muted-foreground">{formatNumber(count, 0)}</span>
        ))}
    </button>
  );
}
