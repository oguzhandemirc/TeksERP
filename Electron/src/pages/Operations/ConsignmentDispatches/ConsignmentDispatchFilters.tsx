import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import { ListSearchBox } from "@/components/data-table/ListSearchBox";
import { DayRangeChip, SelectChip } from "@/components/data-table/filter-row/SelectChip";
import { BandStats } from "@/components/layout/ListPage";
import { formatDisplay } from "@/lib/format";
import type {
  ConsignmentDispatchListFilter,
  ConsignmentDispatchListResult,
  ConsignmentStatusFilter,
} from "./types";

const STATUS_OPTIONS: { value: ConsignmentStatusFilter; label: string }[] = [
  { value: "ALL", label: "Tümü" },
  { value: "ACTIVE", label: "Geçerli" },
  { value: "CANCELLED", label: "İptal" },
];

export function ConsignmentSummaryStrip({ summary }: { summary: ConsignmentDispatchListResult["summary"] }) {
  return (
    <div data-testid="consignment-summary">
      <BandStats
        label="Emanet çıkış özeti"
        items={[
          { key: "count", label: "Belge", value: summary.count },
          { key: "active", label: "Geçerli", value: summary.activeCount },
          { key: "beam", label: "Levent", value: summary.beamCount },
          { key: "yarn", label: "İplik", value: formatDisplay(summary.yarnKg), unit: "kg" },
        ]}
      />
    </div>
  );
}

/** Tek satır filtre kutuları: [Ara][Durum][Müşteri][Gün]. Değerler/sunucu sorgusu değişmedi (UI D2-d). */
export function ConsignmentDispatchFilters({
  value,
  onChange,
}: {
  value: ConsignmentDispatchListFilter;
  onChange: (f: ConsignmentDispatchListFilter) => void;
}) {
  return (
    <>
      <ListSearchBox value={value.search} onSearchChange={(search) => onChange({ ...value, search })} searchHint="Belge no ara" />
      <SelectChip<ConsignmentStatusFilter> id="consignment-status" label="Durum" value={value.status} options={STATUS_OPTIONS} resetValue="ALL" onChange={(v) => onChange({ ...value, status: v ?? "ALL" })} />
      <div className="flex items-center gap-0.5">
        <CustomerPickerField
          value={value.ownerCustomerId}
          onChange={(id) => onChange({ ...value, ownerCustomerId: id })}
          placeholder="Müşteri: Tümü"
          triggerClassName="h-8 w-auto max-w-56 text-xs"
        />
        {value.ownerCustomerId && (
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Müşteri filtresini kaldır" onClick={() => onChange({ ...value, ownerCustomerId: null })}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      <DayRangeChip id="cd-range" label="Gün" from={value.from} to={value.to} onChange={({ from, to }) => onChange({ ...value, from, to })} />
    </>
  );
}
