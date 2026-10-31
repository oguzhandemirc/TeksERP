// =============================================================================
// LEVENT SONUCU · KAPASİTE · BİTİŞ TAHMİNİ — tablo kolonları (null → "ölçülemedi"/"—", 0 değil)
// =============================================================================
import type { ColumnDef } from "@tanstack/react-table";
import { fmtCalendarDate, fmtDate, fmtMeters, fmtNum } from "../_components/formatters";
import { formatPct } from "./dokuma-regime";
import { gerekce } from "./leventShared";
import { warpSpecCellText, type BeamResultRow, type CapacityRow, type FinishForecastRow } from "./leventReportTypes";

const leventHucre = (r: BeamResultRow) => (r.physicalBeamNo ? `${r.beamNo} · ${r.physicalBeamNo}` : r.beamNo);
/** Beklenen/fire `null` = take-up bilinmiyor ⇒ beyan; sayı uydurulmaz. */
const olculemezse = (v: number | null, fmt: (n: number) => string) => (v === null ? "ölçülemedi" : fmt(v));

const ortak: ColumnDef<BeamResultRow>[] = [
  { accessorKey: "beamNo", header: "Levent", cell: ({ row }) => leventHucre(row.original) },
  { accessorKey: "warpSpec.code", header: "Çözgü kartı", cell: ({ row }) => warpSpecCellText(row.original) },
  { accessorKey: "tezgahlar", header: "Tezgah", cell: ({ row }) => row.original.tezgahlar.join(", ") || "—" },
  { accessorKey: "sarilanM", header: "Sarılan", cell: ({ getValue }) => fmtMeters(getValue() as number) },
  { accessorKey: "gercekKumasM", header: "Gerçek kumaş", cell: ({ getValue }) => fmtMeters(getValue() as number) },
  { id: "kaynak", header: "Otomatik / elle", cell: ({ row }) => `${fmtMeters(row.original.gercekKaynak.otomatik)} / ${fmtMeters(row.original.gercekKaynak.elle)}` },
];

export const closedBeamColumns: ColumnDef<BeamResultRow>[] = [
  ...ortak,
  { accessorKey: "beklenenKumasM", header: "Beklenen", cell: ({ row }) => olculemezse(row.original.beklenenKumasM, fmtMeters) },
  { accessorKey: "fireM", header: "Fire", cell: ({ row }) => olculemezse(row.original.fireM, fmtMeters) },
  { accessorKey: "firePct", header: "Fire %", cell: ({ row }) => formatPct(row.original.firePct) },
  { accessorKey: "kapanisAt", header: "Kapanış", cell: ({ row }) => fmtDate(row.original.kapanisAt) },
];

export const openBeamColumns: ColumnDef<BeamResultRow>[] = [
  ...ortak,
  { accessorKey: "kalanM", header: "Kalan", cell: ({ getValue }) => fmtMeters(getValue() as number) },
  { accessorKey: "kullanimPct", header: "Kullanım", cell: ({ row }) => formatPct(row.original.kullanimPct) },
];

export const kapasiteColumns: ColumnDef<CapacityRow>[] = [
  { accessorKey: "code", header: "Tezgah", cell: ({ row }) => `${row.original.code} · ${row.original.name}` },
  { accessorKey: "hafta", header: "Hafta", cell: ({ row }) => `${row.original.hafta} (${fmtCalendarDate(row.original.haftaBaslangic)})` },
  { accessorKey: "nominalUnitsPerMin", header: "Nominal atkı/dk", cell: ({ getValue }) => fmtNum(getValue() as number | null) },
  { accessorKey: "unitsPerCm", header: "Atkı/cm", cell: ({ getValue }) => fmtNum(getValue() as number | null) },
  { accessorKey: "teorikMSaat", header: "Teorik m/sa", cell: ({ getValue }) => fmtNum(getValue() as number | null) },
  { accessorKey: "takvimSaat", header: "Takvim saati", cell: ({ getValue }) => fmtNum(getValue() as number) },
  { accessorKey: "potansiyelM", header: "Potansiyel", cell: ({ getValue }) => fmtMeters(getValue() as number | null) },
  { accessorKey: "gercekM", header: "Gerçek", cell: ({ getValue }) => fmtMeters(getValue() as number) },
  { accessorKey: "kullanimPct", header: "Kullanım", cell: ({ row }) => formatPct(row.original.kullanimPct) },
  { accessorKey: "hesaplanamadi", header: "Hesaplanamadı", cell: ({ row }) => gerekce(row.original.hesaplanamadi) },
];

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
