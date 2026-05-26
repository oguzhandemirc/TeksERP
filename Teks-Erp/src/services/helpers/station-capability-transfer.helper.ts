// =============================================================================
// TeksERP - Station Capability Transfer Helper
// =============================================================================
// İstasyonun yetenek (renk/özellik) listesini "buradan geçen rulonun otomatik
// kazanacağı şeyler" olarak Roll'a kopyalar. Örnek: Kurşun istasyonuna KURSUN
// özelliği atanmışsa, o istasyonda QC2 tamamlanan her top KURSUN özelliğini
// otomatik kazanır. Boyahane fason kabulündeki kategori-bazlı kopyalamanın
// internal istasyon karşılığı.
//
// Per-roll action'ı çağıran service (kursun-qc:completeQc2,
// inventory:kursunFinish, ileride applyDye vb.) bu helper'ı tx içinde
// çağırır. Audit'i caller atar.
// =============================================================================

import type { TxClient } from "./roll-step.helper";

/**
 * İstasyonun propertyCapabilities listesini Roll'a RollProperty olarak
 * kopyalar (skipDuplicates). Boş listede no-op.
 */
export async function copyStationCapabilitiesToRoll(
  tx: TxClient,
  args: { stationId: string; rollId: string },
): Promise<{ propertyIds: string[] }> {
  const caps = await tx.stationProperty.findMany({
    where: { stationId: args.stationId },
    select: { propertyId: true },
  });
  if (caps.length === 0) return { propertyIds: [] };

  await tx.rollProperty.createMany({
    data: caps.map((c) => ({ rollId: args.rollId, propertyId: c.propertyId })),
    skipDuplicates: true,
  });
  return { propertyIds: caps.map((c) => c.propertyId) };
}
