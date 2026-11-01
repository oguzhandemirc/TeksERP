// Barkod serisi biçim alanları (D4-F2) — panelden ayrı: alanlar pasifken de bugünkü biçimi gösterir.
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SEGMENTLER } from "@/pages/GeneralSettings/Numbering/NumberingFields";
import type { SeriesDateSegment } from "@/pages/GeneralSettings/Numbering/types";
import { SEPARATOR_OPTIONS, type BarcodeSeriesForm } from "./barcodeSeriesService";

/** Select boş değer taşıyamaz — "ayraç yok" bu anahtarla temsil edilir. */
const NO_SEPARATOR = "__none__";
const SEPARATOR_ITEMS = SEPARATOR_OPTIONS.map((s) => ({ value: s.value || NO_SEPARATOR, label: s.label }));

type Setter = <K extends keyof BarcodeSeriesForm>(k: K, v: BarcodeSeriesForm[K]) => void;

interface Props {
  form: BarcodeSeriesForm;
  set: Setter;
  disabled: boolean;
  /** Etkinlik kutusu yalnız kayıtlı seride (yaratma her zaman etkin). */
  showActive: boolean;
}

function TextField(props: { id: string; label: string; value: string; disabled: boolean; numeric?: boolean; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Input
        id={props.id}
        type={props.numeric ? "number" : "text"}
        min={props.numeric ? 1 : undefined}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  );
}

function ChoiceField(props: { label: string; value: string; disabled: boolean; items: ReadonlyArray<{ value: string; label: string }>; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label>{props.label}</Label>
      <Select value={props.value} disabled={props.disabled} onValueChange={props.onChange}>
        <SelectTrigger aria-label={props.label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {props.items.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function BarcodeSeriesFields({ form, set, disabled, showActive }: Props) {
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <TextField id="mbs-prefix" label="Ön ek" value={form.prefix} disabled={disabled} onChange={(v) => set("prefix", v.toUpperCase().slice(0, 16))} />
        <ChoiceField label="Tarih parçası" value={form.dateSegment} disabled={disabled} items={SEGMENTLER} onChange={(v) => set("dateSegment", v as SeriesDateSegment)} />
        <TextField id="mbs-digits" label="Hane" numeric value={form.digits} disabled={disabled} onChange={(v) => set("digits", v)} />
        <ChoiceField
          label="Ayraç"
          value={form.separator || NO_SEPARATOR}
          disabled={disabled}
          items={SEPARATOR_ITEMS}
          onChange={(v) => set("separator", v === NO_SEPARATOR ? "" : v)}
        />
        <TextField id="mbs-start" label="Başlangıç (boş = 1)" numeric value={form.startValue} disabled={disabled} onChange={(v) => set("startValue", v)} />
        <TextField id="mbs-max" label="Üst sınır (boş = sınırsız)" numeric value={form.maxValue} disabled={disabled} onChange={(v) => set("maxValue", v)} />
      </div>
      {showActive && (
        <label className="flex items-center gap-2">
          <Checkbox checked={form.isActive} disabled={disabled} onCheckedChange={(v) => set("isActive", v === true)} aria-label="Seri etkin" />
          Seri etkin
        </label>
      )}
    </>
  );
}
