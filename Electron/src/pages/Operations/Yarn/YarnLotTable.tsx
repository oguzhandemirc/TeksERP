// İplik lotları tablosu — ortak DataTable sütunları (düzen `yarn:lots` altında kullanıcıya kayıtlı).
import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { useLocalTable } from "@/hooks/useLocalTable";
import { factoryLocaleDateString } from "@/lib/factory-time";
import { YarnLotQualityMenu } from "./YarnLotQualityMenu";
import { lotQualityOf, YARN_LOT_QUALITY } from "./yarnLotQuality";
import type { YarnLotRow } from "./service";
import { kg } from "./qty";

interface Handlers {
  onToggle: (r: YarnLotRow) => void;
  busy: boolean;
  onDone: () => void;
}

const qualityNoteText = (r: YarnLotRow) =>
  [r.qualityDecidedAt ? factoryLocaleDateString(r.qualityDecidedAt, "tr-TR") : null, r.qualityNote].filter(Boolean).join(" · ");

const LOT_COLUMNS: ColumnDef<YarnLotRow>[] = [
  { accessorKey: "lotNo", header: "Lot", cell: ({ row }) => <span className="font-mono">{row.original.lotNo}</span> },
  {
    id: "item",
    header: "İplik",
    size: 240,
    meta: { label: "İplik", exportValue: (r) => `${r.item.name} ${r.item.code}` },
    cell: ({ row: { original: r } }) => (
      <span>
        {r.item.name} <span className="font-mono text-xs text-muted-foreground">{r.item.code}</span>
      </span>
    ),
  },
  {
    id: "supplier",
    header: "Tedarikçi",
    meta: { label: "Tedarikçi", exportValue: (r) => r.supplier?.name ?? "" },
    cell: ({ row: { original: r } }) => (
      <span>
        {r.supplier?.name ?? <span className="text-muted-foreground">—</span>}
        {r.ownerCustomer && <span className="ml-1.5 text-xs text-amber-700">Emanet: {r.ownerCustomer.name}</span>}
      </span>
    ),
  },
  // Türetilen bakiye — sunucu Σ hareket; eksi görünüyorsa mutabakat §41 kırmızıdır.
  { id: "balanceKg", header: "Bakiye (kg)", meta: { label: "Bakiye (kg)", align: "right", exportValue: (r) => kg(r.balanceKg) }, cell: ({ row }) => <span className="tabular-nums">{kg(row.original.balanceKg)}</span> },
  {
    id: "isActive",
    header: "Durum",
    meta: { label: "Durum", exportValue: (r) => (r.isActive ? "Aktif" : "Pasif") },
    cell: ({ row }) => (row.original.isActive ? <Badge variant="outline">Aktif</Badge> : <Badge variant="secondary">Pasif</Badge>),
  },
  {
    id: "quality",
    header: "Kalite",
    size: 260,
    meta: { label: "Kalite", exportValue: (r) => YARN_LOT_QUALITY[lotQualityOf(r)].label },
    cell: ({ row: { original: r } }) => (
      <span>
        <Badge variant="outline" className={YARN_LOT_QUALITY[lotQualityOf(r)].cls} title={r.qualityNote ?? undefined}>
          {YARN_LOT_QUALITY[lotQualityOf(r)].label}
        </Badge>
        {(r.qualityNote || r.qualityDecidedAt) && <span className="ml-1.5 text-xs text-muted-foreground">{qualityNoteText(r)}</span>}
      </span>
    ),
  },
];

function lotActions({ onToggle, busy, onDone }: Handlers): ColumnDef<YarnLotRow> {
  return {
    id: "actions",
    header: () => <span className="sr-only">Eylemler</span>,
    enableHiding: false,
    size: 170,
    meta: { label: "Eylemler", align: "right" },
    cell: ({ row: { original: r } }) => (
      <div className="flex items-center justify-end">
        <YarnLotQualityMenu row={r} onDone={onDone} />
        <PermissionGate permission="yarn:write">
          <Button size="sm" variant="ghost" onClick={() => onToggle(r)} disabled={busy}>
            {r.isActive ? "Pasife al" : "Aktifleştir"}
          </Button>
        </PermissionGate>
      </div>
    ),
  };
}

export function useYarnLotTable(rows: YarnLotRow[], { onToggle, busy, onDone }: Handlers) {
  const columns = useMemo(() => [...LOT_COLUMNS, lotActions({ onToggle, busy, onDone })], [onToggle, busy, onDone]);
  return useLocalTable({ tableKey: "yarn:lots", data: rows, columns });
}
