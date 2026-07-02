// =============================================================================
// TEST: master-data validation guard'ları — PR-3
// Çalıştır: npx tsx scripts/test_masterdata_guards.ts
// =============================================================================
// 1) relabel (applyManualProperties) allowed-property guard — createInitialEntry
//    PARİTE: item'ın allowed listesi doluysa liste-dışı özellik → 400.
// 2) LabelFormatProfileService validateRefs — widthMm/heightMm/dpi > 0, margin/gap >= 0 → 400.
// (PrinterModelService bölümü 2026-07'de katalogla birlikte kaldırıldı.)
// =============================================================================

import prisma from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { LabelFormatProfileService } from "../src/services/label-format-profile.service";
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

const inv = new InventoryService();
const labelProfiles = new LabelFormatProfileService({ modelName: "labelFormatProfile", tableName: "LABEL_FORMAT_PROFILE", uniqueField: "code" });

const stamp = Date.now().toString().slice(-7);
const profileIds: string[] = [];
let ITEM = "",
  ROLL = "",
  PROP_A = "",
  PROP_B = "";

async function main(): Promise<void> {
  const props = await prisma.fabricProperty.findMany({ where: { isActive: true }, select: { id: true }, take: 2 });
  PROP_A = need(props[0], "aktif FabricProperty #1").id;
  PROP_B = need(props[1], "aktif FabricProperty #2").id;

  // Allowed listesi DOLU bir item (yalnız PROP_A izinli) + bir top.
  const item = await prisma.item.create({
    data: {
      code: `TST-MDG-I-${stamp}`,
      name: "MDG TEST ÜRÜN",
      itemType: "FABRIC",
      unit: "MT",
      allowedProperties: { create: [{ propertyId: PROP_A }] },
    },
    select: { id: true },
  });
  ITEM = item.id;
  const roll = await prisma.roll.create({
    data: {
      barcode: `TST-MDG-R-${stamp}`,
      itemId: ITEM,
      colorId: null,
      status: "WAREHOUSE",
      currentQty: 100,
      initialQty: 100,
      width: 150,
      qualityGrade: "B",
      entrySource: "SUPPLIER_RECEIPT",
    },
    select: { id: true },
  });
  ROLL = roll.id;

  try {
    console.log("\n=== 1) relabel allowed-property guard ===");
    let nonAllowed: unknown;
    try {
      await inv.applyManualProperties(ROLL, { colorId: null, propertyIds: [PROP_B] }, undefined);
    } catch (e) {
      nonAllowed = e;
    }
    check("liste-dışı özellik → 400", is400(nonAllowed));
    // İzinli özellik → ok (pozitif kontrol)
    await inv.applyManualProperties(ROLL, { colorId: null, propertyIds: [PROP_A] }, undefined);
    const after = await prisma.roll.findUnique({ where: { id: ROLL }, select: { properties: { select: { propertyId: true } } } });
    check("izinli özellik → uygulandı", after?.properties.length === 1 && after.properties[0].propertyId === PROP_A);

    console.log("\n=== 2) LabelFormatProfileService guard ===");
    // Geçerli profil (pozitif yol)
    const okProfileRes = await labelProfiles.create(
      { code: `TST-MDG-LP-OK-${stamp}`, name: "ok", widthMm: 100, heightMm: 148, dpi: 203, marginMm: 3, gapMm: 2 },
      undefined
    );
    const okProfileId = (okProfileRes.data as { id?: string } | null)?.id;
    if (okProfileId) profileIds.push(okProfileId);
    check("geçerli label-format-profile → ok", okProfileRes.success === true && !!okProfileId);

    let w0: unknown, marginNeg: unknown;
    try {
      await labelProfiles.create({ code: `TST-MDG-LP-W-${stamp}`, name: "x", widthMm: 0, heightMm: 148 }, undefined);
    } catch (e) {
      w0 = e;
    }
    check("widthMm:0 → 400", is400(w0));
    try {
      await labelProfiles.create({ code: `TST-MDG-LP-M-${stamp}`, name: "x", widthMm: 100, heightMm: 148, marginMm: -1 }, undefined);
    } catch (e) {
      marginNeg = e;
    }
    check("marginMm:-1 → 400", is400(marginNeg));
  } finally {
    await prisma.labelFormatProfile.deleteMany({ where: { code: { startsWith: "TST-MDG-LP-" } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: ROLL } });
    await prisma.roll.deleteMany({ where: { id: ROLL } });
    await prisma.itemAllowedProperty.deleteMany({ where: { itemId: ITEM } });
    await prisma.item.deleteMany({ where: { id: ITEM } });
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
