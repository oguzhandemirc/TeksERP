// =============================================================================
// GÖVDE NO → GÖVDE KARTI eşleştirici — TEK boğaz (devere S3)
// =============================================================================
// Önce birebir (büyük/küçük harf duyarsız, bugünkü yüklem); yoksa ve esnek eşleşme açıksa saf kural
// `utils/beam-body-no.ts` ile normalize eşleşme. Çözüm ucu (`resolveBeamBody`), kayıt çakışma uyarısı ve
// `scripts/fix_beam_body_from_physical_no.ts` bu dosyadan geçer — ikinci kural yazılmaz.
// =============================================================================
import type { Prisma } from "@prisma/client";
import { beamBodyNoLooseMatch } from "../../utils/beam-body-no";

type Db = Pick<Prisma.TransactionClient, "beamBody">;

export type BeamBodyNoMatchedBy = "EXACT" | "NORMALIZED";
export interface BeamBodyNoMatch {
  ids: string[];
  matchedBy: BeamBodyNoMatchedBy;
}

/** Birebir eşleşen gövde kimlikleri (katlanmış eşitlik — kayıt kapısının tekillik yüklemi). */
async function exactIds(db: Db, no: string): Promise<string[]> {
  const rows = await db.beamBody.findMany({ where: { bodyNo: { equals: no, mode: "insensitive" } }, select: { id: true }, orderBy: { bodyNo: "asc" } });
  return rows.map((r) => r.id);
}

/** Normalize eşleşen gövdeler (birebir dahil). Gövde envanteri küçüktür (yüzler); iki kolon okunur, süzme bellekte. */
export async function looseMatchBeamBodies(db: Db, no: string): Promise<Array<{ id: string; bodyNo: string }>> {
  const rows = await db.beamBody.findMany({ select: { id: true, bodyNo: true }, orderBy: { bodyNo: "asc" } });
  return rows.filter((r) => beamBodyNoLooseMatch(no, r.bodyNo));
}

/**
 * Gövde no → kimlikler. Birebir varsa `EXACT` (esnek kural hiç koşmaz → ayar kapalıyla bayt-aynı);
 * yoksa `loose` açıkken normalize adaylar `NORMALIZED`. Boş dizi = eşleşme yok; birden çok = çağıran karar verir.
 */
export async function matchBeamBodyNo(db: Db, raw: string, opts: { loose: boolean }): Promise<BeamBodyNoMatch> {
  const no = raw.trim();
  if (!no) return { ids: [], matchedBy: "EXACT" };
  const exact = await exactIds(db, no);
  if (exact.length > 0 || !opts.loose) return { ids: exact, matchedBy: "EXACT" };
  return { ids: (await looseMatchBeamBodies(db, no)).map((r) => r.id), matchedBy: "NORMALIZED" };
}
