import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateRangeInput } from "@/components/forms/DateRangeInput";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  categoryLabels,
  eventActionLabels,
  ACTIONS_BY_CATEGORY,
} from "./labels";

export type EventsCategoryFilter = "ALL" | "AUTH" | "SYSTEM";

export interface SystemEventsFilterState {
  category: EventsCategoryFilter;
  action?: string;
  dateFrom?: string;
  dateTo?: string;
}

interface Props {
  value: SystemEventsFilterState;
  onChange: (next: SystemEventsFilterState) => void;
}

const ANY = "__any__";

export function SystemEventsFilters({ value, onChange }: Props) {
  // Action seçenekleri seçili kategoriye göre daralır; "ALL"da AUTH+SYSTEM birleştirilir.
  const actionOptions =
    value.category === "ALL"
      ? [...ACTIONS_BY_CATEGORY.AUTH, ...ACTIONS_BY_CATEGORY.SYSTEM]
      : ACTIONS_BY_CATEGORY[value.category];

  const hasActiveFilter =
    value.category !== "ALL" || !!value.action || !!value.dateFrom || !!value.dateTo;

  return (
    <div className="flex flex-wrap items-end gap-2 border-b bg-card/30 px-6 py-3">
      <Field label="Kategori">
        <Select
          value={value.category}
          onValueChange={(v) =>
            onChange({
              ...value,
              category: v as EventsCategoryFilter,
              // kategori değişince action filtresi sıfırlanır (çakışmasın)
              action: undefined,
            })
          }
        >
          <SelectTrigger className="h-9 w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Tümü (Auth + Sistem)</SelectItem>
            <SelectItem value="AUTH">{categoryLabels.AUTH}</SelectItem>
            <SelectItem value="SYSTEM">{categoryLabels.SYSTEM}</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field label="Olay">
        <Select
          value={value.action ?? ANY}
          onValueChange={(v) =>
            onChange({ ...value, action: v === ANY ? undefined : v })
          }
        >
          <SelectTrigger className="h-9 w-52">
            <SelectValue placeholder="Tümü" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Tümü</SelectItem>
            {actionOptions.map((a) => (
              <SelectItem key={a} value={a}>
                {eventActionLabels[a] ?? a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Tarih aralığı">
        <DateRangeInput
          from={value.dateFrom?.slice(0, 10) ?? ""}
          to={value.dateTo?.slice(0, 10) ?? ""}
          onFrom={(v) => onChange({ ...value, dateFrom: v ? `${v}T00:00:00.000Z` : undefined })}
          onTo={(v) => onChange({ ...value, dateTo: v ? `${v}T23:59:59.999Z` : undefined })}
          inputClassName="h-9 w-40"
          fromLabel="Başlangıç"
          toLabel="Bitiş"
        />
      </Field>

      {hasActiveFilter && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            onChange({ category: "ALL", action: undefined, dateFrom: undefined, dateTo: undefined })
          }
          className="h-9 gap-1 text-muted-foreground"
        >
          <X className="h-3 w-3" />
          Temizle
        </Button>
      )}
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
