// =============================================================================
// FASON DEVERE — FİRE defteri yazarı (`WarpingYarnWaste`; kapanış ve iade penceresi AYNI fonksiyon)
// =============================================================================
// Kaynak tam biri: kapanış (`settlementId`) ya da iade hareketi (`returnMovementId`) — CHECK `warping_yarn_wastes_source_ck`.
// Fire tutmayı düşer (`warping-yarn-open.helper`); ters yol WASTE_CANCEL (`reversesId`, tek ters): kapanış firesini
// `reopen.ts`, iade firesini iade stornosu (`yarn-return-waste.ts`) yazar. Çağıran kalemleri önceden `FOR UPDATE` kilitler.
// =============================================================================
import { Prisma } from "@prisma/client";
import { WARPING_WASTE, WARPING_WASTE_CANCEL } from "../helpers/warping-yarn-open.helper";

type Tx = Prisma.TransactionClient;

export type WasteSource = { settlementId: string; returnMovementId?: never } | { returnMovementId: string; settlementId?: never };

export interface WasteLine { dispatchItemId: string; qtyKg: Prisma.Decimal; overTolerance: boolean }

/** İleri fire satırları (WASTE). Boş liste = yazım yok. */
export async function writeWastesTx(tx: Tx, src: WasteSource, warpingOrderId: string, lines: WasteLine[], reason: string | null, userId: string): Promise<void> {
  const rows = lines.filter((l) => l.qtyKg.gt(0));
  if (rows.length === 0) return;
  await tx.warpingYarnWaste.createMany({
    data: rows.map((l) => ({
      settlementId: src.settlementId ?? null, returnMovementId: src.returnMovementId ?? null, warpingOrderId, dispatchItemId: l.dispatchItemId,
      kind: WARPING_WASTE, qtyKg: l.qtyKg, overTolerance: l.overTolerance, reason, createdById: userId,
    })),
  });
}

/** Ters fire satırları (WASTE_CANCEL) — ileri satır değişmez; `reversesId` @unique çift stornoyu DB'de keser. */
export async function reverseWastesTx(
  tx: Tx, src: WasteSource,
  wastes: Array<{ id: string; dispatchItemId: string; qtyKg: Prisma.Decimal; warpingOrderId: string }>, reason: string, userId: string,
): Promise<void> {
  if (wastes.length === 0) return;
  await tx.warpingYarnWaste.createMany({
    data: wastes.map((w) => ({
      settlementId: src.settlementId ?? null, returnMovementId: src.returnMovementId ?? null, warpingOrderId: w.warpingOrderId, dispatchItemId: w.dispatchItemId,
      kind: WARPING_WASTE_CANCEL, qtyKg: w.qtyKg, reversesId: w.id, reason, createdById: userId,
    })),
  });
}
