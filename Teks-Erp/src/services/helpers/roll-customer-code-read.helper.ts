// =============================================================================
// Topa bağlı AKTİF müşteri barkodunu okur (D4-F3) — etiket payload'ı + sevk çekisi.
// =============================================================================
// Aktif = `revokedAt IS NULL`; kısmi unique topta en çok bir aktif kod garanti eder
// (D4-F1). Etiket ve çeki AYNI okuyucudan beslenir: aynı topun etiketindeki kod ile
// sevk belgesindeki kod ayrışmasın.
// =============================================================================
import prisma from "../../lib/prisma";

type ReadClient = Pick<typeof prisma, "rollCustomerCode">;

/** rollId → aktif müşteri kodu. Kodsuz top haritada YOK. */
export async function loadActiveCustomerCodes(rollIds: readonly string[], db: ReadClient = prisma): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (rollIds.length === 0) return out;
  const rows = await db.rollCustomerCode.findMany({
    where: { rollId: { in: [...new Set(rollIds)] }, revokedAt: null },
    select: { rollId: true, code: true },
  });
  for (const r of rows) out.set(r.rollId, r.code);
  return out;
}
