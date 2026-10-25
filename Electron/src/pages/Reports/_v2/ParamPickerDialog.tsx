import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { foldedIncludes } from "@/lib/search-fold";
import type { ParametreSecenegi } from "./sunum";

export const ALL_LABEL = "Tümü";
const SEARCH_THRESHOLD = 8;

interface Props {
  open: boolean;
  title: string;
  options: readonly ParametreSecenegi[];
  multiple: boolean;
  /** Seçili değerler; boş = Tümü. */
  selected: readonly string[];
  /** Boş dizi = Tümü (çağıran anahtarı URL'den siler). */
  onApply: (values: string[]) => void;
  onClose: () => void;
  /** "Tümü" seçeneği yoksa (kıyas gibi zorunlu seçim) gizlenir. */
  allowAll?: boolean;
  /** Seçim yokluğunun metni ("Tümü" yerine; ör. kırılımda "Tek"). */
  allLabel?: string;
}

/** Çip seçicisi — doğrudan MODAL (combobox yok); "Tümü" bir seçenek değil, seçim yokluğudur. */
export function ParamPickerDialog({ open, title, options, multiple, selected, onApply, onClose, allowAll = true, allLabel = ALL_LABEL }: Props) {
  const [draft, setDraft] = useState<string[]>([...selected]);
  const [term, setTerm] = useState("");
  // Taslak modal her AÇILIŞTA seçimden kurulur; açıkken üst bileşenin yeniden çizimi taslağı silmesin.
  const selectedKey = selected.join("\u0001");
  useEffect(() => {
    if (open) {
      setDraft(selectedKey ? selectedKey.split("\u0001") : []);
      setTerm("");
    }
  }, [open, selectedKey]);
  const shown = useMemo(() => (term.trim() ? options.filter((o) => foldedIncludes(o.etiket, term)) : options), [options, term]);

  const pick = (value: string) => {
    if (!multiple) {
      onApply([value]);
      onClose();
      return;
    }
    setDraft((d) => (d.includes(value) ? d.filter((v) => v !== value) : [...d, value]));
  };
  const chooseAll = () => {
    onApply([]);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{multiple ? "Birden çok değer seçebilirsiniz." : "Bir değer seçin."}</DialogDescription>
        </DialogHeader>
        {options.length > SEARCH_THRESHOLD ? (
          <Input autoFocus placeholder="Ara…" value={term} onChange={(e) => setTerm(e.target.value)} aria-label={`${title} ara`} />
        ) : null}
        <div className="max-h-80 overflow-auto rounded-md border p-1" role="listbox" aria-multiselectable={multiple}>
          {allowAll ? (
            <OptionRow label={allLabel} active={(multiple ? draft : selected).length === 0} onClick={chooseAll} />
          ) : null}
          {shown.map((o) => (
            <OptionRow key={o.deger} label={o.etiket} active={(multiple ? draft : selected).includes(o.deger)} onClick={() => pick(o.deger)} />
          ))}
          {shown.length === 0 ? <p className="px-2 py-3 text-sm text-muted-foreground">Eşleşen değer yok.</p> : null}
        </div>
        {multiple ? (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Vazgeç
            </Button>
            <Button
              type="button"
              onClick={() => {
                onApply(draft);
                onClose();
              }}
            >
              Uygula
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function OptionRow({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      className={cn("flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted", active && "font-medium")}
    >
      <Check className={cn("h-4 w-4 shrink-0", active ? "opacity-100" : "opacity-0")} />
      <span className="truncate">{label}</span>
    </button>
  );
}
