// Hareket zamanı — fabrika diliminde (tek kaynak `lib/factory-time`): bugünse saat, değilse gün.
import { factoryDayKey, formatFactory } from "@/lib/factory-time";

export function hareketZamaniCari(iso: string, now: Date = new Date()): string {
  return factoryDayKey(iso) === factoryDayKey(now) ? formatFactory(iso, "HH:mm") : formatFactory(iso, "dd.MM.yyyy");
}

export const gunCari = (iso: string | null | undefined): string => (iso ? formatFactory(iso, "dd.MM.yyyy") : "—");
