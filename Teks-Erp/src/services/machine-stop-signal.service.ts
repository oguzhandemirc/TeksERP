// =============================================================================
// TeksERP — MAKİNE KAYNAKLI DURUŞ (toplayıcı kartın sinyali) · giriş fonksiyonları
// =============================================================================
// Kart duruşu ve bitişini OTOMATİK bildirir; insan yalnız müdahale eder (sınıflar, düzeltir,
// geri alır). Bu dosya YAZMAZ: açılış ve kapanış `machine-stop.service`in tek boğazından
// (`openStopCore` · `closeStopCore`) geçer — insan girişiyle aynı replay, mühür, sed, audit ve
// alarm dürtmesi. Farklar yalnız girişte: kaynak `MACHINE | SIMULATED`, damga beyan ve zorunlu,
// kimlik kartın `stopKey`i, kişi alanları (açan/kapatan/sınıflayan) NULL kalır.
// K1: insanın açık duruşu varsa kart onu SAHİPLENİR (`claimOpenStopForSignal`) — açılış insanınki kalır.
// HTTP ucu `routes/machine-signal.routes.ts` (kart imzası `middlewares/collector-auth.middleware.ts`).
// =============================================================================
import { MachineDataSource, MachineStopEndSource, type MachineSignalKind } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import type { ApiResponse } from "../types/api.types";
import { STOP_REPLAY_MESSAGE, claimOpenStopForSignal, classifyStop, closeStopCore, openStopCore } from "./machine-stop.service";
import { MACHINE_STOP_SELECT, resolveStopStamp, type MachineStopDto } from "./helpers/machine-stop-context.helper";
import { assertReplayPayloadMatches } from "./helpers/idempotent-replay.helper";
import type { StampResolution } from "./helpers/machine-run-open.helper";
import { resolveMachineStopCode } from "./helpers/machine-stop-code.helper";

/** Makine yolunun kabul ettiği kaynaklar — insan kaynakları (OPERATOR/SUPERVISOR) bu yoldan yazılamaz. */
export const MACHINE_STOP_SOURCES = [MachineDataSource.MACHINE, MachineDataSource.SIMULATED] as const;
export type MachineStopSource = (typeof MACHINE_STOP_SOURCES)[number];

const RAW_STOP_CODE_MAX = 32;
/** Kart insanın açık duruşunu üstlendi (K1) — cevap metni. */
export const STOP_CLAIM_MESSAGE = "Açık duruş kart tarafından sahiplenildi";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface OpenMachineStopInput {
  machineId: string;
  /** Kartın duruşu ilk gördüğünde ürettiği UUID — açılış, kapanış ve tekrar AYNI anahtarla gelir. */
  stopKey: string;
  startedAt: Date;
  source: MachineStopSource;
  signalKind?: MachineSignalKind | null;
  /** Kontrolcünün ham duruş kodu — ÇEVRİLMEDEN saklanır. */
  rawStopCode?: string | null;
  collectorId?: string | null;
}

export interface CloseMachineStopInput {
  machineId: string;
  stopKey: string;
  endedAt: Date;
  source: MachineStopSource;
}

function assertMachineSource(source: MachineDataSource): void {
  if (!(MACHINE_STOP_SOURCES as readonly MachineDataSource[]).includes(source)) {
    throw AppError.badRequest("Makine duruşu yalnız MACHINE ya da SIMULATED kaynağıyla yazılır.", { code: "STOP_SOURCE_INVALID", source });
  }
}

function assertStopKey(stopKey: string): void {
  if (!UUID_RE.test(stopKey)) throw AppError.badRequest("Duruş anahtarı (stopKey) UUID olmalı.", { code: "STOP_KEY_INVALID" });
}

function normalizeRawStopCode(raw: string | null | undefined): string | null {
  const v = raw?.trim() ?? "";
  if (v.length === 0) return null;
  if (v.length > RAW_STOP_CODE_MAX) {
    throw AppError.badRequest(`Ham duruş kodu en çok ${RAW_STOP_CODE_MAX} karakter olabilir.`, { code: "RAW_STOP_CODE_TOO_LONG" });
  }
  return v;
}

/** Toplayıcının kart tipi — kodun anlamı ona bağlı; toplayıcısız sinyalde eşleme aranmaz. */
async function collectorTypeOf(collectorId: string | null | undefined): Promise<string | null> {
  if (!collectorId) return null;
  const row = await prisma.machineCollector.findUnique({ where: { id: collectorId }, select: { collectorType: true } });
  return row?.collectorType ?? null;
}

/**
 * Kart duruş gördü — ham kod eşlemesi (`resolveMachineStopCode`) sebep bulursa sebep MAKİNE
 * kararıyla açılışta donar; bulamazsa sebepsiz açılır (sınıflandırma borcu).
 */
export async function openMachineStop(input: OpenMachineStopInput): Promise<ApiResponse<MachineStopDto>> {
  assertMachineSource(input.source);
  assertStopKey(input.stopKey);
  const rawStopCode = normalizeRawStopCode(input.rawStopCode);
  const started = resolveStopStamp(input.startedAt, "duruş başlangıcı", input.source);
  const claimed = await findClaimedStop(input.machineId, input.stopKey);
  if (claimed) return claimReplay(claimed, input, rawStopCode);
  const mapped = await resolveMachineStopCode(prisma, {
    collectorType: await collectorTypeOf(input.collectorId), rawStopCode, machineId: input.machineId,
  });
  try {
    return await openStopCoreFor(input, started, rawStopCode, mapped?.reasonCode ?? null);
  } catch (e) {
    if (!(e instanceof AppError) || e.details?.code !== "STOP_ALREADY_OPEN" || !input.collectorId) throw e;
    const own = await claimOpenStopForSignal(input.machineId, {
      signalKind: input.signalKind ?? null, rawStopCode, collectorId: input.collectorId, signalStopKey: input.stopKey,
    });
    if (!own) throw e;
    return { success: true, data: await classifyClaimed(own, mapped?.reasonCode ?? null), message: STOP_CLAIM_MESSAGE };
  }
}

/** Kartın anahtarıyla SAHİPLENİLMİŞ canlı duruş (K1) — insanın `stopKey`i değişmediği için ayrı kolon. */
async function findClaimedStop(machineId: string, stopKey: string): Promise<MachineStopDto | null> {
  return prisma.machineStopEvent.findFirst({ where: { machineId, signalStopKey: stopKey, revokedAt: null }, select: MACHINE_STOP_SELECT });
}

/** Sahiplenmenin tekrarı: aynı kart + aynı ham kod aynı satır; başka yük 409 (parmak izi boğazı). */
function claimReplay(existing: MachineStopDto, input: OpenMachineStopInput, rawStopCode: string | null): ApiResponse<MachineStopDto> {
  assertReplayPayloadMatches(
    [
      { ad: "collectorId", mevcut: existing.collectorId, gelen: input.collectorId ?? null },
      { ad: "rawStopCode", mevcut: existing.rawStopCode, gelen: rawStopCode },
    ],
    "Bu duruş anahtarı başka bir sinyalle kullanılmış.", { stopId: existing.id },
  );
  return { success: true, data: existing, message: STOP_REPLAY_MESSAGE };
}

/**
 * Eşlenen sebep YALNIZ sebepsiz duruşa makine kararı olarak yazılır (ilk sınıflandırma yolu);
 * insanın sebebi varsa o kalır — kart kararı insan kararını ezmez.
 */
async function classifyClaimed(stop: MachineStopDto, reasonCode: string | null): Promise<MachineStopDto> {
  if (!reasonCode || stop.reasonCode !== null) return stop;
  try {
    return (await classifyStop(stop.id, { reasonCode }, undefined, MachineDataSource.MACHINE)).data!;
  } catch (e) {
    if (e instanceof AppError && e.details?.code === "STOP_ALREADY_CLASSIFIED") return stop;
    throw e;
  }
}

function openStopCoreFor(input: OpenMachineStopInput, started: StampResolution, rawStopCode: string | null, reasonCode: string | null): Promise<ApiResponse<MachineStopDto>> {
  return openStopCore({
    machineId: input.machineId, stopKey: input.stopKey, started, source: input.source, actorId: null,
    reasonCode,
    signal: { signalKind: input.signalKind ?? null, rawStopCode, collectorId: input.collectorId ?? null },
    // Aynı anahtar + başka kimlik yükü (kaynak · başlangıç · ham kod) bir çelişkidir, tekrar değil.
    fingerprint: (e) => [
      { ad: "machineId", mevcut: e.machineId, gelen: input.machineId },
      { ad: "source", mevcut: e.source, gelen: input.source },
      { ad: "startedAt", mevcut: e.startedAt.getTime(), gelen: started.value.getTime() },
      { ad: "rawStopCode", mevcut: e.rawStopCode, gelen: rawStopCode },
    ],
  });
}

/**
 * Kart duruşun bittiğini gördü — insanın "Çalıştı"sıyla AYNI claim. Önce kim kapattıysa o kalır:
 * aynı bitişin tekrarı replay, insanın kapanışı 409 `STOP_CLOSED_BY_OPERATOR` (ezilmez).
 */
export async function closeMachineStop(input: CloseMachineStopInput): Promise<ApiResponse<MachineStopDto>> {
  assertMachineSource(input.source);
  assertStopKey(input.stopKey);
  const ended = resolveStopStamp(input.endedAt, "duruş bitişi", input.source);
  // Kimlik (makine, anahtar): en çok bir canlı satır (`machine_stops_key_uq`); geri alınmışlar yalnız tanı için.
  const rows = await prisma.machineStopEvent.findMany({
    where: { machineId: input.machineId, OR: [{ stopKey: input.stopKey }, { signalStopKey: input.stopKey }] },
    select: { id: true, revokedAt: true, source: true, signalStopKey: true },
  });
  const live = rows.find((r) => r.revokedAt === null);
  if (!live) {
    if (rows.length > 0) throw AppError.conflict("Bu duruş geri alınmış — kapatılamaz.", { code: "STOP_REVOKED", stopId: rows[0]!.id });
    throw AppError.notFound("Bu anahtarla açılmış duruş yok.", { code: "STOP_NOT_FOUND", machineId: input.machineId });
  }
  // Sahiplenilmiş duruşun kaynağı insandır (açılış insanınki) — kaynak eşleşmesi yalnız kartın açtığında aranır.
  if (live.signalStopKey !== input.stopKey && live.source !== input.source) {
    throw AppError.conflict("Duruş başka bir kaynakla açılmış — kaynak tutmuyor.", { code: "CLIENT_TOKEN_COLLISION", stopId: live.id, farkliAlanlar: ["source"] });
  }
  return closeStopCore(live.id, ended, { endSource: MachineStopEndSource.SIGNAL, actorId: null });
}
