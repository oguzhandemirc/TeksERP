// "Durum" kutusu — İş Emirleri Durum süzgecinin deseni (Popover + liste, tetik "Durum: …"); TEK seçim, çünkü
// sunucu `status` tek değer alır. Sayılar aynı where'den gelen özet şeridinden (liste ile ayrışmaz).
import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { NOTE_STATUS_LABEL } from "./noteStatus";
import { NOTE_STATUSES, type DeliveryNoteListResponse, type NoteStatus } from "./types";

interface Props {
  value: NoteStatus | null;
  onChange: (s: NoteStatus | null) => void;
  summary: DeliveryNoteListResponse["summary"] | null;
  autoOpen?: boolean;
}

export function NoteStatusFilter({ value, onChange, summary, autoOpen }: Props) {
  const [open, setOpen] = useState(Boolean(autoOpen));
  const pick = (s: NoteStatus | null) => {
    onChange(s);
    setOpen(false);
  };
  const options: { key: NoteStatus | null; label: string; count: number | undefined }[] = [
    { key: null, label: "Tümü", count: summary?.total },
    ...NOTE_STATUSES.map((s) => ({ key: s, label: NOTE_STATUS_LABEL[s], count: summary?.[s] })),
  ];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="Durum süzgeci"
          className="h-7 min-w-0 justify-between gap-1 border-0 bg-transparent px-2 text-xs font-normal shadow-none hover:bg-transparent"
        >
          <span>{value ? `Durum: ${NOTE_STATUS_LABEL[value]}` : "Durum"}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandList>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem key={o.key ?? "all"} value={o.key ?? "all"} onSelect={() => pick(o.key)} className="py-1.5 text-xs">
                  <Check className={cn("mr-2 h-3.5 w-3.5", value === o.key ? "opacity-100" : "opacity-0")} />
                  <span className="flex-1">{o.label}</span>
                  {o.count !== undefined && <span className="ml-2 tabular-nums text-muted-foreground">{o.count}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
