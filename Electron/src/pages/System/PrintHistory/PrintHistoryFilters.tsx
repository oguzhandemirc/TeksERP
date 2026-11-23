import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterChip } from "@/components/data-table/filter-row/FilterChip";
import { SelectChip } from "@/components/data-table/filter-row/SelectChip";
import { DayPresetChip } from "@/components/data-table/filter-row/DayPresetChip";
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
  /** Satırın başı (arama kutusu). */
  search?: ReactNode;
  /** Tablonun Sütunlar menüsü (çubuğun sağında). */
  tools?: ReactNode;
}

const DAYS: { value: Exclude<PrintDayChip, "aralik">; label: string }[] = [
  { value: "bugun", label: "Bugün" },
  { value: "dun", label: "Dün" },
  { value: "hafta", label: "Bu hafta" },
  { value: "tumu", label: "Tümü" },
];

const opts = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));

/** Tek satır: [Ara][Gün ▾][Kişi ▾]…[Temizle] … [Sütunlar]. Değerler/URL eşlemesi değişmedi (yalnız görünüm, 2026-11-23). */
export function PrintHistoryFilters({ value, onChange, userOptions, printerOptions, deviceOptions, subjectLabel, search, tools }: Props) {
  const set = <K extends keyof PrintHistoryFilterState>(k: K, v: PrintHistoryFilterState[K] | undefined | null) =>
    onChange({ ...value, [k]: v ?? undefined });
  const hasActive =
    value.gun !== "bugun" ||
    !!(value.userId || value.printer || value.deviceRefId || value.subjectKind || value.status || value.outputKind || value.source || value.subjectId);

  return (
    <div data-list-surface="toolbar" className="flex flex-wrap items-center gap-1.5 border-b py-2">
      {search}
      <DayPresetChip<PrintDayChip>
        id="print-day"
        presets={DAYS}
        value={value.gun}
        rangeValue="aralik"
        resetValue="bugun"
        from={value.gunBas ?? ""}
        to={value.gunBit ?? ""}
        onPreset={(g) => onChange({ ...value, gun: g, gunBas: undefined, gunBit: undefined })}
        onRange={(r) => onChange({ ...value, gun: "aralik", gunBas: r.from || undefined, gunBit: r.to || undefined })}
      />
      <SelectChip id="print-user" label="Kişi" value={value.userId ?? null} options={userOptions} onChange={(v) => set("userId", v)} />
      <SelectChip id="print-printer" label="Yazıcı" value={value.printer ?? null} options={printerOptions} onChange={(v) => set("printer", v)} />
      <SelectChip id="print-device" label="Cihaz" value={value.deviceRefId ?? null} options={deviceOptions} onChange={(v) => set("deviceRefId", v)} />
      <SelectChip id="print-subject" label="Tür" value={value.subjectKind ?? null} options={opts(PRINT_SUBJECT_LABELS)} onChange={(v) => set("subjectKind", v as PrintHistoryFilterState["subjectKind"])} />
      <SelectChip id="print-status" label="Durum" value={value.status ?? null} options={opts(PRINT_STATUS_LABELS)} onChange={(v) => set("status", v as PrintHistoryFilterState["status"])} />
      <SelectChip id="print-output" label="Çıktı" value={value.outputKind ?? null} options={opts(PRINT_OUTPUT_LABELS)} onChange={(v) => set("outputKind", v as PrintOutputKind | null)} />
      <SelectChip id="print-source" label="Kaynak" value={value.source ?? null} options={opts(PRINT_SOURCE_LABELS)} onChange={(v) => set("source", v as PrintHistoryFilterState["source"])} />

      {value.subjectId && (
        <FilterChip id="print-subject-id" label="Kayıt" active removable onRemove={() => set("subjectId", undefined)}>
          <span className="max-w-64 truncate px-2 text-xs">
            <span className="text-muted-foreground">Kayıt: </span>
            {subjectLabel || "Seçili kayıt"}
          </span>
        </FilterChip>
      )}

      {hasActive && (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ gun: "bugun" })} className="h-8 gap-1 px-2 text-xs text-muted-foreground" title="Bütün filtreleri kaldır">
          <X className="h-3.5 w-3.5" />
          Temizle
        </Button>
      )}
      {tools && <div className="ml-auto flex items-center gap-1.5">{tools}</div>}
    </div>
  );
}
