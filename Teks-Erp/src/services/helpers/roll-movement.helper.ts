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
//
// Kapanmış hareketi YENİDEN AÇMAK da ters kayıttır (`reopenClosedMovementsTx`):
// kapanış damgası (`exitedAt`/`qtyOut`/`weightOut`/`notes`) yerinde null'lanmaz.
// =============================================================================
import type { Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";

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

export interface ReopenMovementsArgs {
  /** Yeniden açılacak hareketler; yüklem aktif + KAPALI satırla daraltılır. */
  where: Prisma.RollMovementWhereInput;
  /** Kapalı satırın `revokeReason`ı — `KURSUN_REOPEN` / `FASON_KABUL_IPTAL` gibi. */
  reason: string;
  /** Yeni açık satırın `notes` imzası. */
  notes: string | null;
  userId?: string | null;
  /** Verilirse yeniden açılan satır sayısı tam bu olmalı; eksikse yarış → 409. */
  expectCount?: number;
}

/**
 * Kapanmış hareketi ters kayıtla yeniden açar: kapalı satır damgalanır, aynı
 * giriş alanlarıyla (metraj · ağırlık · giriş anı · operatör · makine) yeni açık
 * satır yazılır. Giriş alanları KOPYALANIR çünkü okunuyorlar: `qtyIn` sonraki
 * kapanışın `qtyOut`una, `enteredAt` adım başlangıcına ve operatör etkinlik
 * penceresine akar. Dönen sayı yeniden açılan satır sayısıdır.
 */
export async function reopenClosedMovementsTx(tx: Tx, args: ReopenMovementsArgs): Promise<number> {
  const closed = { ...ACTIVE_MOVEMENT, exitedAt: { not: null } };
  const rows = await tx.rollMovement.findMany({
    where: { AND: [args.where, closed] },
    select: {
      id: true, rollId: true, workOrderStepId: true, qtyIn: true, weightIn: true,
      enteredAt: true, operatorId: true, machineId: true,
    },
    orderBy: { id: "asc" },
  });
  if (rows.length === 0 && args.expectCount === undefined) return 0;
  const claim = await tx.rollMovement.updateMany({
    where: { id: { in: rows.map((r) => r.id) }, ...closed },
    data: {
      revokedAt: new Date(),
      revokedById: args.userId ?? null,
      revokeReason: args.reason.slice(0, 300),
    },
  });
  if (claim.count !== rows.length || (args.expectCount !== undefined && claim.count !== args.expectCount)) {
    throw AppError.conflict("Topun istasyon hareketi bu sırada değişti — ekranı yenileyip tekrar deneyin.", {
      code: "ROLL_MOVEMENT_CHANGED",
    });
  }
  await tx.rollMovement.createMany({
    data: rows.map((r) => ({
      rollId: r.rollId,
      workOrderStepId: r.workOrderStepId,
      qtyIn: r.qtyIn,
      weightIn: r.weightIn,
      enteredAt: r.enteredAt,
      operatorId: r.operatorId,
      machineId: r.machineId,
      notes: args.notes,
    })),
  });
  return rows.length;
}
