// =============================================================================
// TeksERP — TEZGAH DURUŞU (MachineStopEvent) Servisi · ELLE GİRİŞ (Faz 1b)
// =============================================================================
// Duruş bir SPAN DEFTERİDİR (koşum emsali): açık duruş DURUM, kapanmış duruş
// KAYIT. Beş yazma yolu vardır ve beşi de burada yaşar — İKİNCİ YAZAR DOĞMAZ:
//   • AÇ         — makine başına tek açık duruş; sed DB'de (`machine_stops_one_open_
//                  per_machine_uq`), yarışın kaybedeni P2002 → 409 `STOP_ALREADY_OPEN`.
//                  Kimlik `stopKey` (istemci token'ı ya da sunucu uuid); replay aynı satırı döner.
//   • KAPA       — claim `endedAt IS NULL ∧ revokedAt IS NULL`; süre burada hesaplanır.
//   • SINIFLA    — İLK karar (NULL → değer): claim `reasonCode IS NULL`; kayıp sınıfı
//                  preset'ten KOPYALANIR ve DONAR (katalog değişse satır değişmez).
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
// Elle girişte makine kaynaklı alanlar (`signalKind` · `rawStopCode` · `collectorId` ·
// `provisionalEndedAt`) YAZILMAZ — onların yazıcısı Faz 2 ingest'idir.
// =============================================================================
import { MachineDataSource } from "@prisma/client";
import { randomUUID } from "node:crypto";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { p2002Mentions } from "../utils/p2002";
import { resolveRunStamp } from "./helpers/machine-run-open.helper";
import { assertReplayPayloadMatches } from "./helpers/idempotent-replay.helper";
import { factoryDayKeyUtcMidnight } from "../constants/time";
import {
  MACHINE_STOP_SELECT,
  type MachineStopDto,
  assertStopShiftWritableTx,
  loadStop,
  normalizeNote,
  resolveRunId,
  resolveShiftInstanceId,
  resolveStopPreset,
} from "./helpers/machine-stop-context.helper";
import type { ApiResponse } from "../types/api.types";

const TABLE = "MACHINE_STOP_EVENT";


export interface OpenManualStopInput {
  machineId: string;
  /** İstemci beyanı; yoksa sunucu saati (makul aralık dışı → sunucu saati + uyarı). */
  startedAt?: Date | null;
  /** Açılışta sebep verilebilir; verilmezse sınıflandırma borcu (`requiresReason`) doğar. */
  reasonCode?: string | null;
  reasonNote?: string | null;
  beamSlot?: number | null;
  /** Elle girişte KİMLİK: replay aynı anahtarla aynı satırı döner. Yoksa sunucu üretir. */
  clientToken?: string | null;
  /** Kim giriyor — operatör (tablet) mı, vardiya amiri (panel) mi. */
  source?: Extract<MachineDataSource, "OPERATOR" | "SUPERVISOR">;
}

export interface ClassifyStopInput {
  reasonCode: string;
  reasonNote?: string | null;
  beamSlot?: number | null;
}

export interface ReclassifyStopInput {
  /** Beklenen mevcut kod — claim'in çıpası (yarışta bayat karar üzerine yazılmasın). */
  fromReasonCode: string;
  toReasonCode: string;
  /** Değişikliğin gerekçesi — reclass satırına yazılır. */
  reason?: string | null;
  /** Olayın YENİ notu (verilirse). Eski not yerinde ezilmez: reclass satırında saklanır (F3). */
  reasonNote?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// AÇ
// ─────────────────────────────────────────────────────────────────────────────
export async function openManualStop(input: OpenManualStopInput, userId?: string): Promise<ApiResponse<MachineStopDto>> {
  const stopKey = input.clientToken ?? randomUUID();
  const source: MachineDataSource = input.source ?? MachineDataSource.SUPERVISOR;

  // ① Replay — yaratmadan ÖNCE: aynı anahtar aynı satırı döner; geri alınmış duruş yeniden açılmaz.
  const started = resolveRunStamp(input.startedAt, "duruş başlangıcı");
  const warnings = started.warning ? [started.warning] : [];

  const existing = await prisma.machineStopEvent.findFirst({ where: { machineId: input.machineId, stopKey }, select: MACHINE_STOP_SELECT });
  if (existing) {
    if (existing.revokedAt) {
      throw AppError.conflict("Bu duruş daha önce girilip geri alınmış — yeni duruş için formu yeniden açın.", {
        code: "STOP_REVOKED", stopId: existing.id, revokedAt: existing.revokedAt,
      });
    }
    // Replay PARMAK İZİ (F2, koşum/doff emsali): aynı anahtar BAŞKA yükle gelirse 409 —
    // aynı formun ikinci gönderimi değil, başka bir duruş demektir. Başlangıç sunucu
    // çözümü üzerinden (istemci beyanı makul aralık dışında düştüyse ikisi de düşer).
    assertReplayPayloadMatches(
      [
        { ad: "machineId", mevcut: existing.machineId, gelen: input.machineId },
        { ad: "startedAt", mevcut: existing.startedAt.getTime(), gelen: started.value.getTime() },
        { ad: "reasonCode", mevcut: existing.reasonCode, gelen: input.reasonCode?.trim() ?? null },
      ],
      "Bu form daha önce başka bir duruş için kaydedilmiş — yeni duruş için formu yeniden açın.",
      { stopId: existing.id },
    );
    return { success: true, data: existing, message: "Duruş zaten kayıtlı (yeniden gönderim)" };
  }

  let created: MachineStopDto;
  try {
    created = await prisma.$transaction(async (tx) => {
      const machine = await tx.machine.findUnique({ where: { id: input.machineId }, select: { id: true, isActive: true } });
      if (!machine) throw AppError.notFound("Makine bulunamadı", { machineId: input.machineId });
      if (!machine.isActive) throw AppError.badRequest("Pasif makineye duruş girilemez.", { code: "MACHINE_INACTIVE" });
      const preset = input.reasonCode ? await resolveStopPreset(tx, input.reasonCode) : null;
      const shiftInstanceId = await resolveShiftInstanceId(tx, started.value);
      await assertStopShiftWritableTx(tx, { shiftInstanceId, machineId: machine.id });
      const runId = await resolveRunId(tx, machine.id, started.value);
      return tx.machineStopEvent.create({
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
          classifiedById: preset ? (userId ?? null) : null,
          classifiedAt: preset ? new Date() : null,
          requiresReason: preset === null,
          shiftInstanceId,
          factoryDay: factoryDayKeyUtcMidnight(started.value),
          source,
        },
        select: MACHINE_STOP_SELECT,
      });
    });
  } catch (e) {
    if (p2002Mentions(e, /machine_stops_one_open_per_machine_uq/)) {
      throw AppError.conflict("Bu makinede zaten açık bir duruş var — önce onu kapatın.", {
        code: "STOP_ALREADY_OPEN", machineId: input.machineId,
      });
    }
    if (p2002Mentions(e, /machine_stops_key_uq/)) {
      const again = await prisma.machineStopEvent.findFirst({ where: { machineId: input.machineId, stopKey }, select: MACHINE_STOP_SELECT });
      if (again && !again.revokedAt) return { success: true, data: again, message: "Duruş zaten kayıtlı (yeniden gönderim)" };
    }
    throw e;
  }

  await AuditService.log({
    userId, action: "CREATE", tableName: TABLE, recordId: created.id,
    newData: { machineId: created.machineId, startedAt: created.startedAt, reasonCode: created.reasonCode, source: created.source },
  }).catch(() => undefined);

  return { success: true, data: created, message: "Duruş açıldı", ...(warnings.length ? { warnings } : {}) };
}

// ─────────────────────────────────────────────────────────────────────────────
// KAPA
// ─────────────────────────────────────────────────────────────────────────────
export async function closeManualStop(stopId: string, endedAtIn: Date | null | undefined, userId?: string): Promise<ApiResponse<MachineStopDto>> {
  const ended = resolveRunStamp(endedAtIn, "duruş bitişi");
  const warnings = ended.warning ? [ended.warning] : [];

  const closed = await prisma.$transaction(async (tx) => {
    const cur = await tx.machineStopEvent.findUnique({ where: { id: stopId }, select: { shiftInstanceId: true, machineId: true } });
    if (!cur) throw AppError.notFound("Duruş bulunamadı", { stopId });
    await assertStopShiftWritableTx(tx, cur);
    // Süre startedAt'ten; claim WHERE'i başlangıcı da pinler (bitiş < başlangıç 400'e düşer).
    // `endSource` sabit OPERATOR (F6): enum SIGNAL|OPERATOR|WATCHDOG — insan kapanışının tek değeri;
    // amir/operatör ayrımı `source`/`reasonSource`ta yaşar, kapanış kaynağı "insan" der.
    // Uygulama saati parametreyle (kök yasak: ham SQL'de çıplak `now()`; sunucu saati tek kaynak `new Date()`).
    const simdi = new Date();
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE machine_stop_events
         SET "endedAt" = ${ended.value}, "endSource" = 'OPERATOR'::"MachineStopEndSource",
             "durationSec" = GREATEST(0, EXTRACT(EPOCH FROM (${ended.value}::timestamptz - "startedAt")))::int,
             "updatedAt" = ${simdi}::timestamptz
       WHERE id = ${stopId}::uuid AND "endedAt" IS NULL AND "revokedAt" IS NULL AND "startedAt" <= ${ended.value}::timestamptz
       RETURNING id`;
    if (rows.length === 0) {
      const fresh = await tx.machineStopEvent.findUniqueOrThrow({ where: { id: stopId }, select: { startedAt: true, endedAt: true, revokedAt: true } });
      if (fresh.revokedAt) throw AppError.conflict("Bu duruş geri alınmış — kapatılamaz.", { code: "STOP_REVOKED", stopId, revokedAt: fresh.revokedAt });
      if (fresh.endedAt) throw AppError.conflict("Bu duruş zaten kapatılmış.", { code: "STOP_ALREADY_CLOSED", stopId, endedAt: fresh.endedAt });
      if (fresh.startedAt > ended.value) {
        throw AppError.badRequest("Bitiş zamanı başlangıçtan önce olamaz.", { code: "STOP_END_BEFORE_START", startedAt: fresh.startedAt, endedAt: ended.value });
      }
      throw AppError.conflict("Duruş az önce değişti — tekrar deneyin.", { code: "MACHINE_STOP_RACE", stopId });
    }
    return loadStop(tx, stopId);
  });

  await AuditService.log({
    userId, action: "UPDATE", tableName: TABLE, recordId: closed.id,
    changes: [{ field: "endedAt", old: null, new: closed.endedAt }, { field: "durationSec", old: null, new: closed.durationSec }],
  }).catch(() => undefined);

  return { success: true, data: closed, message: "Duruş kapatıldı", ...(warnings.length ? { warnings } : {}) };
}

// ─────────────────────────────────────────────────────────────────────────────
// SINIFLA (ilk karar) — NULL → değer, yerinde; kayıp sınıfı kopyalanır
// ─────────────────────────────────────────────────────────────────────────────
export async function classifyStop(stopId: string, input: ClassifyStopInput, userId?: string, source: MachineDataSource = MachineDataSource.SUPERVISOR): Promise<ApiResponse<MachineStopDto>> {
  const classified = await prisma.$transaction(async (tx) => {
    const cur = await tx.machineStopEvent.findUnique({ where: { id: stopId }, select: { shiftInstanceId: true, machineId: true } });
    if (!cur) throw AppError.notFound("Duruş bulunamadı", { stopId });
    await assertStopShiftWritableTx(tx, cur);
    const preset = await resolveStopPreset(tx, input.reasonCode);
    const claim = await tx.machineStopEvent.updateMany({
      where: { id: stopId, reasonCode: null, revokedAt: null },
      data: {
        reasonCode: preset.code,
        lossClass: preset.lossClass,
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
    changes: [{ field: "reasonCode", old: null, new: classified.reasonCode }, { field: "lossClass", old: null, new: classified.lossClass }],
  }).catch(() => undefined);

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
    const cur = await tx.machineStopEvent.findUnique({ where: { id: stopId }, select: { shiftInstanceId: true, machineId: true, lossClass: true, reasonNote: true } });
    if (!cur) throw AppError.notFound("Duruş bulunamadı", { stopId });
    await assertStopShiftWritableTx(tx, cur);
    const to = await resolveStopPreset(tx, input.toReasonCode);
    const yeniNot = input.reasonNote === undefined ? undefined : normalizeNote(input.reasonNote);
    // Claim: kayıtlı karar hâlâ beklenen mi (yarışta bayat karar üzerine yazılmaz).
    const claim = await tx.machineStopEvent.updateMany({
      where: { id: stopId, reasonCode: input.fromReasonCode.trim(), revokedAt: null },
      data: {
        reasonCode: to.code, lossClass: to.lossClass, reasonSource: MachineDataSource.SUPERVISOR,
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
    return loadStop(tx, stopId);
  });

  await AuditService.log({
    userId, action: "UPDATE", tableName: TABLE, recordId: reclassed.id,
    changes: [{ field: "reasonCode", old: input.fromReasonCode, new: reclassed.reasonCode }],
  }).catch(() => undefined);

  return { success: true, data: reclassed, message: "Duruş yeniden sınıflandırıldı" };
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
    await assertStopShiftWritableTx(tx, cur);
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

  return { success: true, data: revoked, message: "Duruş geri alındı" };
}

