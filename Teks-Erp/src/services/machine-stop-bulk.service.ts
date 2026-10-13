// =============================================================================
// TeksERP — TEZGAH SALONU TOPLU DURUŞ · önizleme / aç / kapat ("Hepsi çalıştı") / sebep ata / geri al
// =============================================================================
// İKİNCİ YAZAR AÇMAZ: her satır mevcut tek yolu çağırır (`openManualStop` · `closeManualStop` ·
// `classifyStop` · `revokeStop`; alarm dürtmesi `nudgeLoomAlarm` onların içinde). Toplu koşum emsali: her satır KENDİ
// transaction'ında, satırlar SUNUCUDA tezgah kodu sırasıyla ve SIRAYLA (Promise.all yok), olmayan satır
// somut sebebiyle `failed`te döner; advisory kilit EKLENMEZ (tek açık duruş seddi DB'de). Önizleme yazmaz.
// Kapat/sebep ata/geri al kayıt yaratmaz (claim): aynı kullanıcının aynı bitiş/sebep/gerekçeyle yeniden gönderimi `ok` döner.
// Sebep ata yalnız AÇIK ve sebepsiz duruşu hedefler (ilk sınıflandırma); sebep→sebep düzeltmesi Tezgah Duruşları'nda kalır.
// =============================================================================
import { MachineDataSource } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { LOOM_MACHINE_WHERE } from "../constants/loom-shift";
import { SYSTEM_EVENT } from "../constants/system-events";
import { extractTransientSqlState } from "../middlewares/error.middleware";
import { STOP_REPLAY_MESSAGE, classifyStop, closeManualStop, openManualStop, revokeStop } from "./machine-stop.service";
import { assertStopShiftWritableTx, resolveShiftInstanceId, resolveStopPreset, resolveStopStamp, stopOverlapWhere } from "./helpers/machine-stop-context.helper";
import type { ApiResponse } from "../types/api.types";

/** Tek istekte en çok tezgah — salonun tamamı (elektrik kesintisi) tek seferde seçilebilsin. */
export const BULK_STOP_MAX = 300;

export type BulkStopAction = "OPEN" | "CLOSE" | "CLASSIFY" | "REVOKE";
export type BulkStopOutcome = BulkStopAction | "BLOCKED";

export interface BulkStopCurrent {
  id: string;
  startedAt: Date;
  reasonCode: string | null;
}

export interface BulkStopPreviewRow {
  machineId: string;
  machineCode: string;
  machineName: string;
  /** Tezgahın açık duruşu (kapat/geri al hedefi; açışta "zaten duruşta" sebebi). */
  current: BulkStopCurrent | null;
  outcome: BulkStopOutcome;
  defaultSelected: boolean;
  block: { code: string; message: string } | null;
}

export interface BulkStopPreviewDto {
  action: BulkStopAction;
  /** Açış/kapanış için değerlendirilen an (verilmediyse sunucu saati). */
  at: Date | null;
  rows: BulkStopPreviewRow[];
}

export interface BulkStopFailure {
  machineId: string;
  machineCode: string;
  code: string;
  message: string;
}

export interface BulkStopOk {
  machineId: string;
  machineCode: string;
  stopId: string;
  /** Aynı denemenin yeniden gönderimi — satır daha önce yazılmıştı, ikinci kez yazılmadı. */
  replayed: boolean;
  warnings: string[];
}

export interface BulkStopResultDto {
  requested: number;
  ok: BulkStopOk[];
  failed: BulkStopFailure[];
}

export interface BulkStopOpenInput {
  /** Zorunlu: istemci denemeye yapıştırır — yeniden gönderim aynı başlangıçla gelir (replay parmak izi). */
  startedAt: Date;
  reasonCode?: string | null;
  reasonNote?: string | null;
  rows: Array<{ machineId: string; clientToken: string }>;
}

export interface BulkStopCloseInput {
  /** Zorunlu: istemci denemeye yapıştırır — yeniden gönderim aynı bitişle `ok` (replay) döner. */
  endedAt: Date;
  rows: Array<{ stopId: string }>;
}

export interface BulkStopClassifyInput {
  reasonCode: string;
  reasonNote?: string | null;
  rows: Array<{ stopId: string }>;
}

export interface BulkStopRevokeInput {
  reason: string;
  rows: Array<{ stopId: string }>;
}

interface LoomInfo {
  id: string;
  code: string;
  name: string;
  isLoom: boolean;
}

const byCode = (a: { machineCode: string }, b: { machineCode: string }): number => a.machineCode.localeCompare(b.machineCode, "tr");

async function loadLooms(ids: readonly string[]): Promise<Map<string, LoomInfo>> {
  const uniq = [...new Set(ids)];
  const rows = await prisma.machine.findMany({ where: { id: { in: uniq } }, select: { id: true, code: true, name: true } });
  const looms = new Set((await prisma.machine.findMany({ where: { id: { in: uniq }, ...LOOM_MACHINE_WHERE }, select: { id: true } })).map((r) => r.id));
  return new Map(rows.map((r) => [r.id, { ...r, isLoom: looms.has(r.id) }]));
}

const notLoom = (loom: LoomInfo | undefined): { code: string; message: string } | null => {
  if (!loom) return { code: "MACHINE_NOT_LOOM", message: "Tezgah bulunamadı." };
  if (!loom.isLoom) return { code: "MACHINE_NOT_LOOM", message: `${loom.code} pasif ya da dokuma holünde değil — duruş girilemez.` };
  return null;
};

/** Mühür/iptal vardiya kapısı (tek yer: `assertStopShiftWritableTx`) — önizlemede satır engeline çevrilir. */
async function shiftBlock(ref: { shiftInstanceId: string | null; machineId: string }): Promise<{ code: string; message: string } | null> {
  try {
    await assertStopShiftWritableTx(prisma, ref);
    return null;
  } catch (e) {
    if (e instanceof AppError) return { code: String((e.details as { code?: unknown } | undefined)?.code ?? `HTTP_${e.statusCode}`), message: e.message };
    throw e;
  }
}

/** Önizleme — YAZMAZ. Her tezgah kodu + adıyla; uygun satır varsayılan seçili, engelli satır sebebiyle. */
export async function previewBulkStops(input: { action: BulkStopAction; machineIds: string[]; at?: Date | null }): Promise<ApiResponse<BulkStopPreviewDto>> {
  const at = input.action === "REVOKE" || input.action === "CLASSIFY" ? null : resolveStopStamp(input.at, input.action === "OPEN" ? "duruş başlangıcı" : "duruş bitişi", MachineDataSource.SUPERVISOR).value;
  const looms = await loadLooms(input.machineIds);
  const openStops = await prisma.machineStopEvent.findMany({
    where: { machineId: { in: [...looms.keys()] }, endedAt: null, revokedAt: null },
    select: { id: true, machineId: true, startedAt: true, reasonCode: true, shiftInstanceId: true },
  });
  const openBy = new Map(openStops.map((s) => [s.machineId, s]));
  const openShift = input.action === "OPEN" && at ? await resolveShiftInstanceId(prisma, at) : null;
  const rows: BulkStopPreviewRow[] = [];
  for (const id of new Set(input.machineIds)) {
    const loom = looms.get(id);
    const base = { machineId: id, machineCode: loom?.code ?? "?", machineName: loom?.name ?? "Bilinmeyen tezgah" };
    const stop = loom?.isLoom ? (openBy.get(id) ?? null) : null;
    const current = stop ? { id: stop.id, startedAt: stop.startedAt, reasonCode: stop.reasonCode } : null;
    const block = notLoom(loom) ?? (await actionBlock(input.action, id, stop, { at, openShift }));
    rows.push(block ? { ...base, current, outcome: "BLOCKED", defaultSelected: false, block } : { ...base, current, outcome: input.action, defaultSelected: true, block: null });
  }
  rows.sort(byCode);
  return { success: true, data: { action: input.action, at, rows } };
}

async function actionBlock(
  action: BulkStopAction,
  machineId: string,
  stop: { id: string; startedAt: Date; shiftInstanceId: string | null; reasonCode: string | null } | null,
  when: { at: Date | null; openShift: string | null },
): Promise<{ code: string; message: string } | null> {
  const { at, openShift } = when;
  if (action === "OPEN") {
    if (stop) return { code: "STOP_ALREADY_OPEN", message: "Tezgah zaten duruşta — önce açık duruşu kapatın." };
    const overlap = await prisma.machineStopEvent.findFirst({ where: stopOverlapWhere(machineId, at!), select: { id: true } });
    if (overlap) return { code: "STOP_OVERLAP", message: "Seçilen başlangıç bu tezgahın kayıtlı bir duruşuyla çakışıyor — daha geç bir saat seçin." };
    return shiftBlock({ shiftInstanceId: openShift, machineId });
  }
  if (!stop) return { code: "STOP_NOT_OPEN", message: "Tezgahta açık duruş yok." };
  if (action === "CLASSIFY" && stop.reasonCode !== null) {
    return { code: "STOP_ALREADY_CLASSIFIED", message: "Açık duruşun sebebi zaten girilmiş — değiştirmek için Tezgah Duruşları ekranını kullanın." };
  }
  if (action === "CLOSE" && at && stop.startedAt > at) return { code: "STOP_END_BEFORE_START", message: "Bitiş zamanı duruşun başlangıcından önce." };
  return shiftBlock({ shiftInstanceId: stop.shiftInstanceId, machineId });
}

/** Satır hatası → somut sebep; iş kuralı dışı hata (DB düştü, bug) YUTULMAZ — tüm çağrı düşer. */
function rowFailure(e: unknown, row: { machineId: string; machineCode: string }): BulkStopFailure {
  if (e instanceof AppError) {
    const code = String((e.details as { code?: unknown } | undefined)?.code ?? "") || `HTTP_${e.statusCode}`;
    return { ...row, code, message: e.message };
  }
  if (extractTransientSqlState(e)) {
    return { ...row, code: "TRANSIENT_CONFLICT", message: `${row.machineCode}: eşzamanlı başka bir işlemle çakıştı — tekrar deneyin.` };
  }
  throw e;
}

const codeOf = (e: unknown): string | null => (e instanceof AppError ? String((e.details as { code?: unknown } | undefined)?.code ?? "") : null);

async function auditBulk(kind: BulkStopAction, userId: string | undefined, r: BulkStopResultDto, extra: Record<string, unknown>): Promise<void> {
  await AuditService.logEvent({
    category: "SYSTEM",
    action: SYSTEM_EVENT.MACHINE_STOP_BULK,
    userId: userId ?? null,
    tableName: "MACHINE_STOP_EVENT",
    payload: { kind, requested: r.requested, ok: r.ok.length, failed: r.failed.length, stopIds: r.ok.map((o) => o.stopId), failedCodes: r.failed.map((f) => f.code), ...extra },
  }).catch(() => undefined);
}

function summary(verb: string, r: BulkStopResultDto): string {
  return r.failed.length === 0 ? `${r.ok.length} tezgahta ${verb}` : `${r.ok.length} tezgahta ${verb}, ${r.failed.length} tezgahta olmadı`;
}

/** Toplu duruş aç — sebep bir kez, her satıra aynı; geçmiş saatte kapanmış duruşla örtüşen satır STOP_OVERLAP ile düşer. */
export async function openBulkStops(input: BulkStopOpenInput, userId?: string): Promise<ApiResponse<BulkStopResultDto>> {
  // Sebep istek düzeyinde doğrulanır: geçersiz kod her satırda aynı 400'ü üretmesin.
  if (input.reasonCode) await resolveStopPreset(prisma, input.reasonCode);
  const looms = await loadLooms(input.rows.map((r) => r.machineId));
  const rows = input.rows.map((r) => ({ ...r, machineCode: looms.get(r.machineId)?.code ?? "?" })).sort(byCode);
  const ok: BulkStopOk[] = [];
  const failed: BulkStopFailure[] = [];
  for (const r of rows) {
    const ident = { machineId: r.machineId, machineCode: r.machineCode };
    const block = notLoom(looms.get(r.machineId));
    if (block) {
      failed.push({ ...ident, ...block });
      continue;
    }
    try {
      const res = await openManualStop(
        { machineId: r.machineId, startedAt: input.startedAt, reasonCode: input.reasonCode ?? null, reasonNote: input.reasonNote ?? null, clientToken: r.clientToken, source: MachineDataSource.SUPERVISOR },
        userId,
        { rejectOverlap: true },
      );
      ok.push({ ...ident, stopId: res.data!.id, replayed: res.message === STOP_REPLAY_MESSAGE, warnings: res.warnings ?? [] });
    } catch (e) {
      failed.push(rowFailure(e, ident));
    }
  }
  const result = { requested: input.rows.length, ok, failed };
  await auditBulk("OPEN", userId, result, { reasonCode: input.reasonCode ?? null, startedAt: input.startedAt });
  return { success: true, data: result, message: summary("duruş açıldı", result) };
}

async function stopRows<T extends { stopId: string }>(rows: readonly T[]) {
  const stops = await prisma.machineStopEvent.findMany({
    where: { id: { in: rows.map((r) => r.stopId) } },
    select: { id: true, machineId: true, machine: { select: { code: true } } },
  });
  const byId = new Map(stops.map((s) => [s.id, s]));
  const out = rows
    .map((r) => {
      const s = byId.get(r.stopId);
      return { ...r, found: !!s, machineId: s?.machineId ?? "", machineCode: s?.machine.code ?? "?" };
    })
    .sort(byCode);
  return out;
}

/** "Hepsi çalıştı" — seçili açık duruşları aynı bitişle kapatır. */
export async function closeBulkStops(input: BulkStopCloseInput, userId?: string): Promise<ApiResponse<BulkStopResultDto>> {
  const ok: BulkStopOk[] = [];
  const failed: BulkStopFailure[] = [];
  for (const r of await stopRows(input.rows)) {
    const ident = { machineId: r.machineId, machineCode: r.machineCode };
    if (!r.found) {
      failed.push({ ...ident, code: "STOP_NOT_FOUND", message: "Duruş bulunamadı." });
      continue;
    }
    try {
      const res = await closeManualStop(r.stopId, input.endedAt, userId, MachineDataSource.SUPERVISOR);
      ok.push({ ...ident, stopId: r.stopId, replayed: false, warnings: res.warnings ?? [] });
    } catch (e) {
      if (codeOf(e) === "STOP_ALREADY_CLOSED") {
        const cur = await prisma.machineStopEvent.findUnique({ where: { id: r.stopId }, select: { endedAt: true, closedById: true } });
        if (cur?.closedById === (userId ?? null) && cur.endedAt?.getTime() === input.endedAt.getTime()) {
          ok.push({ ...ident, stopId: r.stopId, replayed: true, warnings: [] });
          continue;
        }
      }
      failed.push(rowFailure(e, ident));
    }
  }
  const result = { requested: input.rows.length, ok, failed };
  await auditBulk("CLOSE", userId, result, { endedAt: input.endedAt });
  return { success: true, data: result, message: summary("duruş kapandı", result) };
}

/** Sebep ata — sebep bir kez, her satıra aynı; yalnız sebepsiz duruşun İLK sınıflandırması (`classifyStop` claim'i). */
export async function classifyBulkStops(input: BulkStopClassifyInput, userId?: string): Promise<ApiResponse<BulkStopResultDto>> {
  // Sebep istek düzeyinde doğrulanır: geçersiz kod her satırda aynı 400'ü üretmesin.
  const preset = await resolveStopPreset(prisma, input.reasonCode);
  const ok: BulkStopOk[] = [];
  const failed: BulkStopFailure[] = [];
  for (const r of await stopRows(input.rows)) {
    const ident = { machineId: r.machineId, machineCode: r.machineCode };
    if (!r.found) {
      failed.push({ ...ident, code: "STOP_NOT_FOUND", message: "Duruş bulunamadı." });
      continue;
    }
    try {
      await classifyStop(r.stopId, { reasonCode: preset.code, reasonNote: input.reasonNote ?? null }, userId, MachineDataSource.SUPERVISOR);
      ok.push({ ...ident, stopId: r.stopId, replayed: false, warnings: [] });
    } catch (e) {
      if (codeOf(e) === "STOP_ALREADY_CLASSIFIED") {
        const cur = await prisma.machineStopEvent.findUnique({ where: { id: r.stopId }, select: { reasonCode: true, classifiedById: true } });
        if (cur?.classifiedById === (userId ?? null) && cur.reasonCode === preset.code) {
          ok.push({ ...ident, stopId: r.stopId, replayed: true, warnings: [] });
          continue;
        }
      }
      failed.push(rowFailure(e, ident));
    }
  }
  const result = { requested: input.rows.length, ok, failed };
  await auditBulk("CLASSIFY", userId, result, { reasonCode: preset.code });
  return { success: true, data: result, message: summary("sebep girildi", result) };
}

/** Toplu geri al — gerekçe bir kez, her satıra aynı; satır silinmez, damgalanır. */
export async function revokeBulkStops(input: BulkStopRevokeInput, userId?: string): Promise<ApiResponse<BulkStopResultDto>> {
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 3) throw AppError.badRequest("Geri alma gerekçesi en az 3 karakter olmalı.", { code: "REVOKE_REASON_REQUIRED" });
  const ok: BulkStopOk[] = [];
  const failed: BulkStopFailure[] = [];
  for (const r of await stopRows(input.rows)) {
    const ident = { machineId: r.machineId, machineCode: r.machineCode };
    if (!r.found) {
      failed.push({ ...ident, code: "STOP_NOT_FOUND", message: "Duruş bulunamadı." });
      continue;
    }
    try {
      await revokeStop(r.stopId, reason, userId);
      ok.push({ ...ident, stopId: r.stopId, replayed: false, warnings: [] });
    } catch (e) {
      if (codeOf(e) === "STOP_ALREADY_REVOKED") {
        const cur = await prisma.machineStopEvent.findUnique({ where: { id: r.stopId }, select: { revokedById: true, revokeReason: true } });
        if (cur?.revokedById === (userId ?? null) && cur.revokeReason === reason.slice(0, 300)) {
          ok.push({ ...ident, stopId: r.stopId, replayed: true, warnings: [] });
          continue;
        }
      }
      failed.push(rowFailure(e, ident));
    }
  }
  const result = { requested: input.rows.length, ok, failed };
  await auditBulk("REVOKE", userId, result, {});
  return { success: true, data: result, message: summary("duruş geri alındı", result) };
}
