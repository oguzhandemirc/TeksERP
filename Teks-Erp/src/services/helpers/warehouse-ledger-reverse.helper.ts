// =============================================================================
// STOK DEFTERİ — TERS KAYIT KAPISI
// =============================================================================
// "Bu işlemi geri al" yolunun tek kapısı. Yazma kapısından (`warehouse-ledger.helper`)
// AYRI dosyadır: ikisi farklı soruyu cevaplar ve tek dosyada uzunluk tavanını
// (`max-lines`, 300) aşıyorlardı.
//
// ⚠️ Geri alma ileri satırı NE SİLER NE DEĞİŞTİRİR: bugüne bir ters satır yazar ve
// bağı `reversesMovementId`e düşer. "Bu satır ters kayıt mı" sorusunun TEK cevabı
// o bağdır; enum değeri (`*_REVERSAL`) yalnız betimleyicidir.
// =============================================================================
import { WarehouseEventType, type Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { postStockMove, type StockMoveEnd } from "./warehouse-ledger.helper";

type Tx = Prisma.TransactionClient;

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
    // ⚠️ UCUN VARLIĞINI STATÜ BELİRLER, DEPO DEĞİL: stok dışı uçta `warehouseId`
    // meşru olarak NULL'dur (K1). Eski koşul `toWarehouseId && toStatus` idi ve
    // stok dışı ucu "yok" sayardı — sevk satırının tersi `from`suz doğar, yani
    // "mal SHIPPED'ten geri geldi" ucu kaybolurdu.
    from: fwd.toStatus !== null ? { warehouseId: fwd.toWarehouseId, status: fwd.toStatus } : undefined,
    to: fwd.fromStatus !== null ? { warehouseId: fwd.fromWarehouseId, status: fwd.fromStatus } : undefined,
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
 * Defterin doğruluk başlangıcı (epoch) ÇİZİLDİ Mİ — tek kaynak `OPENING_BALANCE`
 * satırının varlığı. Açılış fotoğrafı betiğinin kendi ③ guard'ı da bunu okur
 * (`scripts/acilis_fotografi_stok_defteri.ts`): ikinci bir "epoch var mı" gerçeği
 * doğmasın diye aynı olgu sorulur, bir bayrak değil.
 */
async function epochCizildiMi(tx: Tx): Promise<boolean> {
  const n = await tx.warehouseMovement.count({
    where: { eventType: WarehouseEventType.OPENING_BALANCE },
  });
  return n > 0;
}

/**
 * STATÜSÜZ (eski kapıdan yazılmış) ileri satırın tersini yazar: **bağ ileri
 * satıra, uçlar ÇAĞIRANIN verdiği canlı veriden, metraj ileri satırdan.**
 *
 * Neden ayrı fonksiyon: `reverseStockMove` uçları ileri satırdan AYNALAR, ama
 * statüsüz satırın aynalanacak ucu yoktur ve kapı fırlatır. Üç seçenek ölçüldü
 * (tasarım K4): satırı atlamak Σ'yı eksik bırakır; bağsız yeni ileri satır yazmak
 * çift storno seddini (unique) kaybeder ve "bu satır ters kayıt mı" sorusunu
 * cevapsız bırakır; bu üçüncü yol ikisini de korur.
 *
 * ⚠️ KISIT KODDA ZORLANIR, YORUMLA DEĞİL — ve iki koşullu: dal yalnız satır
 * statüsüz **ve** (satır `preEpoch` damgalı **ya da** epoch HENÜZ ÇİZİLMEMİŞ) ise
 * açılır. İkinci şart olmadan kısıt bu dilimin penceresinde sağlanamıyordu:
 * fotoğrafın `--apply`si K=0'a bağlı, yani epoch zincirin SONUNDA çiziliyor;
 * o güne kadar `preEpoch` damgası hiçbir satırda yok.
 *
 * ⚠️ Epoch çizildikten SONRA `preEpoch = false` + statüsüz satır bir HATA
 * SİNYALİDİR (tasarım D6: taşıma bitince `statusuzAtlanan > 0` kırmızıya döner)
 * ve bu dal onu SUSTURMAZ, fırlatır. Kısıt gevşerse legacy yol yeni satırları
 * sessizce yutmaya başlar ve sinyal kalıcı olarak kaybolur.
 */
export async function reverseLegacyStockMove(
  tx: Tx,
  movementId: string,
  args: {
    reasonCode: string;
    /** Ters satırın ÇIKIŞ ucu — canlı veriden (ileri satırda statü yok). */
    from?: StockMoveEnd;
    /** Ters satırın GİRİŞ ucu — canlı veriden. */
    to?: StockMoveEnd;
    eventType?: WarehouseEventType;
    userId?: string | null;
    notes?: string | null;
  },
): Promise<string> {
  const fwd = await tx.warehouseMovement.findUniqueOrThrow({
    where: { id: movementId },
    select: {
      rollId: true, eventType: true, qty: true,
      fromStatus: true, toStatus: true, preEpoch: true,
      transformGroupId: true, rollVarianceId: true, workOrderStepId: true,
      transferId: true, goodsReceiptId: true, shipmentId: true,
      rollReturnId: true, sackId: true, stockCountId: true,
      reversesMovementId: true,
    },
  });
  if (fwd.reversesMovementId !== null) {
    throw AppError.conflict("Ters kaydın tersi yazılamaz — gerekiyorsa yeni bir ileri hareket yazılır");
  }
  if (fwd.fromStatus !== null || fwd.toStatus !== null) {
    throw AppError.internal(
      "Statülü satır legacy dala girmez — uçları ileri satırdan aynalanabilir, `reverseStockMove` kullanılır",
    );
  }
  if (!fwd.preEpoch && (await epochCizildiMi(tx))) {
    throw AppError.internal(
      `Epoch sonrası statüsüz defter satırı (${movementId}) — legacy dal değil, TUTARSIZLIK: ` +
        "fotoğraftan sonra her satırın ucu kurulabilir olmalı",
    );
  }
  return postStockMove(tx, {
    rollId: fwd.rollId,
    eventType: args.eventType ?? fwd.eventType,
    // Metraj İLERİ SATIRDAN — canlı metraj iptal yollarında 0'a çekilmiş olabilir.
    qty: fwd.qty,
    from: args.from,
    to: args.to,
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
  /**
   * İleri satırın adım damgası (bugünden sonraki adım satırlarında dolu).
   *
   * ⚠️ Bir ADIMA AİT OLMAYAN yollar (topun iptali gibi) açıkça `null` geçer —
   * alan opsiyonel DEĞİL, çünkü "unutuldu" ile "adımı yok" ayrımı kaybolursa
   * kapsamsız ters kayıt sınıfı geri döner. Prisma'da `workOrderStepId: null`
   * zaten "damgasız satır" demek, yani sorgu dalı değişmez.
   */
  workOrderStepId: string | null;
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
