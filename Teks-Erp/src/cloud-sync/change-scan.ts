// DEĞİŞİKLİK TESPİTİ (§4): bir projeksiyonun (w, H] aralığında kirlenen kök kimlikleri.
// Kaynaklar yalnız üçtür ve hiçbiri audit değildir: filigran (`updatedAt`/`createdAt` +
// eşitlik bozucu), DB tetikleyicilerinin `sync_marks` işaretleri, birleştirme defteri
// (`merge_operations`, FK taşıması `updatedAt` yazmaz). Konumlar ONAYDAN önce yazılmaz.
import prisma from "../lib/prisma";
import {
  MERGE_ENTITY_TABLES,
  type ChangeSource,
  type RecordProjection,
  type RootMapping,
} from "./projections";
import { wmKey, type StoredWatermark, type WatermarkWrite } from "./watermarks";

/** Kaynak başına tur tavanı — aşan kaynak kaldığı yerden sonraki turda devam eder. */
export const SOURCE_SCAN_LIMIT = 2000;
let scanLimit = SOURCE_SCAN_LIMIT;

/** Test-only: eşitlik bozucu sayfalamasını küçük kümede ölçmek için tavan. */
export function __setScanLimitForTests(n: number | null): void {
  scanLimit = n ?? SOURCE_SCAN_LIMIT;
}
/** Tek birleştirmenin taşıdığı satır bu sayıyı aşarsa etkilenen projeksiyon TAM gönderilir (§4.5). */
export const MERGE_FULL_THRESHOLD = 50_000;

/** Tarama konumu: `tie` null ise "`at`ten ÖNCEKİ her şey bitti" (ufukla kapanmış tarama). */
export interface ScanPosition {
  readonly at: Date;
  readonly tie: readonly string[] | null;
}

export interface ProjectionChanges {
  readonly projection: RecordProjection;
  /** Yeniden kurulacak kökler (silinenler dahil olabilir — kurucu bulamazsa SILINDI yazar). */
  readonly dirty: Set<string>;
  /** `sync_marks` SILINDI işaretleri. */
  readonly deleted: Set<string>;
  /** Onayla birlikte yazılacak konumlar. */
  readonly positions: WatermarkWrite[];
  /** En az bir kaynak tavana takıldı — sonraki tur beklemeden devam etmeli. */
  readonly truncated: boolean;
  /** Birleştirme emniyeti aşıldı → bu projeksiyon TAM gönderilmeli. */
  readonly needsFull: boolean;
}

function positionOf(stored: StoredWatermark | undefined): ScanPosition | null {
  if (!stored?.at) return null;
  return { at: stored.at, tie: stored.tie };
}

function rootColumn(root: RootMapping): string {
  if (root.kind === "self") return "id";
  return root.kind === "column" ? root.column : root.keyColumn;
}

/**
 * Tek kaynak taraması. `(w, bozucu) < (t, bozucu) ∧ t < H` satır değeri karşılaştırması
 * `(filigran, bozucu)` indeksiyle sayfalanır; tavanda kalınan satırın konumu döner.
 */
async function scanSource(
  s: ChangeSource,
  from: ScanPosition | null,
  horizon: Date,
): Promise<{ keys: string[]; next: ScanPosition; truncated: boolean }> {
  const wcol = `"${s.watermark}"`;
  const ties = s.tieBreaker.map((c) => `"${c.column}"`);
  const keyCol = rootColumn(s.root);
  const params: unknown[] = [horizon];
  const conds = [`${wcol} < $1::timestamptz`];
  if (from && from.tie && from.tie.length === s.tieBreaker.length) {
    const ph = [`$${params.length + 1}::timestamptz`];
    params.push(from.at);
    for (let i = 0; i < s.tieBreaker.length; i++) {
      params.push(from.tie[i]);
      ph.push(`$${params.length}::${s.tieBreaker[i]!.cast}`);
    }
    conds.push(`(${[wcol, ...ties].join(", ")}) > (${ph.join(", ")})`);
  } else if (from) {
    params.push(from.at);
    conds.push(`${wcol} >= $${params.length}::timestamptz`);
  }
  if (s.root.kind !== "self") conds.push(`"${keyCol}" IS NOT NULL`);
  params.push(scanLimit);
  const sql =
    `SELECT ${wcol} AS t, ${ties.map((c, i) => `${c}::text AS k${i}`).join(", ")}, "${keyCol}"::text AS v ` +
    `FROM "${s.table}" WHERE ${conds.join(" AND ")} ORDER BY ${[wcol, ...ties].join(", ")} LIMIT $${params.length}`;
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(sql, ...params);
  const keys = rows.map((r) => r.v as string);
  if (rows.length < scanLimit) return { keys, next: { at: horizon, tie: null }, truncated: false };
  const last = rows[rows.length - 1]!;
  return {
    keys,
    next: { at: last.t as Date, tie: s.tieBreaker.map((_, i) => last[`k${i}`] as string) },
    truncated: true,
  };
}

/** Değişen satır anahtarlarını kök kimliklerine çevirir (kaynak eşlemesiyle). */
export async function mapToRoots(root: RootMapping, keys: readonly string[]): Promise<string[]> {
  const uniq = [...new Set(keys)];
  if (uniq.length === 0) return [];
  if (root.kind !== "lookup") return uniq;
  const rows = await prisma.$queryRawUnsafe<Array<{ root_id: string | null }>>(root.sql, uniq);
  return rows.map((r) => r.root_id).filter((x): x is string => x !== null);
}

/** Birleştirmenin taşıdığı satırlar (tablo + kimlik) → kaynağın kök eşlemesi için anahtar. */
async function refKeys(s: ChangeSource, rowIds: readonly string[]): Promise<string[]> {
  const col = rootColumn(s.root);
  if (col === "id" || rowIds.length === 0) return [...rowIds];
  const rows = await prisma.$queryRawUnsafe<Array<{ v: string | null }>>(
    `SELECT "${col}"::text AS v FROM "${s.table}" WHERE "id" = ANY($1::uuid[])`,
    [...rowIds],
  );
  return rows.map((r) => r.v).filter((x): x is string => x !== null);
}

async function scanMarks(
  p: RecordProjection,
  from: ScanPosition | null,
  horizon: Date,
): Promise<{ deleted: string[]; dirty: string[]; next: ScanPosition; truncated: boolean }> {
  const params: unknown[] = [p.root.table, horizon];
  let cond = "";
  if (from?.tie && from.tie.length === 1) {
    params.push(from.at, from.tie[0]);
    cond = ` AND ("createdAt", "id") > ($3::timestamptz, $4::uuid)`;
  } else if (from) {
    params.push(from.at);
    cond = ` AND "createdAt" >= $3::timestamptz`;
  }
  params.push(scanLimit);
  const rows = await prisma.$queryRawUnsafe<Array<{ t: Date; id: string; rowId: string; kind: string }>>(
    `SELECT "createdAt" AS t, "id"::text AS id, "rowId"::text AS "rowId", "kind"::text AS kind FROM "sync_marks" ` +
      `WHERE "tableName" = $1 AND "createdAt" < $2::timestamptz${cond} ORDER BY "createdAt", "id" LIMIT $${params.length}`,
    ...params,
  );
  const deleted = rows.filter((r) => r.kind === "DELETED").map((r) => r.rowId);
  const dirty = rows.filter((r) => r.kind === "DIRTY").map((r) => r.rowId);
  if (rows.length < scanLimit) return { deleted, dirty, next: { at: horizon, tie: null }, truncated: false };
  const last = rows[rows.length - 1]!;
  return { deleted, dirty, next: { at: last.t, tie: [last.id] }, truncated: true };
}

/** Birleştirme defteri: yeni (`createdAt`) ve geri alınan (`revertedAt`) operasyonlar. */
async function scanMerges(
  p: RecordProjection,
  column: "createdAt" | "revertedAt",
  from: ScanPosition | null,
  horizon: Date,
): Promise<{ roots: string[]; next: ScanPosition; truncated: boolean; needsFull: boolean }> {
  const params: unknown[] = [horizon];
  let cond = "";
  if (from?.tie && from.tie.length === 1) {
    params.push(from.at, from.tie[0]);
    cond = ` AND ("${column}", "id") > ($2::timestamptz, $3::uuid)`;
  } else if (from) {
    params.push(from.at);
    cond = ` AND "${column}" >= $2::timestamptz`;
  }
  params.push(scanLimit);
  const ops = await prisma.$queryRawUnsafe<Array<{ t: Date; id: string; entity: string; survivorId: string }>>(
    `SELECT "${column}" AS t, "id"::text AS id, "entity", "survivorId"::text AS "survivorId" FROM "merge_operations" ` +
      `WHERE "${column}" IS NOT NULL AND "${column}" < $1::timestamptz${cond} ORDER BY "${column}", "id" LIMIT $${params.length}`,
    ...params,
  );
  const roots = new Set<string>();
  let needsFull = false;
  if (ops.length > 0) {
    const opIds = ops.map((o) => o.id);
    for (const o of ops) if (MERGE_ENTITY_TABLES[o.entity] === p.root.table) roots.add(o.survivorId);
    if (ops.some((o) => MERGE_ENTITY_TABLES[o.entity] === p.root.table)) {
      const sources = await prisma.mergeOperationSource.findMany({ where: { operationId: { in: opIds } }, select: { sourceId: true, operationId: true } });
      const own = new Set(ops.filter((o) => MERGE_ENTITY_TABLES[o.entity] === p.root.table).map((o) => o.id));
      for (const s of sources) if (own.has(s.operationId)) roots.add(s.sourceId);
    }
    const tables = new Set(p.sources.map((s) => s.table));
    const refs = await prisma.mergeOperationRef.findMany({
      where: { operationId: { in: opIds }, tableName: { in: [...tables] } },
      select: { tableName: true, rowIds: true },
    });
    const total = refs.reduce((n, r) => n + r.rowIds.length, 0);
    if (total > MERGE_FULL_THRESHOLD) needsFull = true;
    else {
      for (const r of refs) {
        for (const s of p.sources.filter((x) => x.table === r.tableName)) {
          for (const id of await mapToRoots(s.root, await refKeys(s, r.rowIds))) roots.add(id);
        }
      }
    }
  }
  if (ops.length < scanLimit) return { roots: [...roots], next: { at: horizon, tie: null }, truncated: false, needsFull };
  const last = ops[ops.length - 1]!;
  return { roots: [...roots], next: { at: last.t, tie: [last.id] }, truncated: true, needsFull };
}

function toWrite(source: string, pos: ScanPosition): WatermarkWrite {
  return { source, at: pos.at, tie: pos.tie };
}

/**
 * Bir projeksiyonun (w, H] değişiklikleri. `stored` onaylı konumlar; hiç konum yoksa
 * çağıran TAM gönderir (bu fonksiyon ilk turda çağrılmaz).
 */
export async function collectProjectionChanges(
  p: RecordProjection,
  stored: ReadonlyMap<string, StoredWatermark>,
  horizon: Date,
): Promise<ProjectionChanges> {
  const dirty = new Set<string>();
  const deleted = new Set<string>();
  const positions: WatermarkWrite[] = [];
  let truncated = false;
  let needsFull = false;

  for (const s of p.sources) {
    const key = wmKey.source(p.name, s.table, s.watermark);
    const r = await scanSource(s, positionOf(stored.get(key)), horizon);
    for (const id of await mapToRoots(s.root, r.keys)) dirty.add(id);
    positions.push(toWrite(key, r.next));
    truncated ||= r.truncated;
  }

  const marksKey = wmKey.marks(p.name);
  const m = await scanMarks(p, positionOf(stored.get(marksKey)), horizon);
  for (const id of m.deleted) deleted.add(id);
  for (const id of m.dirty) dirty.add(id);
  positions.push(toWrite(marksKey, m.next));
  truncated ||= m.truncated;

  for (const column of ["createdAt", "revertedAt"] as const) {
    const key = wmKey.merge(p.name, column);
    const r = await scanMerges(p, column, positionOf(stored.get(key)), horizon);
    for (const id of r.roots) dirty.add(id);
    positions.push(toWrite(key, r.next));
    truncated ||= r.truncated;
    needsFull ||= r.needsFull;
  }

  for (const c of p.crossings ?? []) {
    const key = wmKey.source(p.name, `gecis-${c.name}`, "zaman");
    const from = stored.get(key)?.at ?? horizon;
    if (from < horizon) {
      const rows = await prisma.$queryRawUnsafe<Array<{ root_id: string | null }>>(c.sql, from, horizon);
      for (const r of rows) if (r.root_id) dirty.add(r.root_id);
    }
    positions.push({ source: key, at: horizon, tie: null });
  }

  for (const id of deleted) dirty.delete(id);
  return { projection: p, dirty, deleted, positions, truncated, needsFull };
}

/**
 * TAM gönderimden sonra her kaynak ufukta başlar: TAM, kökün ufuktaki (ve sonrasındaki)
 * hâlini okumuştur; sonraki tur (H, H'] aralığını tarar (örtüşme zararsız, bulut idempotent).
 */
export function positionsAfterFull(p: RecordProjection, horizon: Date): WatermarkWrite[] {
  const out: WatermarkWrite[] = [];
  for (const s of p.sources) out.push({ source: wmKey.source(p.name, s.table, s.watermark), at: horizon, tie: null });
  out.push({ source: wmKey.marks(p.name), at: horizon, tie: null });
  out.push({ source: wmKey.merge(p.name, "createdAt"), at: horizon, tie: null });
  out.push({ source: wmKey.merge(p.name, "revertedAt"), at: horizon, tie: null });
  for (const c of p.crossings ?? []) out.push({ source: wmKey.source(p.name, `gecis-${c.name}`, "zaman"), at: horizon, tie: null });
  return out;
}
