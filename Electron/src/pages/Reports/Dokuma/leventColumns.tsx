// =============================================================================
// LEVENT BİTİŞ TAHMİNİ — tablo kolonları (null → "—", 0 değil)
// =============================================================================
import type { ColumnDef } from "@tanstack/react-table";
import { fmtCalendarDate, fmtMeters, fmtNum } from "../_components/formatters";
import { gerekce } from "./leventShared";
import type { FinishForecastRow } from "./leventReportTypes";

export const bitisColumns: ColumnDef<FinishForecastRow>[] = [
  { accessorKey: "beamNo", header: "Levent" },
  { accessorKey: "machine.code", header: "Tezgah", cell: ({ row }) => `${row.original.machine.code} · ${row.original.machine.name}` },
  { accessorKey: "position", header: "Yuva", cell: ({ getValue }) => fmtNum(getValue() as number | null) },
  { accessorKey: "kalanM", header: "Kalan", cell: ({ getValue }) => fmtMeters(getValue() as number) },
  { accessorKey: "gunlukOrtM", header: "Günlük ort.", cell: ({ getValue }) => fmtMeters(getValue() as number | null) },
  { id: "kaynak", header: "Otomatik / elle (7 gün)", cell: ({ row }) => `${fmtMeters(row.original.kaynak.otomatik)} / ${fmtMeters(row.original.kaynak.elle)}` },
  { accessorKey: "tahminiBitisGun", header: "Tahmini bitiş", cell: ({ row }) => fmtCalendarDate(row.original.tahminiBitisGun) },
  { accessorKey: "kalanGun", header: "Kalan gün", cell: ({ getValue }) => fmtNum(getValue() as number | null) },
  { accessorKey: "hesaplanamadi", header: "Hesaplanamadı", cell: ({ row }) => gerekce(row.original.hesaplanamadi) },
];
