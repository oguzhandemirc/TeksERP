// Raf topunun görünen ekleri (parti no, depo adı, kg, rafa giriş anı) — raf kümesi `loadShelfCells`ten gelir,
// bu yardımcı yalnız o kümenin topları için depolanmış kolonları okur (türev yok). Patron `stok-kalem` anlığı kullanır.
import prisma from "../../lib/prisma";

export interface ShelfRollExtras {
  readonly batchNumber: string | null;
  readonly warehouseName: string | null;
  readonly weightKg: number | null;
  readonly statusChangedAt: Date | null;
}

export async function loadShelfRollExtras(rollIds: readonly string[]): Promise<Map<string, ShelfRollExtras>> {
  const ids = [...new Set(rollIds)];
  if (ids.length === 0) return new Map();
  const rows = await prisma.roll.findMany({
    where: { id: { in: ids } },
    select: { id: true, weightKg: true, statusChangedAt: true, batch: { select: { batchNumber: true } }, warehouse: { select: { name: true } } },
  });
  return new Map(rows.map((r) => [r.id, {
    batchNumber: r.batch?.batchNumber ?? null,
    warehouseName: r.warehouse?.name ?? null,
    weightKg: r.weightKg === null ? null : Number(r.weightKg),
    statusChangedAt: r.statusChangedAt,
  }]));
}
