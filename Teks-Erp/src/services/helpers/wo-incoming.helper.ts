// =============================================================================
// İŞ EMRİ "GELEN" — girdi kökü topların gelen belge satırlarından metre + kg + en + müşteri parti no + kaynak belgeler
// (belge tanıt 3 aşama, 2026-11-09; salt okunur)
// =============================================================================
// Değerler yalnız topa DOĞRUDAN bağlı satırdan okunur (`CustomerDeliveryNoteLine.rollId`): ARABA özet satırının kg'si/eni topa
// yazılmaz, bölünmüş çocuğun atasının değeri çocuğun değildir. Kg: bir kökün satırı yok ya da satırında kg yoksa toplam null —
// kısmi toplam gösterilmez (sessiz eksik olmaz). En: her kökte var ve hepsi aynıysa tek değer, değilse null (aynı ilke).
// Müşteri parti no: satırlardaki tekil değerler, sıralı birleşik. Hiçbir kök belgeden doğmadıysa `null` (kart çizilmez).
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";

type Db = Pick<Prisma.TransactionClient, "customerDeliveryNoteLine">;

export interface WoIncoming {
  meters: Prisma.Decimal;
  kg: Prisma.Decimal | null;
  kgSource: "DOCUMENT" | null;
  /** Kökleri doğuran gelen belge(ler), belge no sırasıyla. */
  notes: Array<{ id: string; noteNo: string }>;
  widthCm: Prisma.Decimal | null;
  customerBatchNo: string | null;
}

type IncomingLine = { rollId: string | null; weightKg: Prisma.Decimal | null; widthCm: Prisma.Decimal | null; customerBatchNo: string | null; note: { id: string; noteNo: string } };

/** Saf: kök kimlikleri + satırları → gelen bloğu (bekçi DB'siz ölçer). */
export function foldWoIncoming(meters: Prisma.Decimal, rootIds: readonly string[], lines: readonly IncomingLine[]): WoIncoming | null {
  if (rootIds.length === 0 || lines.length === 0) return null;
  const byRoll = new Map(lines.map((l) => [l.rollId!, l]));
  let kg: Prisma.Decimal | null = new Prisma.Decimal(0);
  let width: Prisma.Decimal | null | undefined;
  for (const id of rootIds) {
    const l = byRoll.get(id);
    kg = kg && l?.weightKg != null ? kg.plus(l.weightKg) : null;
    const w = l?.widthCm ?? null;
    width = width === undefined ? w : width && w && width.equals(w) ? width : null;
  }
  const notes = [...new Map(lines.map((l) => [l.note.id, l.note])).values()].sort((a, b) => a.noteNo.localeCompare(b.noteNo));
  const batches = [...new Set(lines.map((l) => l.customerBatchNo?.trim()).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b));
  return { meters, kg, kgSource: kg === null ? null : "DOCUMENT", notes, widthCm: width ?? null, customerBatchNo: batches.length ? batches.join(", ") : null };
}

export async function computeWoIncoming(input: { meters: Prisma.Decimal; rootIds: readonly string[] }, db: Db = prisma): Promise<WoIncoming | null> {
  if (input.rootIds.length === 0) return null;
  const lines = await db.customerDeliveryNoteLine.findMany({
    where: { rollId: { in: [...input.rootIds] } },
    select: { rollId: true, weightKg: true, widthCm: true, customerBatchNo: true, note: { select: { id: true, noteNo: true } } },
  });
  return foldWoIncoming(input.meters, input.rootIds, lines);
}
