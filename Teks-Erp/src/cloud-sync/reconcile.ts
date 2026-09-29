// KÜME ÖZETİ (§4.4 günlük uzlaştırma · §6.5 TAM): bir KAYIT projeksiyonunun buluta girmesi
// gereken kök kimlikleri — kapsam yüklemi (SQL ikizi) + bulutun saklama ufku. Tetikleyici
// birincil silme yoludur; uzlaştırma onun kurulmadığı/düştüğü hâli (elle restore) yakalar.
import prisma from "../lib/prisma";
import type { RecordProjection } from "./projections";

export interface MembershipBounds {
  /** Bulutun saklama ufku (`ufukTarihi`) — OLGU'da bu tarihten eskiler gönderilmez/sayılmaz. */
  readonly retentionFrom: Date | null;
  /** Yalnız bu andan ÖNCE doğmuş satırlar (uzlaştırma: son onaylı ufuk — sonraki doğumlar bulutta henüz yok). */
  readonly createdBefore: Date | null;
}

function membershipWhere(p: RecordProjection, b: MembershipBounds, params: unknown[]): string {
  const conds: string[] = ["TRUE"];
  if (p.scope) conds.push(`(${p.scope.sql})`);
  if (p.retention && b.retentionFrom) {
    params.push(b.retentionFrom);
    conds.push(`(${p.retention.sql}) >= $${params.length}::timestamptz`);
  }
  if (b.createdBefore) {
    params.push(b.createdBefore);
    conds.push(`t."createdAt" < $${params.length}::timestamptz`);
  }
  return conds.join(" AND ");
}

/** Kümeye giren kök kimlikleri (uuid sırasıyla) — TAM gönderimin sayfa listesi. */
export async function membershipIds(p: RecordProjection, b: MembershipBounds): Promise<string[]> {
  const params: unknown[] = [];
  const where = membershipWhere(p, b, params);
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT t."id"::text AS id FROM "${p.root.table}" t WHERE ${where} ORDER BY t."id"`,
    ...params,
  );
  return rows.map((r) => r.id);
}

/**
 * `(adet, md5(string_agg(id::text, ',' ORDER BY id)))` — bulut kendi canlı kümesini AYNI
 * biçimde (uuid tip sırası, virgül, küçük harf metin) özetler; boş küme `md5('')`.
 */
export async function membershipDigest(p: RecordProjection, b: MembershipBounds): Promise<{ count: number; digest: string }> {
  const params: unknown[] = [];
  const where = membershipWhere(p, b, params);
  const rows = await prisma.$queryRawUnsafe<Array<{ n: number; d: string }>>(
    `SELECT count(*)::int AS n, md5(COALESCE(string_agg(t."id"::text, ',' ORDER BY t."id"), '')) AS d FROM "${p.root.table}" t WHERE ${where}`,
    ...params,
  );
  const r = rows[0];
  return { count: r?.n ?? 0, digest: r?.d ?? "" };
}
