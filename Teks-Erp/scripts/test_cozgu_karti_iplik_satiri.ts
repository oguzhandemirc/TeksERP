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
// §7 (D3 yazma kolları): gövde `yarns` → satır kümesi REPLACE, kolonlar türetilir, doğrulamalar 400, audit eski/yeni
//   küme, diriltme, tel önerisi (S6). SONDA (2026-11-17, geri alındı): kanca `pending` kümesini yok sayınca §7a/§7d/§7e/§7f
//   kırmızı (35/4); aynı iplik denetimi kapatılınca §7i kırmızı (38/1, DB unique 400 vermez).
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import { ItemType } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { warpSpecService } from "../src/routes/warp-spec.routes";
import { warpSpecSummaryFromLines, warpSpecYarnLines, WARP_SPEC_YARN_LINES_SELECT } from "../src/services/helpers/warp-spec-yarn.helper";
import { suggestWarpEnds } from "../src/services/warp-plan.service";
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

interface Arms {
  a: string;
  b: string;
  c: string;
  mk: (s: string, den?: string | null, type?: ItemType) => Promise<string>;
  specIds: string[];
}

const idOf = (r: unknown): string => {
  const id = (r as { data?: { id?: string } }).data?.id;
  if (!id) throw new Error("kart kimliği dönmedi");
  return id;
};

/** Kartın iplik kümesi audit satırları (yeni küme taşıyanlar), kronolojik. */
async function yarnLogs(recordId: string): Promise<Array<{ oldData: unknown; newData: unknown }>> {
  const all = await prisma.systemLog.findMany({ where: { tableName: "WARP_SPEC", recordId }, select: { oldData: true, newData: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return all.filter((l) => Array.isArray((l.newData as { yarns?: unknown } | null)?.yarns));
}

/** §7 D3 yazma kolları: satır kümesi gövdeden REPLACE, kolonlar türetilir, doğrulamalar 400, audit eski/yeni küme. */
async function writeArms({ a, b, c, mk, specIds }: Arms): Promise<void> {
  // S1 x/y/z kartı: kolonlar gövdede YANLIŞ gönderilir — satırlardan türetilmeli.
  const s1 = await warpSpecService.create({
    code: `${damga}-S1`, name: `${damga}-S1`, yarnItemId: c, endsCount: 1, sequenceNote: " 1 A 1 B 1 C ",
    yarns: [{ yarnItemId: a, endsCount: 3000 }, { yarnItemId: b, endsCount: 2400 }, { yarnItemId: c, endsCount: "1800" }],
  });
  const s1Id = idOf(s1);
  specIds.push(s1Id);
  const s1Spec = await prisma.warpSpec.findUniqueOrThrow({ where: { id: s1Id }, select: { yarnItemId: true, endsCount: true, sequenceNote: true } });
  check("§7a çok iplikli kart gövdeden doğar: 3 satır, sıra = gövde sırası", J(await rowsOf(s1Id)) === J([{ yarnItemId: a, endsCount: 3000, sortOrder: 0 }, { yarnItemId: b, endsCount: 2400, sortOrder: 1 }, { yarnItemId: c, endsCount: 1800, sortOrder: 2 }]), J(await rowsOf(s1Id)));
  check("§7b kolonlar satırlardan türer (gövdedeki iplik/tel yok sayılır)", s1Spec.yarnItemId === a && s1Spec.endsCount === 7200, J(s1Spec));
  check("§7c dizilim notu yazılır (kırpılmış)", s1Spec.sequenceNote === "1 A 1 B 1 C", J(s1Spec.sequenceNote));
  // Kart görseli: tekil okuma açılımı taşır; tel payı 3000/2400/1800 ≠ eşit rapor → uyuşmazlık bayrağı.
  const one = (await warpSpecService.findById(s1Id)).data as { endsSequence?: { repeat: number[]; repeatCount: number; remainder: number; totalEnds: number; matchesYarnEnds: boolean } | null };
  const es = one.endsSequence;
  check("§7c2 GET /:id endsSequence: rapor [1,2,3] × 2400, uyuşmazlık işaretli", J(es?.repeat) === "[1,2,3]" && es?.repeatCount === 2400 && es.remainder === 0 && es.totalEnds === 7200 && es.matchesYarnEnds === false, J(es));
  const ret = (s1 as { data?: { yarns?: unknown[] } }).data?.yarns ?? [];
  check("§7d yanıt satırları TAZE taşır (kanca sonrası okunur)", ret.length === 3, `${ret.length}`);
  const log1 = (await yarnLogs(s1Id))[0];
  check("§7e audit: doğuşta yeni küme yazıldı", J((log1?.newData as { yarns?: unknown[] } | null)?.yarns?.length) === "3" && J((log1?.oldData as { yarns?: unknown[] } | null)?.yarns) === "[]", J(log1));

  // MONO'ya çevir: replace (silinen satır, yeni iplik, sıra değişimi).
  await warpSpecService.update(s1Id, { yarns: [{ yarnItemId: b, endsCount: 5250 }, { yarnItemId: a, endsCount: 5250 }] });
  const m = await prisma.warpSpec.findUniqueOrThrow({ where: { id: s1Id }, select: { yarnItemId: true, endsCount: true } });
  check("§7f güncelleme kümeyi REPLACE eder, sıra yeni gövdeden", J(await rowsOf(s1Id)) === J([{ yarnItemId: b, endsCount: 5250, sortOrder: 0 }, { yarnItemId: a, endsCount: 5250, sortOrder: 1 }]), J(await rowsOf(s1Id)));
  check("§7g özet yeniden türedi (ana iplik b, Σ 10500)", m.yarnItemId === b && m.endsCount === 10500, J(m));
  const logs = (await yarnLogs(s1Id)).length;
  await warpSpecService.update(s1Id, { yarns: [{ yarnItemId: b, endsCount: 5250 }, { yarnItemId: a, endsCount: 5250 }] });
  const logs2 = (await yarnLogs(s1Id)).length;
  check("§7h aynı küme yeniden gönderilince küme audit'i yazılmaz", logs === 2 && logs2 === 2, `${logs} → ${logs2}`);

  // Doğrulama kolları — her biri 400 ve kart değişmez.
  const before = J(await rowsOf(s1Id));
  const denless = await mk("DENSIZ", null);
  const fabric = await mk("KUMAS", "150", ItemType.FABRIC);
  await expect400("§7i aynı iplik iki satır 400", () => warpSpecService.update(s1Id, { yarns: [{ yarnItemId: a, endsCount: 10 }, { yarnItemId: a, endsCount: 20 }] }));
  await expect400("§7j satırsız küme 400", () => warpSpecService.update(s1Id, { yarns: [] }));
  await expect400("§7k denyesiz iplik 400", () => warpSpecService.update(s1Id, { yarns: [{ yarnItemId: denless, endsCount: 10 }] }));
  await expect400("§7l iplik olmayan kalem 400", () => warpSpecService.update(s1Id, { yarns: [{ yarnItemId: fabric, endsCount: 10 }] }));
  await expect400("§7m tel 0 / kesirli 400", () => warpSpecService.update(s1Id, { yarns: [{ yarnItemId: a, endsCount: 0 }, { yarnItemId: b, endsCount: 1.5 }] }));
  await expect400("§7n satırlar liste değil 400", () => warpSpecService.update(s1Id, { yarns: { yarnItemId: a } }));
  await expect400("§7o dizilim notu 160'ı aşarsa 400", () => warpSpecService.update(s1Id, { sequenceNote: "x".repeat(161) }));
  await expect400("§7p yeni kart satırlı gövdede denyesiz iplikle 400", () => warpSpecService.create({ code: `${damga}-S1X`, name: `${damga}-S1X`, yarns: [{ yarnItemId: denless, endsCount: 10 }] }));
  check("§7q 400'lerden sonra satırlar aynı", J(await rowsOf(s1Id)) === before);
  await warpSpecService.update(s1Id, { sequenceNote: "" });
  check("§7r boş dizilim notu null yazılır", (await prisma.warpSpec.findUniqueOrThrow({ where: { id: s1Id }, select: { sequenceNote: true } })).sequenceNote === null);

  // Pasif kartın aynı kodla yeniden yaratılması (diriltme) satırlı gövdeyi uygular.
  await warpSpecService.softDelete(s1Id);
  await warpSpecService.create({ code: `${damga}-S1`, name: `${damga}-S1`, yarns: [{ yarnItemId: c, endsCount: 900 }] });
  const rv = await prisma.warpSpec.findUniqueOrThrow({ where: { id: s1Id }, select: { isActive: true, yarnItemId: true, endsCount: true } });
  check("§7s diriltmede satır kümesi ve özet yeni gövdeden", rv.isActive && rv.yarnItemId === c && rv.endsCount === 900 && J(await rowsOf(s1Id)) === J([{ yarnItemId: c, endsCount: 900, sortOrder: 0 }]), J(rv));

  // Kart formu yardımcıları (S6) — yalnız önerir.
  const k = await suggestWarpEnds({ kind: "KG_PER_1000M", yarnItemId: a, kgPer1000m: 50 });
  const r = await suggestWarpEnds({ kind: "REED", reedPerCm: 20, widthCm: 350, endsPerDent: 1 });
  check("§7t S6 1000 m'ye 50 kg · 150 den → 3000 tel, fark 0", k.data?.endsCount === 3000 && k.data.diffKg === 0, J(k.data));
  check("§7u S6 tarak 20 × en 350 × dişe 1 → 7000 tel", r.data?.endsCount === 7000, J(r.data));
  await expect400("§7v denyesiz iplikle tel önerisi 400", () => suggestWarpEnds({ kind: "KG_PER_1000M", yarnItemId: denless, kgPer1000m: 50 }));
}

async function run(): Promise<void> {
  const itemIds: string[] = [];
  const specIds: string[] = [];
  try {
    const mk = async (s: string, den: string | null = "150", type: ItemType = ItemType.YARN): Promise<string> => {
      const it = await prisma.item.create({ data: { code: `${damga}-${s}`, name: `${damga}-${s}`, itemType: type, unit: "KG", linearDensityDen: den }, select: { id: true } });
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

    await writeArms({ a, b, c, mk, specIds });

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
