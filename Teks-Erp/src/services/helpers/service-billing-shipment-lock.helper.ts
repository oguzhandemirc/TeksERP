// Hizmet faturası bağının sevkiyat kilidi (H7/H8): bağ yazan fatura tx'i 8023 sevkiyat uzayını İLK ifade olarak
// alır ve DISPATCHED'i kilit altında taze doğrular. `service-billing.helper`dan ayrıldı (dosya boyu); davranış aynı.
import { Prisma, ShipmentStatus } from "@prisma/client";
import { lockShipmentScopeTx } from "./shipment-locks.helper";
import { AppError } from "../../utils/app-error";

type Tx = Prisma.TransactionClient;

/**
 * Bağlı taslak sevk geri almayla serileşir: 8023 sevkiyat kilidi (tx'in İLK ifadesi olarak çağrılır) + taze durum.
 * `undoDispatch` aynı kilit altında bağları sayar — kilitsiz taslak phantom bağ doğururdu.
 */
export async function lockBillableShipmentTx(tx: Tx, shipmentId: string): Promise<void> {
  await lockBillableShipmentsTx(tx, [shipmentId]);
}

/**
 * H8 dönem taslağı: n sevkiyat → 8023 kilitleri id sırasıyla (deterministik; çok kilit deadlock'suz), ÖNCE hepsi
 * kilitlenir, sonra taze durum okunur. Sıralanmış tek kilit = `lockBillableShipmentTx`.
 */
export async function lockBillableShipmentsTx(tx: Tx, shipmentIds: string[], opts: { assertDispatched?: boolean } = {}): Promise<void> {
  const ids = [...new Set(shipmentIds)].sort();
  for (const id of ids) await lockShipmentScopeTx(tx, id);
  if (opts.assertDispatched !== false) await assertShipmentsDispatchedTx(tx, ids);
}

/** Kilit ALTINDA taze durum: bağ yazılacak her sevkiyat hâlâ DISPATCHED (değilse 409). */
export async function assertShipmentsDispatchedTx(tx: Tx, shipmentIds: string[]): Promise<void> {
  const ids = [...new Set(shipmentIds)];
  if (ids.length === 0) return;
  const live = await tx.shipment.count({ where: { id: { in: ids }, status: ShipmentStatus.DISPATCHED } });
  if (live !== ids.length) {
    throw AppError.conflict("Sevkiyat artık sevk edilmiş durumda değil — hizmet işleri faturalanamaz. Ekranı yenileyin.", { code: "SHIPMENT_NOT_DISPATCHED" });
  }
}
