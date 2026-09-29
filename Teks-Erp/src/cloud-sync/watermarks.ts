// Filigran deposu (`sync_watermarks`) — DURUM tablosu: "nereye kadar gönderildi ve bulut
// onayladı". Bir turun taradığı konumlar ONAYDAN SONRA tek tx'te yazılır; onaysız tur
// aynı konumdan yeniden kurulur (bulut aynı satırı ikinci kez almayı idempotent işler).
import prisma from "../lib/prisma";

export interface StoredWatermark {
  readonly source: string;
  readonly at: Date | null;
  readonly tie: readonly string[] | null;
  readonly catalogVersion: number | null;
  readonly digest: string | null;
  readonly retentionFrom: Date | null;
}

export interface WatermarkWrite {
  readonly source: string;
  readonly at?: Date | null;
  readonly tie?: readonly string[] | null;
  readonly catalogVersion?: number | null;
  readonly digest?: string | null;
  readonly retentionFrom?: Date | null;
}

/** Kaynak anahtarları — biçim sözleşmedir (şema yorumu `SyncWatermark`). */
export const wmKey = {
  source: (projection: string, table: string, column: string): string => `kaynak|${projection}|${table}.${column}`,
  marks: (projection: string): string => `isaret|${projection}`,
  merge: (projection: string, column: "createdAt" | "revertedAt"): string => `birlestirme|${projection}|${column}`,
  chain: (projection: string): string => `zincir|${projection}`,
  snapshot: (name: string): string => `anlik|${name}`,
  standardReport: (key: string, period: string): string => `rapor|${key}|${period}`,
  round: "tur",
  reconcile: "uzlastirma",
  dayTurn: "gun-donumu",
  prune: "budama",
} as const;

/** Bulutun "tamamını yeniden gönder" isteği — zincir satırının özet alanında taşınır. */
export const FULL_RESEND_MARKER = "TAM_ISTENDI";

function parseTie(raw: string | null): string[] | null {
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null;
  } catch {
    return null;
  }
}

export async function loadWatermarks(): Promise<Map<string, StoredWatermark>> {
  const rows = await prisma.syncWatermark.findMany({
    select: { source: true, watermarkAt: true, tieBreaker: true, catalogVersion: true, digest: true, retentionFrom: true },
  });
  return new Map(
    rows.map((r) => [
      r.source,
      { source: r.source, at: r.watermarkAt, tie: parseTie(r.tieBreaker), catalogVersion: r.catalogVersion, digest: r.digest, retentionFrom: r.retentionFrom },
    ]),
  );
}

/** Onaylanan konumları TEK tx'te yazar (sıralı; tx içinde paralel çağrı yok). */
export async function saveWatermarks(writes: readonly WatermarkWrite[]): Promise<void> {
  if (writes.length === 0) return;
  await prisma.$transaction(async (tx) => {
    for (const w of writes) {
      const data = {
        ...(w.at !== undefined ? { watermarkAt: w.at } : {}),
        ...(w.tie !== undefined ? { tieBreaker: w.tie === null ? null : JSON.stringify(w.tie) } : {}),
        ...(w.catalogVersion !== undefined ? { catalogVersion: w.catalogVersion } : {}),
        ...(w.digest !== undefined ? { digest: w.digest } : {}),
        ...(w.retentionFrom !== undefined ? { retentionFrom: w.retentionFrom } : {}),
      };
      await tx.syncWatermark.upsert({ where: { source: w.source }, create: { source: w.source, ...data }, update: data });
    }
  });
}

/** Tur sayacı — `{t,k}` zincirinin `k`sı; her pakette bir artar (aynı ufukta sayfalar sıralı kalsın). */
export function formatRoundCounter(n: number): string {
  return String(n).padStart(12, "0");
}
