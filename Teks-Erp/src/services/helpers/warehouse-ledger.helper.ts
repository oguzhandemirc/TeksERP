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
 * Satır iki sebeple yazılamaz: metraj 0/geçersiz ya da iki depo ucu da boş.
 * Bu iki durumun anlamı YOLA GÖRE değişir ve tek bir davranış ikisini birden
 * doğru karşılayamaz:
 *   • `"skip"` — MEŞRU atlama: taşınacak mal ya da yazılacak depo yok (0 metrajlı
 *     topun iptali, deposuz topun düşmesi). Atlandığı ÇAĞIRANA DÖNER, sayılır.
 *   • `"throw"` — TUTARSIZLIK SİNYALİ: bu yolda satırın olmaması bir veri hatası.
 *     Transfer/sevk böyledir; transfer İPTALİ defterden okuduğu için eksik satır
 *     malı hedef depoda MAHSUR bırakır (ölçüldü 2026-09-12: eşiği sessiz atlamaya
 *     çevirmek bu yolu gürültülü hatadan sessiz veri kaybına dönüştürmüştü).
 */
export interface ZeroQtyPolicy {
  onZeroQty: "skip" | "throw";
}

/**
 * Satırın yazılacak bir DEPO UCU var mı. Politikaya TABİ DEĞİL: uçsuzluk her
 * yolda meşru atlamadır, çünkü defter öncesi doğan topların `warehouseId`i NULL
 * (ölçüldü: 4.553 top) ve onların sevki/iadesi çalışmaya devam etmek zorunda.
 * Politika yalnız METRAJ için vardır — uçsuz satırı "tutarsızlık" saymak eski
 * veriyle sevkiyatı kilitlerdi.
 */
function hasWarehouseEnd(entry: WarehouseLedgerEntry): boolean {
  return Boolean(entry.fromWarehouseId || entry.toWarehouseId);
}

/**
 * Tek satır yazar. Yazılamaz satırda davranış `policy`den gelir; dönen değer
 * satırın YAZILIP YAZILMADIĞIDIR — meşru atlama bile sayılabilsin diye.
 */
export async function writeWarehouseMovement(
  tx: Tx,
  entry: WarehouseLedgerEntry,
  policy: ZeroQtyPolicy,
): Promise<boolean> {
  if (!hasWarehouseEnd(entry)) return false;
  if (!qtyYazilabilir(entry.qty)) {
    if (policy.onZeroQty === "throw") {
      throw AppError.internal(
        `Defter satırı yazılamaz (metraj ${String(entry.qty)}) — bu yolda satırın olmaması veri hatasıdır`,
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
  policy: ZeroQtyPolicy,
): Promise<number> {
  if (policy.onZeroQty === "throw") {
    // ⚠️ Yalnız METRAJ denetlenir; uçsuz satır burada da meşru atlamadır.
    const invalidIndex = entries.findIndex((e) => hasWarehouseEnd(e) && !qtyYazilabilir(e.qty));
    if (invalidIndex >= 0) {
      throw AppError.internal(
        `Defter satırı yazılamaz (küme indeksi ${invalidIndex}, metraj ${String(entries[invalidIndex]?.qty)}) — bu yolda satırın olmaması veri hatasıdır`,
      );
    }
  }
  const rows = entries
    .filter((e) => hasWarehouseEnd(e) && qtyYazilabilir(e.qty))
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
  if (!qtyYazilabilir(input.qty)) {
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
      // ⚠️ BAĞ ALANLARININ HEPSİ taşınır. Üçü (transformGroupId · rollVarianceId ·
      // workOrderStepId) eksikti ve ters satır NULL doğuyordu; defter append-only
      // olduğu için o atıf KALICI kayboluyordu (en görünür zararı: tambur ve
      // üretime alma satırlarının `workOrderStepId`i).
      transformGroupId: true, rollVarianceId: true, workOrderStepId: true,
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
    transformGroupId: fwd.transformGroupId,
    rollVarianceId: fwd.rollVarianceId,
    workOrderStepId: fwd.workOrderStepId,
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

/**
 * Topun TERSLENMEMİŞ ileri satırlarının **HEPSİNİ** tersler — "bu top iptal
 * edildi, defterdeki izi tümden sıfırlansın" yolunun kapısı.
 *
 * ⚠️⚠️ YALNIZ TOP TÜMDEN ÖLDÜRÜLÜYORSA KULLANILIR (CANCELLED + `currentQty: 0`).
 * "Şu işlemi geri al" anlamında KULLANILAMAZ — kapsamsız olduğu için başka bir
 * işlemin satırını da tersler. Ölçüldü (2026-09-12): reopen bu kapıyı kullanınca
 * `attachRolls`ın ÇIKIŞ satırını da tersledi ve depoda 100 m HAYALET stok doğdu;
 * üstelik o çıkış `reversesMovementId` unique'i yüzünden kalıcı "terslenmiş"
 * damgası yediği için sapma ileri yolla BİR DAHA kapanmıyordu. Tek satır terslemek
 * için `reverseLatestScopedStockMove` kullan — kapsamı tip düzeyinde zorunludur.
 *
 * ⚠️ Satır SİLİNMEZ: her ileri satıra bugüne yazılan bir ters satır eşlik eder ve
 * bağ `reversesMovementId`e düşer. Aynı satır iki kez terslenemez (DB unique),
 * yani tekrarlayan geri alma turu sessizce ikinci bir ters satır yazmaz.
 *
 * ⚠️ Metraj İLERİ SATIRDAN kopyalanır (`reverseStockMove`), topun canlı
 * metrajından DEĞİL: iptal yolları `currentQty`yi 0'a çekiyor ve canlıdan okumak
 * 0 m'lik bir ters satır yazıp depoda hayalet metraj bırakırdı.
 *
 * ⚠️ STATÜSÜZ satır (iki uç statüsü de NULL) terslenemez — ucu kurulamayan satırın
 * tersi de kurulamaz. Sessizce yutulmaz, sayısı AYRICA döner.
 *
 * ⚠️ Adı "A1 öncesi" DEĞİL: ölçüm (fabrika kopyası, 721 satır) bu kümenin yalnız
 * tarihsel olmadığını gösterdi — ESKİ KAPILAR (transfer · sevk · sayım) bugün de
 * statüsüz satır yazıyor. Yani sayının sıfırdan büyük çıkması "eski veri" değil,
 * "o yolu henüz stok defterine taşımadık" demek. Eski yazıcılar taşındıktan ve
 * açılış bakiyesi backfill'i indikten SONRA bu dal tanım gereği boşalır; o commit'te
 * sayı > 0 bir HATA SİNYALİ hâline gelir ve bekçiye çevrilir (tasarım §D6).
 */
export async function reverseAllRollStockMoves(
  tx: Tx,
  rollIds: string[],
  args: { reasonCode: string; userId?: string | null; notes?: string | null },
): Promise<{ reversed: number; statusuzAtlanan: number }> {
  if (rollIds.length === 0) return { reversed: 0, statusuzAtlanan: 0 };
  const forwards = await tx.warehouseMovement.findMany({
    where: {
      rollId: { in: rollIds },
      // İleri satır: kendisi ters kayıt DEĞİL ve henüz terslenmemiş.
      reversesMovementId: null,
      reversedBy: { none: {} },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, fromStatus: true, toStatus: true },
  });
  let reversed = 0;
  let statusuzAtlanan = 0;
  for (const f of forwards) {
    if (f.fromStatus === null && f.toStatus === null) {
      statusuzAtlanan++;
      continue;
    }
    await reverseStockMove(tx, f.id, args);
    reversed++;
  }
  return { reversed, statusuzAtlanan };
}

/** Hangi ileri satırın terslendiği — TİP DÜZEYİNDE zorunlu, unutulamaz. */
export interface StockMoveScope {
  /** İleri satırın sebep kodu: hangi yazıcının satırını tersliyoruz. */
  reasonCode: string;
  /** İleri satırın adım damgası (bugünden sonraki satırlarda dolu). */
  workOrderStepId: string;
}

/**
 * Kapsam içindeki TEK ileri satırı tersler — "şu işlemi geri al" yolunun kapısı
 * (adımı yeniden açma). Top başına EN YENİ uygun satır seçilir.
 *
 * ⚠️ KAPSAM İKİ ADIMLI SORGUDUR, tek WHERE değil:
 *   ① `reasonCode` + `workOrderStepId = scope.workOrderStepId` (bugünkü yol),
 *   ② bulunamazsa `reasonCode` + `workOrderStepId IS NULL` (GEÇİŞ dalı: damga
 *      eklenmeden önce yazılmış satırlar).
 * `OR workOrderStepId IS NULL` diye TEK yüklemde yazılamaz: o yüklem BAŞKA bir iş
 * emrinin damgalı girişini de aday kümesine sokar ve "geçmişe dönük değiştirme"
 * yasağını çiğner (top daha önce başka WO bitirmişse onun girişi terslenirdi).
 *
 * ⚠️ Satır bulunamazsa SESSİZCE GEÇİLMEZ: `bulunamayan` listesi döner. O durum
 * "defterde olması gereken giriş yok" demektir — gerçek bir tutarsızlık sinyali.
 */
export async function reverseLatestScopedStockMove(
  tx: Tx,
  rollIds: string[],
  scope: StockMoveScope,
  args: { reasonCode: string; userId?: string | null; notes?: string | null },
): Promise<{ reversed: number; statusuzAtlanan: number; bulunamayan: string[] }> {
  const bulunamayan: string[] = [];
  let reversed = 0;
  let statusuzAtlanan = 0;
  for (const rollId of rollIds) {
    const baseWhere = {
      rollId,
      reasonCode: scope.reasonCode,
      reversesMovementId: null,
      reversedBy: { none: {} },
    } satisfies Prisma.WarehouseMovementWhereInput;
    const selectFields = { id: true, fromStatus: true, toStatus: true };
    const stampedRow = await tx.warehouseMovement.findFirst({
      where: { ...baseWhere, workOrderStepId: scope.workOrderStepId },
      orderBy: { createdAt: "desc" },
      select: selectFields,
    });
    const targetRow =
      stampedRow ??
      (await tx.warehouseMovement.findFirst({
        where: { ...baseWhere, workOrderStepId: null },
        orderBy: { createdAt: "desc" },
        select: selectFields,
      }));
    if (!targetRow) {
      bulunamayan.push(rollId);
      continue;
    }
    if (targetRow.fromStatus === null && targetRow.toStatus === null) {
      statusuzAtlanan++;
      continue;
    }
    await reverseStockMove(tx, targetRow.id, args);
    reversed++;
  }
  return { reversed, statusuzAtlanan, bulunamayan };
}
