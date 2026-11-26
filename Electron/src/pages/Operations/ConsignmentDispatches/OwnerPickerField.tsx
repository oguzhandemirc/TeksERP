// Emanet çıkışında malın sahibi: kutuya tıkla → doğrudan modal. Liste `/owners` ucundan — yalnız emaneti (levent /
// iplik lotu) olan müşteriler; emaneti olmayan müşteri seçilip boş aday listesiyle karşılaşılmaz.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ListFilter, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { cn } from "@/lib/utils";
import { listConsignmentOwners } from "./service";
import type { ConsignmentOwner } from "./types";

interface Props {
  value: string | null;
  onChange: (id: string | null) => void;
}

export const OWNERS_QUERY_KEY = "consignment-owners";

export function OwnerPickerField({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<ConsignmentOwner | null>(null);
  const shown = value && picked?.id === value ? picked : null;
  return (
    <>
      <Button
        type="button"
        variant="outline"
        aria-haspopup="dialog"
        aria-label="Malın sahibini seç"
        className={cn("w-full justify-between font-normal", !shown && "text-muted-foreground")}
        onClick={() => setOpen(true)}
      >
        <span className="truncate">{shown ? `${shown.name} — ${shown.code}` : "Müşteri seç…"}</span>
        <ListFilter className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>
      <OwnerPickerDialog
        open={open}
        onOpenChange={setOpen}
        onPick={(o) => {
          setPicked(o);
          onChange(o.id);
          setOpen(false);
        }}
      />
    </>
  );
}

function OwnerPickerDialog({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (o: ConsignmentOwner) => void }) {
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search, 300).trim();
  const listQ = useQuery({
    queryKey: [OWNERS_QUERY_KEY, q],
    queryFn: () => listConsignmentOwners(q),
    enabled: open,
    staleTime: 0,
  });
  const data = listQ.data;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[37.5rem] max-h-[85vh] max-w-lg flex-col" data-dirty-ignore="">
        <DialogHeader className="shrink-0">
          <DialogTitle>Malın sahibini seç</DialogTitle>
          <DialogDescription>Yalnız fabrikada emanet leventi ya da ipliği olan müşteriler listelenir.</DialogDescription>
        </DialogHeader>
        <div className="relative shrink-0">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Ara (ad / kod)…" value={search} maxLength={64} onChange={(e) => setSearch(e.target.value)} className="h-9 pl-8 text-sm" autoFocus />
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-md border">
          {listQ.isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Yükleniyor…</p>
          ) : listQ.isError || !data ? (
            <div className="p-4 text-sm">
              <p className="text-destructive">Liste yüklenemedi — bu “kayıt yok” demek değildir.</p>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => void listQ.refetch()}>
                Tekrar dene
              </Button>
            </div>
          ) : data.owners.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{q ? "Aramaya uyan, emaneti olan müşteri yok." : "Fabrikada emaneti olan müşteri yok."}</p>
          ) : (
            <ul className="divide-y">
              {data.owners.map((o) => (
                <li key={o.id}>
                  <button type="button" onClick={() => onPick(o)} className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-muted/50">
                    <span className="font-medium">{o.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{o.code}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {data?.truncated && (
          <p className="shrink-0 text-xs text-amber-700 dark:text-amber-400" data-testid="owners-truncated">
            İlk {data.owners.length} müşteri gösteriliyor — aradığınız yoksa aramayı daraltın.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
