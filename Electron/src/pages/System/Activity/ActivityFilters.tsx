import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Ban, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { systemLogService } from "@/services/systemLogService";
import { tableLabel, actionLabels } from "./labels";
import type { SystemLogDomainAction, SystemLogGun } from "@/types/systemLog";
import { DateRangeInput } from "@/components/forms/DateRangeInput";
import type { ActivityFilterState, ActivityView } from "./activity-view";

export type { ActivityFilterState } from "./activity-view";

const GUN_CIPLERI: Array<{ value: SystemLogGun; label: string }> = [
  { value: "bugun", label: "Bugün" },
  { value: "dun", label: "Dün" },
  { value: "hafta", label: "Bu hafta" },
];

interface Props {
  value: ActivityFilterState;
  onChange: (next: ActivityFilterState) => void;
  /** Sunucu `reddedilenSuzgeci` işaretini verdi mi — eski backend'de çip gizli. */
  rejectedAvailable?: boolean;
}

const ANY = "__any__";

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

  const hasActiveFilter = !!(
    value.gun ||
    value.reddedilen ||
    value.q ||
    value.userId ||
    value.tableName ||
    value.action ||
    value.dateFrom ||
    value.dateTo
  );

  const set = <K extends keyof ActivityFilterState>(
    key: K,
    raw: string | undefined,
  ) => {
    onChange({ ...value, [key]: raw && raw !== ANY ? raw : undefined });
  };

  return (
    <div className="flex flex-wrap items-end gap-2 border-b bg-card/30 px-4 py-3 sm:px-6">
      <Field label="Görünüm">
        <ViewToggle value={value.gorunum ?? "islem"} onChange={(gorunum) => onChange({ ...value, gorunum })} />
      </Field>
      <Field label="Gün">
        <DayChips
          value={value.gun}
          onChange={(gun) => onChange({ ...value, gun, dateFrom: undefined, dateTo: undefined })}
        />
      </Field>
      {rejectedAvailable && (value.gorunum ?? "islem") === "islem" && !value.q && (
        <Field label="Durum">
          <RejectedChip on={!!value.reddedilen} onChange={(on) => onChange({ ...value, reddedilen: on || undefined })} />
        </Field>
      )}
      <Field label="Ara (kayıt no)">
        <SearchBox value={value.q} onChange={(q) => onChange({ ...value, q })} />
      </Field>

      <Field label="Kullanıcı">
        <Select value={value.userId ?? ANY} onValueChange={(v) => set("userId", v)}>
          <SelectTrigger className="h-9 w-44">
            <SelectValue placeholder="Tümü" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Tümü</SelectItem>
            {(usersQuery.data ?? []).map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.fullName || u.username}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Modül">
        <Select value={value.tableName ?? ANY} onValueChange={(v) => set("tableName", v)}>
          <SelectTrigger className="h-9 w-44">
            <SelectValue placeholder="Tümü" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Tümü</SelectItem>
            {(tablesQuery.data ?? []).map((t) => (
              <SelectItem key={t} value={t}>
                {tableLabel(t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="İşlem">
        <Select value={value.action ?? ANY} onValueChange={(v) => set("action", v)}>
          <SelectTrigger className="h-9 w-32">
            <SelectValue placeholder="Tümü" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Tümü</SelectItem>
            {(Object.keys(actionLabels) as SystemLogDomainAction[]).map((a) => (
              <SelectItem key={a} value={a}>
                {actionLabels[a]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Tarih aralığı">
        <DateRangeInput
          from={value.dateFrom?.slice(0, 10) ?? ""}
          to={value.dateTo?.slice(0, 10) ?? ""}
          onFrom={(v) => onChange({ ...value, gun: undefined, dateFrom: v ? `${v}T00:00:00.000Z` : undefined })}
          onTo={(v) => onChange({ ...value, gun: undefined, dateTo: v ? `${v}T23:59:59.999Z` : undefined })}
          inputClassName="h-9 w-40"
          fromLabel="Başlangıç"
          toLabel="Bitiş"
        />
      </Field>

      {hasActiveFilter && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({ gorunum: value.gorunum })}
          className="h-9 gap-1 text-muted-foreground"
        >
          <X className="h-3 w-3" />
          Temizle
        </Button>
      )}
    </div>
  );
}

function ViewToggle({ value, onChange }: { value: ActivityView; onChange: (v: ActivityView) => void }) {
  const options: Array<[ActivityView, string]> = [
    ["islem", "İşlemler"],
    ["satir", "Tüm satırlar"],
  ];
  return (
    <div role="radiogroup" aria-label="Görünüm" className="flex h-9 rounded-md border p-0.5">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "whitespace-nowrap rounded px-3 text-sm transition-colors",
            value === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Fabrika günü çipleri — aralığı SUNUCU hesaplar (`gun=`). Seçili çipe yeniden basmak kaldırır. */
function DayChips({ value, onChange }: { value?: SystemLogGun; onChange: (v: SystemLogGun | undefined) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {GUN_CIPLERI.map((c) => (
        <Button
          key={c.value}
          type="button"
          size="sm"
          variant={value === c.value ? "default" : "outline"}
          aria-pressed={value === c.value}
          className="h-9 whitespace-nowrap"
          onClick={() => onChange(value === c.value ? undefined : c.value)}
        >
          {c.label}
        </Button>
      ))}
    </div>
  );
}

/** "Reddedilenler" çipi — süzme SUNUCUDA (`reddedilen=1`); yalnız trace status ≥ 400 gelir. */
function RejectedChip({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <Button
      type="button"
      size="sm"
      variant={on ? "default" : "outline"}
      aria-pressed={on}
      className="h-9 gap-1.5 whitespace-nowrap"
      onClick={() => onChange(!on)}
    >
      <Ban className="h-3.5 w-3.5" />
      Reddedilenler
    </Button>
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
    <div className="relative">
      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="SP-…, CV…, barkod"
        aria-label="Kayıt numarasıyla ara"
        className="h-9 w-full min-w-[10rem] pl-7 sm:w-52"
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}
