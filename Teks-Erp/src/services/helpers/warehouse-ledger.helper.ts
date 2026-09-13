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
//   • DEPO KESİMİ ÇOCUĞU — kesim bir DÖNÜŞÜMDÜR, hareket değil. Mal zaten o depoda
//     ve toplam metraj değişmiyor; çocuğa ENTRY yazmak depoya gireni İKİ KEZ
//     saydırırdı (100 m top 2×50 olunca depoya 100 m daha girmiş görünür).
//     ⚠️ Kural yalnız ebeveyn de STOKTAYKEN geçerlidir: açık kumaş (IN_PRODUCTION)
//     kesimi çocuğu stok kümesine İLK KEZ girer ve PRODUCTION satırı alır
//     (`TAMBUR_CUT`, hüküm §11 giriş kalemi 2026-09-13/14).
//   • STATÜ TERFİSİ (`STOCK → WAREHOUSE`) — konum değişmiyor.
//   • BACKFILL — açılış durumu topun kendi satırındadır.
//
// BEST-EFFORT DEĞİL: defter yazımı çağıranın transaction'ı İÇİNDE koşar. Sevk
// commit olup defter satırı düşerse "mal gitti ama defterde yok" durumu doğardı.
// =============================================================================
import { WarehouseEventType, type Prisma, type RollStatus } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { WAREHOUSE_STOCK_STATUSES } from "./warehouse-stock.helper";

type Tx = Prisma.TransactionClient;

/**
 * Satır yazılabilir mi — ÜÇ kapının ORTAK eşiği ve DB seddinin ikizi
 * (`CHECK (qty > 0)`, VALIDATE edilmiş, tüm yazıcılar için canlı).
 *
 * ⚠️ Eşik üç yerde elle tekrarlandığında ayrıştı: eski kapılar `qty = 0`ı
 * GEÇİRİYOR, sed ise reddediyordu. Sonuç 23514 idi ve `createMany` tek sorgu
 * olduğu için TÜM küme düşüp çağıranın (sevkiyat · transfer · sayım) tx'ini
 * ham Postgres hatasıyla geri sarıyordu. Kurşun açık kumaşın `currentQty: 0`
 * ile depoya inmesi bu yolu bayraksız tetikliyordu.
 *
 * ⚠️ 0 metraj "yazılamaz" demek "hata" demek DEĞİL: taşınacak mal yok, yani
 * hareket de yok. Eski kapılar bunu ATLAR (konum defteri), stok defteri kapısı
 * ise FIRLATIR — orada 0 metraj çağıranın hesap hatasıdır.
 */
export function qtyYazilabilir(qty: Prisma.Decimal | number | string): boolean {
  const q = Number(qty);
  return Number.isFinite(q) && q > 0;
}

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
 * Yazılamaz satırda ne olacağı — **ÇAĞRI YERİ BEYAN EDER, varsayılanı YOKTUR.**
 *
 * Satır İKİ sebeple yazılamaz: metraj 0/geçersiz **ya da** iki depo ucu da boş.
 * Politika **ikisini birden** kapsar:
 *   • `"skip"` — MEŞRU atlama: taşınacak mal yok. Atlandığı ÇAĞIRANA DÖNER.
 *   • `"throw"` — TUTARSIZLIK SİNYALİ: bu yolda satırın olmaması bir veri hatası.
 *
 * ⚠️ Alan adı `onZeroQty` DEĞİL: iki sebebi kapsayan bir politikaya yalnız birinin
 * adını vermek, okuyanı uçsuzluk dalının politikasız olduğuna inandırır — nitekim
 * öyle oldu (aşağıya bak).
 */
export interface UnwritableRowPolicy {
  onUnwritable: "skip" | "throw";
}

/**
 * Satırın yazılacak bir DEPO UCU var mı — **politikaya TABİDİR** (2026-09-13).
 *
 * ⚠️ ESKİ DAVRANIŞ ve neden kalktı: bu dal politikaya bakmadan `false` dönüyordu,
 * yani deposuz topun sevki defter satırı yazmadan SESSİZCE geçiyordu (ölçüldü:
 * iki top sevk edilip tek `SHIPMENT` satırı yazıldı). Gerekçesi "defter öncesi
 * doğan deposuz topların sevki kilitlenmesin"di; o gerekçe iki ayaktan da boşaldı
 * — popülasyon 0'a indi (backfill) ve yeni deposuz top DOĞAMAZ
 * (`resolveTargetWarehouseId` artık `null` dönmüyor). Üstelik politikayı geçiren
 * yedi çağıranın yedisi de `"throw"` diyordu: fonksiyon bu beyanı metraj için
 * onurlandırıp uçsuzluk için eziyordu.
 *
 * ⚠️ Bu satırdaki sayı bir İDDİADIR ve süresi dolar: **ölçüldü 2026-09-13,
 * fabrikanın canlı yedeğinde — deposuz top 0.** Sayı yeniden sıfırdan büyürse (yeni bir
 * doğuş yolu resolver'ı atlarsa) bu kapı sahada sevki durdurur; o gün doğru iş
 * kapıyı gevşetmek değil backfill koşmaktır.
 */
function hasWarehouseEnd(entry: WarehouseLedgerEntry): boolean {
  return Boolean(entry.fromWarehouseId || entry.toWarehouseId);
}

function isWritable(entry: WarehouseLedgerEntry): boolean {
  return hasWarehouseEnd(entry) && qtyYazilabilir(entry.qty);
}

/** Yazılamazlığın sebebini ADIYLA söyler — "yazılamaz" tek başına teşhis değil. */
function unwritableReason(entry: WarehouseLedgerEntry): string {
  if (!hasWarehouseEnd(entry)) return "iki depo ucu da boş (deposuz top)";
  return `metraj ${String(entry.qty)}`;
}

/**
 * Tek satır yazar. Yazılamaz satırda davranış `policy`den gelir; dönen değer
 * satırın YAZILIP YAZILMADIĞIDIR — meşru atlama bile sayılabilsin diye.
 */
export async function writeWarehouseMovement(
  tx: Tx,
  entry: WarehouseLedgerEntry,
  policy: UnwritableRowPolicy,
): Promise<boolean> {
  if (!isWritable(entry)) {
    if (policy.onUnwritable === "throw") {
      throw AppError.internal(
        `Defter satırı yazılamaz (${unwritableReason(entry)}) — bu yolda satırın olmaması veri hatasıdır`,
      );
    }
    return false;
  }

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
  return true;
}

/**
 * Çok satırlı yazım (sevk, transfer, toplu iptal). `createMany` ile TEK sorgu —
 * yüzlerce topluk sevkte satır-satır insert perf kuralı 9 ihlalidir.
 *
 * Dönen değer YAZILAN satır sayısıdır; `"skip"` politikasında atlanan sayısı
 * `entries.length - dönen` ile okunur (çağıran onu bir yüzeye basar).
 */
export async function writeWarehouseMovements(
  tx: Tx,
  entries: WarehouseLedgerEntry[],
  policy: UnwritableRowPolicy,
): Promise<number> {
  if (policy.onUnwritable === "throw") {
    // ⚠️ HEPSİ YA HİÇ: denetim insert'ten ÖNCE, tekil kapıyla AYNI yüklemle.
    // Eskiden yalnız metraj denetlenirdi ve uçsuz satır süzgeçte sessizce düşerdi
    // — sevkte "iki top çıktı, tek satır yazıldı" tam buradan geliyordu.
    const invalidIndex = entries.findIndex((e) => !isWritable(e));
    if (invalidIndex >= 0) {
      throw AppError.internal(
        `Defter satırı yazılamaz (küme indeksi ${invalidIndex}, ${unwritableReason(entries[invalidIndex]!)}) — bu yolda satırın olmaması veri hatasıdır`,
      );
    }
  }
  const rows = entries
    .filter(isWritable)
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

/**
 * Hareketin bir ucu: fiziksel depo + topun O UÇTAKİ statüsü. İKİ BİÇİM alır ve
 * ikisini TEK kural ayırır (`assertEndShape`):
 *
 *   • STOK UCU      — `warehouseId` dolu ∧ `status ∈ WAREHOUSE_STOCK_STATUSES`
 *   • STOK DIŞI UÇ  — `warehouseId` NULL ∧ `status ∉ WAREHOUSE_STOCK_STATUSES`
 *
 * Stok dışı uç DEPO TAŞIMAZ ama STATÜ TAŞIR: `SHIPPED` · `AT_KARTELA` ·
 * `CANCELLED` bir rafta değildir, ama satır "nereye gitti"yi söylemek zorundadır
 * — "WAREHOUSE'tan SHIPPED'e gitti" cümlesi eski tipe yazılamıyordu.
 */
export interface StockMoveEnd {
  warehouseId: string | null;
  status: RollStatus;
}

/**
 * K1 — uç biçiminin TEK kuralı: `warehouseId === null ⇔ status ∉ stok kümesi`.
 *
 * İki yön İKİ AYRI hatayı kapatır ve ikisi de sessiz olmamalı:
 *   • stok statüsü + deposuz ⇒ "depoda ama neresi belli değil" bir defter satırı
 *     olamaz. Deposuz top stok kümesine giremez (tasarım K6); eski kapının bu
 *     satırı SESSİZCE atlayan süzgeci (`hasWarehouseEnd`) yeni kapıya taşınmaz.
 *   • stok dışı statü + depolu ⇒ mal rafta değilken rafı adlandırmak, Σ'ya
 *     girmeyecek bir depo atfı üretir ve as-of kırılımını yanıltır.
 */
function assertEndShape(end: StockMoveEnd, side: "from" | "to"): void {
  const stokStatusu = WAREHOUSE_STOCK_STATUSES.includes(end.status);
  if (stokStatusu && end.warehouseId === null) {
    throw AppError.internal(
      `Stok hareketinin ${side} ucu stok statüsünde (${end.status}) ama deposuz — ` +
        `"depoda ama hangi depoda belli değil" defterde yazılamaz`,
    );
  }
  if (!stokStatusu && end.warehouseId !== null) {
    throw AppError.internal(
      `Stok hareketinin ${side} ucu stok dışı statüde (${end.status}) ama depo taşıyor — ` +
        `stok dışı uç depo taşımaz`,
    );
  }
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
  if (!qtyYazilabilir(input.qty)) {
    throw AppError.internal(`Stok hareketi metrajı pozitif olmalı (gelen: ${String(input.qty)})`);
  }
  if (!input.from && !input.to) {
    throw AppError.internal("Stok hareketinin en az bir ucu (çıkış ya da giriş) dolu olmalı");
  }
  if (input.from) assertEndShape(input.from, "from");
  if (input.to) assertEndShape(input.to, "to");
  // STOK DIŞINDAN STOK DIŞINA SATIR YOK (tasarım §64'ün mekanik hâli). Uçlar
  // nullable olduğu andan itibaren "en az bir uç dolu" kontrolü bunu ARTIK
  // karşılamıyor: `SHIPPED → AT_KARTELA` gibi bir satır tipçe yazılabilir hâle
  // gelir, Σ'ya hiç girmez ve defteri stok dışı hareketlerle şişirir. Doğrudan
  // fason sevki · kartela tüketimi · PLANNED sevkiyat iptali bu sınıftadır ve
  // satırsız kalmaları bilinçlidir.
  if (input.from?.warehouseId == null && input.to?.warehouseId == null) {
    throw AppError.internal(
      "Stok hareketinin en az bir ucu STOK KÜMESİNDE olmalı — stok dışından stok dışına satır yazılmaz " +
        `(from: ${input.from?.status ?? "yok"} → to: ${input.to?.status ?? "yok"})`,
    );
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
