import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { RowFilter } from "./row-filter";

/** "+ Filtre": az kullanılan süzgeçler; seçilen satıra kutu olarak eklenir (ya da `onAdd` ile doğrudan etkinleşir). */
export function MoreFiltersMenu({ filters, onPick }: { filters: readonly RowFilter[]; onPick: (f: RowFilter) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground">
          <Plus className="h-3.5 w-3.5" />
          Filtre
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-1" align="start">
        {filters.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">Eklenecek başka filtre yok.</p>
        ) : (
          <div role="menu" aria-label="Filtre ekle">
            {filters.map((f) => (
              <button
                key={f.id}
                type="button"
                role="menuitem"
                className="flex w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                onClick={() => {
                  setOpen(false);
                  onPick(f);
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
