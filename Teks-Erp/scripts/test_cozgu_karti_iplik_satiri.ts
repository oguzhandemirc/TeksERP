// =============================================================================
// ÇÖZGÜ KARTI İPLİK SATIRI BEKÇİSİ — fason devere D1 (plan §6.1)
// =============================================================================
// Kart kolonları (`yarnItemId`, `endsCount`) satırların ÖZETİDİR: ana iplik = sıra 0'ın ipliği, Σ tel = endsCount.
// §1 geri doldurma (migration'ın KENDİ INSERT metni, TEST- kartlara daraltılmış): tek satır + yeniden koşulabilir.
// §2 servis: tek iplikli kart satırla doğar, güncellemede satır eşitlenir. §3 çok iplikli kartta özeti bozan
// yazım 400 + satırlar değişmez. §4 aynı iplik iki satır → DB unique. §5 eski kart okuyucusu (satırsız kart).
// §6 değişmez: satırı olan HER kartta özet = kolonlar (körlük zemini ≥ 1).
// DB'YE YAZAR: `TEST-CKS-<pid>` iplik/kart satırları; `finally`de silinir (satırlar kartla Cascade gider).
// Koşum: npx tsx scripts/run-all-tests.ts cozgu_karti_iplik_satiri
//
// NEGATİF SONDA (2026-11-17 koşuldu, geri alındı): `afterUpdateTx` içindeki `syncSingleYarnRowTx` çağrısı kaldırıldı
//   → §2b–§2d, §3a–§3c, §6b kırmızı (10/17).
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import { ItemType } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { warpSpecService } from "../src/routes/warp-spec.routes";
import { warpSpecSummaryFromLines, warpSpecYarnLines, WARP_SPEC_YARN_LINES_SELECT } from "../src/services/helpers/warp-spec-yarn.helper";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
const J = (v: unknown): string => JSON.stringify(v);
const damga = `TEST-CKS-${process.pid}`;

function backfillSql(): string {
  const file = path.resolve(__dirname, "../prisma/migrations/20261117161624_warp_spec_yarns/migration.sql");
  const sql = fs.readFileSync(file, "utf8");
  const start = sql.lastIndexOf('INSERT INTO "warp_spec_yarns"');
  if (start < 0) throw new Error("migration geri doldurma INSERT'i bulunamadı");
  const stmt = sql.slice(start).replace(/;\s*$/, "").trim();
  if (!/WHERE NOT EXISTS/.test(stmt)) throw new Error("geri doldurma WHERE NOT EXISTS taşımıyor");
  // Yalnız bu bekçinin kartları: ortamdaki diğer kartlara dokunulmaz.
  return `${stmt} AND ws."code" LIKE '${damga}-%'`;
}

async function rowsOf(warpSpecId: string): Promise<Array<{ yarnItemId: string; endsCount: number; sortOrder: number }>> {
  return prisma.warpSpecYarn.findMany({ where: { warpSpecId }, select: { yarnItemId: true, endsCount: true, sortOrder: true }, orderBy: { sortOrder: "asc" } });
}

async function expect400(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    check(label, false, "hata fırlamadı");
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    check(label, code === 400, `status ${String(code)} ${(e as Error).message}`);
  }
}

async function run(): Promise<void> {
  const itemIds: string[] = [];
  const specIds: string[] = [];
  try {
    const mk = async (s: string): Promise<string> => {
      const it = await prisma.item.create({ data: { code: `${damga}-${s}`, name: `${damga}-${s}`, itemType: ItemType.YARN, unit: "KG", linearDensityDen: "150" }, select: { id: true } });
      itemIds.push(it.id);
      return it.id;
    };
    const a = await mk("A");
    const b = await mk("B");
    const c = await mk("C");

    // §1 Geri doldurma — satırsız (göç öncesi gibi) kartlar ham yazılır.
    const raw1 = await prisma.warpSpec.create({ data: { code: `${damga}-ESKI1`, name: `${damga}-ESKI1`, yarnItemId: a, endsCount: 3000 }, select: { id: true } });
    const raw2 = await prisma.warpSpec.create({ data: { code: `${damga}-ESKI2`, name: `${damga}-ESKI2`, yarnItemId: b, endsCount: 4200 }, select: { id: true } });
    specIds.push(raw1.id, raw2.id);
    check("§1o ham kart satırsız doğar (geri doldurma öncesi)", (await rowsOf(raw1.id)).length === 0);
    const sql = backfillSql();
    const n1 = await prisma.$executeRawUnsafe(sql);
    const r1 = await rowsOf(raw1.id);
    const r2 = await rowsOf(raw2.id);
    check("§1a geri doldurma iki karta birer satır yazdı", n1 === 2, `yazılan ${n1}`);
    check("§1b satır = kolonlar (ana iplik, Σ tel, sıra 0)", J(r1) === J([{ yarnItemId: a, endsCount: 3000, sortOrder: 0 }]) && J(r2) === J([{ yarnItemId: b, endsCount: 4200, sortOrder: 0 }]), J([r1, r2]));
    const n2 = await prisma.$executeRawUnsafe(sql);
    check("§1c ikinci koşum fark yok (yeniden koşulabilir)", n2 === 0 && (await rowsOf(raw1.id)).length === 1, `yazılan ${n2}`);

    // §2 Servis yolu — tek iplikli kart.
    const created = await warpSpecService.create({ code: `${damga}-K1`, name: `${damga}-K1`, yarnItemId: a, endsCount: 2400 });
    const k1 = (created as { data?: { id?: string } }).data?.id;
    if (!k1) throw new Error("kart açılamadı");
    specIds.push(k1);
    check("§2a servisle doğan kart tek satır taşır", J(await rowsOf(k1)) === J([{ yarnItemId: a, endsCount: 2400, sortOrder: 0 }]), J(await rowsOf(k1)));
    await warpSpecService.update(k1, { endsCount: 2600 });
    check("§2b tel güncellemesi satıra yansır", J(await rowsOf(k1)) === J([{ yarnItemId: a, endsCount: 2600, sortOrder: 0 }]), J(await rowsOf(k1)));
    await warpSpecService.update(k1, { yarnItemId: b });
    check("§2c iplik değişimi satıra yansır (tek satır kalır)", J(await rowsOf(k1)) === J([{ yarnItemId: b, endsCount: 2600, sortOrder: 0 }]), J(await rowsOf(k1)));
    await warpSpecService.update(k1, { name: `${damga}-K1-AD` });
    check("§2d ilgisiz alan güncellemesi satırı bozmaz", J(await rowsOf(k1)) === J([{ yarnItemId: b, endsCount: 2600, sortOrder: 0 }]));

    // §3 Çok iplikli kart (satırlar D3'e kadar yalnız DB'den doğar) — özeti bozan yazım 400.
    const multi = await prisma.warpSpec.create({ data: { code: `${damga}-COK`, name: `${damga}-COK`, yarnItemId: a, endsCount: 5000 }, select: { id: true } });
    specIds.push(multi.id);
    await prisma.warpSpecYarn.createMany({
      data: [
        { warpSpecId: multi.id, yarnItemId: a, endsCount: 3000, sortOrder: 0 },
        { warpSpecId: multi.id, yarnItemId: b, endsCount: 2000, sortOrder: 1 },
      ],
    });
    const before = J(await rowsOf(multi.id));
    await expect400("§3a çok iplikli kartta tel değişimi 400", () => warpSpecService.update(multi.id, { endsCount: 5200 }));
    await expect400("§3b çok iplikli kartta ana iplik değişimi 400", () => warpSpecService.update(multi.id, { yarnItemId: c }));
    const spec3 = await prisma.warpSpec.findUniqueOrThrow({ where: { id: multi.id }, select: { endsCount: true, yarnItemId: true } });
    check("§3c 400 sonrası satırlar ve kolonlar değişmedi (tx geri alındı)", J(await rowsOf(multi.id)) === before && spec3.endsCount === 5000 && spec3.yarnItemId === a, J(spec3));
    await warpSpecService.update(multi.id, { name: `${damga}-COK-AD` });
    check("§3d çok iplikli kartta özete dokunmayan yazım geçer, satırlar aynı", J(await rowsOf(multi.id)) === before);

    // §4 Aynı iplik iki satır → DB unique.
    try {
      await prisma.warpSpecYarn.create({ data: { warpSpecId: multi.id, yarnItemId: a, endsCount: 10, sortOrder: 2 } });
      check("§4 aynı iplik ikinci satır reddedilir (unique)", false, "yazıldı");
    } catch (e) {
      check("§4 aynı iplik ikinci satır reddedilir (unique)", (e as { code?: string }).code === "P2002", String((e as { code?: string }).code));
    }

    // §5 Eski kart okuyucusu: satırsız kart kolonlardan tek satır okunur; satırlı kart satırlardan.
    const legacy = await prisma.warpSpec.create({ data: { code: `${damga}-ESKI3`, name: `${damga}-ESKI3`, yarnItemId: c, endsCount: 1800 }, select: { id: true } });
    specIds.push(legacy.id);
    const lr = await prisma.warpSpec.findUniqueOrThrow({ where: { id: legacy.id }, select: WARP_SPEC_YARN_LINES_SELECT });
    check("§5a satırsız kart → kolonlardan tek satır", J(warpSpecYarnLines(lr)) === J([{ yarnItemId: c, endsCount: 1800, sortOrder: 0 }]), J(warpSpecYarnLines(lr)));
    const mr = await prisma.warpSpec.findUniqueOrThrow({ where: { id: multi.id }, select: WARP_SPEC_YARN_LINES_SELECT });
    check("§5b çok iplikli kart → satırlardan, sıra belirlenimli", J(warpSpecYarnLines(mr).map((l) => l.yarnItemId)) === J([a, b]));

    // §6 Değişmez: satırı olan HER kartta özet = kolonlar.
    const all = await prisma.warpSpec.findMany({ where: { yarns: { some: {} } }, select: { id: true, code: true, ...WARP_SPEC_YARN_LINES_SELECT } });
    const bad = all.filter((s) => {
      const sum = warpSpecSummaryFromLines(s.yarns);
      return sum.yarnItemId !== s.yarnItemId || sum.endsCount !== s.endsCount;
    });
    check("§6a satırı olan kart var (körlük zemini ≥ 4)", all.length >= 4, `${all.length}`);
    check("§6b her kartta ana iplik = sıra 0, Σ tel = endsCount", bad.length === 0, bad.map((s) => s.code).join(", "));
  } finally {
    await prisma.warpSpec.deleteMany({ where: { id: { in: specIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.error(engel);
    process.exitCode = 1;
    return;
  }
  await run();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
