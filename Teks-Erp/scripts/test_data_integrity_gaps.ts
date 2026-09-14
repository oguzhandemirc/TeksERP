// =============================================================================
// Test: Veri-bütünlüğü açık taraması düzeltmeleri (2026-07-27)
// Çalıştır: npx tsx scripts/test_data_integrity_gaps.ts
// Doğrulananlar (mükerrer/girdi açıklarının "bunun gibi" benzerleri):
//   1. Müşteri vergi no mükerrer 409; ad-değişmeyen/no-değişmeyen update serbest
//   2. Fason firma vergi no mükerrer 409
//   3. Yetki şablonu adı tr-duyarsız fold ('Depocu' vs 'depocu') 409
//   4. Kullanıcı adı harf-duyarsız ('Depocu' vs 'depocu') 409
//   5. Şube: salt-boşluk ad reddi + müşteri-içi kod mükerrer 409
//   6. Sipariş kalemi en (width): 0/negatif reddi
//   7. Reçete: ürünün izinli renk listesi dışı renk reddi
//   8. Rota: planlanan fason firma gerekli kategoride değilse reddi
// =============================================================================
import prisma from "../src/lib/prisma";
import { CustomerService } from "../src/services/customer.service";
import { OrderService } from "../src/services/order.service";
import {
  SubcontractorManagementService,
  SubcontractorCategoryService,
} from "../src/services/subcontractor-management.service";
import { PermissionManagementService } from "../src/services/permission-management.service";
import { CustomerBranchService } from "../src/services/customer-branch.service";
import { ProductRecipeService } from "../src/services/product-recipe.service";
import { RouteService, ROUTE_SERVICE_CONFIG } from "../src/services/route.service";
import { ItemService } from "../src/services/item.service";
import { ColorService } from "../src/services/color.service";

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
async function expectReject(label: string, fn: () => Promise<unknown>, msgPart: string) {
  try { await fn(); check(label, false, "hata beklenirken başarı"); }
  catch (e) { const m = e instanceof Error ? e.message : String(e); check(label, m.includes(msgPart), m); }
}

async function main() {
  const sfx = `${Date.now()}`.slice(-8);
  const made = {
    customerIds: [] as string[], subIds: [] as string[], subCatIds: [] as string[],
    templateIds: [] as string[], userIds: [] as string[], itemIds: [] as string[],
    colorIds: [] as string[], routeIds: [] as string[], recipeIds: [] as string[],
    orderIds: [] as string[], stationIds: [] as string[],
  };

  const customerSvc = new CustomerService({ modelName: "customer", tableName: "CUSTOMER", uniqueField: "code", duplicateNameField: "name", entityLabel: "müşteri", nestedCreateFields: ["branches"] });
  const subSvc = new SubcontractorManagementService();
  const subCatSvc = new SubcontractorCategoryService();
  const branchSvc = new CustomerBranchService();
  const itemSvc = new ItemService({ modelName: "item", tableName: "ITEM", duplicateNameField: "name", entityLabel: "ürün" });
  const colorSvc = new ColorService({ modelName: "color", tableName: "COLOR", uniqueField: "code" });
  const recipeSvc = new ProductRecipeService({ modelName: "productRecipe", tableName: "PRODUCT_RECIPE", nestedCreateFields: ["properties"], uniqueField: "code" });
  const routeSvc = new RouteService(ROUTE_SERVICE_CONFIG);
  const orderSvc = new OrderService({ modelName: "order", tableName: "ORDER", nestedCreateFields: ["lines"] });

  try {
    // --- 1) Müşteri vergi no ---
    const cu1 = await customerSvc.create({ name: `TDG Müşteri A ${sfx}`, taxNumber: "1234567890" }, undefined);
    const cu1id = (cu1.data as { id: string }).id; made.customerIds.push(cu1id);
    await expectReject("Müşteri: aynı vergi no 409",
      () => customerSvc.create({ name: `TDG Müşteri B ${sfx}`, taxNumber: "1234567890" }, undefined), "vergi numarası");
    // Farklı vergi no serbest
    const cu2 = await customerSvc.create({ name: `TDG Müşteri C ${sfx}`, taxNumber: "9876543210" }, undefined);
    made.customerIds.push((cu2.data as { id: string }).id);
    check("Müşteri: farklı vergi no serbest", true);
    // Vergi no DEĞİŞMEYEN update (ad değişir) serbest
    const upd = await customerSvc.update(cu1id, { name: `TDG Müşteri A2 ${sfx}`, taxNumber: "1234567890" }, undefined);
    check("Müşteri: vergi-no-değişmeyen update serbest", upd.success === true);

    // --- 2) Fason firma vergi no ---
    const sb1 = await subSvc.create({ code: `TDG-SB1-${sfx}`, name: `TDG Fason A ${sfx}`, taxNumber: "5555555555" }, undefined);
    made.subIds.push((sb1.data as { id: string }).id);
    await expectReject("Fason firma: aynı vergi no 409",
      () => subSvc.create({ code: `TDG-SB2-${sfx}`, name: `TDG Fason B ${sfx}`, taxNumber: "5555555555" }, undefined), "vergi numarası");

    // --- 3) Yetki şablonu adı fold ---
    const perm = await prisma.permission.findFirst({ select: { id: true } });
    if (perm) {
      const t1 = await PermissionManagementService.createTemplate({ name: `TDG Şablon ${sfx}`, permissionIds: [perm.id] }, undefined);
      made.templateIds.push((t1 as { id: string }).id);
      await expectReject("Şablon: tr-duyarsız ad mükerrer 409",
        () => PermissionManagementService.createTemplate({ name: `tdg şablon ${sfx}`, permissionIds: [perm.id] }, undefined), "zaten var");
    } else { check("şablon testi ÖN KOŞULU: izin kataloğu dolu (boot uzlaştırması)", false, "permission satırı yok"); }

    // --- 4) Kullanıcı adı harf-duyarsız ---
    const u1 = await PermissionManagementService.createUser(
      { username: `TdgUser${sfx}`, fullName: "TDG User", password: "test123", grantOperatorDefaults: false, generateMobileCredentials: false }, undefined);
    made.userIds.push((u1 as { id: string }).id);
    await expectReject("Kullanıcı adı: harf-duyarsız mükerrer 409",
      () => PermissionManagementService.createUser(
        { username: `tdguser${sfx}`, fullName: "TDG User 2", password: "test123", grantOperatorDefaults: false, generateMobileCredentials: false }, undefined), "kullanıcı adı");

    // --- 5) Şube: salt-boşluk ad + kod mükerrer ---
    await expectReject("Şube: salt-boşluk ad reddi",
      () => branchSvc.create(cu1id, { name: "   " }, undefined), "zorunlu");
    await branchSvc.create(cu1id, { name: `TDG Şube ${sfx}`, code: `SB-${sfx}` }, undefined);
    await expectReject("Şube: aynı müşteride mükerrer kod 409",
      () => branchSvc.create(cu1id, { name: `TDG Şube 2 ${sfx}`, code: `sb-${sfx}` }, undefined), "kodlu");

    // --- Fixtures: item + color (recipe/order için) ---
    const colorInList = await colorSvc.create({ code: `TDG-COL-IN-${sfx}`, name: `TDG Renk İçi ${sfx}` }, undefined);
    const colorInId = (colorInList.data as { id: string }).id; made.colorIds.push(colorInId);
    const colorOut = await colorSvc.create({ code: `TDG-COL-OUT-${sfx}`, name: `TDG Renk Dışı ${sfx}` }, undefined);
    const colorOutId = (colorOut.data as { id: string }).id; made.colorIds.push(colorOutId);
    // İzinli renk listesi SADECE colorIn olan ürün
    const it1 = await itemSvc.create(
      { name: `TDG Kumaş ${sfx}`, itemType: "FABRIC", unit: "MT", allowedColorIds: [colorInId] }, undefined);
    const it1id = (it1.data as { id: string }).id; made.itemIds.push(it1id);

    // --- 6) Sipariş kalemi en (width) ---
    await expectReject("Sipariş: en=0 reddi",
      () => orderSvc.create({ orderNumber: `TDG-ORD-W0-${sfx}`, customerId: cu1id, status: "APPROVED",
        lines: [{ itemId: it1id, quantity: 10, width: 0 }] }, undefined), "en pozitif");
    await expectReject("Sipariş: negatif en reddi",
      () => orderSvc.create({ orderNumber: `TDG-ORD-WN-${sfx}`, customerId: cu1id, status: "APPROVED",
        lines: [{ itemId: it1id, quantity: 10, width: -5 }] }, undefined), "en pozitif");
    const okOrder = await orderSvc.create({ orderNumber: `TDG-ORD-OK-${sfx}`, customerId: cu1id, status: "APPROVED",
      lines: [{ itemId: it1id, quantity: 10, width: 150, colorId: colorInId }] }, undefined);
    made.orderIds.push((okOrder.data as { id: string }).id);
    check("Sipariş: geçerli en + izinli renk serbest", true);

    // --- 7) Reçete: ürünün izinli renk listesi dışı renk ---
    await expectReject("Reçete: izinli-liste-dışı renk reddi",
      () => recipeSvc.create({ code: `TDG-RCP-BAD-${sfx}`, name: `TDG Reçete Kötü ${sfx}`, itemId: it1id, colorId: colorOutId }, undefined),
      "izinli renk listesinde değil");
    const okRecipe = await recipeSvc.create({ code: `TDG-RCP-OK-${sfx}`, name: `TDG Reçete İyi ${sfx}`, itemId: it1id, colorId: colorInId }, undefined);
    made.recipeIds.push((okRecipe.data as { id: string }).id);
    check("Reçete: izinli renk serbest", true);

    // --- 8) Rota: planlanan fason gerekli kategoride değil ---
    const cat1 = await subCatSvc.create({ code: `TDG-CAT1-${sfx}`, name: `TDG Kategori 1 ${sfx}` }, undefined);
    const cat1id = (cat1.data as { id: string }).id; made.subCatIds.push(cat1id);
    const cat2 = await subCatSvc.create({ code: `TDG-CAT2-${sfx}`, name: `TDG Kategori 2 ${sfx}` }, undefined);
    const cat2id = (cat2.data as { id: string }).id; made.subCatIds.push(cat2id);
    // Fason firma YALNIZ cat1'e bağlı
    const fason = await subSvc.create({ code: `TDG-FSN-${sfx}`, name: `TDG Fason Rota ${sfx}`, categoryIds: [cat1id] }, undefined);
    const fasonId = (fason.data as { id: string }).id; made.subIds.push(fasonId);
    const station = await prisma.station.create({ data: { code: `TDG-ST-${sfx}`, name: `TDG İst ${sfx}`, kind: "SUBCONTRACTOR", type: "EXTERNAL" } });
    made.stationIds.push(station.id);
    await expectReject("Rota: fason firma gerekli kategoride değil 409",
      () => routeSvc.create({ code: `TDG-RT-BAD-${sfx}`, name: `TDG Rota Kötü ${sfx}`,
        steps: [{ sequence: 1, stationId: station.id, requiredCategoryId: cat2id, plannedSubcontractorId: fasonId }] }, undefined),
      "hizmet vermiyor");
    const okRoute = await routeSvc.create({ code: `TDG-RT-OK-${sfx}`, name: `TDG Rota İyi ${sfx}`,
      steps: [{ sequence: 1, stationId: station.id, requiredCategoryId: cat1id, plannedSubcontractorId: fasonId }] }, undefined);
    made.routeIds.push((okRoute.data as { id: string }).id);
    check("Rota: fason firma doğru kategoride serbest", true);
  } finally {
    await prisma.orderLine.deleteMany({ where: { orderId: { in: made.orderIds } } }).catch(() => {});
    await prisma.order.deleteMany({ where: { id: { in: made.orderIds } } }).catch(() => {});
    await prisma.routeStep.deleteMany({ where: { routeId: { in: made.routeIds } } }).catch(() => {});
    await prisma.route.deleteMany({ where: { id: { in: made.routeIds } } }).catch(() => {});
    await prisma.productRecipeProperty.deleteMany({ where: { recipeId: { in: made.recipeIds } } }).catch(() => {});
    await prisma.productRecipe.deleteMany({ where: { id: { in: made.recipeIds } } }).catch(() => {});
    await prisma.station.deleteMany({ where: { id: { in: made.stationIds } } }).catch(() => {});
    await prisma.itemAllowedColor.deleteMany({ where: { itemId: { in: made.itemIds } } }).catch(() => {});
    await prisma.item.deleteMany({ where: { id: { in: made.itemIds } } }).catch(() => {});
    await prisma.color.deleteMany({ where: { id: { in: made.colorIds } } }).catch(() => {});
    await prisma.subcontractorToCategory.deleteMany({ where: { subcontractorId: { in: made.subIds } } }).catch(() => {});
    await prisma.subcontractor.deleteMany({ where: { id: { in: made.subIds } } }).catch(() => {});
    await prisma.subcontractorCategory.deleteMany({ where: { id: { in: made.subCatIds } } }).catch(() => {});
    await prisma.permissionTemplateItem.deleteMany({ where: { templateId: { in: made.templateIds } } }).catch(() => {});
    await prisma.permissionTemplate.deleteMany({ where: { id: { in: made.templateIds } } }).catch(() => {});
    await prisma.userPermission.deleteMany({ where: { userId: { in: made.userIds } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: made.userIds } } }).catch(() => {});
    await prisma.customerBranch.deleteMany({ where: { customerId: { in: made.customerIds } } }).catch(() => {});
    await prisma.customer.deleteMany({ where: { id: { in: made.customerIds } } }).catch(() => {});
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
