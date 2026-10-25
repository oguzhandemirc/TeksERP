// =============================================================================
// Dokuma küpleri (`durus`, `dokuma-vardiya`) için ORTAK satır kaynağı — R1-SEMKUP
// =============================================================================
// Duruş Pareto ve Randıman raporlarının okuduğu TEK satır kümesi `collectShiftStatRows`tur
// (tezgah × vardiya örneği; mühürlü satır olduğu gibi, açık satır anlık). Semantik küp ikinci bir
// duruş/süre hesabı yazmaz: aynı satırları aynı gün aralığıyla alır, yalnız gruplar.
// Vardiya, satırın kendi `ShiftInstance`ının tanımıdır (takvim helper'ı bu pencerelerle boğaz-ikiz).
// =============================================================================
import { Prisma } from "@prisma/client";
import { factoryYmd } from "../../../../constants/time";
import { collectShiftStatRows } from "../../../machine-shift-stat.service";
import type { DateRange } from "../../_shared";
import type { SemanticDimension } from "../tipler";

export type LoomShiftRow = Awaited<ReturnType<typeof collectShiftStatRows>>["rows"][number];

/** Semantik aralık → dokuma raporlarının fabrika günü penceresi (iki uç dahil). */
export function loomDays(range: DateRange): { from: string; to: string } {
  return { from: factoryYmd(range.from), to: factoryYmd(range.to) };
}

export async function collectLoomRows(range: DateRange): Promise<LoomShiftRow[]> {
  return (await collectShiftStatRows(loomDays(range), { includeBreakdown: true })).rows;
}

export const machineLabel = (r: LoomShiftRow): string => `${r.machine.code} · ${r.machine.name}`;
export const dayKeyOf = (r: LoomShiftRow): string => r.shiftInstance.factoryDayKey.toISOString().slice(0, 10);

/** Helper ölçülerin günü: anahtar `YYYY-MM-DD` fabrika günü (SQL yolu yok — `helperOnly`). */
export const loomDayDimension: SemanticDimension = {
  id: "gun", name: "Gün", kind: "time", valueType: "date", cardinalityCap: 0, keySql: Prisma.sql`NULL::date`, helperOnly: true,
};
