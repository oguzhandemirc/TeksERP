import { useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useScrollEdges } from "./useScrollEdges";
import { FilterChip } from "./FilterChip";
import { MoreFiltersMenu } from "./MoreFiltersMenu";
import { clearAllKeys, isRowFilterActive, withoutKeys, type RowFilter } from "./row-filter";

export interface FilterRowProps {
  search?: string;
  onSearchChange?: (v: string) => void;
  /** Arama kutusunun yerine (ör. barkod okutma alanı — o da `search` yazar). */
  leading?: ReactNode;
  placeholder?: string;
  /** Her zaman görünen kutular (Görünüm, Termin, Müşteri, Durum…). */
  primary: readonly RowFilter[];
  /** "+ Filtre" altındakiler; etkin olan ya da eklenen satıra kutu olarak çıkar. */
  more?: readonly RowFilter[];
  /** Sağ uç (Sütunlar, kayıtlı görünümler…) — "Temizle"den sonra. */
  trailing?: ReactNode;
}

/**
 * TEK SATIR liste filtre çubuğu (2026-11-06, kullanıcı onaylı tasarım):
 * `[Ara][kutular… + Filtre] … [Temizle][trailing]`. Satır HİÇBİR genişlikte sarmaz:
 * arama küçülür, kutu bölgesi yatay kayar, sağ uç sabit kalır. Açılır listeler ve
 * pencereler portalda çizildiği için kaydırma kabı onları kırpmaz.
 * Bekçi: `FilterRow.test.tsx` (✕ · Temizle · + Filtre · tek satır sınıf sözleşmesi).
 */
export const FILTER_ROW_CLASS = "flex shrink-0 flex-nowrap items-center gap-2 border-b px-3 py-2";
export const FILTER_ROW_SCROLL_CLASS = "flex min-w-0 shrink flex-nowrap items-center gap-1.5 overflow-x-auto py-0.5 [scrollbar-width:thin]";

export function FilterRow({ search = "", onSearchChange, leading, placeholder = "Ara...", primary, more = [], trailing }: FilterRowProps) {
  const [sp, setSp] = useSearchParams();
  const [pinned, setPinned] = useState<string[]>([]);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const edges = useScrollEdges(scrollRef);
  const visibleMore = more.filter((f) => pinned.includes(f.id) || isRowFilterActive(f, sp));
  const hidden = more.filter((f) => !visibleMore.includes(f));
  const all = [...primary, ...more];
  const anyActive = all.some((f) => isRowFilterActive(f, sp));
  // Dar ekranda (lg altı) satırda yalnız etkin/eklenmiş kutular kalır; boş kalıcı kutular "+ Filtre"ye geçer
  // ki etkin süzgeç kaymaya düşüp gizlenmesin.
  const idlePrimary = primary.filter((f) => !isRowFilterActive(f, sp) && !pinned.includes(f.id));
  const narrowOnly = new Set(idlePrimary.map((f) => f.id));

  const remove = (f: RowFilter) => {
    if (f.keys.length > 0) setSp(withoutKeys(sp, f.keys), { replace: true });
    f.onClear?.();
    setPinned((p) => p.filter((id) => id !== f.id));
  };
  const clearAll = () => {
    const active = all.filter((f) => isRowFilterActive(f, sp));
    setSp(withoutKeys(sp, clearAllKeys(all, sp)), { replace: true });
    for (const f of active) f.onClear?.();
    setPinned([]);
  };
  const add = (f: RowFilter) => {
    if (f.onAdd) return f.onAdd();
    setPinned((p) => (p.includes(f.id) ? p : [...p, f.id]));
    setJustAdded(f.id);
  };

  const chip = (f: RowFilter, extra: boolean, narrowHide = false) => {
    const active = isRowFilterActive(f, sp);
    return (
      <FilterChip key={f.id} id={f.id} label={f.label} active={active} removable={active || extra} onRemove={() => remove(f)} className={narrowHide ? "hidden lg:inline-flex" : undefined}>
        {f.render({ autoOpen: justAdded === f.id })}
      </FilterChip>
    );
  };

  return (
    <div data-testid="filter-row" className={FILTER_ROW_CLASS}>
      {leading ?? (onSearchChange && <RowSearch value={search} onChange={onSearchChange} placeholder={placeholder} />)}
      <div ref={scrollRef} data-testid="filter-row-scroll" className={cn(FILTER_ROW_SCROLL_CLASS, fadeClass(edges))}>
        {primary.map((f) => chip(f, pinned.includes(f.id), narrowOnly.has(f.id)))}
        {visibleMore.map((f) => chip(f, true))}
      </div>
      {/* Kayan bölgenin DIŞINDA: dar ekranda kutular kaysa da ekleme düğmesi görünür kalır. */}
      <MoreFiltersMenu filters={[...idlePrimary, ...hidden]} onPick={add} narrowOnly={narrowOnly} />
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {anyActive && (
          <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={clearAll} title="Bütün filtreleri kaldır" aria-label="Temizle">
            <X className="h-3.5 w-3.5" />
            <span className="hidden 2xl:inline">Temizle</span>
          </Button>
        )}
        {trailing}
      </div>
    </div>
  );
}

/** Taşan kenar soluklaşır (CSS mask) — içerik kesik değil, kaydırılabilir. */
function fadeClass({ left, right }: { left: boolean; right: boolean }): string | undefined {
  if (left && right) return "[mask-image:linear-gradient(to_right,transparent,black_24px,black_calc(100%-24px),transparent)]";
  if (right) return "[mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)]";
  if (left) return "[mask-image:linear-gradient(to_right,transparent,black_24px)]";
  return undefined;
}

function RowSearch({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    // Dar ekranda ilk küçülen arama: taban 7rem, 2xl altında 10rem, üstünde 16rem (etkin kutulara yer).
    <div className="relative w-28 min-w-[7rem] shrink sm:w-40 2xl:w-64">
      <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} title={placeholder} aria-label="Ara" className="h-8 pl-8 text-sm" />
    </div>
  );
}
