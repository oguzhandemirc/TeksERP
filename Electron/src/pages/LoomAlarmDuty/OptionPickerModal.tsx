// Küçük, yerel liste için "ara-ve-seç" modalı — seçici doğrudan modal açar (combobox yok; UI tercihi).
// Sunucu sayfalaması gerekmeyen listeler (aday kişiler, yetki kataloğu, vardiya pencereleri) için.
import { useState } from "react";
import { AlertTriangle, ChevronsUpDown, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { foldedIncludes } from "@/lib/search-fold";
import { cn } from "@/lib/utils";

export interface PickerOption {
  id: string;
  label: string;
  subLabel?: string | null;
  /** Seçilebilir ama uyarılı (ör. alarmı göremeyen kişi). */
  warning?: string | null;
}

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: readonly PickerOption[];
  title: string;
  value?: string | null;
  onPick: (id: string) => void;
}

function OptionRow({ o, active, onClick }: { o: PickerOption; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn("w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted", active && "bg-primary/10")}>
      <div className="font-medium">{o.label}</div>
      {o.subLabel && <div className="text-xs text-muted-foreground">{o.subLabel}</div>}
      {o.warning && (
        <div className="mt-0.5 flex items-center gap-1 text-xs text-amber-600">
          <AlertTriangle className="h-3 w-3" /> {o.warning}
        </div>
      )}
    </button>
  );
}

/** Denetimli seçim penceresi — bir düğme ya da hücre doğrudan açar. */
export function OptionPickerDialog({ open, onOpenChange, options, title, value = null, onPick }: DialogProps) {
  const [search, setSearch] = useState("");
  const shown = options.filter((o) => foldedIncludes(`${o.label} ${o.subLabel ?? ""}`, search));
  const change = (next: boolean) => {
    if (next) setSearch("");
    onOpenChange(next);
  };
  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{options.length} seçenek</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ara…" className="pl-8" />
        </div>
        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {shown.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">Eşleşen yok.</li>}
          {shown.map((o) => (
            <li key={o.id}>
              <OptionRow
                o={o}
                active={o.id === value}
                onClick={() => {
                  onPick(o.id);
                  change(false);
                }}
              />
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

interface FieldProps {
  value: string | null;
  onChange: (id: string) => void;
  options: readonly PickerOption[];
  title: string;
  placeholder: string;
  disabled?: boolean;
}

/** Form alanı: seçili değeri gösteren düğme → modal. */
export function OptionPickerField({ value, onChange, options, title, placeholder, disabled }: FieldProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === value) ?? null;
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className={cn("min-w-0 flex-1 truncate", !selected && "text-muted-foreground")}>{selected?.label ?? placeholder}</span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
      <OptionPickerDialog open={open} onOpenChange={setOpen} options={options} title={title} value={value} onPick={onChange} />
    </>
  );
}
