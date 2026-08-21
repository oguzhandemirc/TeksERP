// =============================================================================
// TeksERP — Kurşun Bypass Guard Helper
// =============================================================================
// Kurşun bypass düzeninde (fabrika kurşun makinelerine tablet KOYMUYOR) bir
// PROCESS_QC adımı "dağıtılmış" olabilir: yetkili personel adımı fiziksel bir
// kurşun MAKİNESİNE atar, adım daha sonra Tambur'da kart okutmasıyla ya da
// (kurşun son adımsa) dağıtım ekranından kapanır. Atama MAKİNE bazındadır —
// PROCESS_QC istasyonu tektir, altındaki N makineden biri seçilir; adımın
// `stationId`'sine HİÇ dokunulmaz.
//
// NEDEN AYRI DOSYA: bu üç fonksiyonu `kursun-qc.service`, `inventory.service` ve
// `workorder.service` çağırır. Onlar `kursun-bypass.service`'i import etseydi
// import döngüsü doğardı (kursun-bypass.service → tambur/kursun tarafına bakan
// tipler → geri). Guard'lar hiçbir servise bağlı değil, yalnız Prisma'ya —
// bu yüzden helpers/ altında bağımsız yaşar.
//
// SÖZLEŞME: "pending" (açık/bekleyen) atama = `completedAt IS NULL AND
// cancelledAt IS NULL`. Aynı adımda EN FAZLA BİR pending atama olabilir; bu
// invariant'ın DB seddi şema-dışı partial unique'tir
// (`kursun_bypass_one_pending_per_step_uq`, migration 20260731120000).
// =============================================================================

import { Prisma, StationKind, StepStatus, type PrismaClient } from "@prisma/client";
import { AppError } from "../../utils/app-error";

/** Hem havuz client'ı hem transaction client'ı kabul eden okuma tipi (any YOK). */
type Db = PrismaClient | Prisma.TransactionClient;
type TxClient = Prisma.TransactionClient;

/**
 * Bypass kapanışının `RollMovement.notes` marker ÖN EKİ (tam değer
 * `KURSUN_BYPASS_FINISHED:<uuid>` — suffix "tur" kimliğidir, çok-parti
 * kapanışları birbirine karışmasın diye).
 *
 * TEK KAYNAK burada durur: hem `kursun-bypass.service` (yazan) hem
 * `inventory.service` (okuyan) buna bakar; ikincisi `kursun-bypass.service`'i
 * import edemez (import döngüsü — dosya başlığındaki gerekçe).
 */
export const KURSUN_BYPASS_MARKER_PREFIX = "KURSUN_BYPASS_FINISHED";

/** Bir adımın AÇIK bypass atamasının minimum kimliği. */
export interface PendingBypassAssignment {
  id: string;
  /** ATANAN fiziksel kurşun makinesi (atamanın taşıdığı tek yeni bilgi). */
  machineId: string;
  workOrderId: string;
}

/**
 * Adımın AÇIK (tamamlanmamış + iptal edilmemiş) bypass atamasını döner.
 * Yoksa null. Partial unique sayesinde en fazla bir satır olabilir; yine de
 * `findFirst` kullanılır (Prisma şemasında @unique karşılığı bilinçli YOK).
 */
export async function findPendingBypassAssignmentTx(
  db: Db,
  stepId: string,
): Promise<PendingBypassAssignment | null> {
  const row = await db.kursunBypassAssignment.findFirst({
    where: { workOrderStepId: stepId, completedAt: null, cancelledAt: null },
    select: { id: true, machineId: true, workOrderId: true },
  });
  return row;
}

/**
 * Bypass'a dağıtılmış bir adımda ÇAKIŞAN normal-akış işlemini reddeder.
 *
 * NEDEN: bypass rejiminde kurşun adımı "dijital olarak izlenmiyor" kabul edilir —
 * KK2 tamamlama / adım kapatma / manuel taşıma gibi normal akış aksiyonları
 * atamanın altından malı çeker ve iki kapanış yolu (marker'lı bypass vs.
 * QC2_STEP_FINISHED) birbirine karışır. Tek doğru çıkış: ya dağıtımı iptal et,
 * ya Tambur'da kartı okut.
 *
 * Hata metninde "makine" denir — dağıtımcı ekranda bir MAKİNE seçmiştir.
 *
 * @param actionLabel Kullanıcıya gösterilecek eylem adı ("KK2 tamamlama" gibi).
 */
export async function assertStepNotBypassAssigned(
  db: Db,
  stepId: string,
  actionLabel: string,
): Promise<void> {
  const pending = await findPendingBypassAssignmentTx(db, stepId);
  if (pending) {
    throw AppError.conflict(
      `Bu iş emri kurşun makinesine dağıtılmış (bypass) — ${actionLabel} yapılamaz. Dağıtımı iptal edin ya da Tambur'da kartı okutun.`,
    );
  }
}

/**
 * Bu top, bir PROCESS_QC adımını BYPASS kapanışıyla mı geride bıraktı?
 *
 * NEDEN GEREKLİ: bypass rejimi bilinçli olarak `QC2_COMPLETED` RollOperation'ı
 * YAZMAZ (kimse tablette kaliteyi görmedi). `inventory.kursunFinish`'in
 * idempotency sondası ise tam olarak o operasyona bakıyor. Sonuç: kurşun
 * tabletinin OFFLINE kuyruğunda bekleyen bir `kursun-finish` isteği, iş bu arada
 * dağıtılıp Tambur'da kapatıldıysa geç geldiğinde sondaya takılmaz ve operatöre
 * `Roll PROCESS_QC step'inde değil (mevcut: TAMBUR)` gibi teknik bir 400 döner —
 * oysa istenen iş GERÇEKTEN yapılmıştır, doğru cevap idempotent başarıdır.
 *
 * Yalnız top PROCESS_QC'yi çoktan terk etmişken çağrılır; bu yüzden "evet"
 * demek hiçbir mükerrer yazma doğurmaz (çağıran erken döner).
 */
export async function hasBypassClosureOnProcessQcTx(
  db: Db,
  rollId: string,
): Promise<boolean> {
  const row = await db.rollMovement.findFirst({
    where: {
      rollId,
      exitedAt: { not: null },
      notes: { startsWith: KURSUN_BYPASS_MARKER_PREFIX },
      // İlişki alanının adı `step` (kolon `workOrderStepId`) — schema.prisma:1880.
      step: { station: { kind: StationKind.PROCESS_QC } },
    },
    select: { id: true },
  });
  return row !== null;
}

/**
 * DEVİR (TRANSFER): kaynak WO'nun AÇIK bypass atamalarını yeni (devam) iş emrine
 * ve onun klon adımına TAŞIR. Döner: taşınan satır adedi.
 *
 * NEDEN GEREKLİ: `repointRollsTx` topun tüm ayak izini (Roll konumu, movement,
 * operation, error) klon adımlara taşır ama `KursunBypassAssignment` ORADA YOKTU.
 * Sonuç: kurşun makinesine dağıtılmış bir iş devredildiğinde atama kaynak WO'nun
 * ÖLÜ adımında kalıyor, hemen ardından `voidStalePendingBypassAssignmentsTx(...,
 * { force: true })` onu iptal ediyordu → fiziksel olarak makinede duran mal
 * dijital olarak "dağıtılmamış" oluyor, dağıtım ekranından kayboluyor ve Tambur
 * okutması onu kapatacak bir atama bulamıyordu.
 *
 * ⚠️ ÇAĞRI SIRASI LOAD-BEARING: `repointRollsTx`'ten HEMEN SONRA, aynı tx'in
 * sonundaki force-void'den ÖNCE çağrılır. Taşınan satır artık HEDEF `workOrderId`
 * taşıdığı için kaynak WO id'siyle koşan force-void onu GÖRMEZ; ters sırada
 * çağrılırsa atama önce iptal edilir, sonra taşınacak satır kalmaz.
 *
 * `workOrderId` bu tabloda DENORMALİZE bir kolondur (adımdan da türetilebilirdi)
 * — ikisi BİRLİKTE güncellenir, yoksa satır iki WO'ya birden ait görünür.
 *
 * Partial unique (`kursun_bypass_one_pending_per_step_uq`, adım başına ≤1 pending)
 * korunur: hedef adımlar YENİ doğmuş klon adımlardır, üzerlerinde hiç atama yoktur.
 *
 * @param stepMap Kaynak adım id → hedef (klon) adım id. YALNIZ taşınan topların
 *   bulunduğu adımlar geçilmelidir — `oldToNew`'in tamamı geçilirse, topu
 *   taşınmamış bir adımın ataması da yeni WO'ya kaçar.
 */
export async function repointPendingBypassAssignmentsTx(
  tx: TxClient,
  params: {
    sourceWorkOrderId: string;
    targetWorkOrderId: string;
    stepMap: ReadonlyMap<string, string>;
  },
): Promise<number> {
  let moved = 0;
  for (const [oldStepId, newStepId] of params.stepMap) {
    const res = await tx.kursunBypassAssignment.updateMany({
      where: {
        workOrderId: params.sourceWorkOrderId,
        workOrderStepId: oldStepId,
        completedAt: null,
        cancelledAt: null,
      },
      data: {
        workOrderId: params.targetWorkOrderId,
        workOrderStepId: newStepId,
      },
    });
    moved += res.count;
  }
  return moved;
}

/**
 * Bir iş emrinin BAYAT kalmış açık bypass atamalarını iptal eder (soft-cancel).
 * Döndürdüğü sayı iptal edilen satır adedidir.
 *
 * İki kapsam:
 *  • `opts.force = true` → WO'nun TÜM açık atamaları iptal edilir. WO iptali /
 *    kapanış dispozisyonu gibi "iş emri artık yok" olaylarında kullanılır.
 *  • force yok → YALNIZ adımı COMPLETED/SKIPPED'a düşmüş atamalar iptal edilir.
 *    Manuel taşıma emsali: mal kurşun adımından elle çekilince atama anlamsız
 *    kalır, ama adım hâlâ ACTIVE ise (bir kısmı taşındı) atama YAŞAMALI.
 *
 * YALNIZ ATAMA SATIRI güncellenir; adıma/movement'lara DOKUNULMAZ. Atama makine
 * bazında olduğu için ortada geri alınacak bir `step.stationId` repoint'i yok
 * (adımın istasyonu hiç değişmedi). Kapanmış movement'ların `machineId` damgası
 * da SİLİNMEZ: o damga fiilen yapılmış işin atfıdır, bayat atamanın iptali onu
 * geçmişe dönük yalanlamaz — aksi halde işi yapan makinenin hacim raporundan o
 * parti sessizce düşerdi.
 */
export async function voidStalePendingBypassAssignmentsTx(
  tx: TxClient,
  workOrderId: string,
  reason: string,
  opts?: { force?: boolean },
): Promise<number> {
  const where: Prisma.KursunBypassAssignmentWhereInput = {
    workOrderId,
    completedAt: null,
    cancelledAt: null,
  };
  if (!opts?.force) {
    where.workOrderStep = {
      status: { in: [StepStatus.COMPLETED, StepStatus.SKIPPED] },
    };
  }

  const res = await tx.kursunBypassAssignment.updateMany({
    where,
    data: {
      cancelledAt: new Date(),
      // cancelReason VarChar(200) — taşan sebep DB hatası yerine kırpılır.
      cancelReason: reason.slice(0, 200),
    },
  });
  return res.count;
}
