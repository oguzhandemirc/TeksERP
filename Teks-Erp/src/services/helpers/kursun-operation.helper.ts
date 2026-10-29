// =============================================================================
// KURŞUN DEFTER SATIRI — tek yazar (KQ-D4, 2026-10-24)
// =============================================================================
// `KURSUN_APPLIED` satırı "bu topa kurşun uygulandı + hangi gramajla" kanıtıdır.
// İki tablet yolu (kursun-qc `completeQc2`, inventory `kursunFinish`) bu satırı
// buradan yazar; karar `resolveKursunApplication`dan gelir.
//
// DÜZELTME DEFTERİ DEĞİŞTİRMEZ: aynı topa farklı gramaj gelirse eski satır
// ATOMİK CLAIM ile damgalanır (`revokedAt`, 'gramaj düzeltme') ve yeni satır
// yazılır — partial unique `roll_operations_active_triple_uq` (`WHERE revokedAt
// IS NULL`) buna izin verir. Aynı değer ya da değersiz tekrar = no-op (replay).
// =============================================================================
import { assertWorkNotBilledTx } from "./service-billing-gate.helper";
import { Prisma, RollOperationType } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { ACTIVE_OPERATION } from "./roll-operation.helper";

type Tx = Prisma.TransactionClient;

export const KURSUN_CORRECTION_REASON = "gramaj düzeltme";

export type KursunWriteOutcome = "created" | "noop" | "corrected";

export interface ApplyKursunArgs {
  rollId: string;
  stepId: string;
  /** Uygulanan çeşit değeri (gramaj); çeşit bağı yoksa ya da seçilmediyse null. */
  valueId: string | null;
  userId?: string | null;
  machineId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

const CONFLICT = () =>
  AppError.conflict("Kurşun kaydı bu sırada başka bir işlemle değişti — tekrar deneyin.", {
    code: "KURSUN_OPERATION_CONFLICT",
  });

/**
 * Yeni aktif satır. `createMany skipDuplicates` = `ON CONFLICT DO NOTHING`:
 * partial unique dahil her tekillik çakışmasında tx'i bozmadan 0 döner (düz
 * `create` P2002'si interaktif tx'i abort eder, ardından okuma yapılamaz).
 */
async function insertActive(tx: Tx, a: ApplyKursunArgs): Promise<number> {
  const res = await tx.rollOperation.createMany({
    data: [
      {
        rollId: a.rollId,
        workOrderStepId: a.stepId,
        operationType: RollOperationType.KURSUN_APPLIED,
        operatorId: a.userId ?? null,
        machineId: a.machineId ?? null,
        propertyValueId: a.valueId,
        ...(a.metadata !== undefined ? { metadata: a.metadata } : {}),
      },
    ],
    skipDuplicates: true,
  });
  return res.count;
}

async function readActive(tx: Tx, a: ApplyKursunArgs) {
  return tx.rollOperation.findFirst({
    where: {
      ...ACTIVE_OPERATION,
      rollId: a.rollId,
      workOrderStepId: a.stepId,
      operationType: RollOperationType.KURSUN_APPLIED,
    },
    select: { id: true, propertyValueId: true },
  });
}

/**
 * Topun bu adımdaki aktif `KURSUN_APPLIED` satırını istenen değere getirir.
 *   • satır yok          → yazılır ("created"); eşzamanlı ilk yazımda kaybeden
 *                          aynı değerse no-op, farklı değerse 409
 *   • aynı değer / null  → dokunulmaz ("noop" — replay, değersiz tekrar)
 *   • farklı değer       → eski satır claim'le damgalanır + yeni satır ("corrected");
 *                          claim 0 satır ya da yeni satır çakışırsa 409
 */
export async function applyKursunOperationTx(tx: Tx, a: ApplyKursunArgs): Promise<KursunWriteOutcome> {
  const active = await readActive(tx, a);
  if (!active) {
    if ((await insertActive(tx, a)) === 1) return "created";
    const winner = await readActive(tx, a);
    if (winner && (a.valueId === null || winner.propertyValueId === a.valueId)) return "noop";
    throw CONFLICT();
  }
  if (a.valueId === null || active.propertyValueId === a.valueId) return "noop";
  // H7: faturalı işin gramajı (= hizmet kalemi) düzeltilemez — 409 SERVICE_ALREADY_BILLED (fatura no ile).
  await assertWorkNotBilledTx(tx, { rollIds: [a.rollId], workOrderStepId: a.stepId });

  const claimed = await tx.rollOperation.updateMany({
    where: { id: active.id, ...ACTIVE_OPERATION, propertyValueId: active.propertyValueId },
    data: { revokedAt: new Date(), revokedById: a.userId ?? null, revokeReason: KURSUN_CORRECTION_REASON },
  });
  if (claimed.count === 0) throw CONFLICT();
  if ((await insertActive(tx, a)) === 0) throw CONFLICT();
  return "corrected";
}
