// =============================================================================
// KARNE TABLOSU — sütunlar + satır menüsü (izin aynası: menü ögesi = backend ucunun izni)
// =============================================================================
// `SHIFT_STAT_ACTION_PERMISSIONS` backend uçlarıyla birebir (1e şartı ①): panel bir
// izni backend'den geniş göstermez. `statId` NULL ise (karne satırı henüz yazılmadı)
// üç eylem de kapalı — mühür yazılmamış satıra basılamaz.
// =============================================================================
import { MoreHorizontal, Lock, Unlock, Pencil, History } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PermissionGate } from "@/components/PermissionGate";
import { fmtInt } from "../_components/formatters";
import { SealBadge, fmtSec } from "./DokumaShared";
import { SOURCE_LABELS, formatPct } from "./dokuma-regime";
import { SHIFT_STAT_ACTION_PERMISSIONS, type ShiftStatRow } from "./service";

export interface KarneActions {
  onCorrect: (row: ShiftStatRow) => void;
  onSeal: (row: ShiftStatRow) => void;
  onUnseal: (row: ShiftStatRow) => void;
  onLedger: (row: ShiftStatRow) => void;
}

function RowMenu({ row, a }: { row: ShiftStatRow; a: KarneActions }) {
  const yok = row.statId === null;
  const hint = yok ? " (karne henüz yazılmadı)" : "";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Eylemler"><MoreHorizontal className="h-4 w-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={yok} onSelect={() => a.onLedger(row)}><History className="mr-2 h-4 w-4" /> Mühür defteri</DropdownMenuItem>
        <PermissionGate permission={SHIFT_STAT_ACTION_PERMISSIONS.correctTerms}>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={yok || row.sealState === "SEALED"} onSelect={() => a.onCorrect(row)}><Pencil className="mr-2 h-4 w-4" /> Terimleri düzelt{hint}</DropdownMenuItem>
        </PermissionGate>
        <PermissionGate permission={SHIFT_STAT_ACTION_PERMISSIONS.seal}>
          <DropdownMenuItem disabled={yok || row.sealState === "SEALED"} onSelect={() => a.onSeal(row)}><Lock className="mr-2 h-4 w-4" /> Mühürle{hint}</DropdownMenuItem>
        </PermissionGate>
        <PermissionGate permission={SHIFT_STAT_ACTION_PERMISSIONS.unseal}>
          <DropdownMenuItem disabled={yok || row.sealState !== "SEALED"} onSelect={() => a.onUnseal(row)}><Unlock className="mr-2 h-4 w-4" /> Mührü aç…</DropdownMenuItem>
        </PermissionGate>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function buildKarneColumns(a: KarneActions): ColumnDef<ShiftStatRow>[] {
  return [
    { accessorKey: "machine.code", header: "Tezgah", cell: ({ row }) => `${row.original.machine.code} · ${row.original.machine.name}` },
    { accessorKey: "shiftInstance.factoryDayKey", header: "Gün", cell: ({ row }) => row.original.shiftInstance.factoryDayKey.slice(0, 10) },
    { accessorKey: "shiftInstance.shiftDefinition.name", header: "Vardiya", cell: ({ row }) => row.original.shiftInstance.shiftDefinition.name },
    { accessorKey: "terms.source", header: "Kaynak", cell: ({ row }) => (row.original.emptyLoom ? "Boş tezgah" : SOURCE_LABELS[row.original.terms.source]) },
    { accessorKey: "terms.potSec", header: "Planlı", cell: ({ row }) => fmtSec(row.original.terms.potSec) },
    { accessorKey: "terms.aptSec", header: "Çalıştı", cell: ({ row }) => fmtSec(row.original.terms.aptSec) },
    { accessorKey: "terms.unitsActual", header: "Atkı", cell: ({ row }) => fmtInt(row.original.terms.unitsActual) },
    { accessorKey: "kpis.availabilityPct", header: "K", cell: ({ row }) => formatPct(row.original.kpis.availabilityPct) },
    { accessorKey: "kpis.performancePct", header: "P", cell: ({ row }) => formatPct(row.original.kpis.performancePct) },
    { accessorKey: "kpis.effectivenessPct", header: "E", cell: ({ row }) => formatPct(row.original.kpis.effectivenessPct) },
    { accessorKey: "sealState", header: "Durum", cell: ({ row }) => <SealBadge sealState={row.original.sealState} live={row.original.live} /> },
    { accessorKey: "sealGeneration", header: "Kuşak", cell: ({ row }) => (row.original.sealGeneration > 0 ? String(row.original.sealGeneration) : "") },
    { accessorKey: "warnings", header: "Uyarı", cell: ({ row }) => (row.original.warnings.length ? String(row.original.warnings.length) : "") },
    { id: "actions", header: "", cell: ({ row }) => <RowMenu row={row.original} a={a} /> },
  ];
}
