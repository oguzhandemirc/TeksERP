// =============================================================================
// MAKİNE SAAT ÜCRETİ + HİZMET SARF NORMU GEÇERLİLİĞİ — "şu an" ve "şu tarih itibarıyla" TEK KAYNAK (D4-G1a)
// =============================================================================
// İki model de ③a damgalı sürümdür: satır `[createdAt, revokedAt)` penceresinde geçerlidir
// (`itemPriceValidAt` emsali). Kârlılık (D4-G2a) geçmiş bir günün ücretini/normunu buradan okur;
// pencereyi elle yazan ikinci bir yüklem damgalı satırı "o günün ücreti" sanır — AST kapısı
// `test_makine_ucreti_sarf_normu` §7 bu dosya dışındaki as-of yüklemini ve ham SQL'i yakalar.
// =============================================================================
import type { MachineCostRate, Prisma, ServiceConsumableNorm } from "@prisma/client";

type Reader = Pick<Prisma.TransactionClient, "machineCostRate" | "serviceConsumableNorm">;

/** Bugün geçerli (damgasız) sürüm — liste ve yazma yolları "şu an"ı buradan okur. */
export const ACTIVE_COST_RATE = { revokedAt: null } as const;

/** Damga gerekçeleri — panel/audit aynı cümleyi görsün. */
export const COST_RATE_REVOKE_REASON = {
  CHANGED: "Değer değişti",
  REMOVED: "Kaldırıldı",
} as const;

/** `at` anında açık pencere: `createdAt <= at AND (revokedAt IS NULL OR revokedAt > at)`. Yalnız `AND` içine konur. */
function validWindow(at: Date): { createdAt: { lte: Date }; OR: Array<{ revokedAt: null } | { revokedAt: { gt: Date } }> } {
  return { createdAt: { lte: at }, OR: [{ revokedAt: null }, { revokedAt: { gt: at } }] };
}

/** Makinenin `at` anında geçerli saat ücreti (yoksa null). Kısmi unique pencere başına tek satır garanti eder. */
export async function machineCostRateValidAt(db: Reader, machineId: string, at: Date): Promise<MachineCostRate | null> {
  return db.machineCostRate.findFirst({
    where: { AND: [{ machineId }, validWindow(at)] },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

/** Hizmet kaleminin `at` anında geçerli sarf normları (sarf kalemi başına en çok bir satır). */
export async function consumableNormsValidAt(db: Reader, serviceItemId: string, at: Date): Promise<ServiceConsumableNorm[]> {
  return db.serviceConsumableNorm.findMany({
    where: { AND: [{ serviceItemId }, validWindow(at)] },
    orderBy: [{ consumableItemId: "asc" }, { createdAt: "desc" }, { id: "desc" }],
  });
}

/**
 * Kârlılık toplu okuması (D4-G2a): hizmet kalemlerinin TÜM norm sürümleri (damgalılar dahil); `at` seçimi çağıranda
 * `isCostRateValidAt` ile — iş başına sorgu atılmasın diye. Sıra belirlenimli.
 */
export async function consumableNormHistory(db: Reader, serviceItemIds: string[]): Promise<ServiceConsumableNorm[]> {
  if (serviceItemIds.length === 0) return [];
  return db.serviceConsumableNorm.findMany({
    where: { serviceItemId: { in: serviceItemIds } },
    orderBy: [{ serviceItemId: "asc" }, { consumableItemId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
}

/** Pencerenin bellek-içi ikizi (başı dahil, sonu hariç) — bekçi aynı satırlarda ikisini karşılaştırır. */
export function isCostRateValidAt(row: { createdAt: Date; revokedAt: Date | null }, at: Date): boolean {
  return row.createdAt.getTime() <= at.getTime() && (row.revokedAt === null || row.revokedAt.getTime() > at.getTime());
}
