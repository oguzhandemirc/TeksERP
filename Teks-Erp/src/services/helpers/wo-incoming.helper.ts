// =============================================================================
// İŞ EMRİ "GELEN" — girdi kökü topların gelen belge satırlarından metre + kg (belge tanıt 3 aşama, 2026-11-09; salt okunur)
// =============================================================================
// Kg yalnız topa DOĞRUDAN bağlı satırdan okunur (`CustomerDeliveryNoteLine.rollId`): ARABA özet satırının kg'si topa yazılmaz,
// bölünmüş çocuğun atasının kg'si çocuğun değildir. Bir kökün satırı yok ya da satırında kg yoksa toplam null — kısmi toplam
// gösterilmez (sessiz eksik olmaz). Hiçbir kök belgeden doğmadıysa `null` (İE belgeden doğmamış; kart çizilmez).
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";

type Db = Pick<Prisma.TransactionClient, "customerDeliveryNoteLine">;

export interface WoIncoming {
  meters: Prisma.Decimal;
  kg: Prisma.Decimal | null;
  kgSource: "DOCUMENT" | null;
}

export async function computeWoIncoming(input: { meters: Prisma.Decimal; rootIds: readonly string[] }, db: Db = prisma): Promise<WoIncoming | null> {
  if (input.rootIds.length === 0) return null;
  const lines = await db.customerDeliveryNoteLine.findMany({ where: { rollId: { in: [...input.rootIds] } }, select: { rollId: true, weightKg: true } });
  if (lines.length === 0) return null;
  const byRoll = new Map(lines.map((l) => [l.rollId!, l.weightKg]));
  let kg: Prisma.Decimal | null = new Prisma.Decimal(0);
  for (const id of input.rootIds) {
    const w = byRoll.get(id);
    if (w == null) {
      kg = null;
      break;
    }
    kg = kg.plus(w);
  }
  return { meters: input.meters, kg, kgSource: kg === null ? null : "DOCUMENT" };
}
