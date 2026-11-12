import { useRef, useState, type ReactNode } from "react";
import type { Table } from "@tanstack/react-table";
import { useLocation, useSearchParams } from "react-router-dom";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { searchLabels } from "@/lib/search-placeholder";
import { DataTableTools, type ExtraExportOption } from "../DataTableTools";
import type { TableFetchAll } from "../DataTableExportMenu";
import { useScrollEdges } from "./useScrollEdges";
import { FilterChip } from "./FilterChip";
import { MoreFiltersMenu } from "./MoreFiltersMenu";
import { clearAllKeys, isRowFilterActive, withoutKeys, type RowFilter } from "./row-filter";
import { isShown, isToggleFilter, useFilterRowVisibility, withOverride } from "./filter-visibility";

export interface FilterRowProps {
  search?: string;
  onSearchChange?: (v: string) => void;
  /** Arama kutusunun yerine (ör. barkod okutma alanı — o da `search` yazar). */
  leading?: ReactNode;
  /** Kısa yer tutucu (≤20 karakter; uzunu "Ara…"ya düşer ve ipucuna taşınır). */
  placeholder?: string;
  /** Neyin arandığının tam cümlesi — kutunun `title` + `aria-label`ı. */
  searchHint?: string;
  /**
   * Listenin tablosu — verilince sağ uçta STANDART "Sütunlar" (aç/kapa · taşı · sıfırla) + "Dışa aktar" çizilir.
   * Tablo çizen her liste bunu verir (bekçi `liste-standardi.test.ts`).
   */
  tools?: ListTools;
  /** İlk açılışta görünen kutular (Görünüm, Termin, Müşteri, Durum…) — çakılı değil, kullanıcı "+ Filtre"den kaldırabilir. */
  primary: readonly RowFilter[];
  /** İlk açılışta gizli olanlar; etkin olan ya da kullanıcının eklediği satıra kutu olarak çıkar. */
  more?: readonly RowFilter[];
  /** Görünürlük kaydının sayfa kimliği; verilmezse pathname. */
  viewKey?: string;
  /** Sağ uç (Sütunlar, kayıtlı görünümler…) — "Temizle"den sonra. */
  trailing?: ReactNode;
}

/**
 * TEK SATIR liste filtre çubuğu (2026-11-06, kullanıcı onaylı tasarım):
 * `[Ara][kutular… + Filtre] … [Temizle][trailing]`. Satır HİÇBİR genişlikte sarmaz:
 * arama küçülür, kutu bölgesi yatay kayar, sağ uç sabit kalır. Açılır listeler ve
 * pencereler portalda çizildiği için kaydırma kabı onları kırpmaz.
 * Çakılı kutu yok (2026-11-10): "+ Filtre" bütün filtreleri tikli listeler; seçim sayfa başına kalıcı (`filter-visibility.ts`).
 * Bekçi: `FilterRow.test.tsx` (✕ · Temizle · + Filtre tik/kalıcılık · tek satır sınıf sözleşmesi).
 */
export const FILTER_ROW_CLASS = "flex shrink-0 flex-nowrap items-center gap-2 border-b px-3 py-2";
export const FILTER_ROW_SCROLL_CLASS = "flex min-w-0 shrink flex-nowrap items-center gap-1.5 overflow-x-auto py-0.5 [scrollbar-width:thin]";

/** Ortak araç çubuğunun tablo araçları — `DataTableTools` sözleşmesi (tablo tipi sayfadan bağımsız). */
export interface ListTools {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- satır tipi sayfaya özgü; araçlar yalnız sütun düzenini okur
  table: Table<any>;
  exportName?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- yukarıdakiyle aynı
  fetchAll?: TableFetchAll<any>;
  hideExport?: boolean;
  extraExports?: ExtraExportOption[];
}

export function FilterRow({ search = "", onSearchChange, leading, placeholder, searchHint, tools, primary, more = [], trailing, viewKey }: FilterRowProps) {
  const [sp, setSp] = useSearchParams();
  const { pathname } = useLocation();
  const { overrides, write } = useFilterRowVisibility(viewKey ?? pathname);
  /** Bu oturumda menüden açılanlar: dar ekranda da satırda kalır. */
  const [pinned, setPinned] = useState<string[]>([]);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const edges = useScrollEdges(scrollRef);
  const primaryIds = new Set(primary.map((f) => f.id));
  const all = [...primary, ...more];
  const defaultShown = (f: RowFilter) => primaryIds.has(f.id) && !isToggleFilter(f);
  // Oturumda açılan kutu tercih yazımı dönmeden de satırdadır.
  const shown = all.filter((f) => pinned.includes(f.id) || isShown(f, defaultShown(f), overrides, isRowFilterActive(f, sp)));
  const shownIds = new Set(shown.map((f) => f.id));
  const anyActive = all.some((f) => isRowFilterActive(f, sp));
  // Dar ekranda (lg altı) satırda yalnız etkin/açılmış kutular kalır; boş kutular "+ Filtre"den açılır
  // ki etkin süzgeç kaymaya düşüp gizlenmesin.
  const narrowOnly = new Set(shown.filter((f) => !isRowFilterActive(f, sp) && !pinned.includes(f.id)).map((f) => f.id));

  /** Gizlenen kutu değerini taşımaz: gizli filtre listeyi sessizce süzmesin (tek where). */
  const clearValues = (fs: readonly RowFilter[]) => {
    const keys = fs.flatMap((f) => f.keys).filter((k) => sp.has(k));
    if (keys.length > 0) setSp(withoutKeys(sp, keys), { replace: true });
    for (const f of fs) if (isRowFilterActive(f, sp)) f.onClear?.();
  };
  const hide = (f: RowFilter) => {
    clearValues([f]);
    setPinned((p) => p.filter((id) => id !== f.id));
    if (!isToggleFilter(f)) write((ov) => withOverride(ov, f.id, false, defaultShown(f)));
  };
  const show = (f: RowFilter, open: boolean) => {
    if (f.onAdd) return f.onAdd();
    write((ov) => withOverride(ov, f.id, true, defaultShown(f)));
    if (open) {
      setPinned((p) => (p.includes(f.id) ? p : [...p, f.id]));
      setJustAdded(f.id);
    }
  };
  /** ✕: dolu kutuda yalnız değeri siler; kullanıcının eklediği boş kutuyu kapatır. */
  const remove = (f: RowFilter) => {
    if (isRowFilterActive(f, sp)) {
      if (f.keys.length > 0) setSp(withoutKeys(sp, f.keys), { replace: true });
      f.onClear?.();
    } else hide(f);
  };
  const clearAll = () => {
    const active = all.filter((f) => isRowFilterActive(f, sp));
    setSp(withoutKeys(sp, clearAllKeys(all, sp)), { replace: true });
    for (const f of active) f.onClear?.();
    setPinned([]);
  };
  const resetVisibility = () => {
    clearValues(all.filter((f) => !isToggleFilter(f) && !defaultShown(f)));
    write(() => ({}));
    setPinned([]);
  };

  const chip = (f: RowFilter) => {
    const active = isRowFilterActive(f, sp);
    return (
      <FilterChip key={f.id} id={f.id} label={f.label} active={active} removable={active || !defaultShown(f)} onRemove={() => remove(f)} className={narrowOnly.has(f.id) ? "hidden lg:inline-flex" : undefined}>
        {f.render({ autoOpen: justAdded === f.id })}
      </FilterChip>
    );
  };

  return (
    <div data-testid="filter-row" data-list-surface="toolbar" className={FILTER_ROW_CLASS}>
      {leading ?? (onSearchChange && <RowSearch value={search} onChange={onSearchChange} {...searchLabels(placeholder, searchHint)} />)}
      <div ref={scrollRef} data-testid="filter-row-scroll" className={cn(FILTER_ROW_SCROLL_CLASS, fadeClass(edges))}>
        {shown.map(chip)}
      </div>
      {/* Kayan bölgenin DIŞINDA: dar ekranda kutular kaysa da ekleme düğmesi görünür kalır. */}
      <MoreFiltersMenu filters={all} shownIds={shownIds} narrowOnly={narrowOnly} onShow={show} onHide={hide} onReset={resetVisibility} />
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {anyActive && (
          <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={clearAll} title="Bütün filtreleri kaldır" aria-label="Temizle">
            <X className="h-3.5 w-3.5" />
            <span className="hidden 2xl:inline">Temizle</span>
          </Button>
        )}
        {trailing}
        {tools && <DataTableTools compact {...tools} />}
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

function RowSearch({ value, onChange, placeholder, hint }: { value: string; onChange: (v: string) => void; placeholder: string; hint: string }) {
  return (
    // Dar ekranda ilk küçülen arama: taban 7rem, 2xl altında 10rem, üstünde 16rem (etkin kutulara yer).
    <div className="relative w-28 min-w-[7rem] shrink sm:w-40 2xl:w-64">
      <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} title={hint} aria-label={hint} className="h-8 pl-8 text-sm" />
    </div>
  );
}
