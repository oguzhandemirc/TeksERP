// =============================================================================
// test_dokuma_is_emri_yapi — dokuma iş emri yapı seçimi (Seyitoğlu SY-A4, GERÇEK DB)
// =============================================================================
// Kabul (§16.1 SY-A4): yapısız üründe iş emri yanıtı bayt-aynı (yeni anahtar YOK); atkı/desen kartlı
// üründe gövde vermeyince kartlar ETKİN YAPIDAN dolar; açık null "kartsız"; varyant türetilmez,
// başka ürünün varyantı 400 RECIPE_ITEM_MISMATCH; pasif desen 400. Fikstür `TEST-SYA4-<ts>`.
// =============================================================================
import { WeavingExecutionKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { createWeavingOrder, getWeavingOrder, updateWeavingOrder } from "../src/services/weaving-order.service";
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
    return { status: 500, code: (e as Error).message.slice(0, 120) };
  }
}

const TAG = `TEST-SYA4-${Date.now()}`;
/** SY-A4 öncesi main'de ölçülen yanıt anahtar sırası (SY-A4 öncesi) — yapısız işte bayt-aynı kalmalı. */
const BASELINE_KEYS = "id,weavingOrderNumber,itemId,colorId,warpSpecId,plannedM,executionKind,subcontractorId,status,plannedStartDate,plannedEndDate,notes,closedAt,cancelledAt,cancelReason,createdAt,updatedAt,item,color,warpSpec,subcontractor,openRunCount,orderLines,orderLineCount,warpBeamCount";
const NEW_KEYS = ["weftSpecId", "weftSpec", "weaveDesignId", "weaveDesign", "recipeId", "recipe"];
const ids = { items: [] as string[], weft: [] as string[], design: [] as string[], recipe: [] as string[], wo: [] as string[] };

async function main(): Promise<void> {
  const admin = await ensureTestAdmin();
  const item = async (s: string, data: Record<string, unknown> = {}): Promise<string> => {
    const r = await prisma.item.create({ data: { code: `${TAG}-${s}`, name: `${TAG} ${s}`, itemType: "FABRIC", ...data }, select: { id: true } });
    ids.items.push(r.id);
    return r.id;
  };
  const yarn = await prisma.item.create({ data: { code: `${TAG}-Y`, name: `${TAG} İPLİK`, itemType: "YARN", unit: "KG", linearDensityDen: 150 }, select: { id: true } });
  ids.items.push(yarn.id);
  const weft = await prisma.weftSpec.create({ data: { code: `${TAG}-W`, name: `${TAG} atkı`, picksPerCm: "20", yarns: { create: [{ yarnItemId: yarn.id, picksInRepeat: 4, sortOrder: 0 }] } }, select: { id: true } });
  ids.weft.push(weft.id);
  const design = await prisma.weaveDesign.create({ data: { code: `${TAG}-D`, name: `${TAG} desen`, kind: "DOBBY" }, select: { id: true } });
  const passive = await prisma.weaveDesign.create({ data: { code: `${TAG}-DP`, name: `${TAG} pasif desen`, kind: "DOBBY", isActive: false }, select: { id: true } });
  ids.design.push(design.id, passive.id);
  const bare = await item("BARE");
  const built = await item("BUILT", { weftSpecId: weft.id, weaveDesignId: design.id });
  const other = await item("OTHER");
  const recipe = await prisma.productRecipe.create({ data: { code: `${TAG}-R1`, name: `${TAG} V01`, itemId: built, variantCode: "V01" }, select: { id: true } });
  const foreign = await prisma.productRecipe.create({ data: { code: `${TAG}-R2`, name: `${TAG} V01 diğer`, itemId: other }, select: { id: true } });
  ids.recipe.push(recipe.id, foreign.id);
  const mk = async (input: Record<string, unknown>) => {
    const r = await createWeavingOrder({ executionKind: WeavingExecutionKind.IN_HOUSE, plannedM: 100, ...input } as Parameters<typeof createWeavingOrder>[0], admin.id);
    ids.wo.push(r.data!.id);
    return r.data!;
  };

  console.log("§1 yapısız ürün (bugün): yanıtta yeni anahtar yok");
  const a = await mk({ itemId: bare });
  const aKeys = Object.keys(a);
  check("§1a oluştur yanıtı anahtar kümesi + sırası SY-A4 öncesiyle aynı", aKeys.join(",") === BASELINE_KEYS && NEW_KEYS.every((k) => !aKeys.includes(k)), aKeys.join(","));
  const aGet = (await getWeavingOrder(a.id)).data!;
  check("§1b detay yanıtı yeni anahtar taşımaz", NEW_KEYS.every((k) => !(k in aGet)));
  const aRow = await prisma.weavingOrder.findUniqueOrThrow({ where: { id: a.id }, select: { weftSpecId: true, weaveDesignId: true, recipeId: true } });
  check("§1c kolonlar null", aRow.weftSpecId === null && aRow.weaveDesignId === null && aRow.recipeId === null);

  console.log("§2 yapılı ürün: kartlar etkin yapıdan dolar, varyant türetilmez");
  const b = await mk({ itemId: built });
  check("§2a atkı + desen kartı ürünün etkin yapısından", b.weftSpecId === weft.id && b.weaveDesignId === design.id && b.weftSpec?.code === `${TAG}-W` && b.weaveDesign?.code === `${TAG}-D`, JSON.stringify({ w: b.weftSpecId, d: b.weaveDesignId }));
  check("§2b varyant seçilmedi → recipeId yok", !("recipeId" in b));
  const c = await mk({ itemId: built, weftSpecId: null, weaveDesignId: null });
  check("§2c açık null → kartsız (ön dolgu ezmez)", !("weftSpecId" in c) && !("weaveDesignId" in c));
  const d = await mk({ itemId: built, recipeId: recipe.id });
  check("§2d varyant seçimi taşınır", d.recipeId === recipe.id && d.recipe?.variantCode === "V01" && d.weftSpecId === weft.id);

  console.log("§3 kapılar");
  const mismatch = await errOf(() => mk({ itemId: built, recipeId: foreign.id }));
  check("§3a başka ürünün varyantı 400 RECIPE_ITEM_MISMATCH", mismatch?.status === 400 && mismatch.code === "RECIPE_ITEM_MISMATCH", JSON.stringify(mismatch));
  const pas = await errOf(() => mk({ itemId: built, weaveDesignId: passive.id }));
  check("§3b pasif desen 400 WEAVE_DESIGN_NOT_USABLE", pas?.status === 400 && pas.code === "WEAVE_DESIGN_NOT_USABLE", JSON.stringify(pas));
  const retarget = await errOf(() => updateWeavingOrder(d.id, { itemId: other }, admin.id));
  check("§3c varyantlı işin ürünü değişirse 400 RECIPE_ITEM_MISMATCH", retarget?.code === "RECIPE_ITEM_MISMATCH", JSON.stringify(retarget));

  console.log("§4 güncelleme: iş emri kendi seçimini taşır");
  const u = (await updateWeavingOrder(a.id, { recipeId: null, weaveDesignId: design.id }, admin.id)).data!;
  check("§4a yapısız işe desen elle bağlanır", u.weaveDesignId === design.id && !("weftSpecId" in u));
  await prisma.item.update({ where: { id: built }, data: { weaveDesignId: null } });
  const bAfter = (await getWeavingOrder(b.id)).data!;
  check("§4b ürün kartı sonradan değişince iş emri DEĞİŞMEZ", bAfter.weaveDesignId === design.id);
}

async function cleanup(): Promise<void> {
  const t = async (f: () => Promise<unknown>): Promise<void> => { await f().catch((e) => { fail++; console.log(`  ✗ temizlik: ${(e as Error).message.slice(0, 160)}`); }); };
  await t(() => prisma.systemLog.deleteMany({ where: { tableName: "WEAVING_ORDER", recordId: { in: ids.wo } } }));
  await t(() => prisma.weavingOrder.deleteMany({ where: { id: { in: ids.wo } } }));
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
