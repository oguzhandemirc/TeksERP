import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateRangeInput } from "@/components/forms/DateRangeInput";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { PrintDayChip, PrintHistoryFilterState } from "@/lib/print-history-query";
import type { PrintOutputKind } from "@/services/printHistoryService";
import {
  PRINT_OUTPUT_LABELS,
  PRINT_SOURCE_LABELS,
  PRINT_STATUS_LABELS,
  PRINT_SUBJECT_LABELS,
} from "@/lib/print-job-format";

export interface FilterOption {
  value: string;
  label: string;
}

interface Props {
  value: PrintHistoryFilterState;
  onChange: (next: PrintHistoryFilterState) => void;
  /** Kişi/yazıcı/cihaz seçenekleri: görülen satırlardan + seçili değer (süzme yine sunucuda). */
  userOptions: FilterOption[];
  printerOptions: FilterOption[];
  deviceOptions: FilterOption[];
  subjectLabel?: string | null;
}

const ANY = "__any__";

const CHIPS: { key: Exclude<PrintDayChip, "aralik">; label: string }[] = [
  { key: "bugun", label: "Bugün" },
  { key: "dun", label: "Dün" },
  { key: "hafta", label: "Bu hafta" },
  { key: "tumu", label: "Tümü" },
];

export function PrintHistoryFilters({ value, onChange, userOptions, printerOptions, deviceOptions, subjectLabel }: Props) {
  const set = <K extends keyof PrintHistoryFilterState>(k: K, v: PrintHistoryFilterState[K] | undefined) =>
    onChange({ ...value, [k]: v });
  const hasActive =
    value.gun !== "bugun" ||
    !!(value.userId || value.printer || value.deviceRefId || value.subjectKind || value.status || value.outputKind || value.source || value.subjectId);

  return (
    <div className="flex flex-wrap items-end gap-2 border-b bg-card/30 px-4 py-3 sm:px-6">
      <DayChips value={value} onChange={onChange} />

      {value.gun === "aralik" && (
        <Field label="Tarih aralığı (fabrika günü)">
          <DateRangeInput
            from={value.gunBas ?? ""}
            to={value.gunBit ?? ""}
            onFrom={(v) => set("gunBas", v || undefined)}
            onTo={(v) => set("gunBit", v || undefined)}
            inputClassName="h-9 w-40"
            fromLabel="Başlangıç"
            toLabel="Bitiş"
          />
        </Field>
      )}

      <OptionSelect label="Kişi" value={value.userId} options={userOptions} onChange={(v) => set("userId", v)} />
      <OptionSelect label="Yazıcı" value={value.printer} options={printerOptions} onChange={(v) => set("printer", v)} />
      <OptionSelect label="Cihaz" value={value.deviceRefId} options={deviceOptions} onChange={(v) => set("deviceRefId", v)} />
      <OptionSelect
        label="Tür"
        value={value.subjectKind}
        options={Object.entries(PRINT_SUBJECT_LABELS).map(([k, l]) => ({ value: k, label: l }))}
        onChange={(v) => set("subjectKind", v as PrintHistoryFilterState["subjectKind"])}
      />
      <OptionSelect
        label="Durum"
        value={value.status}
        options={Object.entries(PRINT_STATUS_LABELS).map(([k, l]) => ({ value: k, label: l }))}
        onChange={(v) => set("status", v as PrintHistoryFilterState["status"])}
      />
      <OutputToggle value={value.outputKind} onChange={(v) => set("outputKind", v)} />
      <OptionSelect
        label="Kaynak"
        value={value.source}
        options={Object.entries(PRINT_SOURCE_LABELS).map(([k, l]) => ({ value: k, label: l }))}
        onChange={(v) => set("source", v as PrintHistoryFilterState["source"])}
      />

      {value.subjectId && (
        <Field label="Kayıt">
          <Button type="button" variant="secondary" size="sm" className="h-9 max-w-64 gap-1" onClick={() => set("subjectId", undefined)}>
            <span className="truncate">{subjectLabel || "Seçili kayıt"}</span>
            <X className="h-3 w-3 shrink-0" />
          </Button>
        </Field>
      )}

      {hasActive && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange({ gun: "bugun" })}
          className="h-9 gap-1 text-muted-foreground"
        >
          <X className="h-3 w-3" />
          Temizle
        </Button>
      )}
    </div>
  );
}

function DayChips({ value, onChange }: { value: PrintHistoryFilterState; onChange: (next: PrintHistoryFilterState) => void }) {
  return (
    <Field label="Gün">
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Gün">
        {CHIPS.map((c) => (
          <Button
            key={c.key}
            type="button"
            size="sm"
            variant={value.gun === c.key ? "default" : "outline"}
            className="h-9"
            aria-pressed={value.gun === c.key}
            onClick={() => onChange({ ...value, gun: c.key, gunBas: undefined, gunBit: undefined })}
          >
            {c.label}
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          variant={value.gun === "aralik" ? "default" : "outline"}
          className="h-9"
          aria-pressed={value.gun === "aralik"}
          onClick={() => onChange({ ...value, gun: "aralik" })}
        >
          Tarih…
        </Button>
      </div>
    </Field>
  );
}

function OutputToggle({ value, onChange }: { value: PrintOutputKind | undefined; onChange: (v: PrintOutputKind | undefined) => void }) {
  return (
    <Field label="Çıktı">
      <div className="flex items-center gap-1" role="group" aria-label="Çıktı">
        {([undefined, "PRINTER", "PDF"] as const).map((k) => (
          <Button
            key={k ?? "all"}
            type="button"
            size="sm"
            variant={value === k ? "default" : "outline"}
            className="h-9"
            aria-pressed={value === k}
            onClick={() => onChange(k)}
          >
            {k ? PRINT_OUTPUT_LABELS[k] : "Tümü"}
          </Button>
        ))}
      </div>
    </Field>
  );
}

function OptionSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: FilterOption[];
  onChange: (v: string | undefined) => void;
}) {
  return (
    <Field label={label}>
      <Select value={value ?? ANY} onValueChange={(v) => onChange(v === ANY ? undefined : v)}>
        <SelectTrigger className={cn("h-9 w-40", value && "border-primary")} aria-label={label}>
          <SelectValue placeholder="Tümü" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Tümü</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
