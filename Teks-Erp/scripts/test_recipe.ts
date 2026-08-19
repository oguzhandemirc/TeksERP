// =============================================================================
// Test: ProductRecipeService — üretim reçetesi CRUD + özellik (M:N) replace
// Çalıştır: npx tsx scripts/test_recipe.ts
// =============================================================================
// ProductRecipeService BaseService'i genişletir (nestedCreateFields=["properties"],
// uniqueField="code") ve yalnız update()'i M:N drop-recreate için override eder.
// Doğrulananlar:
//   1. create reçeteyi + özellik M:N pivot'unu yazar (nested create)
//   2. create rota/renk/en alanlarını bağlar (defaultInclude ile döner)
//   3. update properties[] gönderince M:N TAMAMEN yeniden yazılır (deleteMany+create)
//   4. update properties[] vermeyince mevcut özellikler KORUNUR (skaler-only PATCH)
//   5. aynı kod ile ikinci create → AppError ("aktif kayıt zaten var") reddi
//   6. softDelete sonrası aynı kodla create → reactivate (isActive=true, aynı id)
// =============================================================================
import prisma from "../src/lib/prisma";
import { ProductRecipeService } from "../src/services/product-recipe.service";
import { BaseServiceConfig } from "../src/services/base.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
async function expectErr(label: string, part: string, fn: () => Promise<unknown>) {
  try { await fn(); check(label, false, "hata bekleniyordu, gelmedi"); }
  catch (e) { const m = e instanceof Error ? e.message : String(e); check(label, m.includes(part), m); }
}

// Route dosyasındaki konfigürasyonun aynısı (defaultInclude M:N pivot'u döndürür).
const recipeConfig: BaseServiceConfig = {
  modelName: "productRecipe",
  tableName: "PRODUCT_RECIPE",
  searchFields: ["name"],
  codeSearchFields: ["code"],
  nestedCreateFields: ["properties"],
  defaultInclude: {
    item: { select: { id: true, code: true, name: true } },
    color: { select: { id: true, code: true, name: true, hex: true } },
    route: { select: { id: true, code: true, name: true } },
    properties: {
      include: { property: { select: { id: true, code: true, name: true } } },
    },
  },
  uniqueField: "code",
};

type RecipeRow = {
  id: string;
  code: string;
  isActive: boolean;
  width: unknown;
  routeId: string | null;
  colorId: string | null;
  properties: Array<{ propertyId: string; property: { code: string } }>;
};

async function main() {
  const ts = Date.now();
  const svc = new ProductRecipeService(recipeConfig);

  // --- Fixture: seed master-data'sı business-key ile çöz (hardcoded UUID yok) ---
  const item = await prisma.item.findFirst({
    where: { isActive: true, itemType: "FABRIC" },
    select: { id: true },
  });
  const props = await prisma.fabricProperty.findMany({
    where: { isActive: true },
    orderBy: { code: "asc" },
    take: 2,
    select: { id: true, code: true },
  });
  const color = await prisma.color.findFirst({ where: { isActive: true }, select: { id: true } });
  const route = await prisma.route.findFirst({ where: { isActive: true }, select: { id: true } });

  if (!item) throw new Error("Seed eksik: aktif FABRIC ürünü yok (npm run seed)");
  if (props.length < 2) throw new Error("Seed eksik: en az 2 aktif kumaş özelliği gerekli (npm run seed)");
  const [propA, propB] = props;

  const CODE = `TEST-RCP-${ts}`;
  const idsToCleanup = new Set<string>();

  const reload = (id: string) =>
    prisma.productRecipe.findUnique({
      where: { id },
      include: { properties: { include: { property: { select: { code: true } } } } },
    }) as Promise<RecipeRow | null>;

  try {
    // 1) create — reçete + iki özellik M:N pivot
    const created = (await svc.create(
      {
        code: CODE,
        name: "TEST REÇETE",
        itemId: item.id,
        colorId: color?.id ?? null,
        routeId: route?.id ?? null,
        width: 138.5,
        foldType: "TUP",
        properties: [{ propertyId: propA.id }, { propertyId: propB.id }],
      },
      undefined,
    )).data as RecipeRow;
    idsToCleanup.add(created.id);

    check("create başarılı + id döndü", typeof created.id === "string" && created.code === CODE);

    const afterCreate = await reload(created.id);
    check(
      "create iki özellik M:N pivot'unu yazdı",
      !!afterCreate &&
        afterCreate.properties.length === 2 &&
        afterCreate.properties.map((p) => p.propertyId).sort().join(",") ===
          [propA.id, propB.id].sort().join(","),
      `count=${afterCreate?.properties.length}`,
    );

    // 2) defaultInclude skaler + ilişki alanlarını bağladı
    check(
      "create rota/renk/en alanlarını bağladı",
      created.routeId === (route?.id ?? null) &&
        created.colorId === (color?.id ?? null) &&
        Number(created.width) === 138.5,
      `width=${String(created.width)}`,
    );

    // 3) update properties[] → M:N TAMAMEN yeniden yazılır (yalnız propB kalmalı)
    await svc.update(created.id, { name: "TEST REÇETE v2", properties: [{ propertyId: propB.id }] }, undefined);
    const afterReplace = await reload(created.id);
    check(
      "update properties[] → M:N drop-recreate (yalnız propB)",
      !!afterReplace &&
        afterReplace.properties.length === 1 &&
        afterReplace.properties[0].propertyId === propB.id,
      `kalan=${afterReplace?.properties.map((p) => p.property.code).join(",")}`,
    );

    // 4) update properties[] vermeyince mevcut M:N KORUNUR (skaler-only PATCH)
    // ⚠️ foldType burada yalnız "skaler alan da gönderiliyor" demek için var;
    // 2026-08-10'dan beri KATALOG değeri olmak zorunda (eski "ACIK" serbest
    // metniydi). Rastgele bir değerle değiştirme — katalog doğrulaması reddeder.
    await svc.update(created.id, { name: "TEST REÇETE v3", foldType: "2-KAT" }, undefined);
    const afterScalar = await reload(created.id);
    check(
      "update properties'siz → mevcut özellik korundu",
      !!afterScalar &&
        afterScalar.properties.length === 1 &&
        afterScalar.properties[0].propertyId === propB.id,
      `count=${afterScalar?.properties.length}`,
    );

    // 5) aynı kod ile ikinci create → aktif kayıt çatışması reddi
    await expectErr("aynı kodla create → aktif kayıt reddi", "aktif kayıt zaten var", () =>
      svc.create({ code: CODE, name: "ÇAKIŞAN", itemId: item.id }, undefined),
    );

    // 6) softDelete → aynı kodla create reactivate eder (aynı id, isActive=true)
    await svc.softDelete(created.id, undefined);
    const afterSoft = await reload(created.id);
    check("softDelete isActive=false yaptı", afterSoft?.isActive === false);

    const reactivated = (await svc.create(
      { code: CODE, name: "TEST REÇETE REAKTIF", itemId: item.id },
      undefined,
    )).data as RecipeRow;
    idsToCleanup.add(reactivated.id);
    check(
      "soft-deleted kodla create → reactivate (aynı id + isActive=true)",
      reactivated.id === created.id && reactivated.isActive === true,
      `id eşit=${reactivated.id === created.id}`,
    );
  } finally {
    for (const id of idsToCleanup) {
      await prisma.productRecipeProperty.deleteMany({ where: { recipeId: id } }).catch(() => {});
      await prisma.productRecipe.delete({ where: { id } }).catch(() => {});
    }
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
