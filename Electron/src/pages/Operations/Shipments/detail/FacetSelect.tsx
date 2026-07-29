import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

/** Çoklu-seçim facet düğmesi (Popover + Command) — sevkiyat detay araç çubuğu ve
 *  iade/sipariş modalları paylaşır. Seçili değerler `selected` (value dizisi). */
export function FacetSelect({
  label,
  options,
  selected,
  onToggle,
  onClear,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (v: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = selected.length === 0 ? label : `${label} (${selected.length})`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={options.length === 0}
          className={cn(
            "h-8 min-w-[110px] justify-between gap-1 px-2 text-xs font-normal",
            selected.length > 0 && "border-primary/50",
          )}
        >
          <span className={cn(selected.length === 0 && "text-muted-foreground")}>{trigger}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder={`${label} ara...`} className="h-8" />
          <CommandList>
            <CommandEmpty>Seçenek yok.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem key={o.value} value={o.label} onSelect={() => onToggle(o.value)}>
                  <Check
                    className={cn(
                      "mr-2 h-3.5 w-3.5",
                      selected.includes(o.value) ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {o.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {selected.length > 0 && (
            <div className="border-t p-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-full justify-center text-xs"
                onClick={onClear}
              >
                Temizle
              </Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
