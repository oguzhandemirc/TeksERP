// =============================================================================
// Audit hash zinciri — DOĞRULAMA ve KORUMA DÜZEYİ (G4, 2026-10-13)
// =============================================================================
// Zinciri DB yazar (trigger `audit_zincir_bagla`, migration 20261013120000); bu
// dosya yalnız OKUR: satırları canlı ∪ arşivde sıraya dizer, her satırın özetini
// TEK kaynak `audit_zincir_ozet` ile yeniden hesaplar. Audit ayak izidir; buradan
// iş kararı türetilmez — sonuç yalnız bir insana (uç, sağlık ekranı) gösterilir.
// =============================================================================

import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AUDIT_TAMPER_SQL } from "../lib/audit-koruma-sql";
import { AuditService } from "./audit.service";

/** Zincir trigger'ının advisory kilit uzayı. Kilidi DB trigger'ı alır (migration
 *  20261013120000 `pg_advisory_xact_lock(8039, 0)`); sabit envanter içindir ve
 *  `test_audit_hash_zinciri` migration'daki sayıyla eşitliğini ölçer. */
export const AUDIT_CHAIN_LOCK_NS: number = 8039;

export const AUDIT_CHAIN_CHECK_KEY = "audit.chainCheck";
export const AUDIT_CHAIN_HEAD_KEY = "audit.chainVerifiedHead";
const GENESIS = "0".repeat(64);
const BATCH = 20000;
const MAX_FINDINGS = 50;

export type AuditChainFindingKind =
  | "SIRA_BOSLUGU" // ara satır silinmiş
  | "CIFT_SIRA" // aynı sıra iki kez (kopya/yeniden yazım)
  | "OZET_UYUSMAZ" // satır içeriği ya da özeti değiştirilmiş
  | "BAS_KESIK" // zincirin başı kesit çapası olmadan silinmiş
  | "KUYRUK_KAYIP" // son doğrulanan satır silinmiş/değişmiş
  | "ZINCIRSIZ_SATIR"; // zincir başladıktan sonra trigger'ı atlayan satır

export interface AuditChainFinding {
  kind: AuditChainFindingKind;
  seq: number | null;
  detail?: string;
}

export interface AuditChainReport {
  durum: "saglam" | "kurcalanmis" | "zincir-yok";
  kontrolAni: string;
  ilkSira: number | null;
  sonSira: number | null;
  kontrolEdilen: number;
  bulgular: AuditChainFinding[];
  /** Pencere/limit yüzünden yarıda kaldıysa true (sonuç kısmi, hüküm verilmez). */
  yarim: boolean;
}

type Db = Pick<typeof prisma, "$queryRaw" | "systemSetting">;

const COLS = Prisma.sql`"chainSeq", "chainHash", "id", "userId", "category"::text AS category, "action",
  "tableName", "recordId", "ipAddress", "deviceId", "requestId", "createdAt", "oldData", "newData", "changes"`;

function union(where: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`SELECT ${COLS} FROM system_logs WHERE ${where}
    UNION ALL SELECT ${COLS} FROM system_log_archives WHERE ${where}`;
}

async function rowHash(db: Db, seq: number): Promise<string | null> {
  const r = await db.$queryRaw<Array<{ h: string | null }>>(Prisma.sql`
    SELECT "chainHash" AS h FROM (${union(Prisma.sql`"chainSeq" = ${seq}`)}) u LIMIT 1`);
  return r[0]?.h ?? null;
}

/** Tam modda kuyruk çapası + zincirsiz satır denetimi. */
async function tailFindings(db: Db, mn: number, mx: number): Promise<AuditChainFinding[]> {
  const bulgular: AuditChainFinding[] = [];
  // Kuyruk çapası: son sağlam doğrulamanın başı hâlâ yerinde mi?
  const cRow = await db.systemSetting.findUnique({ where: { key: AUDIT_CHAIN_HEAD_KEY } });
  const capa = cRow?.value as { seq?: number; hash?: string } | null | undefined;
  if (capa && typeof capa.seq === "number" && typeof capa.hash === "string") {
    if (capa.seq > mx) bulgular.push({ kind: "KUYRUK_KAYIP", seq: capa.seq, detail: `son sıra ${mx}` });
    else if (capa.seq >= mn && (await rowHash(db, capa.seq)) !== capa.hash) {
      bulgular.push({ kind: "KUYRUK_KAYIP", seq: capa.seq, detail: "çapa satırının özeti değişmiş" });
    }
  }
  // Zincirin en eski satırından (normalde başlangıç çapası) sonra zincirsiz satır = trigger atlatılmış.
  const zs = await db.$queryRaw<Array<{ n: number }>>(Prisma.sql`
    SELECT count(*)::int AS n FROM system_logs l
    WHERE l."chainSeq" IS NULL AND l."createdAt" > (
      SELECT min(u."createdAt") FROM (${union(Prisma.sql`"chainSeq" IS NOT NULL`)}) u)`);
  if ((zs[0]?.n ?? 0) > 0) bulgular.push({ kind: "ZINCIRSIZ_SATIR", seq: null, detail: `${zs[0]!.n} satır` });
  return bulgular;
}

/**
 * Zinciri doğrular. `fromSeq/toSeq` verilirse yalnız o aralık (önceki satırın
 * özeti bağlanır; çapa ve zincirsiz-satır denetimi atlanır — bekçi aralığı).
 * `devamEt` false dönerse partiler arasında durur (gece bakım penceresi).
 */
export async function verifyAuditChain(
  opts: { fromSeq?: number; toSeq?: number; devamEt?: () => boolean } = {},
  db: Db = prisma,
): Promise<AuditChainReport> {
  const checkedAt = new Date().toISOString();
  const aralik = opts.fromSeq !== undefined;
  const sinir = await db.$queryRaw<Array<{ mn: number | null; mx: number | null }>>(Prisma.sql`
    SELECT min("chainSeq")::int AS mn, max("chainSeq")::int AS mx FROM (${union(Prisma.sql`"chainSeq" IS NOT NULL`)}) u`);
  const mn = sinir[0]?.mn ?? null;
  const mx = sinir[0]?.mx ?? null;
  const bulgular: AuditChainFinding[] = [];
  if (mn === null || mx === null) {
    return { durum: "zincir-yok", kontrolAni: checkedAt, ilkSira: null, sonSira: null, kontrolEdilen: 0, bulgular, yarim: false };
  }
  const bas = aralik ? Math.max(opts.fromSeq!, mn) : mn;
  const son = opts.toSeq !== undefined ? Math.min(opts.toSeq, mx) : mx;

  // Başın önceki özeti: sıra 1 → genesis · aralık → bir önceki satır · aksi → kesit çapası.
  let prevHash: string | null;
  if (bas === 1) prevHash = GENESIS;
  else if (aralik) prevHash = await rowHash(db, bas - 1);
  else {
    const kesit = await db.$queryRaw<Array<{ h: string | null }>>(Prisma.sql`
      SELECT "newData"->>'throughHash' AS h FROM (${union(Prisma.sql`"action" = 'AUDIT_CHAIN_CUT'
        AND "chainSeq" IS NOT NULL AND ("newData"->>'throughSeq') = ${String(bas - 1)}`)}) u LIMIT 1`);
    prevHash = kesit[0]?.h ?? null;
  }
  if (prevHash === null) {
    bulgular.push({ kind: "BAS_KESIK", seq: bas, detail: `sıra ${bas - 1} ve öncesi kesit çapası olmadan yok` });
  }

  let prevSeq = bas - 1;
  let checkedCount = 0;
  let yarim = false;
  for (let lo = bas; lo <= son; lo += BATCH) {
    if (opts.devamEt && !opts.devamEt()) { yarim = true; break; }
    const hi = Math.min(lo + BATCH - 1, son);
    const where = Prisma.sql`"chainSeq" BETWEEN ${lo} AND ${hi}`;
    const sorunlar = await db.$queryRaw<Array<{ seq: number; ps: number; kind: AuditChainFindingKind }>>(Prisma.sql`
      WITH w AS (
        SELECT u."chainSeq" AS seq, u."chainHash" AS h,
          coalesce(lag(u."chainSeq") OVER o, ${prevSeq}::int) AS ps,
          coalesce(lag(u."chainHash") OVER o, ${prevHash}::text) AS ph,
          audit_zincir_ozet(coalesce(lag(u."chainHash") OVER o, ${prevHash}::text), u."chainSeq", u."id",
            u."userId", u.category, u."action", u."tableName", u."recordId", u."ipAddress",
            u."deviceId", u."requestId", u."createdAt", u."oldData", u."newData", u."changes") AS calc
        FROM (${union(where)}) u
        WINDOW o AS (ORDER BY u."chainSeq")
      )
      SELECT seq, ps, CASE
          WHEN seq = ps THEN 'CIFT_SIRA'
          WHEN seq <> ps + 1 THEN 'SIRA_BOSLUGU'
          WHEN ph IS NOT NULL AND calc IS DISTINCT FROM h THEN 'OZET_UYUSMAZ'
        END AS kind
      FROM w
      WHERE seq = ps OR seq <> ps + 1 OR (ph IS NOT NULL AND calc IS DISTINCT FROM h)
      ORDER BY seq LIMIT ${MAX_FINDINGS}`);
    for (const s of sorunlar) {
      if (bulgular.length >= MAX_FINDINGS) break;
      bulgular.push({
        kind: s.kind, seq: s.seq,
        detail: s.kind === "SIRA_BOSLUGU" ? `sıra ${s.ps + 1}..${s.seq - 1} yok` : undefined,
      });
    }
    const lastRow = await db.$queryRaw<Array<{ seq: number; h: string; n: number }>>(Prisma.sql`
      SELECT max("chainSeq")::int AS seq, (array_agg("chainHash" ORDER BY "chainSeq" DESC))[1] AS h, count(*)::int AS n
      FROM (${union(where)}) u HAVING count(*) > 0`);
    if (lastRow[0]) {
      prevSeq = lastRow[0].seq;
      prevHash = lastRow[0].h;
      checkedCount += lastRow[0].n;
    }
  }

  if (!aralik && !yarim) bulgular.push(...(await tailFindings(db, mn, mx)));

  return {
    durum: bulgular.length === 0 ? "saglam" : "kurcalanmis",
    kontrolAni: checkedAt, ilkSira: bas, sonSira: son, kontrolEdilen: checkedCount, bulgular: bulgular.slice(0, MAX_FINDINGS), yarim,
  };
}

/** Tam doğrulama + resultu kaydet (gece bakımı ve elle uç). Sağlamsa kuyruk çapası ilerler;
 *  kurcalanmışsa `AUDIT_CHAIN_BROKEN` olayı (tek boğaz: iki çağıran da buradan geçer). */
export async function verifyAndRecordAuditChain(
  opts: { devamEt?: () => boolean; userId?: string | null } = {},
): Promise<AuditChainReport> {
  const r = await verifyAuditChain({ devamEt: opts.devamEt });
  if (r.yarim) return r;
  if (r.durum === "kurcalanmis") {
    await AuditService.logEvent({
      category: "SYSTEM",
      action: "AUDIT_CHAIN_BROKEN",
      userId: opts.userId ?? null,
      payload: { bulgular: r.bulgular.slice(0, 10), ilkSira: r.ilkSira, sonSira: r.sonSira },
    });
  }
  const value = JSON.parse(JSON.stringify(r)) as Prisma.InputJsonValue;
  await prisma.systemSetting.upsert({
    where: { key: AUDIT_CHAIN_CHECK_KEY },
    create: { key: AUDIT_CHAIN_CHECK_KEY, value, description: "Audit hash zincirinin son doğrulama resultu" },
    update: { value },
  });
  if (r.durum === "saglam" && r.sonSira !== null) {
    const hash = await rowHash(prisma, r.sonSira);
    const head = { seq: r.sonSira, hash } as Prisma.InputJsonValue;
    await prisma.systemSetting.upsert({
      where: { key: AUDIT_CHAIN_HEAD_KEY },
      create: { key: AUDIT_CHAIN_HEAD_KEY, value: head, description: "Audit zincirinde son sağlam doğrulanan satır (kuyruk çapası)" },
      update: { value: head },
    });
  }
  return r;
}

export async function readLastAuditChainReport(): Promise<AuditChainReport | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: AUDIT_CHAIN_CHECK_KEY } });
  return (row?.value as AuditChainReport | null | undefined) ?? null;
}

export interface AuditProtection {
  /** "tam" = uygulama rolü audit'te yalnız ekleyebilir VE zincir son doğrulamada sağlam. */
  level: "tam" | "kismi";
  /** Uygulama rolü UPDATE/DELETE/TRUNCATE yapamıyor ve tablo sahibi/süper değil. */
  writeOnly: boolean;
  chain: { durum: AuditChainReport["durum"]; kontrolAni: string } | null;
}

/** Sağlık ekranı için: DB rolünün audit üzerindeki fiili yetkisi + son zincir resultu. */
export async function readAuditProtection(): Promise<AuditProtection> {
  const rows = await prisma.$queryRawUnsafe<Array<{ tamper: boolean }>>(AUDIT_TAMPER_SQL);
  const writeOnly = rows[0] ? !rows[0].tamper : false;
  const last = await readLastAuditChainReport();
  const chain = last ? { durum: last.durum, kontrolAni: last.kontrolAni } : null;
  return { level: writeOnly && chain?.durum === "saglam" ? "tam" : "kismi", writeOnly, chain };
}
