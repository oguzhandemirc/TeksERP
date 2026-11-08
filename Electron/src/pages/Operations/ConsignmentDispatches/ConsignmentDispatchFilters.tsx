// Emanet çıkış listesi üst bandı: özet şeridi (sunucu, liste ile aynı where) + durum çipleri + müşteri/tarih/arama.
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DateRangeInput } from "@/components/forms/DateRangeInput";
import { Button } from "@/components/ui/button";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import { fmtNum } from "./consignmentText";
import type {
  ConsignmentDispatchListFilter,
  ConsignmentDispatchListResult,
  ConsignmentStatusFilter,
} from "./types";

const STATUS_CHIPS: { key: ConsignmentStatusFilter; label: string }[] = [
  { key: "ALL", label: "Tümü" },
  { key: "ACTIVE", label: "Geçerli" },
  { key: "CANCELLED", label: "İptal" },
];

export function ConsignmentSummaryStrip({ summary }: { summary: ConsignmentDispatchListResult["summary"] }) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm" data-testid="consignment-summary">
      <span>
        <b className="tabular-nums">{summary.count}</b> belge
      </span>
      <span>
        <b className="tabular-nums">{summary.activeCount}</b> geçerli
      </span>
      <span>
        <b className="tabular-nums">{summary.beamCount}</b> levent
      </span>
      <span>
        <b className="tabular-nums">{fmtNum(summary.yarnKg)}</b> kg iplik
      </span>
    </div>
  );
}

export function ConsignmentDispatchFilters({
  value,
  onChange,
}: {
  value: ConsignmentDispatchListFilter;
  onChange: (f: ConsignmentDispatchListFilter) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1" role="group" aria-label="Durum">
        {STATUS_CHIPS.map((c) => (
          <Button
            key={c.key}
            type="button"
            size="sm"
            variant={value.status === c.key ? "default" : "outline"}
            aria-pressed={value.status === c.key}
            onClick={() => onChange({ ...value, status: c.key })}
          >
            {c.label}
          </Button>
        ))}
      </div>
      <div className="flex w-72 items-center gap-1">
        <CustomerPickerField
          value={value.ownerCustomerId}
          onChange={(id) => onChange({ ...value, ownerCustomerId: id })}
          placeholder="Tüm müşteriler"
        />
        {value.ownerCustomerId && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            aria-label="Müşteri süzgecini kaldır"
            onClick={() => onChange({ ...value, ownerCustomerId: null })}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      <DateRangeInput from={value.from} to={value.to} onFrom={(v) => onChange({ ...value, from: v })} onTo={(v) => onChange({ ...value, to: v })} fromLabel="Başlangıç günü" toLabel="Bitiş günü" idPrefix="cd-range" />
      <Input
        placeholder="Belge no ara…"
        aria-label="Belge no ara"
        className="h-9 w-48"
        value={value.search}
        onChange={(e) => onChange({ ...value, search: e.target.value })}
      />
    </div>
  );
}
