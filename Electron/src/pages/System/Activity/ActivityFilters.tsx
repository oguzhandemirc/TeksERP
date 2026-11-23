import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Ban, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { Button } from "@/components/ui/button";
import { FilterChip } from "@/components/data-table/filter-row/FilterChip";
import { SelectChip } from "@/components/data-table/filter-row/SelectChip";
import { DayPresetChip } from "@/components/data-table/filter-row/DayPresetChip";
import { systemLogService } from "@/services/systemLogService";
import { tableLabel, actionLabels } from "./labels";
import type { SystemLogDomainAction, SystemLogGun } from "@/types/systemLog";
import type { ActivityFilterState, ActivityView } from "./activity-view";

export type { ActivityFilterState } from "./activity-view";

type DayChoice = SystemLogGun | "tumu" | "aralik";

const DAYS: Array<{ value: DayChoice; label: string }> = [
  { value: "bugun", label: "Bugün" },
  { value: "dun", label: "Dün" },
  { value: "hafta", label: "Bu hafta" },
  { value: "tumu", label: "Tümü" },
];

const VIEWS: Array<{ value: ActivityView; label: string }> = [
  { value: "islem", label: "İşlemler" },
  { value: "satir", label: "Tüm satırlar" },
];

interface Props {
  value: ActivityFilterState;
  onChange: (next: ActivityFilterState) => void;
  /** Sunucu `reddedilenSuzgeci` işaretini verdi mi — eski backend'de çip gizli. */
  rejectedAvailable?: boolean;
}

/** Tek satır: [Kayıt no ara][Görünüm ▾][Gün ▾][Reddedilenler][Kullanıcı ▾][Modül ▾][İşlem ▾]. Değerler değişmedi (2026-11-23). */
export function ActivityFilters({ value, onChange, rejectedAvailable = false }: Props) {
  const usersQuery = useQuery({
    queryKey: ["system-log-users"],
    queryFn: () => systemLogService.users().then((r) => r.data),
    staleTime: 5 * 60_000,
  });
  const tablesQuery = useQuery({
    queryKey: ["system-log-tables"],
    queryFn: () => systemLogService.tables().then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  const hasActiveFilter = !!(value.gun || value.reddedilen || value.q || value.userId || value.tableName || value.action || value.dateFrom || value.dateTo);
  const day: DayChoice = value.gun ?? (value.dateFrom || value.dateTo ? "aralik" : "tumu");
  const set = <K extends keyof ActivityFilterState>(key: K, raw: string | null) => onChange({ ...value, [key]: raw || undefined });
  const gorunum = value.gorunum ?? "islem";

  return (
    <div data-list-surface="toolbar" className="flex flex-wrap items-center gap-1.5 border-b py-2">
      <SearchBox value={value.q} onChange={(q) => onChange({ ...value, q })} />
      <SelectChip id="activity-view" label="Görünüm" value={gorunum} resetValue="islem" options={VIEWS} onChange={(v) => onChange({ ...value, gorunum: v ?? "islem" })} />
      <DayPresetChip<DayChoice>
        id="activity-day"
        presets={DAYS}
        value={day}
        rangeValue="aralik"
        resetValue="tumu"
        from={value.dateFrom?.slice(0, 10) ?? ""}
        to={value.dateTo?.slice(0, 10) ?? ""}
        onPreset={(g) => onChange({ ...value, gun: g === "tumu" || g === "aralik" ? undefined : g, dateFrom: undefined, dateTo: undefined })}
        onRange={(r) =>
          onChange({ ...value, gun: undefined, dateFrom: r.from ? `${r.from}T00:00:00.000Z` : undefined, dateTo: r.to ? `${r.to}T23:59:59.999Z` : undefined })
        }
      />
      {rejectedAvailable && gorunum === "islem" && !value.q && (
        <RejectedChip on={!!value.reddedilen} onChange={(on) => onChange({ ...value, reddedilen: on || undefined })} />
      )}
      <SelectChip
        id="activity-user"
        label="Kullanıcı"
        value={value.userId ?? null}
        options={(usersQuery.data ?? []).map((u) => ({ value: u.id, label: u.fullName || u.username }))}
        onChange={(v) => set("userId", v)}
      />
      <SelectChip
        id="activity-module"
        label="Modül"
        value={value.tableName ?? null}
        options={(tablesQuery.data ?? []).map((t) => ({ value: t, label: tableLabel(t) }))}
        onChange={(v) => set("tableName", v)}
      />
      <SelectChip
        id="activity-action"
        label="İşlem"
        value={value.action ?? null}
        options={(Object.keys(actionLabels) as SystemLogDomainAction[]).map((a) => ({ value: a, label: actionLabels[a] }))}
        onChange={(v) => set("action", v)}
      />
      {hasActiveFilter && (
        <Button variant="ghost" size="sm" onClick={() => onChange({ gorunum: value.gorunum })} className="h-8 gap-1 px-2 text-xs text-muted-foreground" title="Bütün filtreleri kaldır">
          <X className="h-3.5 w-3.5" />
          Temizle
        </Button>
      )}
    </div>
  );
}

/** "Reddedilenler" — tek anahtar (aç/kapa) kutu; süzme SUNUCUDA (`reddedilen=1`), yalnız trace status ≥ 400 gelir. */
function RejectedChip({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <FilterChip id="activity-rejected" label="Reddedilenler" active={on} removable={false} onRemove={() => onChange(false)}>
      <button type="button" aria-pressed={on} onClick={() => onChange(!on)} className="flex h-7 items-center gap-1.5 whitespace-nowrap px-2 text-xs">
        <Ban className="h-3.5 w-3.5" />
        <span>Reddedilenler</span>
      </button>
    </FilterChip>
  );
}

/** Kayıt numarası araması: terim gecikmeli olarak SUNUCUYA gider (`q`). */
function SearchBox({ value, onChange }: { value?: string; onChange: (q: string | undefined) => void }) {
  const [term, setTerm] = useState(value ?? "");
  const debounced = useDebouncedValue(term, 350);
  useEffect(() => {
    const next = debounced.trim() || undefined;
    if (next !== value) onChange(next);
    // Yalnız terim değişince yayılır (value/onChange her render'da yenidir).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  useEffect(() => {
    // Dışarıdan "Temizle" — kutu da boşalır.
    if (!value && term) setTerm("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="relative w-full min-w-[10rem] sm:w-56">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Kayıt no: SP-…, CV…, barkod"
        aria-label="Kayıt numarasıyla ara"
        className="h-8 pl-8 text-sm"
      />
    </div>
  );
}
