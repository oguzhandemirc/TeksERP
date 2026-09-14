// =============================================================================
// TeksERP — TEZGAH KOŞUMU (MachineRun) Servisi · aç / kapa / geri al
// =============================================================================
// Koşum bir SPAN DEFTERİDİR: açık koşum bir DURUM, kapanmış koşum bir KAYIT
// (`RollMovement` sınıfı). Üç yazma yolu vardır ve üçü de burada yaşar:
//   • AÇ    — hat başına tek açık koşum. Sed DB'dedir (iki partial unique);
//             precheck yalnız operatöre okunabilir 409 verir, yarışın kaybedeni
//             P2002'yi `MACHINE_RUN_RACE` olarak alır (`work_sessions` emsali).
//             ⛔ Advisory kilit YOK: sed yeten yerde kilit ikinci bir yazar yolu açar.
//   • KAPA  — kapanışta üretim terimleri DONAR (`closeMachineRunTx` TEK yazar);
//             atomik claim `WHERE closedTermsAt IS NULL`.
//   • GERİ AL — `revokedAt` damgası; ileri satır NE SİLİNİR NE DEĞİŞİR, duruşların
//             `runId`si olduğu gibi kalır.
//
// ⚠️ İKİ TARİH: `startedAt`/`endedAt` istemcinin BEYANIDIR (çevrimdışı kuyruk
// gerçek anı taşır); `createdAt` sunucu gerçeğidir ve defterin kronolojisidir.
// Makul aralık dışındaki beyan 400 vermez, sunucu saatine düşer ve `warnings`
// ile söylenir — bozuk RTC'li tablet üretimi DURDURMAMALI (`resolveEntryStamp`).
//
// BORÇ (adıyla): `stopSecAtClose` / `stopCountAtClose` bu dilimde NULL kalır —
// duruş defterinin okunma kuralları (geçici kapanış · kayıp sınıfı) ingest
// diliminindir; kapanış yolu tek yazar olduğu için o dilim BURAYA ekler.
// Koşum kapanırken AÇIK duruş varsa ne olacağı da aynı dilimde tanımlanır.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { isClientTokenP2002, p2002Mentions } from "../utils/p2002";
import { assertMachineRunReplayAlive } from "./helpers/token-replay.helper";
import { assertReplayPayloadMatches } from "./helpers/idempotent-replay.helper";
import { assertProductionLineFree, resolveOpenContext, resolveRunStamp } from "./helpers/machine-run-open.helper";
import { markWeavingOrderInProgressTx } from "./helpers/weaving-order.helper";
import type { ApiResponse } from "../types/api.types";

const TABLE = "MACHINE_RUN";

export const MACHINE_RUN_SELECT = {
  id: true,
  machineId: true,
  productionLineNo: true,
  startedAt: true,
  endedAt: true,
  weavingOrderId: true,
  itemId: true,
  colorId: true,
  targetUnitsPerMin: true,
  unitsPerCm: true,
  picksAtClose: true,
  producedM: true,
  observedSecAtClose: true,
  stopSecAtClose: true,
  stopCountAtClose: true,
  closedTermsAt: true,
  revokedAt: true,
  revokedById: true,
  revokeReason: true,
  clientToken: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.MachineRunSelect;

export type MachineRunDto = Prisma.MachineRunGetPayload<{ select: typeof MACHINE_RUN_SELECT }>;

export interface OpenMachineRunInput {
  machineId: string;
  productionLineNo: number;
  weavingOrderId?: string | null;
  itemId?: string | null;
  colorId?: string | null;
  targetUnitsPerMin?: number | null;
  unitsPerCm?: number | null;
  /** İstemci beyanı; yoksa sunucu saati. */
  startedAt?: Date | null;
  clientToken?: string | null;
}

export interface CloseMachineRunInput {
  /** İstemci beyanı; yoksa sunucu saati. */
  endedAt?: Date | null;
  picksAtClose?: number | null;
  producedM?: number | null;
  observedSecAtClose?: number | null;
}

async function findByToken(clientToken: string): Promise<MachineRunDto | null> {
  return prisma.machineRun.findUnique({ where: { clientToken }, select: MACHINE_RUN_SELECT });
}

/**
 * Token replay'inin dört durumu: ① yok → null · ② aynı yük → kaydı döndür ·
 * ③ başka yük → 409 `CLIENT_TOKEN_COLLISION` · ④ geri alınmış → 409 `RUN_REVOKED`.
 */
function resolveOpenReplay(existing: MachineRunDto, input: OpenMachineRunInput): MachineRunDto {
  assertMachineRunReplayAlive(existing);
  assertReplayPayloadMatches(
    [
      { ad: "machineId", mevcut: existing.machineId, gelen: input.machineId },
      { ad: "productionLineNo", mevcut: existing.productionLineNo, gelen: input.productionLineNo },
      { ad: "weavingOrderId", mevcut: existing.weavingOrderId, gelen: input.weavingOrderId ?? null },
    ],
    "Bu form daha önce başka bir koşum için kaydedilmiş — yeni koşum için formu yeniden açın.",
    { runId: existing.id },
  );
  return existing;
}

/** Audit tx DIŞINDA, best-effort; iş emri geçişi de koşumdan tetiklendiği için buradan yazılır. */
async function auditRunOpened(created: MachineRunDto, userId: string | undefined, transitionedOrderId: string | null): Promise<void> {
  await AuditService.log({
    userId,
    action: "CREATE",
    tableName: TABLE,
    recordId: created.id,
    newData: {
      machineId: created.machineId,
      productionLineNo: created.productionLineNo,
      startedAt: created.startedAt,
      weavingOrderId: created.weavingOrderId,
      itemId: created.itemId,
      colorId: created.colorId,
      targetUnitsPerMin: created.targetUnitsPerMin,
    },
  }).catch(() => undefined);
  if (!transitionedOrderId) return;
  await AuditService.log({
    userId,
    action: "UPDATE",
    tableName: "WEAVING_ORDER",
    recordId: transitionedOrderId,
    changes: [{ field: "status", old: "PLANNED", new: "IN_PROGRESS" }],
    newData: { trigger: "MACHINE_RUN_OPEN", machineRunId: created.id },
  }).catch(() => undefined);
}

export async function openMachineRun(
  input: OpenMachineRunInput,
  userId?: string,
): Promise<ApiResponse<MachineRunDto>> {
  // ① Replay — yaratmadan ÖNCE: aynı token ikinci kez gelirse özgün sonuç döner.
  if (input.clientToken) {
    const existing = await findByToken(input.clientToken);
    if (existing) {
      return {
        success: true,
        data: resolveOpenReplay(existing, input),
        message: "Koşum zaten kayıtlı (yeniden gönderim)",
      };
    }
  }

  const { machine, itemId, colorId } = await resolveOpenContext(input);
  const started = resolveRunStamp(input.startedAt, "başlangıç zamanı");
  const warnings = started.warning ? [started.warning] : [];
  await assertProductionLineFree(machine, input.productionLineNo, started.value);

  let created: MachineRunDto;
  let orderTransitioned = false;
  try {
    created = await prisma.$transaction(async (tx) => {
      // İş emri PLANNED → IN_PROGRESS geçişinin TEK yazarı iş emri helper'ıdır;
      // tetikleyici koşumdur. Claim satır kilidi alır ve INSERT'ten ÖNCE koşar ki
      // eşzamanlı kapatma/iptal claim'iyle serileşsin (1e hükmü 2026-09-13).
      if (input.weavingOrderId) {
        const r = await markWeavingOrderInProgressTx(tx, input.weavingOrderId, userId);
        orderTransitioned = r.transitioned;
      }
      return tx.machineRun.create({
        data: {
          machineId: machine.id,
          productionLineNo: input.productionLineNo,
          startedAt: started.value,
          weavingOrderId: input.weavingOrderId ?? null,
          itemId,
          colorId,
          targetUnitsPerMin: input.targetUnitsPerMin ?? null,
          unitsPerCm: input.unitsPerCm != null ? new Prisma.Decimal(input.unitsPerCm) : null,
          clientToken: input.clientToken ?? null,
        },
        select: MACHINE_RUN_SELECT,
      });
    });
  } catch (e) {
    // Aynı token iki paralel istekte: ikinci create token unique'ine çarpar → replay.
    if (input.clientToken && isClientTokenP2002(e)) {
      const existing = await findByToken(input.clientToken);
      if (existing) {
        return { success: true, data: resolveOpenReplay(existing, input), message: "Koşum zaten kayıtlı (yeniden gönderim)" };
      }
    }
    if (p2002Mentions(e, /machine_runs_(one_open_per_prod_line|natural)_uq/)) {
      throw AppError.conflict(
        "Bu hatta az önce başka bir koşum açıldı — tekrar deneyin.",
        { code: "MACHINE_RUN_RACE", machineId: machine.id, productionLineNo: input.productionLineNo },
      );
    }
    throw e;
  }

  await auditRunOpened(created, userId, orderTransitioned ? input.weavingOrderId ?? null : null);

  return {
    success: true,
    data: created,
    message: "Koşum açıldı",
    ...(warnings.length ? { warnings } : {}),
  };
}

/**
 * KAPANIŞ — TEK YAZAR. Terimler burada donar; watchdog gibi ileride doğacak
 * her kapatan yol da bu fonksiyondan geçer (ikinci yazar, çift yüklem sınıfı).
 * Claim `closedTermsAt IS NULL` çıpasıyla; count-0 tanısı tx içinde fresh okunur.
 */
export async function closeMachineRunTx(
  tx: Prisma.TransactionClient,
  runId: string,
  input: CloseMachineRunInput,
  endedAt: Date,
): Promise<MachineRunDto> {
  const now = new Date();
  const claim = await tx.machineRun.updateMany({
    where: { id: runId, endedAt: null, revokedAt: null, closedTermsAt: null, startedAt: { lte: endedAt } },
    data: {
      endedAt,
      picksAtClose: input.picksAtClose ?? null,
      producedM: input.producedM != null ? new Prisma.Decimal(input.producedM) : null,
      observedSecAtClose: input.observedSecAtClose ?? null,
      closedTermsAt: now,
    },
  });
  if (claim.count === 0) {
    const fresh = await tx.machineRun.findUnique({
      where: { id: runId },
      select: { startedAt: true, endedAt: true, closedTermsAt: true, revokedAt: true },
    });
    if (!fresh) throw AppError.notFound("Koşum bulunamadı", { runId });
    if (fresh.revokedAt) {
      throw AppError.conflict("Bu koşum geri alınmış — kapatılamaz.", { code: "RUN_REVOKED", runId, revokedAt: fresh.revokedAt });
    }
    if (fresh.closedTermsAt) {
      throw AppError.conflict("Bu koşum zaten kapatılmış.", {
        code: "RUN_ALREADY_CLOSED",
        runId,
        endedAt: fresh.endedAt,
        closedTermsAt: fresh.closedTermsAt,
      });
    }
    if (fresh.startedAt > endedAt) {
      throw AppError.badRequest("Bitiş zamanı başlangıçtan önce olamaz.", {
        code: "RUN_END_BEFORE_START",
        startedAt: fresh.startedAt,
        endedAt,
      });
    }
    throw AppError.conflict("Koşum az önce değişti — tekrar deneyin.", { code: "MACHINE_RUN_RACE", runId });
  }
  return tx.machineRun.findUniqueOrThrow({ where: { id: runId }, select: MACHINE_RUN_SELECT });
}

export async function closeMachineRun(
  runId: string,
  input: CloseMachineRunInput,
  userId?: string,
): Promise<ApiResponse<MachineRunDto>> {
  const ended = resolveRunStamp(input.endedAt, "bitiş zamanı");
  const warnings = ended.warning ? [ended.warning] : [];

  const closed = await prisma.$transaction((tx) => closeMachineRunTx(tx, runId, input, ended.value));

  await AuditService.log({
    userId,
    action: "UPDATE",
    tableName: TABLE,
    recordId: closed.id,
    changes: [
      { field: "endedAt", old: null, new: closed.endedAt },
      { field: "picksAtClose", old: null, new: closed.picksAtClose },
      { field: "producedM", old: null, new: closed.producedM },
      { field: "observedSecAtClose", old: null, new: closed.observedSecAtClose },
    ],
  }).catch(() => undefined);

  return {
    success: true,
    data: closed,
    message: "Koşum kapatıldı",
    ...(warnings.length ? { warnings } : {}),
  };
}

/**
 * GERİ ALMA — damga. Açık ya da kapanmış koşum geri alınabilir; ileri satır
 * NE SİLİNİR NE DEĞİŞİR, sedde yer işgal etmez (yüklem `revokedAt IS NULL`).
 *
 * BORÇ (adıyla): mühürlenmiş vardiyaya düşen koşumun geri alınması 409
 * `SHIFT_SEALED` vermeli; mühür yazma yüzeyi henüz yok, kapı o yüzeyle doğar.
 */
export async function revokeMachineRun(
  runId: string,
  reason: string,
  userId?: string,
): Promise<ApiResponse<MachineRunDto>> {
  const revoked = await prisma.$transaction(async (tx) => {
    const claim = await tx.machineRun.updateMany({
      where: { id: runId, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: userId ?? null, revokeReason: reason },
    });
    if (claim.count === 0) {
      const fresh = await tx.machineRun.findUnique({ where: { id: runId }, select: { revokedAt: true } });
      if (!fresh) throw AppError.notFound("Koşum bulunamadı", { runId });
      throw AppError.conflict("Bu koşum zaten geri alınmış.", { code: "RUN_ALREADY_REVOKED", runId, revokedAt: fresh.revokedAt });
    }
    return tx.machineRun.findUniqueOrThrow({ where: { id: runId }, select: MACHINE_RUN_SELECT });
  });

  await AuditService.log({
    userId,
    action: "UPDATE",
    tableName: TABLE,
    recordId: revoked.id,
    changes: [
      { field: "revokedAt", old: null, new: revoked.revokedAt },
      { field: "revokeReason", old: null, new: revoked.revokeReason },
    ],
  }).catch(() => undefined);

  return { success: true, data: revoked, message: "Koşum geri alındı" };
}
