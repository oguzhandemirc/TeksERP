// Kârlılık raporu koşucusu (D4-G3) — hesap `profitability.helper`, biçim `profitability.sunum`; burada yalnız
// ad sözlükleri okunur (sunum saf kalsın, bekçi DB'siz ölçsün). Maliyet ya da ön muhasebe kapalı → null.
import prisma from "../../lib/prisma";
import { computeProfitability, type ProfitabilityResult } from "../helpers/profitability.helper";
import type { ResolvedDayRange } from "./temel/_day-range";
import { buildProfitabilitySunumu, compareMonthsOf, monthsOfWindow, type ProfitBreakdown, type ProfitNames } from "./profitability.sunum";
import type { RaporSunumu } from "./sunum/sunum.types";

/** Kârlılık satırlarının ad sözlükleri (müşteri/işlem/makine/top) — panel raporu ve patron anlığı (D4-G4) ortak. */
export async function loadNames(results: ProfitabilityResult[]): Promise<ProfitNames> {
  const rows = results.flatMap((r) => r.rows);
  const ids = <T,>(pick: (x: (typeof rows)[number]) => T | null) => [...new Set(rows.map(pick).filter((v): v is T => v !== null))];
  const customers = await prisma.customer.findMany({ where: { id: { in: ids((r) => r.customerId) } }, select: { id: true, name: true } });
  const items = await prisma.item.findMany({ where: { id: { in: ids((r) => r.serviceItemId) } }, select: { id: true, name: true } });
  const machines = await prisma.machine.findMany({ where: { id: { in: ids((r) => r.machineId) } }, select: { id: true, name: true } });
  const rolls = await prisma.roll.findMany({ where: { id: { in: ids((r) => r.rollId) } }, select: { id: true, barcode: true } });
  return {
    customers: new Map(customers.map((c) => [c.id, c.name])),
    serviceItems: new Map(items.map((i) => [i.id, i.name])),
    machines: new Map(machines.map((m) => [m.id, m.name])),
    rolls: new Map(rolls.map((r) => [r.id, r.barcode ?? "barkodsuz top"])),
  };
}

export async function profitabilityReport(window: ResolvedDayRange, breakdown: ProfitBreakdown, allowedBreakdowns?: readonly ProfitBreakdown[]): Promise<RaporSunumu | null> {
  const result = await computeProfitability(monthsOfWindow(window.days));
  if (!result) return null;
  const cmpMonths = compareMonthsOf(window);
  const previous = cmpMonths ? await computeProfitability(cmpMonths) : null;
  const names = await loadNames(previous ? [result, previous] : [result]);
  return buildProfitabilitySunumu({ result, previous, names, window, breakdown, allowedBreakdowns });
}
