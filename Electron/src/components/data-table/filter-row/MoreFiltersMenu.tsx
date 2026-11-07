import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { RowFilter } from "./row-filter";

/** "+ Filtre": az kullanılan süzgeçler; seçilen satıra kutu olarak eklenir (ya da `onAdd` ile doğrudan etkinleşir). */
/** `narrowOnly`: yalnız dar ekranda (lg altı) listelenenler — orada satırdan kalkan boş kalıcı kutular. */
/** Eklenecek yoksa düğme çizilmez (geniş ekranda yalnız dar-ekran kutuları varsa `lg:hidden`) — boş menü açılmaz. */
export function MoreFiltersMenu({ filters, onPick, narrowOnly }: { filters: readonly RowFilter[]; onPick: (f: RowFilter) => void; narrowOnly?: ReadonlySet<string> }) {
  const [open, setOpen] = useState(false);
  const wideCount = filters.filter((f) => !narrowOnly?.has(f.id)).length;
  if (filters.length === 0) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className={cn("h-8 shrink-0 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground", wideCount === 0 && "lg:hidden")} title="Filtre ekle" aria-label="Filtre ekle">
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden 2xl:inline">Filtre</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-1" align="start">
        <div role="menu" aria-label="Filtre ekle">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              role="menuitem"
              className={cn("flex w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none", narrowOnly?.has(f.id) && "lg:hidden")}
              onClick={() => {
                setOpen(false);
                onPick(f);
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
