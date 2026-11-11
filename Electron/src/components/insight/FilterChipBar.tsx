import type { ReactNode } from "react";
import { Check, ChevronDown, RotateCcw } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface FilterChipOption {
  value: string;
  label: string;
}

export interface FilterChipProps {
  /** Ekran okuyucu adı ("Kategori"). */
  label: string;
  /** Seçili değer; `null` = hepsi. */
  value: string | null;
  options: readonly FilterChipOption[];
  /** "Hepsi" seçeneğinin ve boş çipin metni ("Tüm kategoriler"); verilmezse "hepsi" seçeneği yok. */
  allLabel?: string;
  onChange: (value: string | null) => void;
}

const CHIP = "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Açılır süzgeç çipi — seçim yapılınca vurgulanır. */
export function FilterChip({ label, value, options, allLabel, onChange }: FilterChipProps) {
  const selected = options.find((o) => o.value === value);
  const text = selected?.label ?? allLabel ?? label;
  const items: Array<{ value: string | null; label: string }> = [...(allLabel ? [{ value: null, label: allLabel }] : []), ...options];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${label}: ${text}`}
        className={cn(CHIP, selected ? "border-primary/50 bg-primary-soft text-primary-soft-foreground" : "border-input bg-card")}
      >
        {text}
        <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        {items.map((o) => (
          <DropdownMenuItem key={o.value ?? "*"} onSelect={() => onChange(o.value)} className="gap-2 text-sm">
            <Check className={cn("h-3.5 w-3.5", o.value === value ? "opacity-100" : "opacity-0")} aria-hidden />
            {o.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface FilterChipBarProps {
  children: ReactNode;
  /** Verilirse "Sıfırla" düğmesi çizilir; `canReset` false iken pasif. */
  onReset?: () => void;
  canReset?: boolean;
  /** Sağ uçtaki birincil eylem ("Özel rapor"). */
  end?: ReactNode;
  label?: string;
}

/** Süzgeç çipi satırı (hedef görsel üst satır): çipler + Sıfırla + sağda birincil eylem. */
export function FilterChipBar({ children, onReset, canReset = true, end, label = "Süzgeçler" }: FilterChipBarProps) {
  return (
    <div role="toolbar" aria-label={label} className="flex flex-wrap items-center gap-2">
      {children}
      {onReset && (
        <button type="button" onClick={onReset} disabled={!canReset} className={cn(CHIP, "border-input bg-card disabled:pointer-events-none disabled:opacity-50")}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Sıfırla
        </button>
      )}
      {end && <div className="ml-auto flex items-center gap-2">{end}</div>}
    </div>
  );
}
