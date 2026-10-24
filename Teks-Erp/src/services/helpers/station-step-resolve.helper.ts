// =============================================================================
// TeksERP — Kart okutmada adım çözümü: oturum istasyonundan (KQ-D2, 2026-10-24)
// =============================================================================
// Soru: "Bu tablet bu refakat kartını okuttu; iş emrinin HANGİ akış adımını
// açmalı?" Eskiden cevap "ilk PROCESS_QC adımı"ydı (`assertWoAtStepKind`);
// Kurşun→KK→Tambur rotasında KK tableti kurşun adımına düşüp 400 alıyordu.
//
// İki dal:
//  SESSION — oturum istasyonu dolu ve İE'nin bu istasyonda akış adımı var:
//            açık toplu adım (stepSequence asc ilk) → tamamlanmamış ilk adım →
//            hepsi COMPLETED ise son adım (tablet yeniden açma onayını açar).
//  LEGACY  — oturum yok (panel/web) ya da İE'nin bu istasyonda adımı yok:
//            BUGÜNKÜ davranış bayt-eşit metinlerle (ilk akış adımı; COMPLETED ise
//            o, değilse açık hareketi varsa o, yoksa "mevcut konum" 400'ü).
//
// ⚠️ `roll-step.helper.assertWoAtStepKind` DOKUNULMAZ — Tambur kart okutması onu
// kullanır; buradaki LEGACY dalı onun semantiğinin AKIŞ ikiziyle yazılmış kopyasıdır.
// ⚠️ Tek akış istasyonlu fabrikada (oturum = tek KK2) SESSION ile LEGACY aynı
// adımı seçer — eski APK davranışı değişmez.
// =============================================================================

import { StepStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { ACTIVE_MOVEMENT } from "./roll-movement.helper";
import { STEP_FLOW_WHERE } from "./quality-station.helper";

export type StationStepResolveMode = "SESSION" | "LEGACY";

export interface StationStepResolution {
  stepId: string;
  mode: StationStepResolveMode;
}

/**
 * Refakat kartının iş emrinde, okutan oturumun istasyonuna düşen akış adımını çözer.
 * `stationId` null → LEGACY (bugünkü davranış). Tx DIŞINDA çağrılır (salt okuma).
 */
export async function resolveWoStepForStation(
  workOrderId: string,
  stationId: string | null,
): Promise<StationStepResolution> {
  if (stationId) {
    const sessionSteps = await prisma.workOrderStep.findMany({
      where: { workOrderId, stationId, station: { ...STEP_FLOW_WHERE } },
      orderBy: { stepSequence: "asc" },
      select: { id: true, status: true, _count: { select: { currentRolls: true } } },
    });
    if (sessionSteps.length > 0) {
      const picked =
        sessionSteps.find((s) => s._count.currentRolls > 0) ??
        sessionSteps.find((s) => s.status !== StepStatus.COMPLETED) ??
        sessionSteps[sessionSteps.length - 1];
      return { stepId: picked.id, mode: "SESSION" };
    }
  }
  return { stepId: await resolveLegacyFlowStep(workOrderId), mode: "LEGACY" };
}

/**
 * KQ-D2 öncesi `getByCardBarcode` davranışı: ilk akış adımı. COMPLETED ise o
 * (yeniden açma özeti); değilse açık hareketi olmalı, yoksa topların gerçek
 * konumunu söyleyen 400. Metinler `assertWoAtStepKind` ile bayt-eşit.
 */
async function resolveLegacyFlowStep(workOrderId: string): Promise<string> {
  const firstStep = await prisma.workOrderStep.findFirst({
    where: { workOrderId, station: { ...STEP_FLOW_WHERE } },
    orderBy: { stepSequence: "asc" },
    select: { id: true, status: true, station: { select: { name: true } } },
  });
  if (!firstStep) {
    throw AppError.notFound("Bu terbiye iş emrinde PROCESS_QC adımı tanımlı değil");
  }
  if (firstStep.status === StepStatus.COMPLETED) return firstStep.id;

  const openRollCount = await prisma.rollMovement.count({
    where: { ...ACTIVE_MOVEMENT, workOrderStepId: firstStep.id, exitedAt: null },
  });
  if (openRollCount > 0) return firstStep.id;

  const stepsWithRolls = await prisma.workOrderStep.findMany({
    where: { workOrderId, currentRolls: { some: {} } },
    select: {
      id: true,
      station: { select: { name: true } },
      _count: { select: { currentRolls: true } },
    },
    orderBy: { stepSequence: "asc" },
  });
  if (stepsWithRolls.length === 0) {
    throw AppError.badRequest(
      `Bu terbiye iş emrinin "${firstStep.station.name}" adımında işlenecek top yok ve şu an aktif başka bir adım da yok. (Üretim henüz başlamamış veya bitmiş.)`,
    );
  }
  const stepNames = stepsWithRolls
    .map((s) => `${s.station.name} (${s._count.currentRolls} rulo)`)
    .join(", ");
  throw AppError.badRequest(
    `Bu terbiye iş emrinin "${firstStep.station.name}" adımında şu an açık top yok. Mevcut konum: ${stepNames}. Tabletinizi yanlış istasyonda okutmuş olabilirsiniz.`,
  );
}
