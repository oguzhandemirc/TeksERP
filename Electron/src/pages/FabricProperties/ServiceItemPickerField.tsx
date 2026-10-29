import { useState } from "react";
import { Check, ChevronsUpDown, Receipt } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { serviceItemLabel, type ServiceItemOption } from "./serviceMapping";

interface Props {
  value: string | null;
  onChange: (next: string | null) => void;
  /** Yalnız aktif SERVICE kalemleri (sayfa tek sorguyla yükler). */
  items: readonly ServiceItemOption[];
  /** Boş seçimin metni ("Eşleme yok" ya da "Özelliğe düşer"). */
  noneLabel: string;
  className?: string;
  ariaLabel?: string;
}

/** Hizmet kalemi seçici: tetik düğme → modal liste (combobox YOK — UI tercihi). */
export function ServiceItemPickerField({ value, onChange, items, noneLabel, className, ariaLabel }: Props) {
  const [open, setOpen] = useState(false);
  const pick = (next: string | null) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        aria-label={ariaLabel ?? "Hizmet kalemi seç"}
        onClick={() => setOpen(true)}
        className={cn(
          "flex min-w-0 items-center gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm transition-colors hover:border-primary/40 hover:bg-muted/50",
          className,
        )}
      >
        <Receipt className="h-4 w-4 shrink-0 text-primary" />
        <span className={cn("min-w-0 flex-1 truncate", !value && "text-muted-foreground")}>
          {value ? serviceItemLabel(value, items) : noneLabel}
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Hizmet kalemi</DialogTitle>
            <DialogDescription>
              Faturada bu işin hangi hizmet kalemiyle kesileceği. Yalnız aktif Hizmet türü kalemler
              listelenir; fiyat Kalem Fiyatları ekranından girilir.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-1 overflow-auto" role="listbox">
            <PickRow label={noneLabel} active={value === null} onClick={() => pick(null)} />
            {items.map((it) => (
              <PickRow
                key={it.id}
                label={`${it.code} — ${it.name}`}
                active={value === it.id}
                onClick={() => pick(it.id)}
              />
            ))}
            {items.length === 0 && (
              <div className="px-2 py-4 text-sm text-muted-foreground">
                Aktif hizmet kalemi yok. Ürünler ekranında Tür: Hizmet ile bir kalem açın.
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Kapat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PickRow({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50",
        active && "border-primary bg-primary/5",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
    </button>
  );
}
