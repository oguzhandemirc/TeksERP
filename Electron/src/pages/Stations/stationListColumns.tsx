// Üretim istasyonları LİSTE görünümü — ortak DataTable sütunları. Bir satır = bir istasyon (makineler yan panelde).
// "Tip" sütunu yalnız listede dış/fason istasyon varsa kurulur (hep "Dahili" yer kaplamasın).
import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { useLocalTable } from "@/hooks/useLocalTable";
import { cn } from "@/lib/utils";
import { toneFor } from "@/lib/station-colors";
import { StationType, stationTypeLabels } from "@/types/enums";
import type { StationListItem } from "./stationListItems";
import { capabilityChips, KursunBadge, StationStatusBadge } from "./StationListRow";
import { plainStationKindLabel } from "./stationPlainLabels";

const dash = <span className="text-muted-foreground">—</span>;
const inactiveCount = (it: StationListItem) => it.machines.filter((m) => m.isActive === false).length;
const capabilityText = (it: StationListItem) =>
  [it.kursun?.enabled ? `Kurşun${it.kursun.defaultGramaj ? ` (${it.kursun.defaultGramaj})` : ""}` : null, ...capabilityChips(it.station)].filter(Boolean).join(", ");

function stationListColumns(showType: boolean): ColumnDef<StationListItem>[] {
  return [
    {
      id: "name",
      header: "İstasyon",
      size: 300,
      meta: { label: "İstasyon", exportValue: (it) => it.station.name },
      cell: ({ row: { original: { station: s } } }) => (
        <span className="flex min-w-0 items-center gap-2" title={`${s.name}${s.code ? ` · ${s.code}` : ""} · ${plainStationKindLabel(s.kind)}`}>
          <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", toneFor(s.type, s.kind).solid)} />
          <span className="truncate font-medium">{s.name}</span>
          {s.code && <span className="shrink-0 font-mono text-xs text-muted-foreground">{s.code}</span>}
          <span className="truncate text-xs text-muted-foreground">{plainStationKindLabel(s.kind)}</span>
        </span>
      ),
    },
    {
      id: "category",
      header: "Süreç türü",
      meta: { label: "Süreç türü", exportValue: (it) => it.station.defaultCategory?.name ?? "" },
      cell: ({ row }) => row.original.station.defaultCategory?.name ?? dash,
    },
    {
      id: "capabilities",
      header: "Yetenekler",
      size: 320,
      meta: { label: "Yetenekler", exportValue: capabilityText },
      cell: ({ row: { original: it } }) => {
        const chips = capabilityChips(it.station);
        if (chips.length === 0 && !it.kursun?.enabled) return dash;
        return (
          <span className="flex items-center gap-1" title={capabilityText(it)}>
            <KursunBadge kursun={it.kursun} />
            {chips.map((c) => (
              <Badge key={c} variant="muted" className="text-[10px]">{c}</Badge>
            ))}
          </span>
        );
      },
    },
    ...(showType
      ? [{ id: "type", header: "Tip", meta: { label: "Tip" }, accessorFn: (it: StationListItem) => stationTypeLabels[it.station.type] } satisfies ColumnDef<StationListItem>]
      : []),
    {
      id: "machines",
      header: "Makine",
      meta: { label: "Makine", align: "right", summable: true, exportValue: (it) => it.machines.length },
      cell: ({ row: { original: it } }) => {
        const off = inactiveCount(it);
        return (
          <span title={off > 0 ? `${off} pasif makine dahil` : undefined}>
            {it.machines.length > 0 ? it.machines.length : <span className="text-muted-foreground">0</span>}
            {off > 0 && <span className="ml-1 text-xs text-muted-foreground">({off} pasif)</span>}
          </span>
        );
      },
    },
    {
      id: "status",
      header: "Durum",
      meta: { label: "Durum", exportValue: (it) => (it.station.isActive ? "Aktif" : "Pasif") },
      cell: ({ row }) => <StationStatusBadge active={row.original.station.isActive} />,
    },
  ];
}

/** Liste tablosu — sütun düzeni `stations:list` tercihinde. */
export function useStationListTable(items: StationListItem[]) {
  const showType = items.some((i) => i.station.type === StationType.EXTERNAL);
  const columns = useMemo(() => stationListColumns(showType), [showType]);
  return useLocalTable({ tableKey: "stations:list", data: items, columns, getRowId: (it) => it.station.id });
}
