import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateRangeInput } from "@/components/forms/DateRangeInput";
import { cn } from "@/lib/utils";
import type { FilterDef } from "../FilterBar";
import { DATE_PRESET_LABELS, applyDatePreset, datePresetText, readDatePreset, type DatePresetId, type DatePresetState } from "./date-preset";

type DateDef = Extract<FilterDef, { kind: "dateRange" }>;

export interface DatePresetFilterProps {
  def: DateDef;
  /** "Geçmiş" seçeneği yalnız bu tarih alanında anlamlı (ör. termin); etiketi alanın diliyle. */
  past?: { field: string; label: string };
  autoOpen?: boolean;
}

const QUICK: DatePresetId[] = ["all", "today", "last7", "last30"];

/**
 * Tarih kutusu — tıklayınca PENCERE (combobox yok, kullanıcı tercihi): Tümü · Bugün · Son 7 gün ·
 * Son 30 gün · [Geçmiş] · Tarih aralığı. Hazır seçim tek tıkla uygulanır; aralık "Uygula" ister.
 * Birden çok tarih alanı varsa (Termin / Sipariş tarihi) pencerenin başında seçilir, kutu adı alandır.
 */
export function DatePresetFilter({ def, past, autoOpen }: DatePresetFilterProps) {
  const [sp, setSp] = useSearchParams();
  const [open, setOpen] = useState(Boolean(autoOpen));
  const current = readDatePreset(sp, def.defaultField);
  const fields = def.fieldOptions ?? [{ value: def.defaultField, label: def.label }];
  const fieldLabel = (f: string) => fields.find((o) => o.value === f)?.label ?? def.label;
  const pastLabel = past && current.field === past.field ? past.label : undefined;
  const label = current.id === "all" ? def.label : fieldLabel(current.field);

  return (
    <>
      <DatePresetTrigger text={`${label}: ${datePresetText(current, pastLabel)}`} onClick={() => setOpen(true)} />
      <DatePresetDialog
        open={open}
        onOpenChange={setOpen}
        title={def.label}
        value={current}
        fields={fields}
        past={past}
        idPrefix={`${def.defaultField}-pencere`}
        onCommit={(st) => setSp(applyDatePreset(sp, st), { replace: true })}
      />
    </>
  );
}

/** Kutu tetiği (çerçeveyi `FilterChip` çizer). */
export function DatePresetTrigger({ text, onClick }: { text: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="h-7 min-w-0 gap-1 border-0 bg-transparent px-2 text-xs font-normal shadow-none hover:bg-transparent"
    >
      <CalendarDays className="h-3.5 w-3.5 shrink-0 opacity-60" />
      <span>{text}</span>
    </Button>
  );
}

export interface DatePresetDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  value: DatePresetState;
  onCommit: (st: DatePresetState) => void;
  fields?: { value: string; label: string }[];
  past?: { field: string; label: string };
  idPrefix: string;
}

/** Denetimli pencere çekirdeği: URL'li kutu (`DatePresetFilter`) ve yerel durumlu süzgeçler (`DayRangeFilter`) aynı pencereyi açar. */
export function DatePresetDialog({ open, onOpenChange, title, value, onCommit, fields = [], past, idPrefix }: DatePresetDialogProps) {
  const [draft, setDraft] = useState<DatePresetState>(value);
  // Açılışta taslak güncel değerden başlar (önceki açılışın yarım girişi taşınmaz).
  const [seenOpen, setSeenOpen] = useState(open);
  if (open !== seenOpen) {
    setSeenOpen(open);
    if (open) setDraft(value);
  }
  const commit = (st: DatePresetState) => {
    onCommit(st);
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-dirty-ignore="">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{fields.length > 1 ? "Tarih türünü seçin; hazır seçim tek tıkla uygulanır." : "Hazır seçim tek tıkla uygulanır."}</DialogDescription>
        </DialogHeader>
        {fields.length > 1 && <FieldSwitch fields={fields} value={draft.field} onChange={(field) => setDraft((d) => ({ ...d, field }))} />}
        <PresetList draft={draft} past={past} onPick={(id) => (id === "range" ? setDraft((d) => ({ ...d, id })) : commit({ ...draft, id }))} />
        {draft.id === "range" && (
          <DateRangeInput
            from={draft.from}
            to={draft.to}
            onFrom={(from) => setDraft((d) => ({ ...d, from }))}
            onTo={(to) => setDraft((d) => ({ ...d, to }))}
            idPrefix={idPrefix}
          />
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Vazgeç</Button>
          <Button type="button" disabled={draft.id !== "range" || (!draft.from && !draft.to)} onClick={() => commit(draft)}>Uygula</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FieldSwitch({ fields, value, onChange }: { fields: { value: string; label: string }[]; value: string; onChange: (f: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Tarih türü" className="inline-flex rounded-md border p-0.5">
      {fields.map((f) => (
        <button
          key={f.value}
          type="button"
          role="radio"
          aria-checked={value === f.value}
          onClick={() => onChange(f.value)}
          className={cn("flex-1 rounded px-3 py-1 text-sm", value === f.value ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

function PresetList({ draft, past, onPick }: { draft: DatePresetState; past?: { field: string; label: string }; onPick: (id: DatePresetId) => void }) {
  const ids: DatePresetId[] = [...QUICK, ...(past && draft.field === past.field ? (["past"] as const) : []), "range"];
  return (
    <div role="radiogroup" aria-label="Tarih seçimi" className="flex flex-col gap-1">
      {ids.map((id) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={draft.id === id}
          onClick={() => onPick(id)}
          className={cn(
            "rounded-md border px-3 py-2 text-left text-sm hover:bg-accent",
            draft.id === id ? "border-primary bg-primary/10 font-medium" : "border-input",
          )}
        >
          {id === "past" && past ? past.label : DATE_PRESET_LABELS[id]}
        </button>
      ))}
    </div>
  );
}
