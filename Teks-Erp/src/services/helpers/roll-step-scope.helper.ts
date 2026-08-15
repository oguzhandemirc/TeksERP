// =============================================================================
// TOPUN STATÜSÜ DEĞİŞTİĞİNDE HANGİ ADIMLAR YENİDEN HESAPLANIR — TEK KAYNAK
// =============================================================================
// `WorkOrderStep.status` sedsiz/denormalize bir alandır ve TEK yazıcısı
// `recomputeStepStatus`'tur (bkz. `roll-step.helper.ts`). O fonksiyon doğruyu
// hesaplar; yanlış olan şey ona verilen KÜMEYDİ.
//
// ── SAHA VAKASI (IE0608260004, canlı veride doğrulandı) ─────────────────────
//   06 Ağu  T080826F0001 "Kurşun + KK2" adımından çıktı → hareket KAPANDI,
//           adım COMPLETED oldu.
//   08 Ağu  iş emri kapanış dispozisyonu topu WAREHOUSE'a çekti →
//           `currentStepId = null`, açık hareket KALMADI.
//   08 Ağu  22 saniye sonra top iptal edildi (`softDelete`).
// `softDelete`'in etki kümesi "AÇIK hareketlerin adımları + currentStepId" idi;
// ikisi de boştu → küme BOŞ kaldı → `recomputeStepStatus` HİÇ KOŞMADI → adım
// bayat `COMPLETED` kaldı. Türetilen doğru değer `PENDING` idi (o adımın tek
// canlı topu artık CANCELLED). Hata yok, log yok; drift'i yalnız
// `scripts/test_consistency.ts` §20 gösteriyordu.
//
// ── KÖK NEDEN: KÜME "hareketin adımı" DEĞİL, "hareketin İŞ EMRİ"dir ─────────
// Topun statüsü `recomputeStepStatus`'a ÜÇ yerden girer:
//   (1) `openCount`   — topun HAREKETİ OLAN adımda (roll.status != CANCELLED)
//   (2) `closedCount` — aynı şekilde, KAPALI hareketlerde
//   (3) `pendingRolls`— topun HAREKETİ OLMAYAN ama AYNI İŞ EMRİNDEKİ adımlarda
//                       ("bu adıma henüz gelmemiş canlı top var mı")
// (2) tek başına saha vakasını açıklar: kapalı hareket de sayıma girer, yani
// bir topu iptal etmek onun GEÇMİŞTE geçtiği adımların türetilen değerini de
// değiştirir. (3) ise kapsamı adımdan İŞ EMRİNE genişletir: top hiç uğramamış
// olsa bile aynı iş emrinin diğer adımlarının "bekleyen" sayısını etkiler.
// Bu yüzden doğru kapsam = **topun hareketi olan her iş emrinin SKIPPED-dışı
// tüm adımları** (+ anomali olarak takılı kalmış `currentStepId`).
//
// ── NEDEN KÜME BAZLI (per-roll döngü YASAK) ────────────────────────────────
// Toplu yollar (kapanış dispozisyonu, parti düşürme) 200 topa kadar çıkabiliyor.
// Top başına sorgu koşulsaydı tek tx'te binlerce ifade doğardı (perf kuralı 10 +
// `statement_timeout=50s`). Bu yardımcı N top için de **2–3 sorgu** koşar ve
// adımı DEDUPLE eder → `recomputeStepStatus` her adım için yalnız BİR KEZ.
//
// ⚠️ İŞ EMRİ DURUMUNA GÖRE SÜZME YAPILMAZ. CANCELLED/COMPLETED/SUPERSEDED bir
// iş emrinin adımı da §20 tarafından ölçülüyor; süzülürse bekçi kalıcı kırmızı
// kalır. Terminal iş emirlerinin adımlarının çoğu zaten SKIPPED'tır ve o adımlar
// bu kümeye HİÇ girmez (aşağıdaki `status: { not: SKIPPED }`).
//
// ⚠️ İŞ EMRİ DİRİLTME RİSKİ YOK. `recomputeStepStatus`'un tek yan etkisi
// `ensureWorkOrderInProgress`'tir ve o **yalnız PLANNED** iş emrini hedefler
// (`updateMany WHERE status = PLANNED`) → COMPLETED/CANCELLED/SUPERSEDED iş
// emri bu yoldan ASLA diriltilmez. Ayrıca bir topu iptal etmek üç sayacın
// hiçbirini BÜYÜTEMEZ, yani iptalin kendisi bir adımı ACTIVE yapamaz; ACTIVE'e
// geçiş ancak ÖNCEDEN var olan bir drift'in düzeltilmesiyle olur ve o durumda
// PLANNED iş emrini IN_PROGRESS'e çekmek zaten DOĞRU cevaptır.
// =============================================================================

import { StepStatus } from "@prisma/client";
import type { TxClient } from "./roll-step.helper";

export interface RollStepScopeEntry {
  id: string;
  workOrderId: string;
  stepSequence: number;
  /** Kümeyi topladığımız andaki KAYITLI durum (recompute öncesi) — audit izi için. */
  status: StepStatus;
  /** COMPLETED'tan düşen adım bu damgayı geri dönülemez kaybeder (aşağıdaki nota bak). */
  completedAt: Date | null;
}

export interface RollStepScope {
  /** Yeniden hesaplanacak adımlar — deterministik sırada (workOrderId, stepSequence). */
  steps: RollStepScopeEntry[];
  /** Etkilenen iş emirleri — id ASC (deterministik kilit sırası; deadlock'ı yapısal olarak keser). */
  workOrderIds: string[];
}

/**
 * Bir veya daha fazla topun statüsü değiştiğinde yeniden hesaplanması gereken
 * `WorkOrderStep` kümesini çözer.
 *
 * @param rollIds       Statüsü değişen top(lar). Boş dizi meşrudur.
 * @param extraStepIds  Ek adım id'leri (tipik olarak `Roll.currentStepId`).
 *                      Hareketi olmayan ama topa takılı kalmış anomali adımı
 *                      kaçmasın diye ayrı geçirilir; `null`/`undefined` elenir.
 *
 * Dönen `steps` SKIPPED adım İÇERMEZ — SKIPPED terminaldir, `recomputeStepStatus`
 * ona zaten dokunmaz. Onu kümede tutmak adım başına boş bir sorgu maliyeti demekti.
 * ⚠️ Bu, bilinçli bir KÖR NOKTA: iş emri kapatma/iptali kalan adımları toptan
 * SKIPPED yapar ve o adımlar bir daha ne burada ne §20'de ölçülür. Orayı açmak
 * WO kapatma semantiğini bozar (`workorder.service` kapanış dalındaki gerekçe).
 */
export async function collectRollStepScopeTx(
  tx: TxClient,
  rollIds: string[],
  extraStepIds: (string | null | undefined)[] = [],
): Promise<RollStepScope> {
  const extras = [...new Set(extraStepIds.filter((s): s is string => !!s))];
  const rolls = [...new Set(rollIds.filter((r) => !!r))];
  if (rolls.length === 0 && extras.length === 0) {
    return { steps: [], workOrderIds: [] };
  }

  const workOrderIds = new Set<string>();

  // (a) Topun TÜM hareketleri — AÇIK ve KAPALI. Kapalı olanları atlamak, tam da
  // saha vakasını doğuran hataydı. `roll_movements(rollId, enteredAt DESC)`
  // index'i bu sorguyu karşılar.
  if (rolls.length > 0) {
    const movements = await tx.rollMovement.findMany({
      where: { rollId: { in: rolls } },
      select: { step: { select: { workOrderId: true } } },
    });
    for (const m of movements) workOrderIds.add(m.step.workOrderId);
  }

  // (b) Anomali adımları: hareketi olmayan ama topa takılı `currentStepId`.
  // Normal akışta buradan yeni bir iş emri gelmez (adımın hareketi zaten vardır),
  // bu yüzden sorgu yalnız extras verildiğinde koşar.
  if (extras.length > 0) {
    const extraSteps = await tx.workOrderStep.findMany({
      where: { id: { in: extras } },
      select: { workOrderId: true },
    });
    for (const s of extraSteps) workOrderIds.add(s.workOrderId);
  }

  if (workOrderIds.size === 0) {
    return { steps: [], workOrderIds: [] };
  }

  // (c) Etkilenen iş emirlerinin SKIPPED-dışı TÜM adımları. Adım bazlı değil iş
  // emri bazlı olması load-bearing: `pendingRolls` sayacı topun HİÇ uğramadığı
  // adımlarda da bu topa bakıyor (yukarıdaki (3) numaralı giriş).
  const steps = await tx.workOrderStep.findMany({
    where: {
      workOrderId: { in: [...workOrderIds] },
      status: { not: StepStatus.SKIPPED },
    },
    select: {
      id: true,
      workOrderId: true,
      stepSequence: true,
      status: true,
      completedAt: true,
    },
  });

  steps.sort((a, b) =>
    a.workOrderId === b.workOrderId
      ? a.stepSequence - b.stepSequence
      : a.workOrderId < b.workOrderId
        ? -1
        : 1,
  );

  return { steps, workOrderIds: [...workOrderIds].sort() };
}
