// =============================================================================
// STOK DEFTERİ — ÜRETİME ALMA ÇIKIŞI (PRODUCTION_ISSUE) tek yazıcısı
// =============================================================================
// Raftaki (stok kümesindeki) bir top üretime alınınca mal raftan İNER: defter
// `PRODUCTION` olayı + `PRODUCTION_ISSUE` sebep koduyla bir ÇIKIŞ satırı alır.
// Bu satırı yazan DÖRT yol vardı (üretime alma · manuel taşıma · elle top ·
// redye ayırma) ve üçü yazmıyordu — raf topu üretime satırsız giriyor, mutabakat
// "rafta" sayıyordu (ölçüldü 2026-09-13/14, hüküm dosyası §5). Yüklem tek yerde
// yaşar: stok kümesinde ∧ deposu var ∧ metraj yazılabilir.
//
// ⚠️ Anlık görüntü CLAIM ÖNCESİ olmalı: claim sonrası statü IN_PRODUCTION'dır ve
// "nereden çıktı"yı söylemez. Çağıran tx içinde taze okuduğu satırları verir.
// =============================================================================
import { Prisma, WarehouseEventType, type RollStatus } from "@prisma/client";
import { STOCK_MOVE_REASON } from "../../constants/stock-move-reasons";
import { postStockMove, qtyYazilabilir } from "./warehouse-ledger.helper";
import { WAREHOUSE_STOCK_STATUSES } from "./warehouse-stock.helper";

type Tx = Prisma.TransactionClient;

/** Claim ÖNCESİ okunmuş top — yön ve metraj buradan gelir. */
export interface ProductionIssueCandidate {
  id: string;
  status: RollStatus;
  warehouseId: string | null;
  currentQty: Prisma.Decimal | number | string;
}

/** Stok kümesinden üretime çıkan top için satır yazılır mı — TEK yüklem. */
export function needsProductionIssue(r: ProductionIssueCandidate): boolean {
  return r.warehouseId !== null && WAREHOUSE_STOCK_STATUSES.includes(r.status) && qtyYazilabilir(r.currentQty);
}

/**
 * Verilen topların stok kümesinden çıkanları için `PRODUCTION_ISSUE` satırı
 * yazar; zaten üretimde olan (stok dışı → stok dışı) top satır almaz.
 * Yazılan satır sayısını döner.
 */
export async function postProductionIssuesTx(
  tx: Tx,
  rolls: readonly ProductionIssueCandidate[],
  args: { workOrderStepId: string; userId?: string | null },
): Promise<number> {
  let written = 0;
  for (const r of rolls) {
    if (!needsProductionIssue(r)) continue;
    await postStockMove(tx, {
      rollId: r.id,
      eventType: WarehouseEventType.PRODUCTION,
      qty: r.currentQty,
      from: { warehouseId: r.warehouseId as string, status: r.status },
      reasonCode: STOCK_MOVE_REASON.PRODUCTION_ISSUE,
      workOrderStepId: args.workOrderStepId,
      userId: args.userId ?? null,
    });
    written++;
  }
  return written;
}
