// =============================================================================
// Latency Persist — RAM gecikme delta'larının GÜNLÜK özet tablosuna yazımı
// =============================================================================
// Neden (SAHA-DAYANIKLILIK-FAZ3.md §P1): latency-stats süreç belleğinde yaşar —
// her restart (dev'de nodemon = her dosya kaydı!) veriyi sıfırlar; "değişiklik
// öncesi/sonrası p95" kıyası ve gün-bazlı trend ancak kalıcı özetle mümkün.
//
// Tasarım sınırları:
//   - TIMER YOK: flush istek-güdümlüdür (noteLatencyDelta throttle'ı) — /health
//     "yeni timer yok" ilkesi korunur. Kapanışta gracefulShutdown 2sn tavanlı
//     son flush çağırır.
//   - İstek yolunun DIŞINDA: throttle dolunca flush setImmediate ile ayrılır;
//     cevap gecikmez.
//   - BEST-EFFORT: yazım hatası isteği düşürmez, sayaca düşer (audit-health
//     deseni); satır bazlı try — bir satır hatası kalanları engellemez.
//   - Bucket sayaçları JSON'da SAKLANIR → günler/aralıklar toplanabilir,
//     persentil okuma anında hesaplanır (yaklaşıklık kaybı yok).
//   - RETENTION: günde en fazla 1 kez, RETENTION_DAYS'ten eski satırlar silinir
//     (fiziksel DELETE — operasyonel özet verisi, domain kaydı değil; tablo
//     TAVANLI kalır: ~150-200 satır/gün × 90 gün).

import prisma from "../lib/prisma";
import { BUCKET_BOUNDS_MS, bucketIndex, percentileFromBuckets } from "./latency-stats.service";

/** Flush throttle penceresi. */
export const FLUSH_INTERVAL_MS = 5 * 60_000;
/** Günlük özet saklama süresi. */
export const RETENTION_DAYS = 90;

interface PendingDelta {
  count: number;
  errCount: number;
  maxMs: number;
  buckets: number[];
}

let pending = new Map<string, PendingDelta>();
let lastFlushAt = Date.now(); // boot anı — ilk flush en erken 5dk sonra
let inFlush = false;
let lastRetentionDayKey = ""; // "YYYY-MM-DD" — retention günde 1 kez
let flushFailures = 0;
let lastFlushError: string | null = null;
let lastFlushOkAt: number | null = null;

/** Yerel gün başlangıcı — fabrika "günü" sunucu saatiyle anlamlıdır. */
function localDay(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Middleware'in ikinci giriş noktası (recordLatency'nin yanında) — istek başına
 * O(1) bellek işlemi + throttle kontrolü. HTTP cevabını asla bekletmez.
 */
export function noteLatencyDelta(method: string, routeKey: string, status: number, ms: number): void {
  const key = `${method} ${routeKey}`;
  let d = pending.get(key);
  if (!d) {
    d = { count: 0, errCount: 0, maxMs: 0, buckets: BUCKET_BOUNDS_MS.map(() => 0) };
    pending.set(key, d);
  }
  d.count += 1;
  if (status >= 500) d.errCount += 1;
  if (ms > d.maxMs) d.maxMs = ms;
  d.buckets[bucketIndex(ms)] += 1;

  if (!inFlush && pending.size > 0 && Date.now() - lastFlushAt >= FLUSH_INTERVAL_MS) {
    // İstek yolundan ayrıl — flush DB turları cevabı geciktirmesin.
    setImmediate(() => void flushLatencyNow());
  }
}

/**
 * Birikmiş delta'ları bugünün satırlarına merge-upsert eder + günde 1 kez
 * retention koşar. Dışarıdan da çağrılabilir: gracefulShutdown (2sn tavanla)
 * ve test scriptleri (throttle beklemeden).
 */
export async function flushLatencyNow(): Promise<void> {
  if (inFlush) return;
  inFlush = true;
  lastFlushAt = Date.now();
  // Swap: flush sürerken gelen kayıtlar YENİ map'e yazılır — kayıp yok.
  const batch = pending;
  pending = new Map();
  try {
    const day = localDay();
    for (const [routeKey, d] of batch) {
      try {
        const existing = await prisma.endpointLatencyDaily.findUnique({
          where: { day_routeKey: { day, routeKey } },
          select: { id: true, maxMs: true, buckets: true },
        });
        if (existing) {
          const merged = (existing.buckets as number[]).map(
            (v, i) => v + (d.buckets[i] ?? 0),
          );
          await prisma.endpointLatencyDaily.update({
            where: { id: existing.id },
            data: {
              count: { increment: d.count },
              errCount: { increment: d.errCount },
              maxMs: Math.max(existing.maxMs, Math.round(d.maxMs)),
              buckets: merged,
            },
          });
        } else {
          await prisma.endpointLatencyDaily.create({
            data: {
              day,
              routeKey,
              count: d.count,
              errCount: d.errCount,
              maxMs: Math.round(d.maxMs),
              buckets: d.buckets,
            },
          });
        }
        lastFlushOkAt = Date.now();
      } catch (err) {
        // Satır bazlı best-effort: bu delta düşer (kabul — özet veri), kalanlar denenir.
        flushFailures += 1;
        lastFlushError = err instanceof Error ? err.message : String(err);
      }
    }

    // Retention — günde en fazla 1 kez, flush'ın kuyruğunda (timer'sız).
    const todayKey = dayKey(day);
    if (lastRetentionDayKey !== todayKey) {
      lastRetentionDayKey = todayKey;
      try {
        const cutoff = localDay();
        cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
        await prisma.endpointLatencyDaily.deleteMany({ where: { day: { lt: cutoff } } });
      } catch (err) {
        flushFailures += 1;
        lastFlushError = err instanceof Error ? err.message : String(err);
      }
    }
  } finally {
    inFlush = false;
  }
}

/** /api/admin/perf cevabına eklenen kalıcılaştırma sağlığı. */
export function getLatencyPersistHealth(): {
  flushFailures: number;
  lastFlushError: string | null;
  lastFlushOkAt: number | null;
  pendingRoutes: number;
} {
  return { flushFailures, lastFlushError, lastFlushOkAt, pendingRoutes: pending.size };
}

export interface LatencyHistoryPoint {
  day: string; // "YYYY-MM-DD"
  count: number;
  errCount: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

/**
 * Gün bazlı seri — grafik için hazır. `route` verilirse o ucun günleri; verilmezse
 * TÜM route'ların bucket'ları gün içinde BİRLEŞTİRİLİP toplam seri üretilir
 * (persentil birleşik bucket'tan — istemci tarafında persentil toplanamaz).
 */
export async function latencyHistory(days: number, route?: string): Promise<LatencyHistoryPoint[]> {
  const from = localDay();
  from.setDate(from.getDate() - (days - 1));
  const rows = await prisma.endpointLatencyDaily.findMany({
    where: { day: { gte: from }, ...(route ? { routeKey: route } : {}) },
    orderBy: { day: "asc" },
    select: { day: true, count: true, errCount: true, maxMs: true, buckets: true },
  });

  const byDay = new Map<string, { count: number; errCount: number; maxMs: number; buckets: number[] }>();
  for (const r of rows) {
    const k = dayKey(r.day);
    let agg = byDay.get(k);
    if (!agg) {
      agg = { count: 0, errCount: 0, maxMs: 0, buckets: BUCKET_BOUNDS_MS.map(() => 0) };
      byDay.set(k, agg);
    }
    agg.count += r.count;
    agg.errCount += r.errCount;
    agg.maxMs = Math.max(agg.maxMs, r.maxMs);
    const b = r.buckets as number[];
    for (let i = 0; i < agg.buckets.length; i++) agg.buckets[i] += b[i] ?? 0;
  }

  return [...byDay.entries()].map(([day, a]) => ({
    day,
    count: a.count,
    errCount: a.errCount,
    p50Ms: percentileFromBuckets(a.buckets, a.count, 0.5, a.maxMs),
    p95Ms: percentileFromBuckets(a.buckets, a.count, 0.95, a.maxMs),
    maxMs: a.maxMs,
  }));
}

/** Kalıcı özet route listesi (UI seçicisi) — son N günde görülen anahtarlar. */
export async function latencyHistoryRoutes(days: number): Promise<string[]> {
  const from = localDay();
  from.setDate(from.getDate() - (days - 1));
  const rows = await prisma.endpointLatencyDaily.findMany({
    where: { day: { gte: from } },
    distinct: ["routeKey"],
    select: { routeKey: true },
    orderBy: { routeKey: "asc" },
  });
  return rows.map((r) => r.routeKey);
}
