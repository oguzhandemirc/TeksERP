// Çoklu kişi seçici — doğrudan modal (combobox yok; UI tercihi). Aday listesi yönetici ucundan gelir.
import { useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { foldedIncludes } from "@/lib/search-fold";
import type { MemberCandidate } from "@/services/bildirimProfilService";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  candidates: readonly MemberCandidate[];
  /** Zaten listede olanlar — seçilemez, "ekli" yazar. */
  exclude: ReadonlySet<string>;
  onConfirm: (ids: string[]) => void;
}

export function UserPickerDialog({ open, onOpenChange, title, candidates, exclude, onConfirm }: Props) {
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const change = (next: boolean) => {
    if (next) {
      setSearch("");
      setPicked(new Set());
    }
    onOpenChange(next);
  };
  const shown = candidates.filter((c) => foldedIncludes(`${c.ad} ${c.kullaniciAdi}`, search));
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{candidates.length} kişi · birden çok seçilebilir</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ad ya da kullanıcı adı ara…" className="pl-8" />
        </div>
        <ul className="max-h-80 space-y-0.5 overflow-y-auto" aria-label="Kişiler">
          {shown.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">Eşleşen kişi yok.</li>}
          {shown.map((c) => {
            const added = exclude.has(c.id);
            return (
              <li key={c.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-muted has-[:disabled]:cursor-default has-[:disabled]:opacity-60">
                  <Checkbox checked={added || picked.has(c.id)} disabled={added} onCheckedChange={() => toggle(c.id)} aria-label={c.ad} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{c.ad}</span>
                    <span className="block truncate text-xs text-muted-foreground">{c.kullaniciAdi}</span>
                  </span>
                  {added && <span className="text-xs text-muted-foreground">ekli</span>}
                </label>
              </li>
            );
          })}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => change(false)}>Vazgeç</Button>
          <Button
            disabled={picked.size === 0}
            onClick={() => {
              onConfirm([...picked]);
              change(false);
            }}
          >
            {picked.size > 0 ? `${picked.size} kişiyi ekle` : "Ekle"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
