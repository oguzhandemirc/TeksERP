// =============================================================================
// İSTEK BAŞLIĞI — `request_traces`in TEK yazarı, okuyucusu ve budayıcısı (izlenebilirlik B1)
// =============================================================================
// Tasarım: docs/design/IZLENEBILIRLIK-CIHAZ-PLAN.md §4.1 · kural: docs/kurallar/defter.md (audit bölümü).
// TELEMETRİ: hiçbir karar/sayı bu tablodan türetilmez; yaşa göre budanır. `prisma.requestTrace`
// erişimi bu dosya dışında yasak — bekçi `test_request_trace` (AST).
//
// SICAK YOL: `recordTrace` yalnız belleğe ekler (await yok, DB yok). Kuyruk ~1 sn'de bir tek
// `createMany` ile boşalır; yazım koşulu BOŞALTMADA değerlendirilir ki yanıttan sonra biten
// fire-and-forget audit de `auditCount`a girsin. Hata yutulur, `dusen` sayacına düşer.
// GÖVDE, sorgu dizesi, başlık değeri burada HİÇ YOKTUR — anlık görüntü yalnız aşağıdaki alanlar.
// =============================================================================

import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { hata } from "../lib/logger";
import { buildNextCursor, cursorWhere, decodeCursor } from "../utils/cursor";
import { requestTracePurgeCutoff } from "./helpers/request-trace-retention.helper";

// ─── Sözleşme ───────────────────────────────────────────────────────────────

/** `finish` anında alınan anlık görüntü. `audit` canlı tutucudur (boşaltmada okunur). */
export interface TraceSnapshot {
  id: string;
  userId: string | null;
  /** Tablet: çözülmüş `req.device.id`. Panel: null → `panelInstanceId`den boşaltmada çözülür. */
  deviceRefId: string | null;
  panelInstanceId: string | null;
  deviceLocalId: string | null;
  clientType: string | null;
  appVersion: string | null;
  ip: string | null;
  method: string;
  routeKey: string;
  status: number;
  durationMs: number;
  errorCode: string | null;
  audit: { count: number };
  createdAt: Date;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Kuyruğa girmeye aday mı (audit sayısı henüz kesin değil). GET 401 oturum düşmesidir: gürültü. */
export function isTraceCandidate(method: string, status: number): boolean {
  return MUTATING.has(method) || (method === "GET" && status === 403);
}

/** Yazım koşulu: (yazan yöntem ∧ (audit'li ∨ reddedilmiş)) ∨ (GET ∧ 403). */
export function shouldRecordTrace(method: string, status: number, auditCount: number): boolean {
  if (MUTATING.has(method)) return auditCount > 0 || status >= 400;
  return method === "GET" && status === 403;
}

export function clipText(v: string | null | undefined, max: number): string | null {
  if (v == null || v === "") return null;
  return v.length > max ? v.slice(0, max) : v;
}

// ─── Sağlık + kova ──────────────────────────────────────────────────────────

const health = { yazilan: 0, dusen: 0, anonimOrneklenmeyen: 0, sonHata: null as string | null, sonHataAt: null as string | null };

/** Süreç başı jeton kovası: saniyede `rate` satır, en çok `burst` birikim. Taşma `dusen`. */
const bucket = { rate: 50, burst: 200, tokens: 200, at: Date.now() };

function takeToken(now: number): boolean {
  bucket.tokens = Math.min(bucket.burst, bucket.tokens + ((now - bucket.at) / 1000) * bucket.rate);
  bucket.at = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

const anonBucket = { rate: 1, burst: 60, tokens: 60, at: Date.now() };

function takeAnonToken(now: number): boolean {
  anonBucket.tokens = Math.min(anonBucket.burst, anonBucket.tokens + ((now - anonBucket.at) / 1000) * anonBucket.rate);
  anonBucket.at = now;
  if (anonBucket.tokens < 1) return false;
  anonBucket.tokens -= 1;
  return true;
}

/** Bekçi düzeneği: kimliksiz red örnek kovasını daraltır/sıfırlar. */
export function setAnonTraceBucketForTest(rate: number, burst: number): void {
  anonBucket.rate = rate;
  anonBucket.burst = burst;
  anonBucket.tokens = burst;
  anonBucket.at = Date.now();
}

/** Bekçi düzeneği: kovayı daraltır/sıfırlar. Üretimde çağrılmaz. */
export function setRequestTraceBucketForTest(rate: number, burst: number): void {
  bucket.rate = rate;
  bucket.burst = burst;
  bucket.tokens = burst;
  bucket.at = Date.now();
}

const PENDING_MAX = 5000;
const FLUSH_MS = 1000;
const pending: TraceSnapshot[] = [];
let timer: NodeJS.Timeout | null = null;

/** `/health` → `requestTraces`: `dusen > 0` = istek başlıkları sessizce düşüyor. */
export function getRequestTraceHealth(): { yazilan: number; dusen: number; anonimOrneklenmeyen: number; kuyruk: number; sonHata: string | null; sonHataAt: string | null } {
  return { ...health, kuyruk: pending.length };
}

// ─── Yazım ──────────────────────────────────────────────────────────────────

/** TEK yazar. Senkron, DB'siz: yalnız kuyruğa ekler; boşaltma zamanlayıcıyla. */
export function recordTrace(snap: TraceSnapshot): void {
  // D4 (VDS denetimi): kimliksiz 401/404 örneklenir — tarama/sel meşru izlerin kovasını tüketmesin.
  // Normal yükte görünmez (saniyede 1, 60'lık birikim) → her kurulumda.
  if (snap.userId === null && (snap.status === 401 || snap.status === 404) && !takeAnonToken(Date.now())) {
    health.anonimOrneklenmeyen++;
    return;
  }
  if (pending.length >= PENDING_MAX) {
    health.dusen++;
    return;
  }
  pending.push(snap);
  if (!timer) {
    timer = setTimeout(() => {
      timer = null;
      void flushRequestTraces();
    }, FLUSH_MS);
    timer.unref();
  }
}

/** Panel kurulum kimliği → `devices.id` (yalnız görüntü). Kısa ömürlü önbellek: boşaltma başına en çok bir sorgu. */
const DEVICE_TTL_MS = 5 * 60_000;
const deviceCache = new Map<string, { id: string | null; at: number }>();

async function resolvePanelDevices(ids: string[], now: number): Promise<void> {
  const miss = ids.filter((k) => {
    const c = deviceCache.get(k);
    return !c || now - c.at > DEVICE_TTL_MS;
  });
  if (miss.length === 0) return;
  if (deviceCache.size > 1000) deviceCache.clear();
  const rows = await prisma.device.findMany({ where: { deviceId: { in: miss } }, select: { id: true, deviceId: true } });
  const found = new Map(rows.map((r) => [r.deviceId, r.id]));
  for (const k of miss) deviceCache.set(k, { id: found.get(k) ?? null, at: now });
}

/** Kuyruğu boşaltır (zamanlayıcı · kapanış · bekçi). Hata FIRLATMAZ. */
export async function flushRequestTraces(): Promise<void> {
  if (pending.length === 0) return;
  const batch = pending.splice(0, pending.length);
  const now = Date.now();
  const rows: Prisma.RequestTraceCreateManyInput[] = [];
  const panelIds = new Set<string>();
  const kept: TraceSnapshot[] = [];
  for (const s of batch) {
    if (!shouldRecordTrace(s.method, s.status, s.audit.count)) continue;
    if (!takeToken(now)) {
      health.dusen++;
      continue;
    }
    kept.push(s);
    if (!s.deviceRefId && s.panelInstanceId) panelIds.add(s.panelInstanceId);
  }
  if (kept.length === 0) return;
  try {
    try {
      await resolvePanelDevices([...panelIds], now);
    } catch {
      /* künye best-effort — satır cihazsız yazılır */
    }
    for (const s of kept) {
      rows.push({
        id: s.id,
        userId: s.userId,
        deviceRefId: s.deviceRefId ?? (s.panelInstanceId ? deviceCache.get(s.panelInstanceId)?.id ?? null : null),
        deviceLocalId: clipText(s.deviceLocalId, 64),
        clientType: clipText(s.clientType, 16),
        appVersion: clipText(s.appVersion, 32),
        ip: clipText(s.ip, 64),
        method: s.method.slice(0, 8),
        routeKey: s.routeKey.slice(0, 160),
        status: Math.max(0, Math.min(32767, s.status)),
        durationMs: Math.max(0, Math.round(s.durationMs)),
        errorCode: clipText(s.errorCode, 60),
        auditCount: s.audit.count,
        createdAt: s.createdAt,
      });
    }
    const r = await prisma.requestTrace.createMany({ data: rows, skipDuplicates: true });
    health.yazilan += r.count;
  } catch (e) {
    health.dusen += kept.length;
    health.sonHata = (e as Error)?.message?.slice(0, 200) ?? String(e);
    health.sonHataAt = new Date().toISOString();
    hata("request-trace", "istek başlıkları yazılamadı (istekler etkilenmedi)", e);
  }
}

// ─── Okuma (B2/B3 bunları çağırır) ──────────────────────────────────────────

export const REQUEST_TRACE_SELECT = {
  id: true,
  userId: true,
  deviceRefId: true,
  deviceLocalId: true,
  clientType: true,
  appVersion: true,
  ip: true,
  method: true,
  routeKey: true,
  status: true,
  durationMs: true,
  errorCode: true,
  auditCount: true,
  createdAt: true,
} satisfies Prisma.RequestTraceSelect;

export type RequestTraceDto = Prisma.RequestTraceGetPayload<{ select: typeof REQUEST_TRACE_SELECT }>;

export async function getTrace(id: string): Promise<RequestTraceDto | null> {
  return prisma.requestTrace.findUnique({ where: { id }, select: REQUEST_TRACE_SELECT });
}

/** Cursor'lı liste (yeniden eskiye). */
export async function listTraces(
  where: Prisma.RequestTraceWhereInput,
  opts: { cursor?: string; limit?: number } = {},
): Promise<{ data: RequestTraceDto[]; nextCursor: string | null }> {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
  const c = decodeCursor(opts.cursor);
  const page: Prisma.RequestTraceWhereInput = c ? { AND: [where, cursorWhere(c)] } : where;
  const rows = await prisma.requestTrace.findMany({
    where: page,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: REQUEST_TRACE_SELECT,
  });
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return { data, nextCursor: hasMore ? buildNextCursor(data[data.length - 1]) : null };
}

/** Gruplama için yalnız kimlikler (yeniden eskiye, tavanlı). */
export async function listTraceIds(where: Prisma.RequestTraceWhereInput, max = 5000): Promise<string[]> {
  const rows = await prisma.requestTrace.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(Math.max(1, max), 20000),
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

// ─── Budama ─────────────────────────────────────────────────────────────────

/** Gece bakımı: yalnız YAŞ yüklemi (`createdAt < now - retentionDays`); 0 = budama yok. */
export async function pruneRequestTraces(now: Date, retentionDays: number): Promise<{ deleted: number; cutoff: Date | null }> {
  const cutoff = requestTracePurgeCutoff(retentionDays, now);
  if (!cutoff) return { deleted: 0, cutoff: null };
  const r = await prisma.requestTrace.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return { deleted: r.count, cutoff };
}

/** İşlem görünümü (B2): sayfadaki istek kimliklerinin başlıkları — tek sorgu. */
export async function getTracesByIds(ids: readonly string[]): Promise<RequestTraceDto[]> {
  if (ids.length === 0) return [];
  return prisma.requestTrace.findMany({ where: { id: { in: [...ids] } }, select: REQUEST_TRACE_SELECT });
}

/**
 * İşlem görünümü (B2): reddedilen istekler (≥400) — audit satırı olmadığı için yalnız burada görünür.
 * `auditliDahil` (B4 "Reddedilenler" süzgeci): audit bırakıp yine de reddedilen istek de gelir;
 * süzme burada, SUNUCUDA — kısmi indeks `(createdAt) WHERE status >= 400`.
 */
export async function listRejectedTraces(
  f: { userId?: string; from?: Date; to?: Date; before?: { at: Date; id: string } },
  limit: number,
  opts: { auditliDahil?: boolean } = {},
): Promise<RequestTraceDto[]> {
  const and: Prisma.RequestTraceWhereInput[] = [{ status: { gte: 400 } }];
  if (!opts.auditliDahil) and.push({ auditCount: 0 });
  if (f.userId) and.push({ userId: f.userId });
  if (f.from) and.push({ createdAt: { gte: f.from } });
  if (f.to) and.push({ createdAt: { lte: f.to } });
  if (f.before) {
    and.push({ OR: [{ createdAt: { lt: f.before.at } }, { createdAt: f.before.at, id: { lt: f.before.id } }] });
  }
  return prisma.requestTrace.findMany({
    where: { AND: and },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(Math.max(1, limit), 200),
    select: REQUEST_TRACE_SELECT,
  });
}

/** Cihaz satırı başına izlerde görülen uygulama sürümleri (birleştirme sezgisi okur; tek okuyucu boğazı). */
export async function listDeviceAppVersions(deviceRefIds: readonly string[]): Promise<Array<{ deviceRefId: string; appVersion: string }>> {
  if (deviceRefIds.length === 0) return [];
  const rows = await prisma.requestTrace.groupBy({
    by: ["deviceRefId", "appVersion"],
    where: { deviceRefId: { in: [...deviceRefIds] }, appVersion: { not: null } },
  });
  return rows.flatMap((r) => (r.deviceRefId && r.appVersion ? [{ deviceRefId: r.deviceRefId, appVersion: r.appVersion }] : []));
}
