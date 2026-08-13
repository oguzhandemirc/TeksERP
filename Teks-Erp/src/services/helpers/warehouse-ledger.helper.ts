// =============================================================================
// DEPO HAREKET DEFTERİ — tek yazma kapısı
// =============================================================================
// "Mal hangi depoya girdi / hangisinden çıktı" sorusunun cevabı. Topun KENDİ
// `warehouseId`'si NEREDE olduğunu söyler; bu defter NASIL geldiğini/gittiğini.
//
// ⚠️ `RollMovement` ile karıştırma: o, İŞ EMRİ ADIMINA giriş/çıkıştır
// (`workOrderStepId` NOT NULL) ve depo olayları oraya sığmaz.
//
// ⚠️ NE ZAMAN SATIR YAZILMAZ (üçü de bilinçli):
//   • KESİM ÇOCUĞU — kesim bir DÖNÜŞÜMDÜR, hareket değil. Mal zaten o depoda ve
//     toplam metraj değişmiyor; çocuğa ENTRY yazmak depoya gireni İKİ KEZ
//     saydırırdı (100 m top 2×50 olunca depoya 100 m daha girmiş görünür).
//   • STATÜ TERFİSİ (`STOCK → WAREHOUSE`) — konum değişmiyor.
//   • BACKFILL — açılış durumu topun kendi satırındadır.
//
// BEST-EFFORT DEĞİL: defter yazımı çağıranın transaction'ı İÇİNDE koşar. Sevk
// commit olup defter satırı düşerse "mal gitti ama defterde yok" durumu doğardı.
// =============================================================================
import { WarehouseEventType, type Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export interface WarehouseLedgerEntry {
  rollId: string;
  eventType: WarehouseEventType;
  /** Olay anındaki metraj — POZİTİF verilir; yönü `eventType` söyler. */
  qty: Prisma.Decimal | number | string;
  fromWarehouseId?: string | null;
  toWarehouseId?: string | null;
  transferId?: string | null;
  goodsReceiptId?: string | null;
  shipmentId?: string | null;
  rollReturnId?: string | null;
  /** Top bu harekete bir çuvalın ÜYESİ olarak girdiyse çuvalın kimliği —
   *  transfer iptalinin "top hâlâ AYNI çuvalda mı" guard'ı buradan okur. */
  sackId?: string | null;
  userId?: string | null;
  notes?: string | null;
}

/**
 * Tek satır yazar. `qty` NEGATİF ya da depo bilgisi TAMAMEN boş ise satır
 * YAZILMAZ (sessizce atlanır): anlamsız bir defter satırı, satır olmamasından
 * kötüdür — "bu depoya ne girdi" toplamını kirletir.
 */
export async function writeWarehouseMovement(tx: Tx, entry: WarehouseLedgerEntry): Promise<void> {
  const qtyNum = Number(entry.qty);
  if (!Number.isFinite(qtyNum) || qtyNum < 0) return;
  if (!entry.fromWarehouseId && !entry.toWarehouseId) return;

  await tx.warehouseMovement.create({
    data: {
      rollId: entry.rollId,
      eventType: entry.eventType,
      qty: entry.qty as Prisma.Decimal,
      fromWarehouseId: entry.fromWarehouseId ?? null,
      toWarehouseId: entry.toWarehouseId ?? null,
      transferId: entry.transferId ?? null,
      goodsReceiptId: entry.goodsReceiptId ?? null,
      shipmentId: entry.shipmentId ?? null,
      rollReturnId: entry.rollReturnId ?? null,
      sackId: entry.sackId ?? null,
      userId: entry.userId ?? null,
      notes: entry.notes ?? null,
    },
  });
}

/**
 * Çok satırlı yazım (sevk, transfer, toplu iptal). `createMany` ile TEK sorgu —
 * yüzlerce topluk sevkte satır-satır insert perf kuralı 9 ihlalidir.
 */
export async function writeWarehouseMovements(tx: Tx, entries: WarehouseLedgerEntry[]): Promise<number> {
  const rows = entries
    .filter((e) => {
      const q = Number(e.qty);
      return Number.isFinite(q) && q >= 0 && (e.fromWarehouseId || e.toWarehouseId);
    })
    .map((e) => ({
      rollId: e.rollId,
      eventType: e.eventType,
      qty: e.qty as Prisma.Decimal,
      fromWarehouseId: e.fromWarehouseId ?? null,
      toWarehouseId: e.toWarehouseId ?? null,
      transferId: e.transferId ?? null,
      goodsReceiptId: e.goodsReceiptId ?? null,
      shipmentId: e.shipmentId ?? null,
      rollReturnId: e.rollReturnId ?? null,
      // ⚠️ Bu map bir ALLOWLIST'tir (z.object / elle kurulan gövde dersinin
      // defter ikizi): yeni alan Entry tipine eklenip BURAYA yazılmazsa satır
      // alanı SESSİZCE düşürür — 2026-08-14'te sackId ile birebir yaşandı ve
      // bekçi (§1d) ilk koşuda yakaladı. Tekil writeWarehouseMovement ile bu
      // map'i birlikte güncelle.
      sackId: e.sackId ?? null,
      userId: e.userId ?? null,
      notes: e.notes ?? null,
    }));
  if (rows.length === 0) return 0;
  const res = await tx.warehouseMovement.createMany({ data: rows });
  return res.count;
}
