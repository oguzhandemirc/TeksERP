// =============================================================================
// TeksERP — TEZGAH DURUŞU (MachineStopEvent) Servisi · elle giriş + makine sinyalinin çekirdeği
// =============================================================================
// Duruş bir SPAN DEFTERİDİR (koşum emsali): açık duruş DURUM, kapanmış duruş
// KAYIT. Altı yazma yolu vardır ve altısı da burada yaşar — İKİNCİ YAZAR DOĞMAZ:
//   • AÇ         — makine başına tek açık duruş; sed DB'de (`machine_stops_one_open_
//                  per_machine_uq`), yarışın kaybedeni P2002 → 409 `STOP_ALREADY_OPEN`.
//                  Kimlik `stopKey` (istemci token'ı ya da sunucu uuid); replay aynı satırı döner.
//   • SAHİPLEN   — kart insanın açık duruşunu üstlenir (K1): yalnız kart alanları null → değer.
//   • KAPA       — claim `endedAt IS NULL ∧ revokedAt IS NULL`; süre burada hesaplanır.
//   • SINIFLA    — İLK karar (NULL → değer): claim `reasonCode IS NULL`; kayıp sınıfı
//                  preset'ten KOPYALANIR ve DONAR (katalog değişse satır değişmez); hedef
//                  süre ve iletim payı da öyle (`freezeStopEscalation`, aç/sınıfla/yeniden sınıfla).
//   • YENİDEN SINIFLA — değer → değer: kayıtlı KARAR değişir, olgular değişmez;
//                  değişimin kendisi `MachineStopReclass` satırıdır (from→to), aynı tx.
//                  Ters yolu KARŞI KAYITTIR: aynı fonksiyon to→from ile — silme/damga yok.
//   • GERİ AL    — `revokedAt` damgası; ileri satır ne silinir ne değişir.
//
// ⚠️ MÜHÜR SINIRI (tasarım §2.7/§2.10): mühür MAKİNE×VARDİYA karnesinin durumudur
// (`MachineShiftStat.sealState`, 01'in Faz 1a dilimi) — henüz ŞEMADA YOK. Kapı TEK
// fonksiyondadır (`helpers/machine-stop-context.helper.ts::assertStopShiftWritableTx`,
// `{ shiftInstanceId, machineId }` alır) ve bugün yalnız iptal edilmiş vardiyayı reddeder;
// karne inince aynı fonksiyon `sealState === SEALED` → 409 `SHIFT_SEALED` verir, çağıranlar değişmez.
//
// AÇ ve KAPA TEK BOĞAZDIR (`openStopCore` · `closeStopCore`): insan girişi (`openManualStop` ·
// `closeManualStop`) ve makine sinyali (`machine-stop-signal.service`) aynı çekirdekten geçer;
// makine kaynaklı alanları (`signalKind` · `rawStopCode` · `collectorId`) yalnız sinyal yolu yazar.
// =============================================================================
import { MachineDataSource, MachineStopEndSource } from "@prisma/client";
import { randomUUID } from "node:crypto";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { p2002Mentions } from "../utils/p2002";
import { factoryDayKeyUtcMidnight } from "../constants/time";
import { assertMachineStopKindAllowed, assertStopWritableTx, machineStopRegime } from "./helpers/machine-stop-regime.helper";
import {
  MACHINE_STOP_SELECT,
  type MachineStopDto,
  assertBeamSlotValid,
  assertNoStopOverlapTx,
  assertStopShiftWritableTx,
  findStopReplayTx,
  freezeStopEscalation,
  loadStop,
  normalizeNote,
  resolveRunId,
  resolveShiftInstanceId,
  resolveStopPreset,
  resolveStopStamp,
  signalCloseConflict,
} from "./helpers/machine-stop-context.helper";
import type {
  ClassifyStopInput, OpenManualStopInput, OpenManualStopOptions, OpenStopCoreInput, ReclassifyStopInput, StopCloser, StopSignalFields,
} from "../types/machine-stop-input.types";
import type { ApiResponse } from "../types/api.types";
import type { StampResolution } from "./helpers/machine-run-open.helper";
import { nudgeLoomAlarm } from "../jobs/loom-alarm.job";
import { STOP_CORRECTED_MESSAGE, auditWatchdogCorrection, correctWatchdogCloseTx, rethrowSealedSignalEnd } from "./helpers/machine-stop-watchdog.helper";

const TABLE = "MACHINE_STOP_EVENT";
/** Açılış replay'inin cevap metni — toplu açılış "yeniden gönderim" satırını bununla ayırır. */
export const STOP_REPLAY_MESSAGE = "Duruş zaten kayıtlı (yeniden gönderim)";
/** Makine kapanış sinyalinin tekrarı (aynı bitiş) — satır değişmez. */
export const STOP_CLOSE_REPLAY_MESSAGE = "Duruş zaten bu bitişle kapatılmış (yeniden gönderim)";


// ─────────────────────────────────────────────────────────────────────────────
// AÇ
// ─────────────────────────────────────────────────────────────────────────────
export async function openManualStop(input: OpenManualStopInput, userId?: string, opts: OpenManualStopOptions = {}): Promise<ApiResponse<MachineStopDto>> {
  const stopKey = input.clientToken ?? randomUUID();
  const source: MachineDataSource = input.source ?? MachineDataSource.SUPERVISOR;
  const started = resolveStopStamp(input.startedAt, "duruş başlangıcı", source);
  const reasonCode = input.reasonCode?.trim() ?? null;
  return openStopCore({
    machineId: input.machineId, stopKey, started, source, reasonCode: input.reasonCode, reasonNote: input.reasonNote,
    beamSlot: input.beamSlot, actorId: userId ?? null,
    // Replay PARMAK İZİ (F2, koşum/doff emsali): başlangıç sunucu çözümü üzerinden.
    fingerprint: (e) => [
      { ad: "machineId", mevcut: e.machineId, gelen: input.machineId },
      { ad: "startedAt", mevcut: e.startedAt.getTime(), gelen: started.value.getTime() },
      { ad: "reasonCode", mevcut: e.reasonCode, gelen: reasonCode },
    ],
  }, opts);
}

/**
 * DURUŞ AÇILIŞININ TEK BOĞAZI — insan (`openManualStop`) ve makine (`openMachineStop`) aynı
 * replay · mühür · sed · audit · alarm dürtmesi yolundan geçer; `machineStopEvent.create` yalnız burada.
 */
export async function openStopCore(input: OpenStopCoreInput, opts: OpenManualStopOptions = {}): Promise<ApiResponse<MachineStopDto>> {
  const { stopKey, started, source } = input;
  const warnings = started.warning ? [started.warning] : [];

  let created: MachineStopDto;
  try {
    const out = await prisma.$transaction(async (tx) => {
      // ① Replay — yaratmadan ÖNCE ve AYNI bağlantıda (ayrı havuz alımı istemesin).
      const existing = await findStopReplayTx(tx, input.machineId, stopKey, input.fingerprint);
      if (existing) return { replay: true as const, row: existing };
      const machine = await tx.machine.findUnique({ where: { id: input.machineId }, select: { id: true, isActive: true, warpBeamSlots: true, station: { select: { kind: true } } } });
      if (!machine) throw AppError.notFound("Makine bulunamadı", { machineId: input.machineId });
      if (!machine.isActive) throw AppError.badRequest("Pasif makineye duruş girilemez.", { code: "MACHINE_INACTIVE" });
      assertMachineStopKindAllowed(await machineStopRegime(tx), machine.station.kind, opts); // D4-A1: dokumasız rejimde yalnız kurşun/brode/tambur
      assertBeamSlotValid(machine, input.beamSlot);
      const preset = input.reasonCode ? await resolveStopPreset(tx, input.reasonCode) : null;
      const shiftInstanceId = await resolveShiftInstanceId(tx, started.value);
      await assertStopShiftWritableTx(tx, { shiftInstanceId, machineId: machine.id });
      if (opts.rejectOverlap) await assertNoStopOverlapTx(tx, machine.id, started.value);
      const runId = await resolveRunId(tx, machine.id, started.value);
      const escalation = await freezeStopEscalation(tx, preset, null);
      const row = await tx.machineStopEvent.create({
        data: {
          machineId: machine.id,
          runId,
          stopKey,
          startedAt: started.value,
          beamSlot: input.beamSlot ?? null,
          reasonCode: preset?.code ?? null,
          lossClass: preset?.lossClass ?? null,
          reasonNote: normalizeNote(input.reasonNote),
          reasonSource: preset ? source : null,
          classifiedById: preset ? input.actorId : null,
          classifiedAt: preset ? new Date() : null,
          openedById: input.actorId, // açan kişi; kapatan `closeStopCore`da
          requiresReason: preset === null,
          targetMinutes: escalation.targetMinutes,
          escalationGraceMinutes: escalation.escalationGraceMinutes,
          shiftInstanceId, factoryDay: factoryDayKeyUtcMidnight(started.value), source,
          ...(input.signal ?? {}),
        },
        select: MACHINE_STOP_SELECT,
      });
      return { replay: false as const, row };
    });
    if (out.replay) return { success: true, data: out.row, message: STOP_REPLAY_MESSAGE };
    created = out.row;
  } catch (e) {
    if (p2002Mentions(e, /machine_stops_one_open_per_machine_uq/)) {
      throw AppError.conflict("Bu makinede zaten açık bir duruş var — önce onu kapatın.", {
        code: "STOP_ALREADY_OPEN", machineId: input.machineId,
      });
    }
    if (p2002Mentions(e, /machine_stops_key_uq/)) {
      const again = await prisma.machineStopEvent.findFirst({ where: { machineId: input.machineId, stopKey }, select: MACHINE_STOP_SELECT });
      if (again && !again.revokedAt) return { success: true, data: again, message: STOP_REPLAY_MESSAGE };
    }
    throw e;
  }

  await AuditService.log({
    userId: input.actorId ?? undefined, action: "CREATE", tableName: TABLE, recordId: created.id,
    newData: {
      machineId: created.machineId, startedAt: created.startedAt, reasonCode: created.reasonCode, source: created.source,
      targetMinutes: created.targetMinutes, escalationGraceMinutes: created.escalationGraceMinutes,
      ...(input.signal ? { rawStopCode: created.rawStopCode, collectorId: created.collectorId } : {}),
    },
  }).catch(() => undefined);

  nudgeLoomAlarm();
  return { success: true, data: created, message: "Duruş açıldı", ...(warnings.length ? { warnings } : {}) };
}

// ─────────────────────────────────────────────────────────────────────────────
// SAHİPLEN (K1) — kart, insanın açtığı açık duruşu üstlenir; açılış insanınki kalır
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Claim `endedAt ∧ revokedAt IS NULL ∧ collectorId IS NULL ∧ kaynak insan`: yalnız kart alanları
 * (null → değer) yazılır, olgular (`startedAt` · `stopKey` · açan) değişmez. Sahiplenilecek duruş
 * yoksa ya da yarışta kaybedilirse `null` — çağıran açılışın sed hatasını aynen döner.
 */
export async function claimOpenStopForSignal(machineId: string, signal: StopSignalFields & { signalStopKey: string }): Promise<MachineStopDto | null> {
  const open = await prisma.machineStopEvent.findFirst({ where: { machineId, endedAt: null, revokedAt: null }, select: { id: true } });
  if (!open) return null;
  const human = { in: [MachineDataSource.OPERATOR, MachineDataSource.SUPERVISOR] };
  const claim = await prisma.machineStopEvent.updateMany({ where: { id: open.id, endedAt: null, revokedAt: null, collectorId: null, signalStopKey: null, source: human }, data: signal });
  if (claim.count === 0) return null;
  const changes = [["collectorId", signal.collectorId], ["rawStopCode", signal.rawStopCode], ["signalClaim", "sahiplenildi"]].map(([field, v]) => ({ field: field!, old: null, new: v }));
  await AuditService.log({ userId: undefined, action: "UPDATE", tableName: TABLE, recordId: open.id, changes }).catch(() => undefined);
  return prisma.machineStopEvent.findUniqueOrThrow({ where: { id: open.id }, select: MACHINE_STOP_SELECT });
}

// ─────────────────────────────────────────────────────────────────────────────
// KAPA
// ─────────────────────────────────────────────────────────────────────────────
export async function closeManualStop(
  stopId: string,
  endedAtIn: Date | null | undefined,
  userId?: string,
  source: MachineDataSource = MachineDataSource.SUPERVISOR,
): Promise<ApiResponse<MachineStopDto>> {
  const ended = resolveStopStamp(endedAtIn, "duruş bitişi", source);
  // `endSource` sabit OPERATOR (F6): insan kapanışının tek değeri; amir/operatör ayrımı `source`ta yaşar.
  return closeStopCore(stopId, ended, { endSource: MachineStopEndSource.OPERATOR, actorId: userId ?? null });
}

/**
 * DURUŞ KAPANIŞININ TEK BOĞAZI — insanın "Çalıştı"sı, makinenin "bitti" sinyali ve watchdog'un geçici kapanışı
 * aynı claim'den geçer (`endedAt IS NULL ∧ revokedAt IS NULL ∧ startedAt ≤ bitiş`); kim önce kapattıysa o kalır.
 * Tek istisna: WATCHDOG kapanışına gelen gerçek sinyal bitişi onu BİR KEZ düzeltir (`correctWatchdogCloseTx`).
 */
export async function closeStopCore(stopId: string, ended: StampResolution, closer: StopCloser): Promise<ApiResponse<MachineStopDto>> {
  const warnings = ended.warning ? [ended.warning] : [];
  const out = await prisma.$transaction(async (tx) => {
    const cur = await tx.machineStopEvent.findUnique({ where: { id: stopId }, select: { shiftInstanceId: true, machineId: true } });
    if (!cur) throw AppError.notFound("Duruş bulunamadı", { stopId });
    await assertStopWritableTx(tx, cur, closer.endSource === MachineStopEndSource.OPERATOR); // D4-A1 tür kapısı: sinyal/watchdog muaf
    // Süre startedAt'ten; claim WHERE'i başlangıcı da pinler (bitiş < başlangıç 400'e düşer).
    // Uygulama saati parametreyle (kök yasak: ham SQL'de çıplak `now()`; sunucu saati tek kaynak `new Date()`).
    const simdi = new Date();
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE machine_stop_events
         SET "endedAt" = ${ended.value}, "endSource" = ${closer.endSource}::"MachineStopEndSource", "closedById" = ${closer.actorId}::uuid,
             "provisionalEndedAt" = ${closer.endSource === MachineStopEndSource.WATCHDOG ? ended.value : null}::timestamptz,
             "durationSec" = GREATEST(0, EXTRACT(EPOCH FROM (${ended.value}::timestamptz - "startedAt")))::int,
             "updatedAt" = ${simdi}::timestamptz
       WHERE id = ${stopId}::uuid AND "endedAt" IS NULL AND "revokedAt" IS NULL AND "startedAt" <= ${ended.value}::timestamptz
       RETURNING id`;
    if (rows.length === 0) {
      const fresh = await tx.machineStopEvent.findUniqueOrThrow({ where: { id: stopId }, select: { machineId: true, startedAt: true, endedAt: true, revokedAt: true, endSource: true, endCorrectedAt: true } });
      if (fresh.revokedAt) throw AppError.conflict("Bu duruş geri alınmış — kapatılamaz.", { code: "STOP_REVOKED", stopId, revokedAt: fresh.revokedAt });
      if (await correctWatchdogCloseTx({ tx, stopId, fresh, closer, endedAt: ended.value, simdi })) return { stop: await loadStop(tx, stopId), replay: false, corrected: fresh.endedAt };
      if (fresh.endedAt && closer.endSource === MachineStopEndSource.SIGNAL) {
        return { stop: await loadStop(tx, stopId), replay: signalCloseConflict(stopId, { endedAt: fresh.endedAt, endSource: fresh.endSource }, ended.value) === "replay" };
      }
      if (fresh.endedAt) throw AppError.conflict("Bu duruş zaten kapatılmış.", { code: "STOP_ALREADY_CLOSED", stopId, endedAt: fresh.endedAt });
      if (fresh.startedAt > ended.value) {
        throw AppError.badRequest("Bitiş zamanı başlangıçtan önce olamaz.", { code: "STOP_END_BEFORE_START", startedAt: fresh.startedAt, endedAt: ended.value });
      }
      throw AppError.conflict("Duruş az önce değişti — tekrar deneyin.", { code: "MACHINE_STOP_RACE", stopId });
    }
    return { stop: await loadStop(tx, stopId), replay: false };
    // Mühürlü vardiyada kartın gerçek bitişi kaybolmaz: geciken kapanış kuyruğuna yazılır, 409 korunur.
  }).catch((e: unknown) => rethrowSealedSignalEnd(e, stopId, ended.value, closer.endSource));
  if (out.replay) return { success: true, data: out.stop, message: STOP_CLOSE_REPLAY_MESSAGE };

  const closed = out.stop;
  if ("corrected" in out) await auditWatchdogCorrection(closed, out.corrected);
  else await AuditService.log({
    userId: closer.actorId ?? undefined, action: "UPDATE", tableName: TABLE, recordId: closed.id,
    changes: [{ field: "endedAt", old: null, new: closed.endedAt }, { field: "durationSec", old: null, new: closed.durationSec }],
  }).catch(() => undefined);

  nudgeLoomAlarm();
  return { success: true, data: closed, message: "corrected" in out ? STOP_CORRECTED_MESSAGE : "Duruş kapatıldı", ...(warnings.length ? { warnings } : {}) };
}

// ─────────────────────────────────────────────────────────────────────────────
// SINIFLA (ilk karar) — NULL → değer, yerinde; kayıp sınıfı kopyalanır
// ─────────────────────────────────────────────────────────────────────────────
export async function classifyStop(stopId: string, input: ClassifyStopInput, userId?: string, source: MachineDataSource = MachineDataSource.SUPERVISOR): Promise<ApiResponse<MachineStopDto>> {
  const classified = await prisma.$transaction(async (tx) => {
    const cur = await tx.machineStopEvent.findUnique({
      where: { id: stopId },
      select: { shiftInstanceId: true, machineId: true, escalationGraceMinutes: true, machine: { select: { warpBeamSlots: true } } },
    });
    if (!cur) throw AppError.notFound("Duruş bulunamadı", { stopId });
    await assertStopWritableTx(tx, cur, source !== MachineDataSource.MACHINE); // D4-A1 tür kapısı: makine sınıflaması muaf
    assertBeamSlotValid(cur.machine, input.beamSlot);
    const preset = await resolveStopPreset(tx, input.reasonCode);
    const escalation = await freezeStopEscalation(tx, preset, cur.escalationGraceMinutes);
    const claim = await tx.machineStopEvent.updateMany({
      where: { id: stopId, reasonCode: null, revokedAt: null },
      data: {
        reasonCode: preset.code,
        lossClass: preset.lossClass,
        targetMinutes: escalation.targetMinutes,
        escalationGraceMinutes: escalation.escalationGraceMinutes,
        reasonNote: normalizeNote(input.reasonNote),
        reasonSource: source,
        classifiedById: userId ?? null,
        classifiedAt: new Date(),
        ...(input.beamSlot !== undefined ? { beamSlot: input.beamSlot } : {}),
      },
    });
    if (claim.count === 0) {
      const fresh = await tx.machineStopEvent.findUniqueOrThrow({ where: { id: stopId }, select: { reasonCode: true, revokedAt: true } });
      if (fresh.revokedAt) throw AppError.conflict("Geri alınmış duruş sınıflandırılamaz.", { code: "STOP_REVOKED", stopId });
      throw AppError.conflict(`Bu duruş zaten sınıflandırılmış (${fresh.reasonCode}) — değiştirmek için 'yeniden sınıfla' yolunu kullanın.`, {
        code: "STOP_ALREADY_CLASSIFIED", stopId, reasonCode: fresh.reasonCode,
      });
    }
    return loadStop(tx, stopId);
  });

  await AuditService.log({
    userId, action: "UPDATE", tableName: TABLE, recordId: classified.id,
    changes: [
      { field: "reasonCode", old: null, new: classified.reasonCode },
      { field: "lossClass", old: null, new: classified.lossClass },
      { field: "targetMinutes", old: null, new: classified.targetMinutes },
    ],
  }).catch(() => undefined);

  nudgeLoomAlarm();
  return { success: true, data: classified, message: "Duruş sınıflandırıldı" };
}

// ─────────────────────────────────────────────────────────────────────────────
// YENİDEN SINIFLA — değer → değer; değişim DEFTERE (from→to), ters yolu KARŞI KAYIT
// ─────────────────────────────────────────────────────────────────────────────
export async function reclassifyStop(stopId: string, input: ReclassifyStopInput, userId?: string): Promise<ApiResponse<MachineStopDto>> {
  if (input.fromReasonCode.trim() === input.toReasonCode.trim()) {
    throw AppError.badRequest("Yeni sebep mevcut sebeple aynı — değişiklik yok.", { code: "STOP_RECLASS_NOOP" });
  }
  const reclassed = await prisma.$transaction(async (tx) => {
    const cur = await tx.machineStopEvent.findUnique({ where: { id: stopId }, select: { shiftInstanceId: true, machineId: true, lossClass: true, reasonNote: true, targetMinutes: true, escalationGraceMinutes: true } });
    if (!cur) throw AppError.notFound("Duruş bulunamadı", { stopId });
    await assertStopWritableTx(tx, cur); // mühür/iptal vardiya + D4-A1 tür kapısı
    const to = await resolveStopPreset(tx, input.toReasonCode);
    const escalation = await freezeStopEscalation(tx, to, cur.escalationGraceMinutes);
    const yeniNot = input.reasonNote === undefined ? undefined : normalizeNote(input.reasonNote);
    // Claim: kayıtlı karar hâlâ beklenen mi (yarışta bayat karar üzerine yazılmaz).
    const claim = await tx.machineStopEvent.updateMany({
      where: { id: stopId, reasonCode: input.fromReasonCode.trim(), revokedAt: null },
      data: {
        reasonCode: to.code, lossClass: to.lossClass, reasonSource: MachineDataSource.SUPERVISOR,
        targetMinutes: escalation.targetMinutes, escalationGraceMinutes: escalation.escalationGraceMinutes,
        classifiedById: userId ?? null, classifiedAt: new Date(),
        ...(yeniNot !== undefined ? { reasonNote: yeniNot } : {}),
      },
    });
    if (claim.count === 0) {
      const fresh = await tx.machineStopEvent.findUniqueOrThrow({ where: { id: stopId }, select: { reasonCode: true, revokedAt: true } });
      if (fresh.revokedAt) throw AppError.conflict("Geri alınmış duruş yeniden sınıflandırılamaz.", { code: "STOP_REVOKED", stopId });
      if (fresh.reasonCode === null) {
        throw AppError.conflict("Bu duruş henüz sınıflandırılmamış — önce 'sınıfla' yolunu kullanın.", { code: "STOP_NOT_CLASSIFIED", stopId });
      }
      throw AppError.conflict(`Duruşun sebebi bu sırada değişmiş (${fresh.reasonCode}) — listeyi yenileyip tekrar deneyin.`, {
        code: "STOP_RECLASS_STALE", stopId, reasonCode: fresh.reasonCode,
      });
    }
    // DEFTER — aynı tx: karar değişti, değişimin kendisi satır. Bir daha değişmez.
    await tx.machineStopReclass.create({
      data: {
        stopEventId: stopId,
        fromReasonCode: input.fromReasonCode.trim(),
        toReasonCode: to.code,
        fromLossClass: cur.lossClass,
        toLossClass: to.lossClass,
        // Gerekçe + (not değiştiyse) ESKİ not — yerinde ezilen tek şey olay notu olurdu, defter onu taşır.
        reason: normalizeNote(
          [input.reason?.trim() || null, yeniNot !== undefined && cur.reasonNote ? `eski not: ${cur.reasonNote}` : null].filter(Boolean).join(" · ") || null,
        ),
        actedById: userId ?? null,
      },
    });
    return { stop: await loadStop(tx, stopId), oldTargetMinutes: cur.targetMinutes };
  });

  await AuditService.log({
    userId, action: "UPDATE", tableName: TABLE, recordId: reclassed.stop.id,
    changes: [
      { field: "reasonCode", old: input.fromReasonCode, new: reclassed.stop.reasonCode },
      { field: "targetMinutes", old: reclassed.oldTargetMinutes, new: reclassed.stop.targetMinutes },
    ],
  }).catch(() => undefined);

  nudgeLoomAlarm();
  return { success: true, data: reclassed.stop, message: "Duruş yeniden sınıflandırıldı" };
}

// ─────────────────────────────────────────────────────────────────────────────
// GERİ AL — damga
// ─────────────────────────────────────────────────────────────────────────────
export async function revokeStop(stopId: string, reason: string, userId?: string): Promise<ApiResponse<MachineStopDto>> {
  const trimmed = reason?.trim() ?? "";
  if (trimmed.length < 3) throw AppError.badRequest("Geri alma gerekçesi en az 3 karakter olmalı.", { code: "REVOKE_REASON_REQUIRED" });

  const revoked = await prisma.$transaction(async (tx) => {
    const cur = await tx.machineStopEvent.findUnique({ where: { id: stopId }, select: { shiftInstanceId: true, machineId: true } });
    if (!cur) throw AppError.notFound("Duruş bulunamadı", { stopId });
    await assertStopWritableTx(tx, cur); // mühür/iptal vardiya + D4-A1 tür kapısı
    const claim = await tx.machineStopEvent.updateMany({
      where: { id: stopId, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: userId ?? null, revokeReason: trimmed.slice(0, 300) },
    });
    if (claim.count === 0) {
      const fresh = await tx.machineStopEvent.findUniqueOrThrow({ where: { id: stopId }, select: { revokedAt: true } });
      throw AppError.conflict("Bu duruş zaten geri alınmış.", { code: "STOP_ALREADY_REVOKED", stopId, revokedAt: fresh.revokedAt });
    }
    return loadStop(tx, stopId);
  });

  await AuditService.log({
    userId, action: "UPDATE", tableName: TABLE, recordId: revoked.id,
    changes: [{ field: "revokedAt", old: null, new: revoked.revokedAt }, { field: "revokeReason", old: null, new: revoked.revokeReason }],
  }).catch(() => undefined);

  nudgeLoomAlarm();
  return { success: true, data: revoked, message: "Duruş geri alındı" };
}

