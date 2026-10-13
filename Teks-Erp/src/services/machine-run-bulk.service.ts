// =============================================================================
// TeksERP — TEZGAH SALONU TOPLU KOŞUM · önizleme / iş ver (başlat · değiştir) / bitir
// =============================================================================
// İKİNCİ YAZAR AÇMAZ: her satır mevcut tek yolu çağırır (`openMachineRun` — Değiştir dahil,
// `closeMachineRunTx` — kapanış tek yazarı). Kurşun `assign-bulk` emsali: her satır KENDİ
// transaction'ında, sonuç parçalı olabilir, olmayan satır somut sebebiyle `failed`te döner.
// Satırlar SUNUCUDA tezgah kodu + hat sırasıyla, SIRAYLA işlenir (Promise.all yok); advisory
// kilit EKLENMEZ (koşum seddi yeter — dokuma.md). Önizleme yazmaz; yıkıcı satır (Değiştir,
// aynı iş) varsayılan seçili DEĞİLDİR — kullanıcı tek tek işaretler.
// =============================================================================
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { LOOM_MACHINE_WHERE } from "../constants/loom-shift";
import { SYSTEM_EVENT } from "../constants/system-events";
import { extractTransientSqlState } from "../middlewares/error.middleware";
import { closeMachineRun, openMachineRun } from "./machine-run.service";
import { OPEN_MACHINE_RUN_WHERE } from "./helpers/machine-run-open.helper";
import { listOpenInHouseWeavingOrders, type MachineRunTabletContextDto } from "./helpers/machine-run-suggest.helper";
import { mountedBeamsOnMachineTx, runOpenBeamWarning } from "./helpers/warp-beam-mount.helper";
import { assertRunWeavingOrderGate, assertWeavingOrderLinkableTx, warpSpecMismatchWarning, type LinkableWeavingOrder } from "./helpers/production-chain-gates.helper";
import { resolveRunWeavingOrderRequired } from "./system-setting.service";
import { checkRowJobs, rowJobIdOf, usesRequestJob, type RowJobCheck, type RowJobInput } from "./helpers/machine-run-bulk-jobs.helper";
import type { ApiResponse } from "../types/api.types";

/** Tek istekte en çok satır (kurşun emsali). */
export const BULK_RUN_MAX = 100;

export type BulkRunAction = "ASSIGN" | "FINISH";
export type BulkRunOutcome = "START" | "REPLACE" | "SAME_JOB" | "FINISH" | "BLOCKED";

export interface BulkRunTarget {
  machineId: string;
  productionLineNo: number;
}

/** İş ver hedefi — satır başına iş (C.6) opsiyonel; tanımsızsa istek düzeyindeki iş. */
export interface BulkRunJobTarget extends BulkRunTarget, RowJobInput {}

export interface BulkRunCurrent {
  id: string;
  weavingOrderId: string | null;
  weavingOrderNumber: string | null;
  startedAt: Date;
}

export interface BulkRunPreviewRow {
  machineId: string;
  machineCode: string;
  machineName: string;
  productionLineNo: number;
  productionLineCount: number;
  current: BulkRunCurrent | null;
  /** Bu satıra verilecek iş (İş ver; satır başına farklı olabilir). Bitirde ve işsiz koşumda null. */
  weavingOrder: { id: string; weavingOrderNumber: string } | null;
  outcome: BulkRunOutcome;
  /** Arayüzün satırı ilk açılışta işaretleyip işaretlemeyeceği; yıkıcı satır (Değiştir) işaretsiz gelir. */
  defaultSelected: boolean;
  warnings: string[];
  block: { code: string; message: string } | null;
}

export interface BulkRunPreviewDto {
  action: BulkRunAction;
  weavingOrder: { id: string; weavingOrderNumber: string } | null;
  rows: BulkRunPreviewRow[];
}

export interface BulkRunContextDto {
  weavingOrders: MachineRunTabletContextDto["weavingOrders"];
  /** Açıkken işsiz (numune) koşum açılamaz — pencere o seçeneği çizmez. */
  weavingOrderRequired: boolean;
  /** Sunucu satır başına işi tanır (C.6) — 2.15.6 sunucusunda alan yok, panel tezgah başına seçiciyi çizmez. */
  rowJobs: true;
}

export interface BulkAssignRow extends BulkRunJobTarget {
  clientToken: string;
  /** Dolu hatta açık koşumun id'si — verilirse "Değiştir": eski koşum aynı tx'te kapanır. */
  replaceRunId?: string | null;
}

export interface BulkAssignInput {
  weavingOrderId?: string | null;
  targetUnitsPerMin?: number | null;
  rows: BulkAssignRow[];
}

export interface BulkFinishInput {
  rows: Array<{ runId: string; picksAtClose?: number | null }>;
}

export interface BulkRowFailure {
  machineId: string;
  machineCode: string;
  productionLineNo: number;
  code: string;
  message: string;
}

export interface BulkAssignOk {
  machineId: string;
  machineCode: string;
  productionLineNo: number;
  runId: string;
  replacedRunId: string | null;
  warnings: string[];
}

export interface BulkFinishOk {
  machineId: string;
  machineCode: string;
  productionLineNo: number;
  runId: string;
}

export interface BulkResultDto<T> {
  requested: number;
  ok: T[];
  failed: BulkRowFailure[];
}

interface LoomInfo {
  id: string;
  code: string;
  name: string;
  productionLineCount: number;
  /** `LOOM_MACHINE_WHERE`e uyuyor mu (aktif + dokuma holü) — uymayan satır adıyla reddedilir. */
  isLoom: boolean;
}

const byCodeThenLine = (a: { machineCode: string; productionLineNo: number }, b: { machineCode: string; productionLineNo: number }): number =>
  a.machineCode.localeCompare(b.machineCode, "tr") || a.productionLineNo - b.productionLineNo;

async function loadLooms(ids: readonly string[]): Promise<Map<string, LoomInfo>> {
  const uniq = [...new Set(ids)];
  const rows = await prisma.machine.findMany({ where: { id: { in: uniq } }, select: { id: true, code: true, name: true, productionLineCount: true } });
  const looms = new Set((await prisma.machine.findMany({ where: { id: { in: uniq }, ...LOOM_MACHINE_WHERE }, select: { id: true } })).map((r) => r.id));
  return new Map(rows.map((r) => [r.id, { ...r, isLoom: looms.has(r.id) }]));
}

/** Hattın açık koşumu (sed gereği en çok bir) — işin numarasıyla. */
async function openRunsOf(machineIds: readonly string[]): Promise<Map<string, BulkRunCurrent>> {
  const runs = await prisma.machineRun.findMany({
    where: { machineId: { in: [...new Set(machineIds)] }, ...OPEN_MACHINE_RUN_WHERE },
    select: { id: true, machineId: true, productionLineNo: true, weavingOrderId: true, startedAt: true, weavingOrder: { select: { weavingOrderNumber: true } } },
  });
  return new Map(
    runs.map((r) => [
      `${r.machineId}:${r.productionLineNo}`,
      { id: r.id, weavingOrderId: r.weavingOrderId, weavingOrderNumber: r.weavingOrder?.weavingOrderNumber ?? null, startedAt: r.startedAt },
    ]),
  );
}

const UNKNOWN_LOOM = (id: string): LoomInfo => ({ id, code: "?", name: "Bilinmeyen tezgah", productionLineCount: 0, isLoom: false });

/** Tezgah/hat düzeyinde engel — iki uç (önizleme · uygulama) aynı yüklemi okur. */
function targetBlock(loom: LoomInfo | undefined, line: number): { code: string; message: string } | null {
  if (!loom) return { code: "MACHINE_NOT_LOOM", message: "Tezgah bulunamadı." };
  if (!loom.isLoom) return { code: "MACHINE_NOT_LOOM", message: `${loom.code} pasif ya da dokuma holünde değil — koşum açılamaz.` };
  if (!Number.isInteger(line) || line < 1 || line > loom.productionLineCount) {
    return { code: "PRODUCTION_LINE_OUT_OF_RANGE", message: `${loom.code} tezgahının ${loom.productionLineCount} hattı var — ${line}. hat yok.` };
  }
  return null;
}

async function assignWarnings(machineId: string, order: LinkableWeavingOrder | null): Promise<string[]> {
  const out: string[] = [];
  const beam = await runOpenBeamWarning(prisma, machineId);
  if (beam) out.push(beam);
  if (order) {
    for (const b of await mountedBeamsOnMachineTx(prisma, machineId)) {
      const w = warpSpecMismatchWarning(b, order);
      if (w && !out.includes(w)) out.push(w);
    }
  }
  const stop = await prisma.machineStopEvent.findFirst({ where: { machineId, endedAt: null, revokedAt: null }, select: { id: true } });
  if (stop) out.push("Tezgah duruşta — koşum açılır, duruş açık kalır.");
  return out;
}

export async function bulkRunContext(): Promise<ApiResponse<BulkRunContextDto>> {
  return {
    success: true,
    data: { weavingOrders: await listOpenInHouseWeavingOrders(prisma), weavingOrderRequired: await resolveRunWeavingOrderRequired(), rowJobs: true },
  };
}

/** Önizleme — YAZMAZ. Her hedef satırı tezgah adıyla; İSTEK düzeyindeki iş engeli (fason/kapalı iş, iş zorunlu) tüm isteği 400 yapar, SATIR işinin engeli yalnız o satırı BLOCKED yapar. */
export async function previewBulkRuns(input: { action: BulkRunAction; weavingOrderId?: string | null; targets: BulkRunJobTarget[] }): Promise<ApiResponse<BulkRunPreviewDto>> {
  let order: LinkableWeavingOrder | null = null;
  const assign = input.action === "ASSIGN";
  if (assign && usesRequestJob(input.targets)) {
    await assertRunWeavingOrderGate(prisma, input.weavingOrderId ?? null);
    if (input.weavingOrderId) order = await assertWeavingOrderLinkableTx(prisma, input.weavingOrderId);
  }
  const rowJobs = assign ? await checkRowJobs(input.targets.filter((t) => t.weavingOrderId !== undefined).map((t) => rowJobIdOf(t, null))) : new Map<string | null, RowJobCheck>();
  const looms = await loadLooms(input.targets.map((t) => t.machineId));
  const open = await openRunsOf(input.targets.map((t) => t.machineId));
  const rows: BulkRunPreviewRow[] = [];
  const seen = new Set<string>();
  for (const t of input.targets) {
    const key = `${t.machineId}:${t.productionLineNo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const loom = looms.get(t.machineId);
    const info = loom ?? UNKNOWN_LOOM(t.machineId);
    const ident = { machineId: t.machineId, machineCode: info.code, machineName: info.name, productionLineNo: t.productionLineNo, productionLineCount: info.productionLineCount };
    const job: RowJobCheck = !assign ? { order: null, block: null } : t.weavingOrderId === undefined ? { order, block: null } : rowJobs.get(rowJobIdOf(t, null))!;
    const base = { ...ident, weavingOrder: job.order ? { id: job.order.id, weavingOrderNumber: job.order.weavingOrderNumber } : null };
    const block = targetBlock(loom, t.productionLineNo) ?? job.block;
    const current = block ? null : (open.get(key) ?? null);
    if (block) {
      rows.push({ ...base, current: null, outcome: "BLOCKED", defaultSelected: false, warnings: [], block });
    } else if (input.action === "FINISH") {
      rows.push(
        current
          ? { ...base, current, outcome: "FINISH", defaultSelected: true, warnings: [], block: null }
          : { ...base, current: null, outcome: "BLOCKED", defaultSelected: false, warnings: [], block: { code: "RUN_NOT_OPEN", message: "Bu hatta açık koşum yok." } },
      );
    } else {
      const warnings = await assignWarnings(t.machineId, job.order);
      const sameJob = current !== null && (current.weavingOrderId ?? null) === (job.order?.id ?? null);
      const outcome: BulkRunOutcome = current === null ? "START" : sameJob ? "SAME_JOB" : "REPLACE";
      rows.push({ ...base, current, outcome, defaultSelected: outcome === "START", warnings, block: null });
    }
  }
  rows.sort(byCodeThenLine);
  return {
    success: true,
    data: { action: input.action, weavingOrder: order ? { id: order.id, weavingOrderNumber: order.weavingOrderNumber } : null, rows },
  };
}

/** Satır hatası → somut sebep; iş kuralı dışı hata (DB düştü, bug) YUTULMAZ — tüm çağrı düşer. */
function rowFailure(e: unknown, row: { machineId: string; machineCode: string; productionLineNo: number }): BulkRowFailure {
  if (e instanceof AppError) {
    const code = String((e.details as { code?: unknown } | undefined)?.code ?? "") || `HTTP_${e.statusCode}`;
    return { ...row, code, message: e.message };
  }
  if (extractTransientSqlState(e)) {
    return { ...row, code: "TRANSIENT_CONFLICT", message: `${row.machineCode}: eşzamanlı başka bir işlemle çakıştı — tekrar deneyin.` };
  }
  throw e;
}

async function auditBulk(kind: "ASSIGN" | "FINISH", userId: string | undefined, r: BulkResultDto<{ runId: string }>, extra: Record<string, unknown>): Promise<void> {
  await AuditService.logEvent({
    category: "SYSTEM",
    action: SYSTEM_EVENT.MACHINE_RUN_BULK,
    userId: userId ?? null,
    tableName: "MACHINE_RUN",
    payload: { kind, requested: r.requested, ok: r.ok.length, failed: r.failed.length, runIds: r.ok.map((o) => o.runId), failedCodes: r.failed.map((f) => f.code), ...extra },
  }).catch(() => undefined);
}

function summary(verb: string, r: BulkResultDto<unknown>): string {
  return r.failed.length === 0 ? `${r.ok.length} tezgahta ${verb}` : `${r.ok.length} tezgahta ${verb}, ${r.failed.length} tezgahta olmadı`;
}

/** İş ver (başlat + değiştir). Dolu hatta `replaceRunId` yoksa satır PRODUCTION_LINE_OCCUPIED ile düşer — sessiz üzerine yazma yok. */
export async function assignBulkRuns(input: BulkAssignInput, userId?: string): Promise<ApiResponse<BulkResultDto<BulkAssignOk>>> {
  const looms = await loadLooms(input.rows.map((r) => r.machineId));
  const rows = input.rows
    .map((r) => ({ ...r, machineCode: looms.get(r.machineId)?.code ?? "?" }))
    .sort(byCodeThenLine);
  const ok: BulkAssignOk[] = [];
  const failed: BulkRowFailure[] = [];
  for (const r of rows) {
    const ident = { machineId: r.machineId, machineCode: r.machineCode, productionLineNo: r.productionLineNo };
    const block = targetBlock(looms.get(r.machineId), r.productionLineNo);
    if (block) {
      failed.push({ ...ident, ...block });
      continue;
    }
    try {
      const res = await openMachineRun(
        { machineId: r.machineId, productionLineNo: r.productionLineNo, weavingOrderId: rowJobIdOf(r, input.weavingOrderId), targetUnitsPerMin: input.targetUnitsPerMin ?? null, clientToken: r.clientToken },
        userId,
        { replaceRunId: r.replaceRunId ?? null },
      );
      ok.push({ ...ident, runId: res.data.id, replacedRunId: r.replaceRunId ?? null, warnings: res.warnings ?? [] });
    } catch (e) {
      failed.push(rowFailure(e, ident));
    }
  }
  const result = { requested: input.rows.length, ok, failed };
  await auditBulk("ASSIGN", userId, result, { weavingOrderId: input.weavingOrderId ?? null, rowJobs: input.rows.filter((r) => r.weavingOrderId !== undefined).length, replaced: ok.filter((o) => o.replacedRunId).length });
  return { success: true, data: result, message: summary("iş başladı", result) };
}

/** İşi bitir — koşumu kapatır (atkı sayacı boş = ölçülmedi); Dokuma İş Emrini KAPATMAZ. */
export async function finishBulkRuns(input: BulkFinishInput, userId?: string): Promise<ApiResponse<BulkResultDto<BulkFinishOk>>> {
  const runs = await prisma.machineRun.findMany({
    where: { id: { in: input.rows.map((r) => r.runId) } },
    select: { id: true, machineId: true, productionLineNo: true, machine: { select: { code: true } } },
  });
  const byId = new Map(runs.map((r) => [r.id, r]));
  const rows = input.rows
    .map((r) => {
      const run = byId.get(r.runId);
      return { ...r, machineId: run?.machineId ?? "", machineCode: run?.machine.code ?? "?", productionLineNo: run?.productionLineNo ?? 0 };
    })
    .sort(byCodeThenLine);
  const ok: BulkFinishOk[] = [];
  const failed: BulkRowFailure[] = [];
  for (const r of rows) {
    const ident = { machineId: r.machineId, machineCode: r.machineCode, productionLineNo: r.productionLineNo };
    if (!byId.has(r.runId)) {
      failed.push({ ...ident, code: "RUN_NOT_FOUND", message: "Koşum bulunamadı." });
      continue;
    }
    try {
      await closeMachineRun(r.runId, { picksAtClose: r.picksAtClose ?? null }, userId);
      ok.push({ ...ident, runId: r.runId });
    } catch (e) {
      failed.push(rowFailure(e, ident));
    }
  }
  const result = { requested: input.rows.length, ok, failed };
  await auditBulk("FINISH", userId, result, {});
  return { success: true, data: result, message: summary("iş bitti", result) };
}
