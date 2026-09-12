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
import { WarehouseEventType, type Prisma, type RollStatus } from "@prisma/client";
import { AppError } from "../../utils/app-error";

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
  /** Sayım fark fişi / stornosu — kaynak belge bağı. */
  stockCountId?: string | null;
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
      stockCountId: entry.stockCountId ?? null,
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
      stockCountId: e.stockCountId ?? null,
      userId: e.userId ?? null,
      notes: e.notes ?? null,
    }));
  if (rows.length === 0) return 0;
  const res = await tx.warehouseMovement.createMany({ data: rows });
  return res.count;
}

// -----------------------------------------------------------------------------
// STOK DEFTERİ KAPISI (2026-09-12) — `postStockMove`
// -----------------------------------------------------------------------------
// Yukarıdaki iki yazıcı KONUM defterinin kapısıdır ve anlamsız satırı SESSİZCE
// atlar. Stok defterinde sessiz atlama = yazılmamış hareket = sessizce kayan
// toplam; bu yüzden yeni kapı FIRLATIR ve olayın iki ucundaki top statüsünü
// (`fromStatus`/`toStatus`) zorunlu kılar — stok kümesi tanımı satıra gömülmesin.
// Tasarım: `docs/design/DEPO-STOK-DEFTERI-TASARIM.md` §D2/§D5.
// -----------------------------------------------------------------------------

/** Hareketin bir ucu: fiziksel depo + topun O UÇTAKİ statüsü. */
export interface StockMoveEnd {
  warehouseId: string;
  status: RollStatus;
}

export interface StockMoveInput {
  rollId: string;
  eventType: WarehouseEventType;
  /** Olaydaki DEĞİŞİM miktarı (delta) — topun o anki toplamı değil. Pozitif. */
  qty: Prisma.Decimal | number | string;
  /** Stoktan çıkış ucu (yoksa olay bir giriştir). */
  from?: StockMoveEnd;
  /** Stoğa giriş ucu (yoksa olay bir çıkıştır). */
  to?: StockMoveEnd;
  /** Sebep kataloğu satırı — ayrıntı enum'a değil buraya yazılır. */
  reasonCode: string;
  transformGroupId?: string | null;
  rollVarianceId?: string | null;
  workOrderStepId?: string | null;
  reversesMovementId?: string | null;
  transferId?: string | null;
  goodsReceiptId?: string | null;
  shipmentId?: string | null;
  rollReturnId?: string | null;
  sackId?: string | null;
  stockCountId?: string | null;
  userId?: string | null;
  notes?: string | null;
}

/**
 * Satırı kuran TEK yer — doğrulama da burada. Tekil ve toplu kapı aynı map'i
 * kullanır; ikisine ayrı map yazılırsa `writeWarehouseMovements`in 2026-08-14'te
 * `sackId`i sessizce düşüren allowlist hatası stok defterinde tekrarlanır.
 */
function stockMoveRow(input: StockMoveInput): Prisma.WarehouseMovementCreateManyInput {
  const qty = Number(input.qty);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw AppError.internal(`Stok hareketi metrajı pozitif olmalı (gelen: ${String(input.qty)})`);
  }
  if (!input.from && !input.to) {
    throw AppError.internal("Stok hareketinin en az bir ucu (çıkış ya da giriş) dolu olmalı");
  }
  return {
    rollId: input.rollId,
    eventType: input.eventType,
    qty: input.qty as Prisma.Decimal,
    fromWarehouseId: input.from?.warehouseId ?? null,
    toWarehouseId: input.to?.warehouseId ?? null,
    fromStatus: input.from?.status ?? null,
    toStatus: input.to?.status ?? null,
    reasonCode: input.reasonCode,
    transformGroupId: input.transformGroupId ?? null,
    rollVarianceId: input.rollVarianceId ?? null,
    workOrderStepId: input.workOrderStepId ?? null,
    reversesMovementId: input.reversesMovementId ?? null,
    transferId: input.transferId ?? null,
    goodsReceiptId: input.goodsReceiptId ?? null,
    shipmentId: input.shipmentId ?? null,
    rollReturnId: input.rollReturnId ?? null,
    sackId: input.sackId ?? null,
    stockCountId: input.stockCountId ?? null,
    userId: input.userId ?? null,
    notes: input.notes ?? null,
  };
}

/** Tek satır yazar ve id'sini döner. Anlamsız satırda ATLAMAZ, FIRLATIR. */
export async function postStockMove(tx: Tx, input: StockMoveInput): Promise<string> {
  const row = await tx.warehouseMovement.create({
    data: stockMoveRow(input),
    select: { id: true },
  });
  return row.id;
}

/**
 * TOPLU kardeş — yazılan satır sayısını döner. Sayım/sevk/transfer gibi yollar
 * tavanda yüzlerce top taşır ve satır-satır insert perf kuralı 9 ihlalidir;
 * bu kapı TEK `createMany` atar.
 *
 * ⚠️ HEPSİ YA HİÇ: doğrulama TÜM satırlar için insert'ten ÖNCE koşar, yani
 * kümedeki tek bozuk satır hiçbir şey yazılmadan fırlatır — yarım yazılmış bir
 * küme, mutabakatı sessizce kaydıran en kötü sonuçtur.
 *
 * ⚠️ `createMany` id DÖNMEZ: ters kayıt bağı (`reversesMovementId`) kurulacak
 * ileri satırlar bu kapıdan GEÇEMEZ, tekil `postStockMove` kullanır.
 */
export async function postStockMoves(tx: Tx, inputs: StockMoveInput[]): Promise<number> {
  if (inputs.length === 0) return 0;
  const rows = inputs.map(stockMoveRow);
  const res = await tx.warehouseMovement.createMany({ data: rows });
  return res.count;
}

/**
 * İleri satırın TERSİNİ bugüne yazar: yön aynalanır, `qty` İLERİ SATIRDAN
 * kopyalanır (canlı metrajdan değil — ileri kayıttan sonra metraj değişmiş
 * olabilir) ve bağ `reversesMovementId`e yazılır. Aynı satırın iki kez
 * terslenmesini DB'deki unique kapatır.
 *
 * `eventType` verilmezse ileri satırınki KOPYALANIR. Verilirse o yazılır — bazı
 * yollar ters satırı panelde kendi adıyla göstermek ister (`CANCEL_REVERSAL`).
 * Bu yalnız BETİMLEYİCİDİR: "bu satır ters kayıt mıdır" sorusunun tek cevabı
 * `reversesMovementId IS NOT NULL`tır, enum değeri değil (tasarım §D2a).
 */
export async function reverseStockMove(
  tx: Tx,
  movementId: string,
  args: {
    reasonCode: string;
    eventType?: WarehouseEventType;
    userId?: string | null;
    notes?: string | null;
  },
): Promise<string> {
  const fwd = await tx.warehouseMovement.findUniqueOrThrow({
    where: { id: movementId },
    select: {
      rollId: true, eventType: true, qty: true,
      fromWarehouseId: true, toWarehouseId: true,
      fromStatus: true, toStatus: true,
      transferId: true, goodsReceiptId: true, shipmentId: true,
      rollReturnId: true, sackId: true, stockCountId: true,
      reversesMovementId: true,
    },
  });
  if (fwd.reversesMovementId !== null) {
    throw AppError.conflict("Ters kaydın tersi yazılamaz — gerekiyorsa yeni bir ileri hareket yazılır");
  }
  return postStockMove(tx, {
    rollId: fwd.rollId,
    eventType: args.eventType ?? fwd.eventType,
    qty: fwd.qty,
    from: fwd.toWarehouseId && fwd.toStatus ? { warehouseId: fwd.toWarehouseId, status: fwd.toStatus } : undefined,
    to: fwd.fromWarehouseId && fwd.fromStatus ? { warehouseId: fwd.fromWarehouseId, status: fwd.fromStatus } : undefined,
    reasonCode: args.reasonCode,
    reversesMovementId: movementId,
    transferId: fwd.transferId,
    goodsReceiptId: fwd.goodsReceiptId,
    shipmentId: fwd.shipmentId,
    rollReturnId: fwd.rollReturnId,
    sackId: fwd.sackId,
    stockCountId: fwd.stockCountId,
    userId: args.userId ?? null,
    notes: args.notes ?? null,
  });
}
