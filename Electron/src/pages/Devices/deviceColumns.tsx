// Tabletler listesi — ortak DataTable sütunları. Ad işlem dökümünü açar; ⋯ menü ve sağ-tık aynı eylemler (DeviceRow.tsx).
import { useMemo, useRef } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { ExportColumn } from "@/lib/list-export";
import { useLocalTable } from "@/hooks/useLocalTable";
import { safeFormat } from "@/lib/format";
import type { DeviceListItem } from "./types";
import { DeviceActionsMenu, DeviceNameLink, DeviceStatusCell, deviceKindLabel, type DeviceRowHandlers } from "./DeviceRow";

/** Tablodaki rozetle AYNI sıra (birleşme dahil) — dosya listesinin durumu `deviceStatusLabel`. */
const statusCellText = (d: DeviceListItem): string => (d.mergedIntoId ? "Birleştirildi" : deviceStatusLabel(d));
/** Satırdaki rozetle AYNI sıra: pasiflik onay durumunun önüne geçer. */
const deviceStatusLabel = (d: DeviceListItem): string =>
  !d.isActive ? "Pasif" : d.status === "APPROVED" ? "Onaylı" : "Onay bekliyor";

// Dışa aktarım sütunları — ekrandaki kolonların (Cihaz · Tür · Durum · Son
// aktivite · Kimlik) karşılığı; kimlik tabloda kısaltılır, dosyada TAM yazılır
// (cihaz eşleştirmesi ancak tam kimlikle yapılabilir).
export const DEVICE_EXPORT_COLUMNS: ExportColumn<DeviceListItem>[] = [
  { label: "Cihaz Adı", value: (d) => d.name },
  { label: "Tür", value: (d) => deviceKindLabel(d.kind) },
  { label: "Durum", value: deviceStatusLabel },
  { label: "Makine", value: (d) => (d.machine ? `${d.machine.name} (${d.machine.code})` : "") },
  { label: "İstasyon", value: (d) => d.machine?.station.name ?? "" },
  { label: "Son Aktivite", value: (d) => (d.lastSeenAt ? safeFormat(d.lastSeenAt, "dd.MM.yyyy HH:mm") : "") },
  { label: "Cihaz Kimliği", value: (d) => d.deviceId },
];

const lastSeenText = (d: DeviceListItem) => (d.lastSeenAt ? safeFormat(d.lastSeenAt, "dd.MM.yyyy HH:mm") : "—");

function deviceColumns(proofLostIds: ReadonlySet<string>, handlers: { current: DeviceRowHandlers }): ColumnDef<DeviceListItem>[] {
  return [
    { id: "name", header: "Cihaz", size: 260, meta: { label: "Cihaz", exportValue: (d) => d.name }, cell: ({ row }) => <DeviceNameLink device={row.original} /> },
    { id: "kind", header: "Tür", size: 96, meta: { label: "Tür" }, accessorFn: (d) => deviceKindLabel(d.kind), cell: ({ getValue }) => <span className="text-muted-foreground">{String(getValue())}</span> },
    {
      id: "status",
      header: "Durum",
      size: 200,
      meta: { label: "Durum", exportValue: (d) => [statusCellText(d), proofLostIds.has(d.id) ? "Anahtar kaybı" : ""].filter(Boolean).join(" · ") },
      cell: ({ row }) => <DeviceStatusCell device={row.original} proofLost={proofLostIds.has(row.original.id)} />,
    },
    { id: "lastSeenAt", header: "Son aktivite", size: 160, meta: { label: "Son aktivite", exportValue: lastSeenText }, cell: ({ row }) => <span className="text-xs text-muted-foreground">{lastSeenText(row.original)}</span> },
    {
      id: "deviceId",
      header: "Kimlik",
      size: 160,
      meta: { label: "Kimlik", exportValue: (d) => d.deviceId },
      cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground" title={row.original.deviceId}>{row.original.deviceId.slice(0, 12)}…</span>,
    },
    {
      id: "actions",
      header: "",
      size: 48,
      enableHiding: false,
      meta: { label: "Eylemler", align: "right", exportValue: () => "" },
      cell: ({ row }) => <DeviceActionsMenu device={row.original} handlers={handlers.current} />,
    },
  ];
}

/** Tablo + satır eylemleri; geri çağrılar ref'te (sütunlar yalnız anahtar kaybı kümesi değişince yeniden kurulur). */
export function useDevicesTable(rows: DeviceListItem[], proofLostIds: ReadonlySet<string>, handlers: DeviceRowHandlers) {
  const ref = useRef(handlers);
  ref.current = handlers;
  const columns = useMemo(() => deviceColumns(proofLostIds, ref), [proofLostIds]);
  const table = useLocalTable({ tableKey: "devices:list", data: rows, columns });
  return { table, handlers: ref };
}
