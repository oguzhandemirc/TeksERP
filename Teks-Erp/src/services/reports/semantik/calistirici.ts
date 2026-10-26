// =============================================================================
// SEMANTİK KATMAN — ÇALIŞTIRICI (R1-SEMCEK; plan §3.4)
// =============================================================================
// Ağır rapor sorgusu tek process'i kilitleyemez: her blok kendi KISA okuma tx'inde SIRAYLA koşar
// (READ ONLY · statement_timeout = `reports.statementTimeoutSec` · lock_timeout 2 sn), koşu
// `ReportRun` satırına `backendPid` ile yazılır ki iptal (`pg_cancel_backend`) mümkün olsun.
// 57014 → 503 `RAPOR_ZAMAN_ASIMI` · 40P01/40001 → 409 · semafor dolu → 429 `RAPOR_SIRADA`.
// `ReportRun` TELEMETRİdir (audit muaf, `audit-muafiyeti.ts`); durum geçişi atomik claim.
// =============================================================================
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "../../../lib/prisma";
import { AppError } from "../../../utils/app-error";
import { extractTransientSqlState } from "../../../middlewares/error.middleware";
import { readReportsStatementTimeoutSec } from "../../system-setting.service";
import { REPORT_MAX_ROWS, resolveCompareRange, type DateRange } from "../_shared";
import { shapeHelper, shapeSqlRows, type RawRow, type SemanticResult, type SemanticRow, type SemanticTotals } from "./sonuc";
import { andOnlyLeaves, buildSql, compileQuery, type SemanticQueryInput } from "./derleyici";
import { accessDigest, type AccessContext } from "./izin";
import { matchesPermission } from "../../../middlewares/rbac.middleware";
import { REPORT_PUBLISH_PERMISSION } from "../../../constants/permission-catalog";
import { SEMANTIC_CUBES, measureDictionaryEntry } from "./katalog";
import { ResultCache, digest, stableStringify } from "./onbellek";
import { reportSemaphore, type ReportSemaphore } from "./semafor";
import type { CompiledQuery, SemanticCube } from "./tipler";

export const LOCK_TIMEOUT = "2s";

export interface RunDeps {
  cubes: readonly SemanticCube[];
  semaphore: ReportSemaphore;
  cache: ResultCache<SemanticResult>;
  readTimeoutSec: () => Promise<number>;
}

export type { SemanticResult } from "./sonuc";

export const semanticResultCache = new ResultCache<SemanticResult>();

export const defaultDeps: RunDeps = {
  cubes: SEMANTIC_CUBES,
  semaphore: reportSemaphore,
  cache: semanticResultCache,
  readTimeoutSec: () => readReportsStatementTimeoutSec(),
};

/** Süren koşular (tek process): iptal ucu ve bağlantı kopması buradan pid bulur. */
interface ActiveRun { userId: string; pid: number | null; cancelled: boolean }
const activeRuns = new Map<string, ActiveRun>();

class RunCancelled extends Error {}

/** SQLSTATE'i iki kılıktan çıkarır (çıplak sürücü hatası · P2010 sarımı); yalnız beklenen kodlar. */
export function extractSqlState(err: unknown, codes: readonly string[]): string | null {
  if (!err || typeof err !== "object") return null;
  const e = err as Record<string, unknown>;
  const causes: Record<string, unknown>[] = [];
  if (e.cause && typeof e.cause === "object") causes.push(e.cause as Record<string, unknown>);
  const meta = e.meta as Record<string, unknown> | undefined;
  const dae = meta?.driverAdapterError as Record<string, unknown> | undefined;
  if (dae?.cause && typeof dae.cause === "object") causes.push(dae.cause as Record<string, unknown>);
  for (const c of causes) {
    for (const f of [c.code, c.originalCode]) if (typeof f === "string" && codes.includes(f)) return f;
  }
  if (typeof e.message === "string") {
    const m = /Code:\s*`?([0-9A-Z]{5})`?/.exec(e.message);
    if (m && codes.includes(m[1]!)) return m[1]!;
  }
  return null;
}

interface RunOutcome { status: "TAMAM" | "ZAMAN_ASIMI" | "HATA"; rowCount?: number; errorCode?: string }

async function finishRun(runId: string, startedAt: number, o: RunOutcome): Promise<number> {
  const r = await prisma.reportRun.updateMany({
    where: { id: runId, status: "CALISIYOR" },
    data: { status: o.status, durationMs: Date.now() - startedAt, rowCount: o.rowCount ?? null, errorCode: o.errorCode ?? null },
  });
  return r.count;
}

/** Tek blok: kısa okuma tx'i, pid kaydı, sorgu. `tx.*` sırayla — paralel tx çağrısı yok. */
async function runBlock<T>(runId: string, sql: Prisma.Sql, timeoutSec: number): Promise<T[]> {
  const active = activeRuns.get(runId);
  const sec = Math.trunc(timeoutSec);
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      // SET bind parametresi almaz; değer okuyucuda 5..45 tam sayıya sıkıştırıldı.
      await tx.$executeRaw(Prisma.raw(`SET LOCAL statement_timeout = '${sec}s'`));
      await tx.$executeRaw(Prisma.raw(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`));
      const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      if (active) active.pid = pid;
      await prisma.reportRun.updateMany({ where: { id: runId, status: "CALISIYOR" }, data: { backendPid: pid } });
      if (active?.cancelled) throw new RunCancelled();
      const rows = await tx.$queryRaw<T[]>(sql);
      if (active) active.pid = null;
      return rows;
    },
    { timeout: (sec + 5) * 1000, maxWait: 5_000 },
  );
}

/** İstenen küp fabrika ayarına bağlıysa (vardiya, kalite rolü) çözülmüş kopyasıyla değiştirilir. */
export async function prepareCubes(cubes: readonly SemanticCube[], cubeId: string): Promise<readonly SemanticCube[]> {
  const target = cubes.find((c) => c.id === cubeId);
  if (!target?.prepare) return cubes;
  const ready = await target.prepare();
  return cubes.map((c) => (c === target ? ready : c));
}

const iso = (r: DateRange) => ({ dateFrom: r.from.toISOString(), dateTo: r.to.toISOString() });

function cacheKeyOf(input: SemanticQueryInput, ctx: AccessContext): string {
  const { yenile: _y, kosuId: _k, ...params } = input;
  return digest([`semantik/${input.kup}`, stableStringify(params), accessDigest(ctx)]);
}

/** Koşu satırının kayıtlı rapor bağı (R1-KAYIT): tanım + sürüm; önizlemede boş. */
export interface RunOrigin {
  definitionId: string;
  versionId: string | null;
}

/** Önizleme sorgusu: derle → (önbellek) → semafor → koşu kaydı → bloklar SIRAYLA → sunum. */
export async function runSemanticQuery(
  input: SemanticQueryInput,
  ctx: AccessContext,
  runId: string = input.kosuId ?? randomUUID(),
  deps: RunDeps & { origin?: RunOrigin | null } = defaultDeps,
): Promise<SemanticResult> {
  // Kayıtlı rapor koşusu: koşu satırı tanım + sürüme bağlanır (önizlemede yok).
  const origin = deps.origin ?? null;
  const q = compileQuery(input, ctx, await prepareCubes(deps.cubes, input.kup));
  const key = cacheKeyOf(input, ctx);
  if (!input.yenile) {
    const hit = deps.cache.get(key);
    if (hit) return { ...hit, kosuId: null, onbellek: { isabet: true } };
  }
  const release = deps.semaphore.tryAcquire(ctx.userId);
  if (!release) {
    throw AppError.tooManyRequests("Aynı anda çalışan rapor sınırı doldu; rapor sırada, birazdan tekrar deneyin.", { code: "RAPOR_SIRADA" });
  }
  const startedAt = Date.now();
  try {
    try {
      await prisma.reportRun.create({
        data: {
          id: runId, key: `semantik/${q.cube.id}`, paramsDigest: key, userId: ctx.userId, status: "CALISIYOR",
          ...(origin ? { definitionId: origin.definitionId, versionId: origin.versionId } : {}),
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw AppError.conflict("Bu koşu kimliği zaten kullanılmış.", { code: "RAPOR_KOSU_VAR" });
      }
      throw e;
    }
    activeRuns.set(runId, { userId: ctx.userId, pid: null, cancelled: false });
    const result = await executeBlocks(q, input, runId, deps);
    const claimed = await finishRun(runId, startedAt, { status: "TAMAM", rowCount: result.satirlar.length });
    // Sonuç hazırken iptal claim'i kazandıysa koşu iptal sayılır (durum satırı tek gerçek).
    if (claimed === 0) throw new RunCancelled();
    deps.cache.set(key, { ...result, kosuId: null });
    return result;
  } catch (e) {
    throw await classifyFailure(e, runId, startedAt);
  } finally {
    activeRuns.delete(runId);
    release();
  }
}

async function executeBlocks(q: CompiledQuery, input: SemanticQueryInput, runId: string, deps: RunDeps): Promise<SemanticResult> {
  const timeoutSec = await deps.readTimeoutSec();
  const warnings: string[] = [];
  const notes = [...(q.cube.notes ?? [])];
  const compareRange = resolveCompareRange(
    { dateFrom: iso(q.range).dateFrom, dateTo: iso(q.range).dateTo, compare: input.compare, compareFrom: input.compareFrom, compareTo: input.compareTo },
    q.range,
  );
  let shaped: { satirlar: SemanticRow[]; toplam: SemanticTotals };
  let kiyas: SemanticResult["kiyas"] = null;
  const helper = q.measures[0]!.helper;
  if (helper) {
    // Derleyici helper ölçüde "veya"yı reddeder; yine de süzgeç sessizce düşmez (fail-closed).
    const filters = andOnlyLeaves(q.filter);
    if (!filters) throw new Error("helper ölçüye 've' dışı süzgeç ulaştı");
    const h = await helper.compute({ range: q.range, dimensions: q.dimensions, filters, cap: q.cap });
    notes.push(...h.notes);
    shaped = shapeHelper(q, h);
    if (compareRange && !activeRuns.get(runId)?.cancelled) {
      const c = await helper.compute({ range: compareRange, dimensions: [], filters, cap: q.cap });
      kiyas = { aralik: iso(compareRange), toplam: shapeHelper({ ...q, dimensions: [] }, c).toplam };
    }
    if (activeRuns.get(runId)?.cancelled) throw new RunCancelled();
  } else {
    const rows = await runBlock<RawRow>(runId, q.sql!, timeoutSec);
    const s = shapeSqlRows(q, rows);
    if (s.truncated) warnings.push(`Kırılım ${REPORT_MAX_ROWS} satırı aşıyor; ilk ${REPORT_MAX_ROWS} satır gösteriliyor — toplam tüm kayıtları kapsar, daha az boyut ya da daha dar bir aralık seçin.`);
    shaped = s;
    if (compareRange) {
      // Kıyas bloğu: yalnız toplam (boyutsuz, dönemsiz) — ayrı kısa tx, SIRAYLA.
      const cq: CompiledQuery = { ...q, dimensions: [], period: null, range: compareRange };
      const crows = await runBlock<RawRow>(runId, buildSql(cq), timeoutSec);
      kiyas = { aralik: iso(compareRange), toplam: shapeSqlRows(cq, crows).toplam };
    }
  }
  if (q.dimensions.some((d) => d.kind === "category") && shaped.satirlar.some((r) => Object.values(r.anahtarlar).some((c) => c.diger))) {
    warnings.push(`Kırılım ilk ${q.cap} değerle sınırlı; kalanlar "Diğer" satırında toplandı. Toplam tüm değerleri kapsar.`);
  }
  return {
    kosuId: runId,
    kup: { kimlik: q.cube.id, ad: q.cube.name },
    olculer: q.measures.map((m) => {
      const t = measureDictionaryEntry(m.id);
      return { kimlik: m.id, ad: t?.ad ?? m.id, aciklama: t?.aciklama ?? "", birim: t?.birim ?? "", iyiYon: t?.iyiYon ?? "notr" };
    }),
    boyutlar: q.dimensions.map((d) => ({ kimlik: d.id, ad: d.name, ...(d.personName ? { kisiAdi: true as const } : {}) })),
    aralik: iso(q.range),
    donemler: q.period
      ? { birim: q.period.unit, adet: q.period.count, anahtarlar: (shaped.toplam.donemler ?? []).map((d) => d.donem) }
      : null,
    satirlar: shaped.satirlar,
    toplam: shaped.toplam,
    kiyas,
    tavan: q.cap,
    uyarilar: warnings,
    notlar: notes,
    kisiAdi: q.dimensions.some((d) => d.personName === true),
    onbellek: { isabet: false },
  };
}

async function classifyFailure(e: unknown, runId: string, startedAt: number): Promise<unknown> {
  const active = activeRuns.get(runId);
  const timeout = extractSqlState(e, ["57014", "55P03"]);
  if (e instanceof RunCancelled || (active?.cancelled && timeout === "57014")) {
    return AppError.conflict("Rapor çalıştırması iptal edildi.", { code: "RAPOR_IPTAL" });
  }
  if (e instanceof AppError) {
    // Kayıt öncesi hatalar (koşu satırı yok) ya da kayıt çakışması — durum satırına dokunulmaz.
    if (e.statusCode !== 409 || (e.details as { code?: string } | undefined)?.code !== "RAPOR_KOSU_VAR") {
      await finishRun(runId, startedAt, { status: "HATA", errorCode: String((e.details as { code?: string } | undefined)?.code ?? "HATA") }).catch(() => 0);
    }
    return e;
  }
  if (timeout) {
    await finishRun(runId, startedAt, { status: "ZAMAN_ASIMI", errorCode: timeout }).catch(() => 0);
    return new AppError(
      "Rapor zaman sınırını aştı; dönemi daraltın ya da daha az kırılım seçin.",
      503,
      true,
      { code: "RAPOR_ZAMAN_ASIMI", sqlState: timeout },
    );
  }
  const transient = extractTransientSqlState(e);
  if (transient) {
    await finishRun(runId, startedAt, { status: "HATA", errorCode: transient }).catch(() => 0);
    return AppError.conflict("Rapor eşzamanlı bir işlemle çakıştı; tekrar deneyin.", { code: "RAPOR_CAKISMA", sqlState: transient });
  }
  await finishRun(runId, startedAt, { status: "HATA", errorCode: "HATA" }).catch(() => 0);
  return e;
}

/** Süren koşuyu durdurur: durum claim'i (CALISIYOR → IPTAL) + `pg_cancel_backend`. */
async function stopRun(runId: string, where: Prisma.ReportRunWhereInput): Promise<number> {
  const claimed = await prisma.reportRun.updateMany({
    where: { ...where, id: runId, status: "CALISIYOR" },
    data: { status: "IPTAL", errorCode: "IPTAL" },
  });
  if (claimed.count === 0) return 0;
  const active = activeRuns.get(runId);
  if (active) {
    active.cancelled = true;
    // Yalnız BU koşunun şu an sorgu çalıştıran bağlantısı; pid boşsa blok arasındadır, bayrak yeter.
    if (active.pid !== null) await prisma.$queryRaw`SELECT pg_cancel_backend(${active.pid}::int)`;
  }
  return claimed.count;
}

/** İptal ucu: KENDİ koşusu; `report:publish` taşıyan başkasınınkini de durdurur (R1-KAYIT). */
export async function cancelRun(runId: string, ctx: AccessContext): Promise<{ kosuId: string; durum: "IPTAL" }> {
  const scope: Prisma.ReportRunWhereInput = matchesPermission(ctx.permissions, REPORT_PUBLISH_PERMISSION) ? {} : { userId: ctx.userId };
  const n = await stopRun(runId, scope);
  if (n === 0) {
    const own = await prisma.reportRun.findFirst({ where: { id: runId, ...scope }, select: { status: true } });
    if (!own) throw AppError.notFound("Rapor çalıştırması bulunamadı.", { code: "RAPOR_KOSU_YOK" });
    throw AppError.conflict("Rapor çalıştırması zaten bitmiş.", { code: "RAPOR_KOSU_BITTI", durum: own.status });
  }
  return { kosuId: runId, durum: "IPTAL" };
}

/** İstemci bağlantısı koptu: yanıtı bekleyen yok, koşu boşuna sürmesin. */
export async function abortDisconnectedRun(runId: string, userId: string): Promise<void> {
  if (!activeRuns.has(runId)) return;
  await stopRun(runId, { userId }).catch(() => 0);
}

/** Bekçi/teşhis: süren koşu sayısı. */
export function activeRunCount(): number {
  return activeRuns.size;
}
