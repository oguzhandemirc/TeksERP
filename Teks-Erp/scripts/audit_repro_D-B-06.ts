// =============================================================================
// AUDIT REPRO — D-B-06: Ad-mükerrer guard'ı (`assertNameNotDuplicate`) bir
//   CHECK-THEN-ACT'tir; kilitsizdir. DB seddi OLMAYAN tablolarda N paralel
//   create AYNI adla N satır üretir.
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER.
// Beklenen (sağlıklı sistem): N paralel istekten tam 1'i başarılı; diğerleri 409.
// Ölçüm: §1 `quality_grades` (DB'de nameFold UNIQUE **YOK** — saha+dev)
//        §2 `items`          (dev'de partial UNIQUE VAR, SAHADA YOK — yumuşak kapı)
//   §2'de P2002 görülmesi, uygulama guard'ının yarışı KAPATMADIĞININ ispatıdır:
//   ikinci INSERT guard'ı geçmiş, yalnız DB seddi durdurmuştur. Sahada o sed
//   olmadığı için aynı yarış sessiz bir mükerrer üretir.
// Gözlenen: çalıştırınca doldur — log audit/repro/D-B-06.log
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_D-B-06.ts
// =============================================================================
import "dotenv/config";
function devDbGuard(): void {
  const url = process.env.DATABASE_URL ?? "";
  if ((process.env.NODE_ENV ?? "") === "production" || (process.env.APP_ENV ?? "") === "production")
    throw new Error("REPRO: production ortamında koşturulamaz");
  let host = "", db = "";
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    db = decodeURIComponent(u.pathname.replace(/^\//, ""));
  } catch { throw new Error("REPRO: DATABASE_URL çözümlenemedi (fail-closed)"); }
  if (!["localhost", "127.0.0.1", "::1"].includes(host))
    throw new Error(`REPRO: yerel olmayan host reddedildi: ${host}`);
  if (/saha|prod|canli|sahin/i.test(db) && db !== "adnansahin_db")
    throw new Error(`REPRO: prod kopyası/prod adı reddedildi: ${db}`);
}
devDbGuard();

import { randomUUID } from "crypto";
import prisma from "../src/lib/prisma";
import { qualityGradeService } from "../src/routes/quality-grade.routes";
import { itemService } from "../src/routes/item.routes";

const STAMP = `AUDITREPRO-D-B-06-${randomUUID().slice(0, 6).toUpperCase()}`;
let fail = 0;
const ok = (m: string) => console.log(`✅ ${m}`);
const bad = (m: string) => { fail++; console.log(`❌ ${m}`); };
const info = (m: string) => console.log(`   ${m}`);

interface Attempt { okCount: number; errs: string[] }

async function race(n: number, fn: (i: number) => Promise<unknown>): Promise<Attempt> {
  const res = await Promise.allSettled(Array.from({ length: n }, (_, i) => fn(i)));
  const errs = res
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => {
      const e = r.reason as { code?: string; message?: string; statusCode?: number };
      return `${e?.code ?? e?.statusCode ?? "?"}: ${String(e?.message ?? r.reason).slice(0, 90)}`;
    });
  return { okCount: res.filter((r) => r.status === "fulfilled").length, errs };
}

async function main(): Promise<void> {
  console.log(`\n=== AUDIT REPRO D-B-06 — ad-mükerrer yarışı (${STAMP}) ===\n`);
  const user = await prisma.user.findFirst({ where: { isActive: true }, select: { id: true } });

  // ── §1 QualityGrade — DB'de nameFold UNIQUE YOK (saha ve dev) ────────────
  for (const N of [2, 5, 10]) {
    const name = `${STAMP} KALITE ${N}`;
    const r = await race(N, (i) =>
      qualityGradeService.create(
        { code: `AR6${N}${i}${STAMP.slice(-4)}`, name, targetStatus: "WAREHOUSE" } as never,
        user?.id,
      ),
    );
    // Ölçüm COMMIT SONRASI, DB'DEN.
    const rows = await prisma.qualityGrade.count({ where: { name } });
    const line = `quality_grades · N=${N} → başarılı ${r.okCount}, DB'de ${rows} satır`;
    if (rows > 1) bad(`${line} → AYNI ADLA ${rows} KALİTE SINIFI (mükerrer)`);
    else ok(`${line}`);
    if (r.errs.length) info(`  reddedilenler: ${r.errs.slice(0, 3).join(" | ")}`);
  }

  // ── §2 Item — dev'de partial UNIQUE VAR, SAHADA YOK ──────────────────────
  console.log("");
  for (const N of [2, 5]) {
    const name = `${STAMP} KUMAS ${N}`;
    const r = await race(N, (i) =>
      itemService.create({ code: `AR6I${N}${i}${STAMP.slice(-4)}`, name, itemType: "FABRIC" } as never, user?.id),
    );
    const rows = await prisma.item.count({ where: { name } });
    const p2002 = r.errs.filter((e) => e.startsWith("P2002")).length;
    const line = `items · N=${N} → başarılı ${r.okCount}, DB'de ${rows} satır, P2002 ${p2002}`;
    if (rows > 1) bad(`${line} → mükerrer kumaş`);
    else if (p2002 > 0)
      bad(`${line} → uygulama guard'ı yarışı GEÇİRDİ; duran şey DB seddi (sahada o sed YOK → sessiz mükerrer)`);
    else ok(line);
    if (r.errs.length) info(`  reddedilenler: ${r.errs.slice(0, 3).join(" | ")}`);
  }

  // ── §3 DB seddi envanteri (iki ortamda hangi tabloda var) ────────────────
  console.log("");
  const idx = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
    `SELECT indexname FROM pg_indexes WHERE indexdef ILIKE '%UNIQUE%' AND indexname LIKE '%nameFold%' ORDER BY 1`,
  );
  info(`dev DB'de nameFold UNIQUE index: ${idx.map((i) => i.indexname).join(", ") || "(yok)"}`);
  info("saha kopyasında ölçüldü: customers_nameFold_key · subcontractors_nameFold_key ·");
  info("colors_nameFoldColor_key VAR; **items_nameFold_key YOK** (yumuşak kapı atladı).");

  console.log(`\n=== SONUÇ: ${fail} kırmızı ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main()
  .catch((e) => { console.error("REPRO HATASI:", e); process.exitCode = 2; })
  .finally(async () => {
    try {
      const qgs = await prisma.qualityGrade.findMany({ where: { name: { startsWith: STAMP } }, select: { id: true } });
      const items = await prisma.item.findMany({ where: { name: { startsWith: STAMP } }, select: { id: true } });
      const ids = [...qgs.map((q) => q.id), ...items.map((i) => i.id)];
      await prisma.itemAllowedColor.deleteMany({ where: { itemId: { in: items.map((i) => i.id) } } });
      await prisma.itemAllowedProperty.deleteMany({ where: { itemId: { in: items.map((i) => i.id) } } });
      await prisma.qualityGrade.deleteMany({ where: { id: { in: qgs.map((q) => q.id) } } });
      await prisma.item.deleteMany({ where: { id: { in: items.map((i) => i.id) } } });
      await prisma.systemLog.deleteMany({ where: { recordId: { in: ids } } });
      console.log("temizlik tamam");
    } catch (e) {
      console.error("TEMİZLİK HATASI (elle bak):", (e as Error).message, "damga:", STAMP);
    }
    await prisma.$disconnect();
  });
