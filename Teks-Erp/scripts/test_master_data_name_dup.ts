// =============================================================================
// Test: Tanımlarda ad-mükerrer koruması (2026-07-27)
// Çalıştır: npx tsx scripts/test_master_data_name_dup.ts
// Doğrulananlar:
//   1. Renk: aynı ad 409; legacy tireli ad ile yeni boşluklu yazım da çakışır
//   2. Ürün: aynı ad (case-farklı) 409; farklı ad serbest
//   3. İstasyon (bare BaseService): aynı ad 409; pasif eş "aktifleştirin" 409
//   4. Makine: ad AYNI istasyonda tekil; farklı istasyonda aynı ad serbest
//   5. Müşteri: aynı ad 409
//   6. Fason firma + kategori: aynı ad 409
//   7. Müşteri şubesi: aynı müşteride aynı ad 409; farklı müşteride serbest;
//      inline branches[] dizi-içi mükerrer 400
//   8. Tarihsel mükerrer: ad DEĞİŞMEYEN update engellenmez
// =============================================================================
import prisma from "../src/lib/prisma";
import { BaseService } from "../src/services/base.service";
import { ItemService } from "../src/services/item.service";
import { ColorService } from "../src/services/color.service";
import { CustomerService } from "../src/services/customer.service";
import {
  SubcontractorManagementService,
  SubcontractorCategoryService,
} from "../src/services/subcontractor-management.service";
import { CustomerBranchService } from "../src/services/customer-branch.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

/** err 409/400 + mesaj parçası bekle. */
async function expectReject(
  label: string,
  fn: () => Promise<unknown>,
  msgPart: string,
): Promise<void> {
  try {
    await fn();
    check(label, false, "hata beklenirken başarı döndü");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    check(label, msg.includes(msgPart), msg);
  }
}

async function main() {
  const ts = Date.now();
  const suffix = `${ts}`.slice(-8);
  const created = {
    colorIds: [] as string[],
    itemIds: [] as string[],
    stationIds: [] as string[],
    machineIds: [] as string[],
    customerIds: [] as string[],
    subIds: [] as string[],
    subCatIds: [] as string[],
  };

  const colorSvc = new ColorService({
    modelName: "color",
    tableName: "COLOR",
    searchFields: ["name"],
    codeSearchFields: ["code"],
    uniqueField: "code",
  });
  const itemSvc = new ItemService({
    modelName: "item",
    tableName: "ITEM",
    searchFields: ["name"],
    codeSearchFields: ["code"],
    duplicateNameField: "name",
    entityLabel: "ürün",
  });
  const stationSvc = new BaseService({
    modelName: "station",
    tableName: "STATION",
    searchFields: ["name"],
    codeSearchFields: ["code"],
    uniqueField: "code",
    duplicateNameField: "name",
    entityLabel: "istasyon",
  });
  const machineSvc = new BaseService({
    modelName: "machine",
    tableName: "MACHINE",
    searchFields: ["name"],
    codeSearchFields: ["code"],
    uniqueField: "code",
    duplicateNameField: "name",
    duplicateNameScopeField: "stationId",
    entityLabel: "makine",
  });
  const customerSvc = new CustomerService({
    modelName: "customer",
    tableName: "CUSTOMER",
    searchFields: ["name"],
    codeSearchFields: ["code"],
    uniqueField: "code",
    duplicateNameField: "name",
    entityLabel: "müşteri",
    nestedCreateFields: ["branches"],
  });
  const subSvc = new SubcontractorManagementService();
  const subCatSvc = new SubcontractorCategoryService();
  const branchSvc = new CustomerBranchService();

  try {
    // --- 1) Renk ---
    const c1 = await colorSvc.create(
      { code: `TEST-DUP-C1-${suffix}`, name: `test dup gümüş ${suffix}` },
      undefined,
    );
    created.colorIds.push((c1.data as { id: string }).id);
    await expectReject(
      "Renk: aynı ad ikinci kez 409",
      () => colorSvc.create({ code: `TEST-DUP-C2-${suffix}`, name: `TEST DUP GÜMÜŞ ${suffix}` }, undefined),
      "zaten var",
    );
    // Legacy tireli ada karşı yeni boşluklu yazım
    const legacyName = `TESTDUP-${suffix}-GRİ`;
    const c3 = await prisma.color.create({
      data: { code: `TEST-DUP-C3-${suffix}`, name: legacyName },
    });
    created.colorIds.push(c3.id);
    await expectReject(
      "Renk: legacy tireli ada boşluklu yazım da çakışır",
      () => colorSvc.create({ code: `TEST-DUP-C4-${suffix}`, name: `testdup ${suffix} gri` }, undefined),
      "zaten var",
    );

    // --- 2) Ürün ---
    const i1 = await itemSvc.create(
      { name: `test dup kumaş ${suffix}`, itemType: "FABRIC", unit: "MT" },
      undefined,
    );
    created.itemIds.push((i1.data as { id: string }).id);
    await expectReject(
      "Ürün: aynı ad (case-farklı) 409",
      () => itemSvc.create({ name: `TEST DUP KUMAŞ ${suffix}`, itemType: "FABRIC", unit: "MT" }, undefined),
      "zaten var",
    );
    const i2 = await itemSvc.create(
      { name: `test dup kumaş b ${suffix}`, itemType: "FABRIC", unit: "MT" },
      undefined,
    );
    created.itemIds.push((i2.data as { id: string }).id);
    check("Ürün: farklı ad serbest", true);

    // --- 3) İstasyon + pasif eş ---
    const s1 = await stationSvc.create(
      { code: `TEST-DUP-S1-${suffix}`, name: `Test Dup İstasyon ${suffix}`, kind: "OTHER", type: "INTERNAL" },
      undefined,
    );
    const s1id = (s1.data as { id: string }).id;
    created.stationIds.push(s1id);
    await expectReject(
      "İstasyon: aynı ad 409",
      () => stationSvc.create({ code: `TEST-DUP-S2-${suffix}`, name: `test dup istasyon ${suffix}`, kind: "OTHER", type: "INTERNAL" }, undefined),
      "zaten var",
    );
    await prisma.station.update({ where: { id: s1id }, data: { isActive: false } });
    await expectReject(
      "İstasyon: pasif eş 'aktifleştirin' 409",
      () => stationSvc.create({ code: `TEST-DUP-S3-${suffix}`, name: `Test Dup İstasyon ${suffix}`, kind: "OTHER", type: "INTERNAL" }, undefined),
      "aktifleştirin",
    );
    await prisma.station.update({ where: { id: s1id }, data: { isActive: true } });

    // --- 4) Makine: istasyon-kapsamlı ---
    const s2 = await stationSvc.create(
      { code: `TEST-DUP-S4-${suffix}`, name: `Test Dup İstasyon B ${suffix}`, kind: "OTHER", type: "INTERNAL" },
      undefined,
    );
    const s2id = (s2.data as { id: string }).id;
    created.stationIds.push(s2id);
    const m1 = await machineSvc.create(
      { code: `TEST-DUP-M1-${suffix}`, name: `Test Makine ${suffix}`, stationId: s1id },
      undefined,
    );
    created.machineIds.push((m1.data as { id: string }).id);
    await expectReject(
      "Makine: aynı istasyonda aynı ad 409",
      () => machineSvc.create({ code: `TEST-DUP-M2-${suffix}`, name: `test makine ${suffix}`, stationId: s1id }, undefined),
      "zaten var",
    );
    const m3 = await machineSvc.create(
      { code: `TEST-DUP-M3-${suffix}`, name: `Test Makine ${suffix}`, stationId: s2id },
      undefined,
    );
    created.machineIds.push((m3.data as { id: string }).id);
    check("Makine: farklı istasyonda aynı ad serbest", true);
    await expectReject(
      "Makine: dolu istasyona aynı adla TAŞIMA 409",
      () => machineSvc.update((m3.data as { id: string }).id, { stationId: s1id }, undefined),
      "zaten var",
    );

    // --- 5) Müşteri (+ inline şube dizi-içi mükerrer) ---
    const cu1 = await customerSvc.create({ name: `Test Dup Müşteri ${suffix}` }, undefined);
    created.customerIds.push((cu1.data as { id: string }).id);
    await expectReject(
      "Müşteri: aynı ad 409",
      () => customerSvc.create({ name: `TEST DUP MÜŞTERİ ${suffix}` }, undefined),
      "zaten var",
    );
    await expectReject(
      "Müşteri: inline şube dizi-içi mükerrer 400",
      () =>
        customerSvc.create(
          {
            name: `Test Dup Müşteri B ${suffix}`,
            branches: [{ name: "Merkez" }, { name: "MERKEZ" }],
          },
          undefined,
        ),
      "tekrar edemez",
    );

    // --- 6) Fason firma + kategori ---
    const sc1 = await subCatSvc.create(
      { code: `TEST-DUP-SC1-${suffix}`, name: `Test Dup Kategori ${suffix}` },
      undefined,
    );
    created.subCatIds.push((sc1.data as { id: string }).id);
    await expectReject(
      "Fason kategorisi: aynı ad 409",
      () => subCatSvc.create({ code: `TEST-DUP-SC2-${suffix}`, name: `test dup kategori ${suffix}` }, undefined),
      "zaten var",
    );
    const sb1 = await subSvc.create(
      { code: `TEST-DUP-SB1-${suffix}`, name: `Test Dup Fason ${suffix}` },
      undefined,
    );
    created.subIds.push((sb1.data as { id: string }).id);
    await expectReject(
      "Fason firma: aynı ad 409",
      () => subSvc.create({ code: `TEST-DUP-SB2-${suffix}`, name: `TEST DUP FASON ${suffix}` }, undefined),
      "zaten var",
    );

    // --- 7) Müşteri şubesi: müşteri-kapsamlı ---
    const cuAId = created.customerIds[0]!;
    const cu2 = await customerSvc.create({ name: `Test Dup Müşteri C ${suffix}` }, undefined);
    const cuBId = (cu2.data as { id: string }).id;
    created.customerIds.push(cuBId);
    await branchSvc.create(cuAId, { name: `Test Şube ${suffix}` }, undefined);
    await expectReject(
      "Şube: aynı müşteride aynı ad 409",
      () => branchSvc.create(cuAId, { name: `TEST ŞUBE ${suffix}` }, undefined),
      "zaten var",
    );
    await branchSvc.create(cuBId, { name: `Test Şube ${suffix}` }, undefined);
    check("Şube: farklı müşteride aynı ad serbest", true);

    // --- 8) Tarihsel mükerrer düzenlenebilir kalır ---
    // İki aynı-adlı istasyonu koruma-öncesi veri gibi doğrudan DB'ye yaz.
    const legacyA = await prisma.station.create({
      data: { code: `TEST-DUP-L1-${suffix}`, name: `Test Legacy İst ${suffix}`, kind: "OTHER", type: "INTERNAL" },
    });
    const legacyB = await prisma.station.create({
      data: { code: `TEST-DUP-L2-${suffix}`, name: `Test Legacy İst ${suffix}`, kind: "OTHER", type: "INTERNAL" },
    });
    created.stationIds.push(legacyA.id, legacyB.id);
    const legacyUpdate = await stationSvc.update(
      legacyA.id,
      { name: `Test Legacy İst ` },
      undefined,
    );
    check("Tarihsel mükerrer: ad değişmeyen update serbest", legacyUpdate.success === true);
    await expectReject(
      "Update: ad BAŞKA kayıtla çakışırsa 409",
      () => stationSvc.update(legacyA.id, { name: `Test Dup İstasyon B ${suffix}` }, undefined),
      "zaten var",
    );
  } finally {
    // Cleanup — test kendi yarattığını siler (FK sırasına dikkat).
    await prisma.machine.deleteMany({ where: { id: { in: created.machineIds } } }).catch(() => {});
    await prisma.station.deleteMany({ where: { id: { in: created.stationIds } } }).catch(() => {});
    await prisma.customerBranch.deleteMany({ where: { customerId: { in: created.customerIds } } }).catch(() => {});
    await prisma.customer.deleteMany({ where: { id: { in: created.customerIds } } }).catch(() => {});
    await prisma.subcontractorToCategory.deleteMany({ where: { subcontractorId: { in: created.subIds } } }).catch(() => {});
    await prisma.subcontractor.deleteMany({ where: { id: { in: created.subIds } } }).catch(() => {});
    await prisma.subcontractorCategory.deleteMany({ where: { id: { in: created.subCatIds } } }).catch(() => {});
    await prisma.item.deleteMany({ where: { id: { in: created.itemIds } } }).catch(() => {});
    await prisma.color.deleteMany({ where: { id: { in: created.colorIds } } }).catch(() => {});
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
