import { useState } from "react";
import { Check, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { RowFilter } from "./row-filter";

interface Props {
  /** Sayfanın BÜTÜN filtreleri; satırda görünenler tikli. */
  filters: readonly RowFilter[];
  shownIds: ReadonlySet<string>;
  /** Satırda görünen ama dar ekranda (lg altı) satırdan kalkmış boş kutular — orada "Aç" ile açılır. */
  narrowOnly?: ReadonlySet<string>;
  onShow: (f: RowFilter, open: boolean) => void;
  onHide: (f: RowFilter) => void;
  onReset: () => void;
}

/**
 * "+ Filtre": tikli olan satırdadır. Tiksize dokunmak kutuyu ekler (ve açar), tikliye dokunmak
 * kaldırır (değeri temizlenir). Altta "Varsayılana dön". Kaldırırken menü açık kalır (birkaçını art arda).
 */
export function MoreFiltersMenu({ filters, shownIds, narrowOnly, onShow, onHide, onReset }: Props) {
  const [open, setOpen] = useState(false);
  if (filters.length === 0) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground" title="Filtre ekle" aria-label="Filtre ekle">
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden 2xl:inline">Filtre</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="start">
        <div role="menu" aria-label="Filtre ekle">
          {filters.map((f) => {
            const checked = shownIds.has(f.id);
            return (
              <div key={f.id} className="flex items-center">
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={checked}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  onClick={() => {
                    if (checked) return onHide(f);
                    setOpen(false);
                    onShow(f, true);
                  }}
                >
                  <Check className={cn("h-3.5 w-3.5 shrink-0", !checked && "invisible")} aria-hidden />
                  <span className="truncate">{f.label}</span>
                </button>
                {narrowOnly?.has(f.id) && (
                  <button
                    type="button"
                    role="menuitem"
                    aria-label={`${f.label} aç`}
                    className="shrink-0 rounded-sm px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent lg:hidden"
                    onClick={() => {
                      setOpen(false);
                      onShow(f, true);
                    }}
                  >
                    Aç
                  </button>
                )}
              </div>
            );
          })}
          <div className="my-1 border-t" />
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
            onClick={() => {
              setOpen(false);
              onReset();
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Varsayılana dön
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
