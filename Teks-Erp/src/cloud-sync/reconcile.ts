// KÜME ÖZETİ (§4.4 günlük uzlaştırma · §6.5 TAM): bir KAYIT projeksiyonunun buluta girmesi
// gereken kök kimlikleri. Kural tel sözleşmesindedir (`RECONCILE_PARENTS` başlığı) ve bulut AYNISINI
// uygular: kapsam ∧ kendi saklaması ∧ ebeveyn kümede − bekleyen. Tetikleyici birincil silme yoludur;
// uzlaştırma onun kurulmadığı/düştüğü hâli (elle restore) yakalar.
import prisma from "../lib/prisma";
import { findRecordProjection } from "./projections";
import type { RecordProjection } from "./projection-types";
import { MAX_RECONCILE_PENDING, RECONCILE_PARENTS } from "./wire";

export interface MembershipBounds {
  /** Bulutun saklama ufku (`ufukTarihi`) — kökün ve ebeveyninin saklama tarihine birlikte uygulanır. */
  readonly retentionFrom: Date | null;
  /** Bekleyen sınırı: bu andan sonra doğan kök bulutta henüz olmayabilir (son onaylı ufuk). null = ayrım yok (TAM). */
  readonly createdBefore: Date | null;
  /** Ebeveynin son onaylı ufku: ebeveyni bundan sonra doğan çocuk da bekleyendir. */
  readonly parentCreatedBefore?: Date | null;
}

/** Ebeveynin `t` takma adlı SQL parçası alt sorguda `q`ya taşınır; başka `t.` başvurusu kalırsa kural kurulamaz. */
function rebaseToParentAlias(sql: string): string {
  const out = sql.replace(/\bt\."/g, 'q."');
  if (/\bt\./.test(out)) throw new Error(`Ebeveyn SQL parçası taşınamadı (t. başvurusu kaldı): ${sql}`);
  return out;
}

interface ParentLink {
  readonly table: string;
  readonly fk: string;
  readonly projection: RecordProjection;
}

export function parentLinkOf(p: RecordProjection): ParentLink | null {
  const rule = RECONCILE_PARENTS[p.name];
  if (!rule) return null;
  const parent = findRecordProjection(rule.parent);
  const fk = p.columns.find((c) => c.wire === rule.field)?.source;
  if (!parent || !fk) throw new Error(`Uzlaştırma ebeveyni çözülemedi: ${p.name} → ${rule.parent}.${rule.field}`);
  return { table: parent.root.table, fk, projection: parent };
}

function memberWhere(p: RecordProjection, b: MembershipBounds, params: unknown[]): string {
  const conds: string[] = ["TRUE"];
  if (p.scope) conds.push(`(${p.scope.sql})`);
  if (p.retention && b.retentionFrom) {
    params.push(b.retentionFrom);
    conds.push(`(${p.retention.sql}) >= $${params.length}::timestamptz`);
  }
  const link = parentLinkOf(p);
  if (link) {
    const q = link.projection;
    const inner = [`q."id" = t."${link.fk}"`];
    if (q.scope) inner.push(`(${rebaseToParentAlias(q.scope.sql)})`);
    if (q.retention && b.retentionFrom) {
      params.push(b.retentionFrom);
      inner.push(`(${rebaseToParentAlias(q.retention.sql)}) >= $${params.length}::timestamptz`);
    }
    conds.push(`EXISTS (SELECT 1 FROM "${link.table}" q WHERE ${inner.join(" AND ")})`);
  }
  return conds.join(" AND ");
}

/** Bekleyen yüklemi (kök ya da ebeveyn son onaylı ufuktan sonra doğdu); sınır yoksa `FALSE`. */
function pendingWhere(p: RecordProjection, b: MembershipBounds, params: unknown[]): string {
  if (!b.createdBefore) return "FALSE";
  params.push(b.createdBefore);
  const conds = [`t."createdAt" >= $${params.length}::timestamptz`];
  const link = parentLinkOf(p);
  if (link && b.parentCreatedBefore) {
    params.push(b.parentCreatedBefore);
    conds.push(`EXISTS (SELECT 1 FROM "${link.table}" q WHERE q."id" = t."${link.fk}" AND q."createdAt" >= $${params.length}::timestamptz)`);
  }
  return `(${conds.join(" OR ")})`;
}

/** Kümeye giren kök kimlikleri (uuid sırasıyla) — TAM gönderimin sayfa listesi (bekleyen ayrımı yok). */
export async function membershipIds(p: RecordProjection, b: MembershipBounds): Promise<string[]> {
  const params: unknown[] = [];
  const where = memberWhere(p, b, params);
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT t."id"::text AS id FROM "${p.root.table}" t WHERE ${where} ORDER BY t."id"`,
    ...params,
  );
  return rows.map((r) => r.id);
}

export interface MembershipDigest {
  readonly count: number;
  readonly digest: string;
  /** Kümeden ayrılan bekleyen kökler (bulut bunları kendi kümesinden dışlar). */
  readonly pending: string[];
  /** Bekleyen `MAX_RECONCILE_PENDING`i aştı: bu projeksiyon bugün uzlaştırılmaz. */
  readonly pendingOverflow: boolean;
}

/**
 * `(adet, md5(string_agg(id::text, ',' ORDER BY id)))` bekleyenler DIŞINDA — bulut kendi canlı kümesini AYNI
 * biçimde (uuid tip sırası, virgül, küçük harf metin) özetler; boş küme `md5('')`.
 */
export async function membershipDigest(p: RecordProjection, b: MembershipBounds): Promise<MembershipDigest> {
  const params: unknown[] = [];
  const where = memberWhere(p, b, params);
  const pending = pendingWhere(p, b, params);
  const rows = await prisma.$queryRawUnsafe<Array<{ n: number; d: string }>>(
    `SELECT count(*)::int AS n, md5(COALESCE(string_agg(t."id"::text, ',' ORDER BY t."id"), '')) AS d FROM "${p.root.table}" t WHERE ${where} AND NOT ${pending}`,
    ...params,
  );
  const pendingRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT t."id"::text AS id FROM "${p.root.table}" t WHERE ${where} AND ${pending} ORDER BY t."id" LIMIT ${MAX_RECONCILE_PENDING + 1}`,
    ...params,
  );
  const r = rows[0];
  const overflow = pendingRows.length > MAX_RECONCILE_PENDING;
  return { count: r?.n ?? 0, digest: r?.d ?? "", pending: overflow ? [] : pendingRows.map((x) => x.id), pendingOverflow: overflow };
}
