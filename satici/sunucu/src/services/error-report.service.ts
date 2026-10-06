// HATA RAPORU (fabrika tarafı): `POST /v1/hata-raporu` müşteri onaylı, kişisel verisiz hata GRUPLARINI alır
// (kurulum imzalı, KATI gövde). Grup anahtarı gövdeden YENİDEN hesaplanır; aynı `partiId` sayacı ikinci kez
// artırmaz; kurulum başına grup tavanı dolunca yeni grup alınmaz. İki tablo da TELEMETRİdir (budanır).
import { errorReportGroupKey, type ErrorReportRequest, type ErrorReportResponse } from "../lisans-protokol";
import { lockInstallation } from "../lib/locks";
import { prisma, type Db } from "../lib/prisma";
import type { AuthenticatedRequest } from "./installation-auth";

const INT_MAX = 2_147_483_647;

export async function acceptErrorReport(auth: AuthenticatedRequest, body: ErrorReportRequest, maxGroups: number): Promise<ErrorReportResponse> {
  const kurulumId = auth.installation.id;
  const kabul = await prisma.$transaction(async (tx) => {
    await lockInstallation(tx, kurulumId);
    const seen = await tx.hataRaporuPartisi.findUnique({ where: { kurulumId_partiId: { kurulumId, partiId: body.partiId } }, select: { kabul: true } });
    if (seen) return seen.kabul;
    // Aynı partide aynı grup iki satır gelirse tek grupta birleşir (sayılar toplanır).
    const merged = new Map<string, ErrorReportRequest["kayitlar"][number]>();
    for (const e of body.kayitlar) {
      const key = errorReportGroupKey(e);
      const prev = merged.get(key);
      merged.set(key, prev ? { ...prev, sayi: Math.min(prev.sayi + e.sayi, INT_MAX), ilk: prev.ilk < e.ilk ? prev.ilk : e.ilk, son: prev.son > e.son ? prev.son : e.son } : e);
    }
    const keys = [...merged.keys()];
    const existing = new Set(
      (await tx.hataRaporuGrubu.findMany({ where: { kurulumId, grupAnahtari: { in: keys } }, select: { grupAnahtari: true } })).map((r) => r.grupAnahtari),
    );
    let room = Math.max(0, maxGroups - (await tx.hataRaporuGrubu.count({ where: { kurulumId } })));
    let accepted = 0;
    for (const [key, e] of merged) {
      if (!existing.has(key)) {
        if (room === 0) continue;
        room--;
      }
      const ilk = new Date(e.ilk);
      const son = new Date(e.son);
      await tx.$executeRaw`
        INSERT INTO hata_raporu_grubu (id, "kurulumId", "grupAnahtari", kaynak, surum, kod, sinif, bilesen, yol, yigin, sayi, ilk, son, "createdAt", "updatedAt")
        VALUES (gen_random_uuid(), ${kurulumId}::uuid, ${key}, ${e.kaynak}, ${e.surum}, ${e.kod}, ${e.sinif}, ${e.bilesen}, ${e.yol},
                ${e.yigin}::varchar(160)[], ${e.sayi}, ${ilk}, ${son}, now(), now())
        ON CONFLICT ("kurulumId", "grupAnahtari") DO UPDATE SET
          sayi = LEAST(hata_raporu_grubu.sayi::bigint + EXCLUDED.sayi, ${INT_MAX})::int,
          ilk = LEAST(hata_raporu_grubu.ilk, EXCLUDED.ilk),
          son = GREATEST(hata_raporu_grubu.son, EXCLUDED.son),
          "updatedAt" = now()`;
      accepted++;
    }
    await tx.hataRaporuPartisi.create({
      data: { kurulumId, partiId: body.partiId, kayitSayisi: body.kayitlar.length, kabul: accepted, dusurulen: body.dusurulen },
    });
    return accepted;
  });
  return { v: 1, partiId: body.partiId, kabul };
}

/** Portal: kurulum başına özet (grup sayısı, toplam hata, son görülme) — en son hata alan kurulum önce. */
export async function errorReportSummary(db: Db, g: { limit: number }) {
  const rows = await db.hataRaporuGrubu.groupBy({
    by: ["kurulumId"],
    _count: { _all: true },
    _sum: { sayi: true },
    _max: { son: true },
    orderBy: [{ _max: { son: "desc" } }, { kurulumId: "asc" }],
    take: g.limit,
  });
  const installations = await db.kurulum.findMany({
    where: { id: { in: rows.map((r) => r.kurulumId) } },
    select: { id: true, kurulumId: true, ad: true, tesis: { select: { ad: true, musteri: { select: { id: true, ad: true } } } } },
  });
  const byId = new Map(installations.map((k) => [k.id, k]));
  return rows.map((r) => ({
    kurulum: byId.get(r.kurulumId) ?? null,
    grupSayisi: r._count._all,
    toplam: r._sum.sayi ?? 0,
    sonGorulme: r._max.son,
  }));
}

/** Portal: bir kurulumun hata grupları (son görülme sırasıyla; kaynak süzmesi sunucuda). */
export async function listErrorReportGroups(db: Db, g: { installationDbId: string; source?: string; limit: number }) {
  return db.hataRaporuGrubu.findMany({
    where: { kurulumId: g.installationDbId, ...(g.source ? { kaynak: g.source } : {}) },
    orderBy: [{ son: "desc" }, { id: "desc" }],
    take: g.limit,
    select: { id: true, kaynak: true, surum: true, kod: true, sinif: true, bilesen: true, yol: true, yigin: true, sayi: true, ilk: true, son: true },
  });
}

/** Budama (telemetri): grup son görülmesinden, parti doğuşundan saklama günü sonra silinir. */
export async function pruneErrorReports(nowMs: number, keepDays: number): Promise<number> {
  const before = new Date(nowMs - keepDays * 86_400_000);
  const groups = await prisma.hataRaporuGrubu.deleteMany({ where: { son: { lt: before } } });
  const batches = await prisma.hataRaporuPartisi.deleteMany({ where: { createdAt: { lt: before } } });
  return groups.count + batches.count;
}
