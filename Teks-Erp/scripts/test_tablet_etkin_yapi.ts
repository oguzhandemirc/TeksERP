// =============================================================================
// test_tablet_etkin_yapi — tablet iş kartında dokuma işinin etkin yapısı, SALT-OKUNUR (Seyitoğlu SY-M4).
// Kabul (§16.1): yapısız işte ekran aynı (uç `null` döner → tablet hiçbir şey çizmez); yeni zorunlu alan 0
// (uç salt-okuma GET'tir, gövde almaz). Yapılı işte atkı sırası + armür dosya adı + sıklık + varyant iplik
// değişimi etkin yapı tek kaynağından gelir; armür ızgarası tablete gitmez. Fikstür `TEST-SYM4-<ts>`.
// =============================================================================
import * as fs from "fs";
import * as path from "path";
import prisma, { pool } from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { createWeftSpec } from "../src/services/weft-spec.service";
import { createWeaveDesign } from "../src/services/weave-design.service";
import { replaceRecipeWeftOverrides } from "../src/services/item-construction.service";
import { weavingOrderTabletConstruction } from "../src/services/helpers/tablet-construction.helper";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

const TAG = `TEST-SYM4-${Date.now()}`;
const ids = { items: [] as string[], weft: [] as string[], design: [] as string[], recipe: [] as string[], wo: [] as string[] };

function staticChecks(): void {
  console.log("§0 statik: uç biçimi");
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "machine-run.routes.ts"), "utf8");
  const line = src.split("\n").find((l) => l.includes('router.get("/construction"')) ?? "";
  check("§0a GET /construction mobil dokuma ekran izniyle açılır", /requireAnyPermission\("loom:run", "loom:doff", \.\.\.MOBILE_DOKUMA\)/.test(line), line.trim());
  check("§0b gövde yok, yalnız weavingOrderId sorgusu (strict)", /weavingOrderId: z\.string\(\)\.uuid\([^)]*\) \}\)\.strict\(\)\.parse\(req\.query\)/.test(src));
  check("§0c tablet helper yapıyı yalnız resolveEffectiveConstruction'dan okur",
    /resolveEffectiveConstruction\(prisma, wo\.itemId, wo\.recipeId\)/.test(fs.readFileSync(path.join(__dirname, "..", "src", "services", "helpers", "tablet-construction.helper.ts"), "utf8")));
}

async function main(): Promise<void> {
  staticChecks();
  const admin = await ensureTestAdmin();
  const yarn = async (s: string): Promise<string> => {
    const r = await prisma.item.create({ data: { code: `${TAG}-${s}`, name: `${TAG} İPLİK ${s}`, itemType: "YARN", unit: "KG", linearDensityDen: 150 }, select: { id: true } });
    ids.items.push(r.id);
    return r.id;
  };
  const [y1, y2, y3] = [await yarn("Y1"), await yarn("Y2"), await yarn("Y3")];
  const fabric = async (s: string, data: Record<string, string> = {}): Promise<string> => {
    const r = await prisma.item.create({ data: { code: `${TAG}-${s}`, name: `${TAG} KUMAŞ ${s}`, itemType: "FABRIC", ...data }, select: { id: true } });
    ids.items.push(r.id);
    return r.id;
  };
  const order = async (n: string, itemId: string, recipeId: string | null = null): Promise<string> => {
    const r = await prisma.weavingOrder.create({ data: { weavingOrderNumber: `${TAG}-WO-${n}`, itemId, recipeId, executionKind: "IN_HOUSE" }, select: { id: true } });
    ids.wo.push(r.id);
    return r.id;
  };

  console.log("§1 yapısız iş → null (bugünkü ekran)");
  const bare = await order("BARE", await fabric("BARE"));
  const bareRes = await weavingOrderTabletConstruction(bare);
  check("§1a yapısız işte etkin yapı null", bareRes === null, JSON.stringify(bareRes));

  console.log("§2 yapılı iş + varyant");
  const w = await createWeftSpec({ code: `${TAG}-W`, name: `${TAG} atkı`, picksPerCm: "20", sequenceCode: "A4 B1 A4 C1", yarns: [{ yarnItemId: y1 }, { yarnItemId: y2 }, { yarnItemId: y3 }] }, admin.id);
  ids.weft.push(w.id);
  const d = await createWeaveDesign({ code: `${TAG}-D`, name: `${TAG} BALIK`, kind: "DOBBY", frameCount: 2, repeatCm: "0.5", liftPlan: [[1, 0], [0, 1]], loomFileName: "D2057.DOP" }, admin.id);
  ids.design.push(d.id);
  const full = await fabric("FULL", { weftSpecId: w.id, weaveDesignId: d.id });
  const rec = await prisma.productRecipe.create({ data: { code: `${TAG}-R`, name: `${TAG} V02`, itemId: full, variantCode: "V02" }, select: { id: true } });
  ids.recipe.push(rec.id);
  await replaceRecipeWeftOverrides(rec.id, [{ weftSortOrder: 2, yarnItemId: y1 }], admin.id);
  const c = await weavingOrderTabletConstruction(await order("FULL", full, rec.id));
  check("§2a armür dosya adı + desen kodu", c?.design?.loomFileName === "D2057.DOP" && c.design.code === `${TAG}-D`, JSON.stringify(c?.design));
  check("§2b sıklık + sıra kodu + rapor toplamı", c?.weft?.picksPerCm === 20 && c.weft.sequenceCode === "A4 B1 A4 C1" && c.weft.picksInRepeatTotal === 10, JSON.stringify(c?.weft && { ...c.weft, yarns: undefined }));
  const seq = (c?.weft?.yarns ?? []).map((y) => `${y.letter}:${y.yarnCode.slice(TAG.length + 1)}:${y.picksInRepeat}${y.swapped ? "*" : ""}`).join(" ");
  check("§2c varyant değişimi uygulanmış atkı sırası (C → Y1, işaretli)", seq === "A:Y1:8 B:Y2:1 C:Y1:1*", seq);
  check("§2d varyant kodu taşınır", c?.variantCode === "V02");
  check("§2e armür ızgarası tablete gitmez", c !== null && !JSON.stringify(c).includes("liftPlan"));

  console.log("§3 kapılar");
  let nf: AppError | null = null;
  try { await weavingOrderTabletConstruction("00000000-0000-4000-8000-000000000000"); } catch (e) { nf = e instanceof AppError ? e : null; }
  check("§3a olmayan iş → 404", nf?.statusCode === 404);
}

async function cleanup(): Promise<void> {
  const t = async (f: () => Promise<unknown>): Promise<void> => { await f().catch((e) => { fail++; console.log(`  ✗ temizlik: ${(e as Error).message.slice(0, 160)}`); }); };
  await t(() => prisma.weavingOrder.deleteMany({ where: { id: { in: ids.wo } } }));
  await t(() => prisma.productRecipeWeftYarn.deleteMany({ where: { recipeId: { in: ids.recipe } } }));
  await t(() => prisma.productRecipe.deleteMany({ where: { id: { in: ids.recipe } } }));
  await t(() => prisma.item.updateMany({ where: { id: { in: ids.items } }, data: { weftSpecId: null, weaveDesignId: null } }));
  await t(() => prisma.weftSpecYarn.deleteMany({ where: { weftSpecId: { in: ids.weft } } }));
  await t(() => prisma.weftSpec.deleteMany({ where: { id: { in: ids.weft } } }));
  await t(() => prisma.weaveDesign.deleteMany({ where: { id: { in: ids.design } } }));
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
