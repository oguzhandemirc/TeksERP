// Beklenen top sayısı — kuşak ihtiyacı raporu ve kuşak sarf düşümü TEK formülü buradan alır.
import type { Prisma } from "@prisma/client";

/** Bir kalemin beklenen top sayısı — top boyu yoksa `null` (bilinmiyor; 0 değil). */
export function expectedRolls(remaining: Prisma.Decimal, pieceLengthM: Prisma.Decimal | null): number | null {
  if (!pieceLengthM || pieceLengthM.lte(0)) return null;
  return remaining.div(pieceLengthM).ceil().toNumber();
}
