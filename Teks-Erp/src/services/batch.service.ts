// =============================================================================
// TeksERP — Batch (Parti) Service
// =============================================================================
// Parti = üretime aynı anda giren top grubu; bir iş emri (WorkOrder) N parti içerir.
// Attach dalgasında / sevk-anı auto-attach'te doğar (K3). Refakat kartı parti
// başınadır. "Dal" (eski Roll.batchSplitId = dispatch.id) kavramının yerini alır.
// Detay: docs/design/PARTI-MODELI-TASARIM.md.
//
// Bu servis parti YAŞAM DÖNGÜSÜNÜN tx-içi çekirdeğini sağlar:
//   - createBatchTx            : P kodu üret + Batch + roll üyeliği + refakat kartı (tek tx)
//   - isBatchLockedTx          : parti kilitli mi (fasonda topu var mı — türetilmiş kilit, K14)
//   - assertBatchInWorkOrder   : parti gerçekten bu WO'ya mı ait
//   - deleteIfEmptyAndTraceless: boşalan + izsiz partiyi sil (soft-delete istisnası)
//
// Kod üretimi (P + GGAAYY + NNNN) tx İÇİNDE, sequence okuması closure içinde —
// çağıran `withBarcodeRetry(() => prisma.$transaction(...))` ile sarmalı (P2002 → retry).
// Kart audit'i F273 gereği tx DIŞINDA: createBatchTx `cardRes`'i döner, çağıran
// commit sonrası audit'ler (created ise).
// =============================================================================

import { Prisma, PrintedDocType, RollStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import {
  SHORT_BATCH_MAX,
  SHORT_BATCH_MIN,
  buildDailyCode,
  buildShortBatchCode,
  dailyCodePrefix,
  nextDailySeq,
  nextShortBatchSeq,
  parseShortBatchCode,
} from "../utils/code-format";
import { AuditService } from "./audit.service";
import { readBatchShortNumberEnabled } from "./system-setting.service";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { AppError } from "../utils/app-error";
import { touchWorkOrderTx } from "./helpers/workorder-locks.helper";
// K15 belge cerrahisi: konsolidasyonda kapanan (loser) sevklerin basılı irsaliyeleri
// cancelDispatch ile AYNI mekanizmayla VOID edilir (belge silinmez, filigran alır).
import { printedDocumentService } from "./printed-document.service";
// K16 sevk cerrahisi: splitBatch/moveRolls fasondayken de çalışır — taşınan
// topların açık+outstanding sevk kalemleri hedef partiyi izler (retarget /
// kısmi-bölme yeni sevk / hedef sevkine kalem birleştirme).
import { performDispatchSurgeryTx } from "./helpers/batch-dispatch-surgery.helper";
import {
  markTravelerCardDirtyTx,
  markTravelerCardsDirtyTx,
} from "./helpers/traveler-card-dirty.helper";

// K18: üyelik değişiminde etiketi bayatlamayan (labelDirty atlanacak) TARİHÇE
// statüleri — tüketilmiş/iptal top fiziksel etikete çıkmaz, bayraklanmaz.
// EXPORT: üyelik değiştiren DİĞER işlemler de (dispatch K11 birleştirme, K5
// kalan-böl, manuel taşıma new/join) aynı desenle bayraklar — tek kaynak.
export const K18_DEAD_STATUSES: RollStatus[] = [
  RollStatus.SUBCONTRACTOR_CONSUMED,
  RollStatus.TAMBUR_CONSUMED,
  RollStatus.KARTELA_CONSUMED,
  RollStatus.CANCELLED,
];

/**
 * "Bu iş emrinde CANLI malzeme kaldı mı" sorusunun statü kümesi.
 *
 * ⚠️ K18 İLE KARIŞTIRMA — iki AYRI soru: K18 *"lane'de/etikette göster"* der,
 * bu küme *"iş kaldı mı"* der. Fark iki statüde somutlaşır:
 *   • `SCRAP` K18'de DEĞİLDİR (fire gerçek bir karardır, mal vardı ve üretildi)
 *     ama burada ölüdür — fire top üzerinde yapılacak iş yoktur.
 *   • `SHIPPED` de aynı şekilde: sevk edilmiş mal iş emrinde iş bırakmaz.
 *
 * `workorder-split.service.supersedeEmptiedSourceWorkOrderTx` bu listeyi satır içi
 * yazıyordu ve **`KARTELA_CONSUMED` eksikti** → son topu kartelaya giden bir iş emri
 * kalıcı olarak "boş değil" sayılıyor ve hiç SUPERSEDED olamıyordu. Tek kaynak.
 */
export const NO_LIVE_MATERIAL_STATUSES: RollStatus[] = [
  ...K18_DEAD_STATUSES,
  RollStatus.SHIPPED,
  RollStatus.SCRAP,
];

export interface CreateBatchResult {
  batch: { id: string; batchNumber: string; workOrderId: string; splitFromId: string | null };
}

/**
 * Parti no üretiminin `pg_advisory_xact_lock` NAMESPACE'i (2 argümanlı form).
 *
 * KK1'in 8021'inden AYRI: aynı uzayda olsalardı ham giriş tuzağı ile parti
 * numaralandırma birbirini sessizce serileştirirdi (yanlış sonuç değil, teşhisi
 * imkânsız gecikme). 1-argümanlı uzay ise `session-registry` /
 * `permission-management` tarafından kullanılıyor.
 */
// Tip `number` (literal DEĞİL) — bekçi bunu KK1'in namespace'iyle karşılaştırıyor ve
// literal tiplerde TS "örtüşme yok" diye derlemede düşürürdü. Namespace kimliği bir
// sayıdır; literal daraltmanın burada hiçbir değeri yok.
export const BATCH_NUMBER_LOCK_NS: number = 8022;

/** Parti sayacı TEK ve GLOBAL → tek anahtar yeter (hashtext'e gerek yok). */
const BATCH_NUMBER_LOCK_KEY = 1;

/**
 * Parti no üretici — tx İÇİNDE, sequence okuması closure içinde
 * (çağıran `withBarcodeRetry(() => prisma.$transaction(...))` ile sarar).
 *
 * İKİ REJİM, tek kapı. `batch.shortNumberEnabled` bayrağı:
 *   • AÇIK (varsayılan)  → `P01 … P99`, 99'dan sonra P01'e SARAR. Tarih taşımaz,
 *     BENZERSİZ DEĞİLDİR (2026-08-05 kullanıcı kararı; fabrika numaralı fiziksel
 *     parti plakası kullanıyor). Sayacın kaynağı: en son doğan KISA parti.
 *   • KAPALI → eski `P + GGAAYY + SIRA` (dolgusuz günlük sıra), birebir korunur.
 *
 * ⚠️⚠️ KİLİT HER İKİ REJİMİ DE KAPSAR ve SIRASI LOAD-BEARING — okumalardan ÖNCE
 * alınır. Eskiden günlük yolun yarışını `batches.batchNumber` üzerindeki `@unique`
 * + `withBarcodeRetry` (P2002 → tekrar dene) çözüyordu. Kısa parti no tanım gereği
 * tekrarlandığı için o kısıt KALDIRILDI (migration
 * `20260805120000_batch_short_number`) — yani günlük yol da korumasız kaldı ve
 * kilit onun yerini alıyor. Kilitsiz bırakılsaydı aynı gün doğan iki parti sessizce
 * aynı `P05082629` kodunu alırdı: hata yok, log yok, iki ayrı mal tek numarada.
 *
 * ⚠️ Kilit `generateBatchNumberTx`'in İLK ifadesidir; sonraya alınırsa hiçbir şey
 * kazanılmaz (klasik TOCTOU — KK1 guard'ında birebir aynı hata yaşandı).
 */
export async function generateBatchNumberTx(
  tx: Prisma.TransactionClient,
  date: Date,
): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BATCH_NUMBER_LOCK_NS}::int, ${BATCH_NUMBER_LOCK_KEY}::int)`;

  if (await readBatchShortNumberEnabled(tx)) {
    return buildShortBatchCode(nextShortBatchSeq(await readLastShortBatchSeqTx(tx)));
  }

  const prefix = dailyCodePrefix("P", date);
  const todays = await tx.batch.findMany({
    where: { batchNumber: { gte: prefix, startsWith: prefix } },
    select: { batchNumber: true },
  });
  const seq = nextDailySeq(
    todays.map((b) => b.batchNumber),
    prefix,
  );
  // digits=1 → padStart(1) seq ≥ 1 için no-op: dolgu yok, hane serbest.
  return buildDailyCode("P", seq, date, 1);
}

/**
 * Sayacın KAYNAĞI: en son doğan kısa parti numarası (yoksa `null` → P01'den başlar).
 *
 * Neden saklanan bir sayaç DEĞİL de veriden türetme: bu repo tüm sıra üretimini
 * veriden türetiyor (`nextDailySeq`, `nextPrefixedSequence`) ve saklanan sayaç
 * "ayar ne diyor" ile "veri ne diyor" diye ikinci bir doğruluk kaynağı açardı.
 * Türetilmiş sayaç kendi kendini onarır ve yedekten geri yüklemede tutarlı gelir.
 *
 * ⚠️ Regex SADECE kısa biçimi kabul eder (`P01`-`P99`) — eski günlük kodlar
 * (`P0508260019`) ve `P00` dışarıda kalır. Günlük kodlar sızsaydı bayrak ilk
 * açıldığında sayaç P01 yerine "son günlük sıra + 1"den başlardı.
 *
 * Sıralama `createdAt DESC` — `batchNumber` ile SIRALANAMAZ (numara sarıyor, en
 * büyük numara "en son" demek değil; P99'dan sonra doğan P01 en yenisidir).
 * Destek index: `batches_createdAt_idx` (aynı migration).
 */
async function readLastShortBatchSeqTx(tx: Prisma.TransactionClient): Promise<number | null> {
  const rows = await tx.$queryRaw<Array<{ batchNumber: string }>>`
    SELECT "batchNumber" FROM batches
    WHERE "batchNumber" ~ '^P(0[1-9]|[1-9][0-9])$'
    ORDER BY "createdAt" DESC
    LIMIT 1`;
  return parseShortBatchCode(rows[0]?.batchNumber);
}

/**
 * Panelde gösterilecek sayaç durumu (`GET /api/batches/number-state`).
 *
 * ⚠️ `next` bir ÖNİZLEMEDİR, REZERVASYON DEĞİL: kilit dışında okunur ve arada bir
 * parti doğarsa gerçekleşen numara farklı olur. Yüzey bunu "sıradaki" diye sunar,
 * "ayrılmış" diye değil.
 */
export async function getBatchNumberState(): Promise<{
  enabled: boolean;
  min: number;
  max: number;
  last: number | null;
  next: number | null;
  lastCode: string | null;
  nextCode: string | null;
}> {
  const enabled = await readBatchShortNumberEnabled();
  if (!enabled) {
    return {
      enabled,
      min: SHORT_BATCH_MIN,
      max: SHORT_BATCH_MAX,
      last: null,
      next: null,
      lastCode: null,
      nextCode: null,
    };
  }
  const last = await readLastShortBatchSeqTx(prisma as unknown as Prisma.TransactionClient);
  const next = nextShortBatchSeq(last);
  return {
    enabled,
    min: SHORT_BATCH_MIN,
    max: SHORT_BATCH_MAX,
    last,
    next,
    lastCode: last === null ? null : buildShortBatchCode(last),
    nextCode: buildShortBatchCode(next),
  };
}

/**
 * Yeni parti doğurur: P kodu + Batch satırı + (varsa) rollIds üyeliği.
 * Çağıran tx'i `withBarcodeRetry(() => prisma.$transaction(...))` ile sarmalı.
 *
 * Roll üyeliği ATOMİK CLAIM DEĞİL — çağıran topları önceden sahiplenmiş olmalı
 * (attach status-guard'ı / dispatch claim'i); burada yalnız `batchId` damgalanır.
 * NOT: Refakat kartı parti başına DEĞİL — iş emri başına (WO açılışında doğar);
 * parti oluşturmak kart üretmez.
 */
export async function createBatchTx(
  tx: Prisma.TransactionClient,
  params: {
    workOrderId: string;
    rollIds: string[];
    splitFromId?: string | null;
    userId?: string;
    date?: Date;
  },
): Promise<CreateBatchResult> {
  const now = params.date ?? new Date();
  const batchNumber = await generateBatchNumberTx(tx, now);

  const batch = await tx.batch.create({
    data: {
      batchNumber,
      workOrderId: params.workOrderId,
      splitFromId: params.splitFromId ?? null,
    },
    select: { id: true, batchNumber: true, workOrderId: true, splitFromId: true },
  });

  if (params.rollIds.length > 0) {
    await tx.roll.updateMany({
      where: { id: { in: params.rollIds } },
      data: { batchId: batch.id },
    });
  }

  // Refakat kartında YENİ bir parti satırı doğdu → basılı kâğıt eksik kaldı.
  // Bu, "kartta parti no yok" şikayetinin ASIL kaynağıdır: kart iş emri açılışında
  // basılır, parti ise `attachRolls`'ta (yani sonra) doğar. Buradan işaretlemek
  // `splitBatch` ve fason sevkindeki `splitRemainder` yollarını da kapsar — ikisi
  // de partiyi bu fonksiyondan doğurur.
  await markTravelerCardDirtyTx(tx, params.workOrderId);

  return { batch };
}

/**
 * Parti KİLİTLİ mi? Kilit TÜRETİLMİŞTİR (status/lock kolonu YOK). K14 çift
 * koşullu: (a) partinin AT_SUBCONTRACTOR statülü topu VARSA ('Konum' ile aynı
 * kaynak) VEYA (b) partiye bağlı, iptal edilmemiş + fasondan-sevk-edilmemiş ve
 * hâlâ OUTSTANDING (dönmemiş kalemi olan) sevk kaydı VARSA — mal FİİLEN
 * DIŞARIDAYKEN parti düzenlenemez (K8 guard'ı). (b) şart: AT_SUB top detach
 * edilirse (workorder detachRolls buna izin verir) partide AT_SUB top kalmaz
 * ama açık sevk outstanding kalır; yalnız-roll-türevli kilit bu "zombi" sevkli
 * partiyi serbest sanıp aynı (parti, adım)'da İKİNCİ açık sevke kapı açardı
 * (firma çözümünün bire-bir varsayımı kırılırdı). Mal tamamen döndüyse iki
 * koşul da söner — kilit KENDİLİĞİNDEN açılır, sevk kayıtları tarihçe kalır.
 * DIRECT_SHIPPED sevk kilit saymaz (mal çıktı, dönmeyecek).
 */
export async function isBatchLockedTx(
  tx: Prisma.TransactionClient,
  batchId: string,
): Promise<boolean> {
  const atSubcontractor = await tx.roll.count({
    where: { batchId, status: RollStatus.AT_SUBCONTRACTOR },
  });
  if (atSubcontractor > 0) return true;
  // Outstanding = en az bir kalemi iptal-olmamış bir makbuzla dönmemiş açık sevk.
  const outstandingDispatch = await tx.subcontractorDispatch.count({
    where: {
      batchId,
      cancelledAt: null,
      directShippedAt: null,
      items: { some: { receiptItems: { none: { receipt: { cancelledAt: null } } } } },
    },
  });
  return outstandingDispatch > 0;
}

/**
 * Partinin gerçekten bu iş emrine ait olduğunu doğrular (cross-WO manipülasyon
 * koruması). Parti yoksa 404, başka WO'ya aitse 400.
 */
export async function assertBatchInWorkOrder(
  tx: Prisma.TransactionClient,
  batchId: string,
  workOrderId: string,
): Promise<void> {
  const batch = await tx.batch.findUnique({
    where: { id: batchId },
    select: { workOrderId: true },
  });
  if (!batch) throw AppError.notFound("Parti bulunamadı");
  if (batch.workOrderId !== workOrderId) {
    throw AppError.badRequest("Parti bu iş emrine ait değil");
  }
}

/**
 * Boşalan partiyi (hiç top kalmadıysa) YALNIZ hiçbir iz yoksa siler — soft-delete
 * istisnası ("boş çuval silme" emsali). İz = fason sevki VEYA kart taraması (scan)
 * VEYA kendisinden ayrılmış çocuk parti VEYA merge soy bağı (K17: başka partiye
 * birleşmiş ya da içine birleşme almış). İz varsa parti KALIR (izlenebilirlik).
 * İzsizse: (taranmamış) kart(lar) fiziksel silinir + parti silinir. Döner: silindiyse true.
 */
export async function deleteIfEmptyAndTraceless(
  tx: Prisma.TransactionClient,
  batchId: string,
): Promise<boolean> {
  const rollCount = await tx.roll.count({ where: { batchId } });
  if (rollCount > 0) return false;

  const dispatchCount = await tx.subcontractorDispatch.count({ where: { batchId } });
  if (dispatchCount > 0) return false;

  const childCount = await tx.batch.count({ where: { splitFromId: batchId } });
  if (childCount > 0) return false;

  // K17: merge izi — kendisi bir survivor'a birleşmişse (mergedIntoId) ya da başka
  // partiler ona birleşmişse (mergedChildren) tarihçe satırıdır, silinmez.
  const self = await tx.batch.findUnique({
    where: { id: batchId },
    select: { mergedIntoId: true },
  });
  if (self?.mergedIntoId) return false;
  const mergedChildCount = await tx.batch.count({ where: { mergedIntoId: batchId } });
  if (mergedChildCount > 0) return false;

  // Kart iş emri başına (partiye bağlı değil) — boş partiyi silmek karta dokunmaz.
  await tx.batch.delete({ where: { id: batchId } });
  return true;
}

// =============================================================================
// K8 düzeltme araçları — moveRolls / splitBatch / mergeBatches. K14 kilidi artık
// hiçbirini DURDURMAZ: kilitli (fasonda mallı) partide de çalışırlar; sevk
// belgeleri operasyonu İZLER (K15 merge konsolidasyonu, K16 split/move sevk
// cerrahisi — retarget / kısmi-bölme / kalem birleştirme). Tek koruma: aynı
// adımda FARKLI firmalara açık sevk varsa 409 (fiziksel gerçek — mal iki firmada).
// Hepsi tek iş emri içinde. Electron K8 dialog'ları bunları çağırır.
// Kilit türetilmiş kalır (isBatchLockedTx) — UI rozet/uyarı için okur.
// =============================================================================

/**
 * K8+K16: Topları başka bir partiye taşı (aynı iş emri içinde). K16 (fasondayken
 * move — OSFM kuralı): kilit kontrolü YOK; taşınan topların açık+outstanding sevk
 * kalemleri hedef partiyi izler (performDispatchSurgeryTx):
 *   - Hedefin AYNI adımda açık sevki varsa (aynı firma) kalemler oraya birleşir;
 *     boşalan kaynak sevk K16_MOVE ile kapanır. FARKLI firmaya açık sevk → 409.
 *   - Yoksa kaynak sevk tam taşınıyorsa retarget, kısmiyse K16 yeni sevk doğar.
 * Boşalan kaynak partiler: sevk cerrahisi görenler SİLİNMEZ — K17 tarzı
 * mergedIntoId=hedef iziyle tarihçe satırı kalır; cerrahisiz boş+izsiz kaynaklar
 * eskisi gibi silinir.
 */
export async function moveRolls(
  params: { rollIds: string[]; toBatchId: string; userId?: string },
): Promise<{
  movedCount: number;
  toBatchNumber: string;
  deletedBatchIds: string[];
  mergedSourceBatchIds: string[];
}> {
  const { rollIds, toBatchId, userId } = params;
  if (rollIds.length === 0) throw AppError.badRequest("Taşınacak top seçilmedi");

  const result = await withBarcodeRetry(() =>
    prisma.$transaction(async (tx) => {
    // Merge yarışı (MAJOR-3c): mergeBatches WO satırını kilitleyip belge cerrahisi
    // yapar — moveRolls aynı kilidi almazsa retarget/konsolidasyonla yarışır (kilit
    // guard'ları bayat veriyle geçer). Kilit anahtarı için minimal ön-okuma; tüm
    // guard'lar kilit SONRASI taze okumayla koşar.
    const targetRef = await tx.batch.findUnique({
      where: { id: toBatchId },
      select: { workOrderId: true },
    });
    if (!targetRef) throw AppError.notFound("Hedef parti bulunamadı");
    await touchWorkOrderTx(tx, targetRef.workOrderId);

    const target = await tx.batch.findUnique({
      where: { id: toBatchId },
      select: {
        id: true,
        workOrderId: true,
        batchNumber: true,
        mergedIntoId: true,
        mergedInto: { select: { batchNumber: true } },
      },
    });
    if (!target) throw AppError.notFound("Hedef parti bulunamadı");
    // Kilit tazeliği: kilit anahtarı ön-okumadan geldi — kilit beklerken parti
    // başka iş emrine taşınmış olabilir (UNDYED_MOVE batch.workOrderId'yi
    // değiştirir); o zaman kilit yanlış WO satırında kalır. Taze okuma AYNI
    // iş emrini göstermiyorsa 409.
    if (target.workOrderId !== targetRef.workOrderId) {
      throw AppError.conflict(
        "Hedef parti bu sırada başka bir iş emrine taşındı — listeyi yenileyin.",
      );
    }
    // K17: birleşmiş kaynak parti tarihçe satırıdır — yeni üyelik alamaz.
    if (target.mergedIntoId) {
      throw AppError.badRequest(
        `Parti ${target.batchNumber}, ${target.mergedInto?.batchNumber ?? target.mergedIntoId} altına birleştirilmiş — işlem survivor partide yapılmalı`,
      );
    }
    // K16: assertUnlocked (hedef + kaynak) KALKTI — kilitli partiyle de taşınır;
    // sevk katmanını aşağıdaki cerrahi düzenler.

    const rolls = await tx.roll.findMany({
      where: { id: { in: rollIds } },
      select: {
        id: true,
        batchId: true,
        status: true,
        barcode: true,
        currentStep: { select: { workOrderId: true } },
        producedInStep: { select: { workOrderId: true } },
      },
    });
    if (rolls.length !== rollIds.length) throw AppError.notFound("Bazı toplar bulunamadı");
    // K16 madde 5 (splitBatch simetrisi): tüketilmiş/iptal TARİHÇE topu tek
    // başına taşınamaz — o kaynağın izidir (UI canlıları listeler; savunma
    // katmanı burada). mergeBatches'in TÜM-parti taşıması bilinçli istisnadır
    // (iz partiyle birlikte akar), burada değil.
    const dead = rolls.filter((r) => K18_DEAD_STATUSES.includes(r.status));
    if (dead.length > 0) {
      throw AppError.conflict(
        `Tüketilmiş/iptal tarihçe topları taşınamaz: ${dead.map((r) => r.barcode ?? r.id).join(", ")}`,
      );
    }

    const sourceBatchIds = [
      ...new Set(rolls.map((r) => r.batchId).filter((x): x is string => !!x && x !== toBatchId)),
    ];
    for (const sb of sourceBatchIds) {
      const src = await tx.batch.findUnique({ where: { id: sb }, select: { workOrderId: true } });
      if (!src || src.workOrderId !== target.workOrderId) {
        throw AppError.badRequest("Toplar hedef partiyle aynı iş emrinde değil");
      }
    }
    // PARTİSİZ (batchId=null) top yukarıdaki kaynak-parti kontrolünden GEÇMİYORDU —
    // yabancı WO'nun topu doğrudan API çağrısıyla bu partiye damgalanabilirdi (lane
    // metrajı şişer, fason sevk kalemine yabancı top girer). Üyelik kanıtı: topun
    // canlı adımı (currentStep) VEYA doğum adımı (producedInStep) hedef WO'ya ait olmalı.
    const foreignLoose = rolls.filter(
      (r) =>
        r.batchId == null &&
        r.currentStep?.workOrderId !== target.workOrderId &&
        r.producedInStep?.workOrderId !== target.workOrderId,
    );
    if (foreignLoose.length > 0) {
      throw AppError.badRequest(
        `Partisiz toplar bu iş emrine ait değil: ${foreignLoose.map((r) => r.barcode ?? r.id).join(", ")}`,
      );
    }

    // ── K16 SEVK CERRAHİSİ (üyelik taşınmadan ÖNCE — kalem→sevk eşleşmesi taze).
    const surgery = await performDispatchSurgeryTx(tx, {
      sourceBatchIds,
      movedRollIds: new Set(rollIds),
      targetBatchId: toBatchId,
      targetBatchNumber: target.batchNumber,
      userId,
    });

    // K18: üyelik değişiyor — üyeliği GERÇEKTEN değişen (kaynağı hedeften farklı)
    // CANLI topların fiziksel etiketindeki Parti No artık bayat → yeniden bas
    // uyarısı. Zaten hedefte olan top üyelik değiştirmez — bayraklanmaz; dead
    // guard yukarıda attı, notIn savunma katmanı.
    const changingIds = rolls.filter((r) => r.batchId !== toBatchId).map((r) => r.id);
    if (changingIds.length > 0) {
      await tx.roll.updateMany({
        where: { id: { in: changingIds }, status: { notIn: K18_DEAD_STATUSES } },
        data: { labelDirty: true },
      });
      // Kartın parti satırlarındaki top adedi/metraj kaydı — üyelik taşınınca
      // eldeki kâğıt bu iki sütunda yanlışlanır. Kaynak partiler guard gereği
      // hedefle AYNI iş emrinde (yukarıda doğrulandı) → tek WO yeter.
      await markTravelerCardDirtyTx(tx, target.workOrderId);
    }
    await tx.roll.updateMany({ where: { id: { in: rollIds } }, data: { batchId: toBatchId } });

    const deletedBatchIds: string[] = [];
    const mergedSourceBatchIds: string[] = [];
    for (const sb of sourceBatchIds) {
      if (surgery.touchedSourceBatchIds.has(sb)) {
        // K16: sevk cerrahisi gören kaynak boşaldıysa SİLİNMEZ — K17 tarzı soy
        // bağıyla (mergedIntoId=hedef) "parti bütünüyle hedefe aktı" tarihçe satırı
        // kalır (retarget kaynağı izsiz kalıp yanlışlıkla silinmesin). ATOMİK CLAIM:
        // eşzamanlı merge kaynağı kapmışsa soy bağı ezilmez.
        const remaining = await tx.roll.count({ where: { batchId: sb } });
        if (remaining === 0) {
          const claim = await tx.batch.updateMany({
            where: { id: sb, mergedIntoId: null },
            data: { mergedIntoId: toBatchId },
          });
          if (claim.count === 1) mergedSourceBatchIds.push(sb);
        }
        continue;
      }
      if (await deleteIfEmptyAndTraceless(tx, sb)) deletedBatchIds.push(sb);
    }
    return {
      movedCount: rollIds.length,
      toBatchNumber: target.batchNumber,
      deletedBatchIds,
      mergedSourceBatchIds,
      surgery,
    };
    }),
  );

  await AuditService.log({
    userId,
    action: "UPDATE",
    tableName: "BATCH",
    recordId: toBatchId,
    newData: {
      event: "K8_MOVE_ROLLS",
      movedCount: result.movedCount,
      rollIds,
      deletedBatchIds: result.deletedBatchIds,
      // K16 sevk cerrahisi izi + K17 tarzı boşalan-kaynak soy bağı.
      retargetedDispatchNos: result.surgery.retargetedDispatchNos,
      bornDispatches: result.surgery.bornDispatches,
      mergedItems: result.surgery.mergedItems,
      closedDispatchNos: result.surgery.closedDispatchNos,
      mergedSourceBatchIds: result.mergedSourceBatchIds,
    },
  });
  return {
    movedCount: result.movedCount,
    toBatchNumber: result.toBatchNumber,
    deletedBatchIds: result.deletedBatchIds,
    mergedSourceBatchIds: result.mergedSourceBatchIds,
  };
}

/**
 * K8+K15: İki+ partiyi birleştir — EN ESKİ parti no YAŞAR (survivor).
 *
 * K15 (fasondayken merge — OSFM kuralı): kilitli (fasonda mallı) partiler de
 * birleştirilebilir; kilit kontrolü YOK (K16 ile moveRolls/splitBatch'te de
 * kalktı — üç araç da belge cerrahisiyle çalışır). Belge de birleşir:
 *   1. Guard: seçilen partilerin AÇIK+OUTSTANDING sevkleri aynı adımda FARKLI
 *      firmalara ise 409 + somut çakışma listesi (hiçbir mutasyon yapılmadan).
 *   2. Kaynak partilerin TÜM sevkleri (tarihçe: RETURNED/CANCELLED/DIRECT_SHIPPED
 *      dahil) dispatch.batchId = survivor olarak yeniden hedeflenir.
 *   3. Retarget sonrası survivor'da aynı adımda birden çok AÇIK+OUTSTANDING sevk
 *      kalırsa (guard gereği hepsi aynı firma): EN ESKİ yaşar, diğerlerinin
 *      kalemleri ona taşınır, boşalanlar K15_MERGE sebebiyle kapanır →
 *      DEĞİŞMEZ: bir (parti, adım) çiftinde en fazla BİR açık+outstanding sevk.
 *      (SubcontractorReceipt'te dispatchId alanı YOK — makbuz↔sevk bağı
 *      ReceiptItem.sourceDispatchItemId üzerindendir ve kalem taşınınca bağ
 *      kendiliğinden yaşayan sevke geçer; ayrıca retarget gerekmez.)
 *   4. K17 soy bağı: boşalan kaynak partiler SİLİNMEZ — mergedIntoId = survivor
 *      ile tarihçe satırı kalır (deleteIfEmptyAndTraceless çağrılmaz).
 * Toplar (CONSUMED tarihçe topları DAHİL — where yalnız batchId) survivor'a
 * taşınır; böylece cancelReceipt parti-tutarlılık guard'ı (roll.batchId ===
 * dispatch.batchId) merge sonrası doğal geçer. Kart WO başına — karta dokunulmaz.
 *
 * BİLİNÇLİ YAN ETKİ (K15 madde 9): konsolidasyon born (parentReceiptId dolu) ve
 * non-born kalemleri TEK sevkte karıştırabilir → o sevk için "Aktarımı Geri Al"
 * türetimi (TÜM kalemler born) kaybolur. Kabul edilmiş kısıt — geri alma
 * gerekiyorsa kabul iptali / sevk iptali yolları kullanılır.
 */
export async function mergeBatches(
  params: { batchIds: string[]; userId?: string },
): Promise<{ survivorId: string; survivorNumber: string; mergedNumbers: string[] }> {
  const { batchIds, userId } = params;
  const uniq = [...new Set(batchIds)];
  if (uniq.length < 2) throw AppError.badRequest("Birleştirme için en az iki parti gerekli");

  const result = await prisma.$transaction(async (tx) => {
    // KİLİT ÖNCE (MAJOR-3a): dispatch/receive/cancelReceipt WO satırını kilitler;
    // belge cerrahisi (retarget + konsolidasyon) onlarla serileşsin. Kilit anahtarı
    // (workOrderId) için MİNİMAL ön-okuma yapılır; guard'ların dayandığı veri kilit
    // SONRASI taze okunur — kilit beklerken partiler değişmiş olabilir.
    const pre = await tx.batch.findMany({
      where: { id: { in: uniq } },
      select: { id: true, workOrderId: true },
    });
    if (pre.length !== uniq.length) throw AppError.notFound("Bazı partiler bulunamadı");
    const woId = pre[0].workOrderId;
    if (!pre.every((b) => b.workOrderId === woId)) {
      throw AppError.badRequest("Yalnız aynı iş emrinin partileri birleştirilebilir");
    }
    await touchWorkOrderTx(tx, woId);

    // TAZE okuma — TÜM guard'lar kilit SONRASI veriyle koşar.
    const batches = await tx.batch.findMany({
      where: { id: { in: uniq } },
      select: {
        id: true,
        batchNumber: true,
        workOrderId: true,
        createdAt: true,
        mergedIntoId: true,
        mergedInto: { select: { batchNumber: true } },
      },
      // id tie-break: getBranches lane sıralamasıyla birebir — createdAt eşitliğinde
      // UI'nın gösterdiği survivor ile burada seçilen survivor ayrışmasın.
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (batches.length !== uniq.length) throw AppError.notFound("Bazı partiler bulunamadı");
    if (!batches.every((b) => b.workOrderId === woId)) {
      throw AppError.badRequest("Yalnız aynı iş emrinin partileri birleştirilebilir");
    }
    // K17: zaten birleşmiş parti tarihçe satırıdır — yeniden birleştirilemez
    // (mergedIntoId ezilir, soy bağı bozulurdu).
    const alreadyMerged = batches.find((b) => b.mergedIntoId);
    if (alreadyMerged) {
      throw AppError.badRequest(
        `Parti ${alreadyMerged.batchNumber}, ${alreadyMerged.mergedInto?.batchNumber ?? alreadyMerged.mergedIntoId} altına birleştirilmiş — işlem survivor partide yapılmalı`,
      );
    }

    const allBatchIds = batches.map((b) => b.id);
    const numberById = new Map(batches.map((b) => [b.id, b.batchNumber]));

    // ── K15 madde 1 — GUARD (hiçbir mutasyondan ÖNCE): seçilen partilerin AÇIK
    // (iptal edilmemiş + fasondan-sevk-edilmemiş) ve OUTSTANDING (en az bir kalemi
    // iptal-olmamış makbuzla dönmemiş) sevkleri adım bazında gruplanır; bir adımda
    // 2+ FARKLI firma varsa 409 — fiziksel gerçek: mal iki ayrı firmada, firma
    // çözümü (F74) bozulur. Farklı adımlardaki sevkler serbest (çözüm stepId-scope'lu).
    const openOutstanding = await tx.subcontractorDispatch.findMany({
      where: {
        batchId: { in: allBatchIds },
        cancelledAt: null,
        directShippedAt: null,
        items: { some: { receiptItems: { none: { receipt: { cancelledAt: null } } } } },
      },
      select: {
        id: true,
        dispatchNo: true,
        batchId: true,
        stepId: true,
        subcontractorId: true,
        dispatchedAt: true,
        subcontractor: { select: { name: true } },
        step: { select: { station: { select: { name: true } } } },
      },
      orderBy: [{ dispatchedAt: "asc" }, { createdAt: "asc" }],
    });
    const byStep = new Map<string, typeof openOutstanding>();
    for (const d of openOutstanding) {
      const arr = byStep.get(d.stepId) ?? [];
      arr.push(d);
      byStep.set(d.stepId, arr);
    }
    const conflicts: string[] = [];
    for (const dispatches of byStep.values()) {
      const firmIds = new Set(dispatches.map((d) => d.subcontractorId));
      if (firmIds.size > 1) {
        const stepName = dispatches[0].step.station.name;
        const parts = dispatches.map(
          (d) =>
            `${d.subcontractor.name} → parti ${numberById.get(d.batchId) ?? d.batchId} (sevk ${d.dispatchNo})`,
        );
        conflicts.push(`"${stepName}" adımında: ${parts.join(", ")}`);
      }
    }
    if (conflicts.length > 0) {
      throw AppError.conflict(
        `Birleştirme yapılamaz — aynı fason adımında farklı firmalara açık sevkler var: ` +
          `${conflicts.join("; ")}. Önce mal kabul edilmeli ya da ilgili sevk iptal edilmeli.`,
      );
    }

    const survivor = batches[0]; // en eski no yaşar
    const sources = batches.slice(1);
    const sourceIds = sources.map((s) => s.id);

    // ── K15 madde 2 — SEVK RETARGET: kaynak partilerin TÜM sevkleri (tarihçe
    // dahil) survivor'a. Born roll kalıtımı dispatch.batchId'den okunduğu ve
    // cancelReceipt tutarlılık guard'ı roll.batchId===dispatch.batchId beklediği
    // için toplarla BİRLİKTE taşınmaları şart.
    const sourceDispatches = await tx.subcontractorDispatch.findMany({
      where: { batchId: { in: sourceIds } },
      select: { id: true, dispatchNo: true },
      orderBy: { dispatchedAt: "asc" },
    });
    if (sourceDispatches.length > 0) {
      await tx.subcontractorDispatch.updateMany({
        where: { batchId: { in: sourceIds } },
        data: { batchId: survivor.id },
      });
    }

    // K18: fiziksel etiketteki Parti No artık bayat — yeniden bas uyarısı.
    // Taşınmadan ÖNCE bayrakla (kaynak partilerin CANLI topları = taşınan küme);
    // tüketilmiş/iptal tarihçe topları etikete çıkmaz, bayraklanmaz.
    await tx.roll.updateMany({
      where: { batchId: { in: sourceIds }, status: { notIn: K18_DEAD_STATUSES } },
      data: { labelDirty: true },
    });
    // Aynı gerekçe REFAKAT KARTI için: kaynak partiler survivor altına birleşti →
    // `resolveLiveBatches` onları artık BASMIYOR (`mergedIntoId != null` atlanır),
    // yani eldeki kâğıtta var olmayan parti numaraları yazılı kalıyor. Kart WO
    // başına olduğu için survivor + kaynakların TÜM iş emirleri işaretlenir.
    await markTravelerCardsDirtyTx(tx, batches.map((b) => b.workOrderId));
    // Toplar — CONSUMED/CANCELLED tarihçe topları DAHİL (where yalnız batchId).
    await tx.roll.updateMany({
      where: { batchId: { in: sourceIds } },
      data: { batchId: survivor.id },
    });

    // ── K15 madde 3 — AÇIK SEVK KONSOLİDASYONU: retarget sonrası survivor'da aynı
    // adımda birden çok açık+outstanding sevk varsa (guard gereği hepsi aynı firma)
    // EN ESKİ (dispatchedAt asc) yaşar; diğerlerinin kalemleri ona taşınır, boşalan
    // kayıtlar K15_MERGE sebebiyle kapanır (atomik claim). AÇIK-olmayan sevkler
    // konsolide EDİLMEZ — yalnız retarget edildi (tarihçe bozulmaz).
    const consolidations: Array<{ closedDispatchNo: string; intoDispatchNo: string; stepName: string }> = [];
    const now = new Date();
    for (const dispatches of byStep.values()) {
      if (dispatches.length < 2) continue;
      const keeper = dispatches[0]; // orderBy dispatchedAt asc — en eski yaşar
      const losers = dispatches.slice(1);
      // Kalem-çakışma seddi (MINOR-1): aynı top hem keeper'da hem loser'da ise
      // taşıma @@unique(dispatchId, rollId)'e çarpar (P2002 → çıplak 500).
      // Değişmez ihlali zaten var demektir — anlaşılır Türkçe 409 ile durdur.
      const keeperItems = await tx.subcontractorDispatchItem.findMany({
        where: { dispatchId: keeper.id },
        select: { rollId: true },
      });
      const keeperRollIds = new Set(keeperItems.map((i) => i.rollId));
      for (const loser of losers) {
        const loserItems = await tx.subcontractorDispatchItem.findMany({
          where: { dispatchId: loser.id },
          select: { rollId: true, roll: { select: { barcode: true } } },
        });
        const overlap = loserItems.filter((i) => keeperRollIds.has(i.rollId));
        if (overlap.length > 0) {
          throw AppError.conflict(
            `Birleştirme yapılamaz — sevk ${loser.dispatchNo} ile ${keeper.dispatchNo} aynı top(lar)ı içeriyor: ` +
              `${overlap.map((i) => i.roll.barcode ?? i.rollId).join(", ")}. Sevk kayıtları tutarsız, önce düzeltilmeli.`,
          );
        }
        await tx.subcontractorDispatchItem.updateMany({
          where: { dispatchId: loser.id },
          data: { dispatchId: keeper.id },
        });
        for (const i of loserItems) keeperRollIds.add(i.rollId);
        // ATOMİK CLAIM: eşzamanlı cancel/directShip kaybedeni burada yakalar.
        // totalQty → 0 (MINOR-2): kalemleri keeper'a taşındı — açık bakiye/rapor
        // çift saymasın; cancelReason zaten nereye gittiğini açıklıyor.
        const closed = await tx.subcontractorDispatch.updateMany({
          where: { id: loser.id, cancelledAt: null, directShippedAt: null },
          data: {
            cancelledAt: now,
            cancelledById: userId ?? null,
            cancelReason: `K15_MERGE: ${survivor.batchNumber} altında ${keeper.dispatchNo} ile birleştirildi`,
            totalQty: new Prisma.Decimal(0),
          },
        });
        if (closed.count === 0) {
          throw AppError.conflict(
            `Sevk ${loser.dispatchNo} bu sırada başka bir işlemle değişti. Listeyi yenileyip tekrar deneyin.`,
          );
        }
        // MINOR-2: loser'ın basılı irsaliyesi artık gerçeği yansıtmıyor — VOID
        // (cancelDispatch'in kullandığı voidForSource mekanizması; belge silinmez,
        // baskıda İPTAL filigranı alır).
        await printedDocumentService.voidForSource(
          tx,
          PrintedDocType.SUBCONTRACTOR_DISPATCH,
          loser.id,
          `K15_MERGE: ${survivor.batchNumber} altında ${keeper.dispatchNo} ile birleştirildi`,
        );
        consolidations.push({
          closedDispatchNo: loser.dispatchNo,
          intoDispatchNo: keeper.dispatchNo,
          stepName: keeper.step.station.name,
        });
      }
      // Yaşayan sevkin metraj snapshot'ı artık taşınan kalemleri de kapsıyor —
      // kapanış bakiyesi (totalQty − dönen − fasondan) tutarlı kalsın diye
      // kalem toplamından yeniden hesaplanır. ATOMİK CLAIM: keeper bu sırada
      // iptal/DSK edildiyse kalem taşımak tutarsızlık olur → 409.
      // K15 belge notu (MINOR-2): birleşen kalemlerin izi keeper sevkin notes
      // alanına APPEND edilir — basılı irsaliye fasoncuda, belge yeniden basılabilir.
      const agg = await tx.subcontractorDispatchItem.aggregate({
        where: { dispatchId: keeper.id },
        _sum: { dispatchedQty: true },
      });
      const keeperRow = await tx.subcontractorDispatch.findUnique({
        where: { id: keeper.id },
        select: { notes: true },
      });
      const mergeNote = `K15: ${losers.map((l) => l.dispatchNo).join(", ")} kalemleri bu sevke birleştirildi (${now.toISOString().slice(0, 10)})`;
      const keeperClaim = await tx.subcontractorDispatch.updateMany({
        where: { id: keeper.id, cancelledAt: null, directShippedAt: null },
        data: {
          totalQty: agg._sum.dispatchedQty ?? new Prisma.Decimal(0),
          notes: keeperRow?.notes ? `${keeperRow.notes} | ${mergeNote}` : mergeNote,
        },
      });
      if (keeperClaim.count === 0) {
        throw AppError.conflict(
          `Sevk ${keeper.dispatchNo} bu sırada başka bir işlemle değişti. Listeyi yenileyip tekrar deneyin.`,
        );
      }
    }

    // ── K17 madde 4 — SOY BAĞI: kaynaklar silinmez, mergedIntoId=survivor ile
    // tarihçe satırı kalır (deleteIfEmptyAndTraceless BİLEREK çağrılmaz).
    // ATOMİK CLAIM (MAJOR-3b): mergedIntoId=null koşulu — eşzamanlı ikinci merge
    // aynı kaynağı kapmışsa soy bağı EZİLMEZ, kaybeden 409 alır.
    const setMerged = await tx.batch.updateMany({
      where: { id: { in: sourceIds }, mergedIntoId: null },
      data: { mergedIntoId: survivor.id },
    });
    if (setMerged.count !== sourceIds.length) {
      throw AppError.conflict(
        "Partilerden biri bu sırada başka bir birleştirmeye girmiş — listeyi yenileyin.",
      );
    }

    return {
      survivorId: survivor.id,
      survivorNumber: survivor.batchNumber,
      mergedNumbers: sources.map((s) => s.batchNumber),
      retargetedDispatchNos: sourceDispatches.map((d) => d.dispatchNo),
      consolidations,
    };
  });

  await AuditService.log({
    userId,
    action: "UPDATE",
    tableName: "BATCH",
    recordId: result.survivorId,
    newData: {
      event: "K8_MERGE_BATCHES",
      survivor: result.survivorNumber,
      merged: result.mergedNumbers,
      // K15: belge cerrahisi izi — retarget edilen sevkler + kapatılan→yaşayan eşlemesi.
      retargetedDispatchNos: result.retargetedDispatchNos,
      consolidations: result.consolidations,
      // K17: mergedIntoId = survivor yazılan kaynak partiler.
      mergedIntoSetOn: result.mergedNumbers,
    },
  });
  return {
    survivorId: result.survivorId,
    survivorNumber: result.survivorNumber,
    mergedNumbers: result.mergedNumbers,
  };
}

/**
 * K8+K16: Bir partiden seçilen topları YENİ bir partiye ayır (elle böl). Yeni
 * parti P kodu alır (splitFrom = kaynak); kart WO başına olduğundan yeni kart YOK.
 * Partinin TÜM topları seçilemez.
 *
 * K16 (fasondayken split — OSFM kuralı): kilit kontrolü YOK; taşınan topların
 * açık+outstanding sevk kalemleri yeni partiyi izler (performDispatchSurgeryTx):
 * sevkin TÜM kalemleri taşınıyorsa kayıt olduğu gibi RETARGET (yeni belge doğmaz),
 * KISMİ ise aynı meta + orijinal dispatchedAt'li YENİ sevk doğar (yeni no, K16
 * notu). Dönmüş kalem taşınamaz (409); tüketilmiş/iptal tarihçe topu bölünemez.
 */
export async function splitBatch(
  params: { batchId: string; rollIds: string[]; userId?: string },
): Promise<{ newBatchId: string; newBatchNumber: string }> {
  const { batchId, rollIds, userId } = params;
  if (rollIds.length === 0) throw AppError.badRequest("Ayrılacak top seçilmedi");

  const { newBatch, surgery } = await withBarcodeRetry(() =>
    prisma.$transaction(async (tx) => {
      // Kilit anahtarı (workOrderId) için MİNİMAL ön-okuma (mergeBatches deseni);
      // guard'ların dayandığı veri kilit SONRASI taze okunur.
      const srcRef = await tx.batch.findUnique({
        where: { id: batchId },
        select: { workOrderId: true },
      });
      if (!srcRef) throw AppError.notFound("Kaynak parti bulunamadı");
      // Merge yarışı (MAJOR-3c): mergeBatches ile serileş — kilit guard'lardan ÖNCE
      // alınır ki roll/sevk okumaları eşzamanlı merge'in commit'ini görsün.
      await touchWorkOrderTx(tx, srcRef.workOrderId);
      // TAZE okuma — kilit beklerken parti değişmiş olabilir; guard'lar taze
      // veriyle koşar (kilit tazeliği simetrisi: moveRolls hedefte aynı kontrolü yapar).
      const src = await tx.batch.findUnique({
        where: { id: batchId },
        select: { id: true, workOrderId: true, mergedIntoId: true },
      });
      if (!src) throw AppError.notFound("Kaynak parti bulunamadı");
      // UNDYED_MOVE batch.workOrderId'yi değiştirir — kilit yanlış WO satırında kalır.
      if (src.workOrderId !== srcRef.workOrderId) {
        throw AppError.conflict(
          "Parti bu sırada başka bir iş emrine taşındı — listeyi yenileyin.",
        );
      }
      // K17: birleşmiş parti tarihçe satırıdır — bölünemez (topları survivor'da).
      if (src.mergedIntoId) {
        throw AppError.conflict(
          "Parti bu sırada başka bir partiye birleştirilmiş — listeyi yenileyin.",
        );
      }
      // K16: assertUnlocked KALKTI — kilitli (fasonda mallı) parti de bölünür.

      const rolls = await tx.roll.findMany({
        where: { id: { in: rollIds }, batchId },
        select: { id: true, status: true, barcode: true },
      });
      if (rolls.length !== rollIds.length) throw AppError.badRequest("Bazı toplar bu partide değil");
      // K16 madde 5: tüketilmiş/iptal TARİHÇE topları bölmede taşınmaz — onlar
      // kaynağın izidir (UI canlıları listeler; savunma katmanı burada).
      const dead = rolls.filter((r) => K18_DEAD_STATUSES.includes(r.status));
      if (dead.length > 0) {
        throw AppError.conflict(
          `Tüketilmiş/iptal tarihçe topları bölmede taşınamaz: ${dead.map((r) => r.barcode ?? r.id).join(", ")}`,
        );
      }
      const total = await tx.roll.count({ where: { batchId } });
      if (rolls.length >= total) {
        throw AppError.badRequest("Partinin TÜM topları seçilemez — bölmede bir kısım kaynakta kalmalı");
      }

      const created = await createBatchTx(tx, {
        workOrderId: src.workOrderId,
        rollIds: rolls.map((r) => r.id),
        splitFromId: batchId,
        userId,
      });

      // ── K16 SEVK CERRAHİSİ: seçilen topların açık sevk kalemleri yeni partiye.
      // (Hedef yeni doğdu → "hedef sevkiyle birleştirme" dalı hiç tetiklenmez;
      // retarget ya da kısmi-bölme yeni sevk. Değişmez: yeni partide adım başına
      // en fazla 1 açık sevk — kaynakta zaten ≤1 vardı.)
      const surgery = await performDispatchSurgeryTx(tx, {
        sourceBatchIds: [batchId],
        movedRollIds: new Set(rollIds),
        targetBatchId: created.batch.id,
        targetBatchNumber: created.batch.batchNumber,
        userId,
      });

      // K18: fiziksel etiketteki Parti No artık bayat — yeniden bas uyarısı
      // (guard gereği seçilenlerin hepsi canlı; notIn yine de savunma).
      await tx.roll.updateMany({
        where: { id: { in: rollIds }, status: { notIn: K18_DEAD_STATUSES } },
        data: { labelDirty: true },
      });

      return { newBatch: created.batch, surgery };
    }),
  );

  await AuditService.log({
    userId,
    action: "CREATE",
    tableName: "BATCH",
    recordId: newBatch.id,
    newData: {
      event: "K8_SPLIT_BATCH",
      batchNumber: newBatch.batchNumber,
      splitFromId: batchId,
      rollCount: rollIds.length,
      // K16 sevk cerrahisi izi.
      retargetedDispatchNos: surgery.retargetedDispatchNos,
      bornDispatches: surgery.bornDispatches,
    },
  });
  return { newBatchId: newBatch.id, newBatchNumber: newBatch.batchNumber };
}
