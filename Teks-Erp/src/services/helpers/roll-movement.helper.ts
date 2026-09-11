// =============================================================================
// TOP HAREKETİ — aktif yüklem + geri alma kapısı (tek kaynak)
// =============================================================================
// `RollMovement` topun bir adıma ne zaman girip çıktığının izidir ve adım
// DURUMU bu satırlardan SAYILARAK türetilir (`recomputeStepStatus`). Geri alma
// satırı SİLMEZ, `revokedAt` ile damgalar; ileri kaydın `exitedAt`/`qtyOut`
// alanlarına dokunmaz.
//
// ⚠️ Geri alınmış satır "hiç olmamış" sayılır: adım durumuna, konuma, sayaçlara
// ve raporlara girmez; ne kapatılır ne yeniden açılır. DB'deki partial unique
// (`roll_movements_one_open_per_roll_step_uq`) da onu saymaz — top aynı adıma
// yeniden girebilsin.
//
// Okuyan ve güncelleyen HER yol `ACTIVE_MOVEMENT`tan geçer; ham SQL aynı yüklemi
// `"revokedAt" IS NULL` olarak yazar. Elle kopyalanan `revokedAt: null` bir gün
// unutulur ve geri alınmış hareket adımı yanlış duruma taşır (ayrışan yüzey).
// =============================================================================
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/** Geri alınmamış (yürürlükteki) top hareketi. */
export const ACTIVE_MOVEMENT = { revokedAt: null } as const;

export interface RevokeMovementsArgs {
  rollIds: string[];
  workOrderStepIds?: string[];
  /** Yalnız açık (`exitedAt IS NULL`) hareketler. */
  onlyOpen?: boolean;
  /** Hareketi açan yolun `notes` imzası (ör. `RECEIPT_OPEN_FABRIC:<no>`). */
  notes?: string;
  /** Neden geri alındı — `MANUAL_MOVE` / `FASON_RECEIPT_CANCEL` gibi. */
  reason: string;
  userId?: string | null;
}

/**
 * Hareketi geri alır (silmez). Dönen sayı DAMGALANAN satır sayısıdır; eski
 * `deleteMany().count` ile aynı anlamı taşır, çağıranların sayaç mantığı bozulmaz.
 */
export async function revokeRollMovements(tx: Tx, args: RevokeMovementsArgs): Promise<number> {
  if (args.rollIds.length === 0) return 0;
  const res = await tx.rollMovement.updateMany({
    where: {
      rollId: { in: args.rollIds },
      ...(args.workOrderStepIds ? { workOrderStepId: { in: args.workOrderStepIds } } : {}),
      ...(args.onlyOpen ? { exitedAt: null } : {}),
      ...(args.notes !== undefined ? { notes: args.notes } : {}),
      ...ACTIVE_MOVEMENT,
    },
    data: {
      revokedAt: new Date(),
      revokedById: args.userId ?? null,
      revokeReason: args.reason.slice(0, 300),
    },
  });
  return res.count;
}
