// =============================================================================
// STOK DEFTERİ — GİRİŞ ÖLÇÜMÜ DÜZELTMESİ (ENTRY_CORRECTION) tek yazıcısı
// =============================================================================
// Bütün topta (initialQty = currentQty) ölçüm düzeltmesi topun KABUL metrajını
// değiştirir: sapma defterine satır (kayıt düzeltmesi / aşım) + stok defterine
// ADJUST (düşükse çıkış −fark, yüksekse giriş +fark), ikisi bağlı. Kabul-anı
// okuyucuları (`RECEIPT_QTY_REASONS`) bu kodu ENTRY ile birlikte işaretli toplar.
// Yüklem tek yerde: yalnız stok kümesindeki depolu top satır alır (üretimdeki topun
// stok ucu yok; ufuk-öncesi deposuz top satırsız — `adjustRollQty` kapısıyla aynı).
// Ters yolu yok: ters yönde ikinci düzeltme yeni olgudur (karşı olay kendisi).
// =============================================================================
import { Prisma, RollVarianceKind, WarehouseEventType, type RollStatus } from "@prisma/client";
import { STOCK_MOVE_REASON } from "../../constants/stock-move-reasons";
import { VARIANCE_SOURCES } from "../../constants/variance-reasons";
import { recordVarianceTx } from "./roll-variance.helper";
import { postStockMove, qtyYazilabilir } from "./warehouse-ledger.helper";
import { WAREHOUSE_STOCK_STATUSES } from "./warehouse-stock.helper";

type Tx = Prisma.TransactionClient;

/** Claim ÖNCESİ okunmuş top — eski metraj, raf ve fiş buradan gelir. */
export interface EntryCorrectionCandidate {
  id: string;
  status: RollStatus;
  warehouseId: string | null;
  currentQty: Prisma.Decimal;
  goodsReceiptId: string | null;
}

/** Sapma + (stok kümesindeyse) defter satırı; sapma satırının id'sini döner (0 farkta null). */
export interface EntryCorrectionInput {
  roll: EntryCorrectionCandidate;
  yeniQty: Prisma.Decimal;
  reason: string | undefined;
  userId: string | null;
}

export async function postEntryCorrectionTx(tx: Tx, input: EntryCorrectionInput): Promise<string | null> {
  const { roll, yeniQty, reason, userId } = input;
  const dusuk = yeniQty.lessThan(roll.currentQty);
  const fark = dusuk ? roll.currentQty.minus(yeniQty) : yeniQty.minus(roll.currentQty);
  const varianceId = await recordVarianceTx(tx, {
    rollId: roll.id,
    kind: dusuk ? RollVarianceKind.RECORD_CORRECTION : RollVarianceKind.OVERAGE,
    qty: fark,
    source: VARIANCE_SOURCES.ENTRY_QTY_CORRECTION,
    reasonCode: dusuk ? "DIGER" : null,
    reasonText: reason?.trim() || "Giriş ölçümü düzeltmesi (Düzelt diyaloğu, gerekçe girilmedi)",
    userId,
  });
  if (roll.warehouseId !== null && WAREHOUSE_STOCK_STATUSES.includes(roll.status) && qtyYazilabilir(fark)) {
    const end = { warehouseId: roll.warehouseId, status: roll.status };
    await postStockMove(tx, {
      rollId: roll.id,
      eventType: WarehouseEventType.ADJUST,
      qty: fark,
      ...(dusuk ? { from: end } : { to: end }),
      reasonCode: STOCK_MOVE_REASON.ENTRY_CORRECTION,
      rollVarianceId: varianceId,
      goodsReceiptId: roll.goodsReceiptId,
      userId,
      notes: (reason ?? "").slice(0, 300) || null,
    });
  }
  return varianceId;
}
