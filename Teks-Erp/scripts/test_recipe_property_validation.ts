// =============================================================================
// TEST: ProductRecipe properties[] isActive + dedup guard (backlog #7)
// Çalıştır: npx tsx scripts/test_recipe_property_validation.ts
// =============================================================================
// validateRefs: properties[].propertyId varlık+isActive doğrular (soft-delete giriş
// guard'ı). create/update: dedup → @@unique([recipeId,propertyId]) ihlali (409) önlenir.
// =============================================================================

import prisma from "../src/lib/prisma";
import { ProductRecipeService } from "../src/services/product-recipe.service";
import { AppError } from "../src/utils/app-error";

let pass = 0,
  fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}
function need<T>(v: T | null | undefined, what: string): T {
  if (v == null) throw new Error(`Fixture bulunamadı: ${what}`);
  return v;
}
const is400 = (e: unknown) => e instanceof AppError && e.statusCode === 400;
const NONEXISTENT = "00000000-0000-0000-0000-000000000000";

const recipes = new ProductRecipeService({
  modelName: "productRecipe",
  tableName: "PRODUCT_RECIPE",
  nestedCreateFields: ["properties"],
});
let ITEM = "",
  PROP = "",
  ADMIN = "";

async function main(): Promise<void> {
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS").id;
  PROP = need(await prisma.fabricProperty.findFirst({ where: { isActive: true }, select: { id: true } }), "aktif FabricProperty").id;
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin").id;
  const stamp = Date.now().toString().slice(-6);

  try {
    console.log("\n=== ProductRecipe properties[] guard ===");

    // A) geçersiz propertyId → 400
    let badProp: unknown;
    try {
      await recipes.create(
        { code: `TST-RCP-BADP-${stamp}`, name: `t-badp-${stamp}`, itemId: ITEM, properties: [{ propertyId: NONEXISTENT }] },
        ADMIN
      );
    } catch (e) {
      badProp = e;
    }
    check("geçersiz propertyId → 400", is400(badProp));

    // B) DUPLICATE propertyId → success + dedup (tek satır)
    const dupRes = await recipes.create(
      {
        code: `TST-RCP-DUP-${stamp}`,
        // ⚠️ Ad da benzersiz: `product_recipes` ad seddi (2026-08-31, T1-007);
        // üç reçetenin üçü de "t" adını taşıyordu, ikincisi P2002 alıyordu.
        name: `t-dup-${stamp}`,
        itemId: ITEM,
        properties: [{ propertyId: PROP }, { propertyId: PROP }],
      },
      ADMIN
    );
    const dupId = (dupRes.data as { id?: string } | null)?.id;
    check("mükerrer propertyId → success (P2002 değil)", dupRes.success === true && !!dupId);
    if (dupId) {
      const propCount = await prisma.productRecipeProperty.count({ where: { recipeId: dupId } });
      check("mükerrer propertyId dedup edildi (tek satır)", propCount === 1, `count=${propCount}`);
    }

    // C) geçerli tek property → success
    const okRes = await recipes.create(
      { code: `TST-RCP-OK-${stamp}`, name: `t-ok-${stamp}`, itemId: ITEM, properties: [{ propertyId: PROP }] },
      ADMIN
    );
    check("geçerli property → success", okRes.success === true);
  } finally {
    await prisma.productRecipeProperty.deleteMany({ where: { recipe: { code: { startsWith: "TST-RCP-" } } } }).catch(() => undefined);
    await prisma.productRecipe.deleteMany({ where: { code: { startsWith: "TST-RCP-" } } });
    console.log("(test verisi temizlendi)");
  }

  console.log("──────────────────────────────────────────");
  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
