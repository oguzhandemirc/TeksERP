// =============================================================================
// test_atki_karti_ozel_kopya — "Bu desene özel kopya" (Seyitoğlu SY-P3, GERÇEK DB)
// Kabul: ortak atkı kartı (3 kumaş) A kumaşı için kopyalanır → yeni kart iplik satırları/sıra kodu/sıklıkla
// aynı, YALNIZ A yeni karta geçer, B ve C eski kartta, eski kart değişmez; aynı gövde tekrarı aynı kartı
// döner (ikinci kart doğmaz); bağ değişmişse / tek kullanıcıysa / kod mükerrerse 409 ve tx geri; audit
// iki satır; uç `warpspec:write` + dokuma modül kapısı arkasında. Fikstür `TEST-SYP3-<ts>`.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { createWeftSpec } from "../src/services/weft-spec.service";
import { forkWeftSpecForItem } from "../src/services/weft-spec-fork.service";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

async function errOf(fn: () => Promise<unknown>): Promise<{ status: number; code: unknown } | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof AppError) return { status: e.statusCode, code: e.details?.code };
    return { status: 500, code: (e as { code?: string }).code };
  }
}

const TAG = `TEST-SYP3-${Date.now()}`;
const ids = { items: [] as string[], weft: [] as string[] };

async function main(): Promise<void> {
  const admin = await ensureTestAdmin();
  const mkItem = async (s: string, itemType: "YARN" | "FABRIC"): Promise<string> => {
    const r = await prisma.item.create({
      data: { code: `${TAG}-${s}`, name: `${TAG} ${s}`, itemType, unit: itemType === "YARN" ? "KG" : "MT", ...(itemType === "YARN" ? { linearDensityDen: 150 } : {}) },
      select: { id: true },
    });
    ids.items.push(r.id);
    return r.id;
  };
  const [y1, y2, y3] = [await mkItem("Y1", "YARN"), await mkItem("Y2", "YARN"), await mkItem("Y3", "YARN")];
  const src = await createWeftSpec({ code: `${TAG}-W`, name: `${TAG} ortak atkı`, picksPerCm: "20", weftProgramNo: "6037", sequenceCode: "A4 B1 A4 C1", yarns: [{ yarnItemId: y1 }, { yarnItemId: y2 }, { yarnItemId: y3 }] }, admin.id);
  ids.weft.push(src.id);
  const [fa, fb, fc] = [await mkItem("KA", "FABRIC"), await mkItem("KB", "FABRIC"), await mkItem("KC", "FABRIC")];
  await prisma.item.updateMany({ where: { id: { in: [fa, fb, fc] } }, data: { weftSpecId: src.id } });
  const bound = async (id: string): Promise<string | null> => (await prisma.item.findUniqueOrThrow({ where: { id }, select: { weftSpecId: true } })).weftSpecId;

  console.log("§1 kopya: yalnız istenen kumaş yeni karta geçer");
  const r1 = await forkWeftSpecForItem(src.id, { itemId: fa, code: `${TAG}-WA`, name: `${TAG} atkı KA` }, admin.id);
  ids.weft.push(r1.weftSpec.id);
  check("§1a yeni kimlik + istenen kod/ad, replayed=false", r1.weftSpec.id !== src.id && r1.weftSpec.code === `${TAG}-WA` && r1.weftSpec.name === `${TAG} atkı KA` && r1.replayed === false);
  const sig = (w: typeof r1.weftSpec): string =>
    JSON.stringify([w.picksPerCm?.toString(), w.sequenceCode, w.weftProgramNo, w.yarns.map((y) => [y.yarnItemId, y.picksInRepeat, y.sortOrder])]);
  const srcAfter = await prisma.weftSpec.findUniqueOrThrow({ where: { id: src.id }, select: { picksPerCm: true, sequenceCode: true, weftProgramNo: true, yarns: { select: { yarnItemId: true, picksInRepeat: true, sortOrder: true }, orderBy: { sortOrder: "asc" } } } });
  check("§1b iplik satırları + sıra kodu + sıklık + program no birebir kopya", sig(r1.weftSpec) === sig(src), sig(r1.weftSpec));
  check("§1c YALNIZ A kumaşı yeni karta geçti", (await bound(fa)) === r1.weftSpec.id);
  check("§1d B ve C eski kartta kaldı", (await bound(fb)) === src.id && (await bound(fc)) === src.id);
  check("§1e eski kart değişmedi", JSON.stringify(srcAfter.yarns) === JSON.stringify(src.yarns.map((y) => ({ yarnItemId: y.yarnItemId, picksInRepeat: y.picksInRepeat, sortOrder: y.sortOrder }))) && srcAfter.sequenceCode === src.sequenceCode);
  // Audit tx dışında best-effort (void) yazılır — kısa bekleme ile okunur.
  await new Promise((res) => setTimeout(res, 300));
  const logs = await prisma.systemLog.findMany({ where: { OR: [{ recordId: r1.weftSpec.id, tableName: "WEFT_SPEC", action: "CREATE" }, { recordId: fa, tableName: "ITEM", action: "UPDATE" }] }, select: { tableName: true } });
  check("§1f audit: kart CREATE + kumaş UPDATE", logs.some((l) => l.tableName === "WEFT_SPEC") && logs.some((l) => l.tableName === "ITEM"), `${logs.length} satır`);

  console.log("§2 idempotency (kopya kodu doğal anahtar)");
  const before = await prisma.weftSpec.count({ where: { code: { startsWith: TAG } } });
  const r2 = await forkWeftSpecForItem(src.id, { itemId: fa, code: `${TAG}-WA`, name: `${TAG} atkı KA` }, admin.id);
  check("§2a aynı gövde tekrarı → aynı kart, replayed=true", r2.weftSpec.id === r1.weftSpec.id && r2.replayed === true);
  check("§2b tekrarda ikinci kart doğmadı", (await prisma.weftSpec.count({ where: { code: { startsWith: TAG } } })) === before);
  const dupCode = await errOf(() => forkWeftSpecForItem(src.id, { itemId: fb, code: `${TAG}-WA`, name: `${TAG} atkı KB` }, admin.id));
  check("§2c başka kumaş aynı kodla → 409 WEFT_SPEC_DUPLICATE, B yerinde", dupCode?.status === 409 && dupCode.code === "WEFT_SPEC_DUPLICATE" && (await bound(fb)) === src.id, JSON.stringify(dupCode));
  const dupName = await errOf(() => forkWeftSpecForItem(src.id, { itemId: fb, code: `${TAG}-WB`, name: `${TAG} ortak atkı` }, admin.id));
  check("§2d ad mükerrer → 409 WEFT_SPEC_DUPLICATE, tx geri (kart yok, B yerinde)", dupName?.code === "WEFT_SPEC_DUPLICATE" && (await prisma.weftSpec.count({ where: { code: `${TAG}-WB` } })) === 0 && (await bound(fb)) === src.id, JSON.stringify(dupName));

  console.log("§3 atomik claim + kullanım kapısı");
  const stale = await errOf(() => forkWeftSpecForItem(src.id, { itemId: fa, code: `${TAG}-WA2`, name: `${TAG} atkı KA2` }, admin.id));
  check("§3a kumaş artık kaynağa bağlı değil → 409 WEFT_SPEC_BINDING_CHANGED, kart doğmadı", stale?.code === "WEFT_SPEC_BINDING_CHANGED" && (await prisma.weftSpec.count({ where: { code: `${TAG}-WA2` } })) === 0, JSON.stringify(stale));
  // Yarış: başka yazar C'nin bağını açık tx'te değiştirip tutar; kopya C'yi kaynakta okur, claim satır kilidinde
  // bekler, yazar commit edince claim WHERE'i yeniden değerlenir → 0 satır → 409 ve kopya kartı geri alınır.
  let held!: () => void;
  const writerHolds = new Promise<void>((res) => { held = res; });
  const writer = prisma.$transaction(async (tx) => {
    await tx.item.update({ where: { id: fc }, data: { weftSpecId: r1.weftSpec.id } });
    held();
    await new Promise((res) => setTimeout(res, 1500));
  }, { timeout: 20_000 });
  await writerHolds;
  const raced = await errOf(() => forkWeftSpecForItem(src.id, { itemId: fc, code: `${TAG}-WR`, name: `${TAG} atkı yarış` }, admin.id));
  await writer;
  check("§3e yarış: bağ claim anında değişmiş → 409 WEFT_SPEC_BINDING_CHANGED, kopya geri alındı", raced?.code === "WEFT_SPEC_BINDING_CHANGED" && (await prisma.weftSpec.count({ where: { code: `${TAG}-WR` } })) === 0 && (await bound(fc)) === r1.weftSpec.id, JSON.stringify(raced));
  await prisma.item.update({ where: { id: fc }, data: { weftSpecId: src.id } });
  const r3 = await forkWeftSpecForItem(src.id, { itemId: fb, code: `${TAG}-WB`, name: `${TAG} atkı KB` }, admin.id);
  ids.weft.push(r3.weftSpec.id);
  const solo = await errOf(() => forkWeftSpecForItem(src.id, { itemId: fc, code: `${TAG}-WC`, name: `${TAG} atkı KC` }, admin.id));
  check("§3b kart tek kumaşta kaldı → 409 WEFT_SPEC_NOT_SHARED, C yerinde", solo?.code === "WEFT_SPEC_NOT_SHARED" && (await bound(fc)) === src.id, JSON.stringify(solo));
  check("§3c olmayan kart → 404", (await errOf(() => forkWeftSpecForItem(fa, { itemId: fc, code: `${TAG}-WZ`, name: `${TAG} z` }, admin.id)))?.status === 404);
  check("§3d boş kod → 400", (await errOf(() => forkWeftSpecForItem(src.id, { itemId: fc, code: "  ", name: `${TAG} z` }, admin.id)))?.status === 400);

  console.log("§4 uç kapıları (yapısal)");
  const route = readFileSync(path.join(__dirname, "../src/routes/weft-spec.routes.ts"), "utf8");
  check("§4a POST /:id/fork warpspec:write arkasında (yeni izin kodu yok)", /router\.post\("\/:id\/fork", requirePermission\("warpspec:write"\)/.test(route));
  check("§4b router dokuma modül kapısı arkasında", route.includes("router.use(verifyToken, requireDokumaEnabled)"));
  check("§4c gövde strict (tanınmayan alan 400)", /forkBody = z\.object\([\s\S]*?\}\)\.strict\(\)/.test(route));
}

async function cleanup(): Promise<void> {
  const t = async (f: () => Promise<unknown>): Promise<void> => { await f().catch((e) => { fail++; console.log(`  ✗ temizlik: ${(e as Error).message.slice(0, 160)}`); }); };
  const extra = await prisma.weftSpec.findMany({ where: { code: { startsWith: TAG } }, select: { id: true } });
  const weft = [...new Set([...ids.weft, ...extra.map((w) => w.id)])];
  await t(() => prisma.item.updateMany({ where: { id: { in: ids.items } }, data: { weftSpecId: null } }));
  await t(() => prisma.weftSpecYarn.deleteMany({ where: { weftSpecId: { in: weft } } }));
  await t(() => prisma.weftSpec.deleteMany({ where: { id: { in: weft } } }));
  await t(() => prisma.item.deleteMany({ where: { id: { in: ids.items } } }));
}

main()
  .catch((e) => { fail++; console.error("  ✗ beklenmeyen hata:", e); })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
