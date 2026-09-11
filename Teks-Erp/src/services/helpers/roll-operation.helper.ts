// =============================================================================
// TOP OPERASYON İZİ — aktif yüklem + geri alma kapısı (tek kaynak)
// =============================================================================
// `RollOperation` "bu topa kurşun uygulandı mı / QC2'den geçti mi / fasona gitti
// mi" sorusunun cevabıdır. Şema başlığı append-only diyordu ama kod YEDİ yerde
// `deleteMany` ile siliyordu: geri alınmış bir adımın HİÇ OLMADIĞI iddia ediliyor,
// izlenebilirlik sorgusunun cevabı geriye dönük değişiyordu.
//
// 2026-09-11'den beri satır SİLİNMEZ, `revokedAt` ile damgalanır.
//
// ⚠️ DB'deki unique PARTIAL'dır (`roll_operations_active_triple_uq`,
// `WHERE "revokedAt" IS NULL`): geri alınmış satır dururken aynı (top, adım, tip)
// üçlüsü YENİDEN yazılabilsin — yoksa top o adımı bir daha işleyemezdi.
//
// Okuyan HER yol `ACTIVE_OPERATION`dan geçer; elle kopyalanan `revokedAt: null`
// bir gün unutulur ve geri alınmış iz "yapılmış" sayılır (ayrışan yüzey sınıfı).
// =============================================================================
import type { Prisma, RollOperationType } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/** Geri alınmamış (yürürlükteki) operasyon izi. */
export const ACTIVE_OPERATION = { revokedAt: null } as const;

export interface RevokeOperationsArgs {
  rollIds: string[];
  workOrderStepIds?: string[];
  operationTypes?: RollOperationType[];
  /** Neden geri alındı — `TAMBUR_UNDO` / `FASON_CANCEL` / `MANUAL_MOVE` gibi. */
  reason: string;
  userId?: string | null;
}

/**
 * İzi geri alır (silmez). Dönen sayı DAMGALANAN satır sayısıdır; eski
 * `deleteMany().count` ile aynı anlamı taşır, çağıranların sayaç mantığı bozulmaz.
 */
export async function revokeRollOperations(tx: Tx, args: RevokeOperationsArgs): Promise<number> {
  if (args.rollIds.length === 0) return 0;
  const res = await tx.rollOperation.updateMany({
    where: {
      rollId: { in: args.rollIds },
      ...(args.workOrderStepIds ? { workOrderStepId: { in: args.workOrderStepIds } } : {}),
      ...(args.operationTypes ? { operationType: { in: args.operationTypes } } : {}),
      ...ACTIVE_OPERATION,
    },
    data: {
      revokedAt: new Date(),
      revokedById: args.userId ?? null,
      revokeReason: args.reason.slice(0, 300),
    },
  });
  return res.count;
}
