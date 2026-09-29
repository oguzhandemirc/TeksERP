// Paket girdilerinin uygulanması (sözleşme §6.3–6.5). Hepsi çağıranın tx'inde, kiracı ve paket
// kilidi altında. Sürüm anı PAKETİN UFKUDUR: `ON CONFLICT … WHERE stored.version_at <= EXCLUDED`
// ⇒ geç gelen eski paket yeni veriyi ezemez, silinmiş satırı diriltemez (mezar taşı satırı kalır,
// 7 gün sonra budanır). Bulut aritmetik yapmaz; satır fabrikanın hesapladığı hâliyle saklanır.
import { Prisma } from "@prisma/client";
import { firstDate, projectionDef } from "../catalog/projections";
import type { Tx } from "../lib/db";
import { NO_TENANT } from "../lib/tenant";
import type { EntryRejectCode, FullRequestReason, RecordEntry, SyncResponse, Watermark } from "../wire/esitleme";
import type { z } from "zod";
import { EMPTY_SET_DIGEST, type ReconcileEntrySchema, type SnapshotEntrySchema } from "../wire/esitleme";

export interface PackageAccumulator {
  kabul: SyncResponse["kabul"];
  ret: SyncResponse["ret"];
  istenen: SyncResponse["istenen"];
}

function reject(acc: PackageAccumulator, projeksiyon: string, kod: EntryRejectCode): void {
  acc.ret.push({ projeksiyon, kod });
}

function requestFull(acc: PackageAccumulator, projeksiyon: string, neden: FullRequestReason): void {
  if (!acc.istenen.some((i) => i.projeksiyon === projeksiyon)) acc.istenen.push({ projeksiyon, tur: "TAM", neden });
}

/** Eşitlik bozucu: ikisi de rakamsa sayısal (tur sayacı), değilse bayt sırası. */
function compareTieBreaker(a: string, b: string): number {
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    const x = BigInt(a);
    const y = BigInt(b);
    return x === y ? 0 : x < y ? -1 : 1;
  }
  return a === b ? 0 : a < b ? -1 : 1;
}

/** Filigran sırası: önce zaman, eşitse eşitlik bozucu. */
export function compareWatermarks(a: Watermark, b: { t: Date | string; k: string }): number {
  const ta = Date.parse(a.t);
  const tb = typeof b.t === "string" ? Date.parse(b.t) : b.t.getTime();
  if (ta !== tb) return ta < tb ? -1 : 1;
  return compareTieBreaker(a.k, b.k);
}

interface RowInput {
  readonly id: string;
  readonly data: Record<string, unknown>;
  readonly retention_at: string | null;
  readonly sort_at: string;
}

function rowInputs(entry: RecordEntry, horizon: Date): RowInput[] {
  const def = projectionDef(entry.projeksiyon)!;
  const byId = new Map<string, RowInput>();
  for (const row of entry.yaz) {
    const data = row as Record<string, unknown>;
    // Alt satırın saklama/sıralama tarihi kök satırdan gelir (bakım kökle birlikte budar).
    const retention = def.subRow ? null : firstDate(data, def.root.retentionFields);
    const sort = def.subRow ? null : firstDate(data, def.root.sortFields);
    byId.set(row.id, { id: row.id, data, retention_at: retention?.toISOString() ?? null, sort_at: (sort ?? horizon).toISOString() });
  }
  return [...byId.values()];
}

interface RowTarget {
  readonly tesisId: string;
  readonly projection: string;
  readonly horizon: Date;
}

async function upsertRows(tx: Tx, { tesisId, projection, horizon }: RowTarget, rows: readonly RowInput[]): Promise<void> {
  if (rows.length === 0) return;
  await tx.$executeRaw`
    INSERT INTO projection_rows (tesis_id, projection, record_id, data, version_at, deleted_at, retention_at, sort_at, updated_at)
    SELECT ${tesisId}::uuid, ${projection}, r.id, r.data, ${horizon}::timestamptz, NULL, r.retention_at, r.sort_at, now()
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS r(id uuid, data jsonb, retention_at timestamptz, sort_at timestamptz)
    ON CONFLICT (tesis_id, projection, record_id) DO UPDATE
      SET data = EXCLUDED.data, version_at = EXCLUDED.version_at, deleted_at = NULL,
          retention_at = EXCLUDED.retention_at, sort_at = EXCLUDED.sort_at, updated_at = now()
      WHERE projection_rows.version_at <= EXCLUDED.version_at`;
}

async function tombstoneRows(tx: Tx, { tesisId, projection, horizon }: RowTarget, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.$executeRaw`
    INSERT INTO projection_rows (tesis_id, projection, record_id, data, version_at, deleted_at, sort_at, updated_at)
    SELECT ${tesisId}::uuid, ${projection}, x.id, '{}'::jsonb, ${horizon}::timestamptz, ${horizon}::timestamptz, ${horizon}::timestamptz, now()
      FROM unnest(${[...new Set(ids)]}::uuid[]) AS x(id)
    ON CONFLICT (tesis_id, projection, record_id) DO UPDATE
      SET deleted_at = EXCLUDED.deleted_at, version_at = EXCLUDED.version_at, updated_at = now()
      WHERE projection_rows.version_at <= EXCLUDED.version_at`;
}

/** TAM parça izlemesi; son parça gelince `version_at < başlangıç` satırlar düşer (kaçmış silmeler dahil). */
async function trackFullRun(tx: Tx, g: { tesisId: string; entry: RecordEntry; horizon: Date; nowMs: number }): Promise<"OK" | "UYUSMAZ"> {
  const tam = g.entry.tam!;
  const startedAt = new Date(tam.baslangic);
  if (startedAt.getTime() > g.horizon.getTime()) return "UYUSMAZ";
  const key = { tesisId_projection_startedAt: { tesisId: g.tesisId, projection: g.entry.projeksiyon, startedAt } };
  const run = await tx.fullSyncRun.findUnique({ where: key });
  if (run && run.totalParts !== tam.toplamParca) return "UYUSMAZ";
  const received = [...new Set([...(run?.receivedParts ?? []), tam.parca])].sort((a, b) => a - b);
  const complete = received.length === tam.toplamParca;
  const alreadyDone = run?.completedAt != null;
  await tx.fullSyncRun.upsert({
    where: key,
    create: { tesisId: g.tesisId, projection: g.entry.projeksiyon, startedAt, totalParts: tam.toplamParca, receivedParts: received, completedAt: complete ? new Date(g.nowMs) : null },
    update: { receivedParts: received, ...(complete && !alreadyDone ? { completedAt: new Date(g.nowMs) } : {}) },
  });
  if (complete && !alreadyDone) {
    await tx.$executeRaw`
      UPDATE projection_rows SET deleted_at = ${g.horizon}::timestamptz, version_at = ${g.horizon}::timestamptz, updated_at = now()
       WHERE tesis_id = ${g.tesisId}::uuid AND projection = ${g.entry.projeksiyon} AND deleted_at IS NULL AND version_at < ${startedAt}::timestamptz`;
  }
  return "OK";
}

function violatesFieldClass(entry: RecordEntry): boolean {
  const def = projectionDef(entry.projeksiyon)!;
  const forbidden = def.subRow ? [] : (def.root.forbiddenRootFields ?? []);
  return forbidden.length > 0 && entry.yaz.some((row) => forbidden.some((f) => Object.hasOwn(row, f)));
}

export async function applyRecordEntry(tx: Tx, g: { tesisId: string; horizon: Date; entry: RecordEntry; nowMs: number }, acc: PackageAccumulator): Promise<void> {
  const { entry, tesisId, horizon } = g;
  const def = projectionDef(entry.projeksiyon);
  if (!def) return reject(acc, entry.projeksiyon, "PROJEKSIYON_BILINMIYOR");
  if (def.root.kind === "ANLIK") return reject(acc, entry.projeksiyon, "PROJEKSIYON_TURU");
  if (violatesFieldClass(entry)) return reject(acc, entry.projeksiyon, "ALAN_SINIFI_IHLALI");
  const stored = await tx.syncWatermark.findUnique({ where: { tesisId_projection: { tesisId, projection: entry.projeksiyon } } });
  if (stored && entry.katalogSurum < stored.catalogVersion) return reject(acc, entry.projeksiyon, "KATALOG_SURUMU");
  if (stored && entry.katalogSurum > stored.catalogVersion && entry.tam === null) return requestFull(acc, entry.projeksiyon, "KATALOG_SURUMU");
  let accepted = true;
  if (entry.tam === null) {
    const onceki = entry.filigran.onceki;
    const gap = stored ? onceki !== null && compareWatermarks(onceki, { t: stored.watermarkT, k: stored.watermarkK }) > 0 : onceki !== null;
    if (gap) {
      accepted = false;
      requestFull(acc, entry.projeksiyon, "FILIGRAN_KOPUK");
    }
  } else if ((await trackFullRun(tx, g)) === "UYUSMAZ") {
    return reject(acc, entry.projeksiyon, "TAM_PARCA_UYUSMAZ");
  }
  const target = { tesisId, projection: entry.projeksiyon, horizon };
  await upsertRows(tx, target, rowInputs(entry, horizon));
  await tombstoneRows(tx, target, entry.sil.map((s) => s.id));
  if (!accepted) return;
  const yeni = entry.filigran.yeni;
  const advance = !stored || compareWatermarks(yeni, { t: stored.watermarkT, k: stored.watermarkK }) > 0;
  const mark = { watermarkT: advance ? new Date(yeni.t) : stored.watermarkT, watermarkK: advance ? yeni.k : stored.watermarkK, catalogVersion: entry.katalogSurum };
  await tx.syncWatermark.upsert({
    where: { tesisId_projection: { tesisId, projection: entry.projeksiyon } },
    create: { tesisId, projection: entry.projeksiyon, ...mark },
    update: mark,
  });
  acc.kabul.push({ projeksiyon: entry.projeksiyon, filigran: yeni });
}

export async function applySnapshot(tx: Tx, g: { tesisId: string; horizon: Date; snap: z.infer<typeof SnapshotEntrySchema> }, acc: PackageAccumulator): Promise<void> {
  const def = projectionDef(g.snap.projeksiyon);
  if (!def) return reject(acc, g.snap.projeksiyon, "PROJEKSIYON_BILINMIYOR");
  if (def.root.kind !== "ANLIK" || def.subRow) return reject(acc, g.snap.projeksiyon, "PROJEKSIYON_TURU");
  await tx.$executeRaw`
    INSERT INTO projection_rows (tesis_id, projection, record_id, data, version_at, sort_at, updated_at)
    VALUES (${g.tesisId}::uuid, ${g.snap.projeksiyon}, ${NO_TENANT}::uuid, ${JSON.stringify(g.snap.veri)}::jsonb, ${g.horizon}::timestamptz, ${g.horizon}::timestamptz, now())
    ON CONFLICT (tesis_id, projection, record_id) DO UPDATE
      SET data = EXCLUDED.data, version_at = EXCLUDED.version_at, sort_at = EXCLUDED.sort_at, deleted_at = NULL, updated_at = now()
      WHERE projection_rows.version_at <= EXCLUDED.version_at`;
}

export async function reconcile(tx: Tx, g: { tesisId: string; rec: z.infer<typeof ReconcileEntrySchema> }, acc: PackageAccumulator): Promise<void> {
  const def = projectionDef(g.rec.projeksiyon);
  if (!def) return reject(acc, g.rec.projeksiyon, "PROJEKSIYON_BILINMIYOR");
  if (def.root.kind === "ANLIK") return reject(acc, g.rec.projeksiyon, "PROJEKSIYON_TURU");
  const ufuk = g.rec.ufukTarihi ? new Date(g.rec.ufukTarihi) : null;
  const parent = def.root.retentionFromParent ? def.root.parent : undefined;
  // Fabrika kümeyi AYNI tarihle süzer: kalemin tarihi yoksa üst belgenin saklama tarihi (fabrika `retention.parent`).
  const horizonFilter = !ufuk
    ? Prisma.empty
    : parent
      ? Prisma.sql`AND EXISTS (SELECT 1 FROM projection_rows p
           WHERE p.tesis_id = r.tesis_id AND p.projection = ${parent.projection} AND p.deleted_at IS NULL
             AND p.record_id::text = r.data->>${parent.field} AND (p.retention_at IS NULL OR p.retention_at >= ${ufuk}::timestamptz))`
      : Prisma.sql`AND (r.retention_at IS NULL OR r.retention_at >= ${ufuk}::timestamptz)`;
  const rows = await tx.$queryRaw<{ adet: number; ozet: string }[]>(Prisma.sql`
    SELECT count(*)::int AS adet, md5(COALESCE(string_agg(r.record_id::text, ',' ORDER BY r.record_id), '')) AS ozet
      FROM projection_rows r
     WHERE r.tesis_id = ${g.tesisId}::uuid AND r.projection = ${g.rec.projeksiyon} AND r.deleted_at IS NULL ${horizonFilter}`);
  const mine = rows[0] ?? { adet: 0, ozet: EMPTY_SET_DIGEST };
  if (mine.adet !== g.rec.adet || mine.ozet !== g.rec.ozet) requestFull(acc, g.rec.projeksiyon, "UZLASTIRMA");
}
