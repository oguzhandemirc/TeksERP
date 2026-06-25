// =============================================================================
// TEST: master-data validation guard'ları — PR-3
// Çalıştır: npx tsx scripts/test_masterdata_guards.ts
// =============================================================================
// 1) relabel (applyManualProperties) allowed-property guard — createInitialEntry
//    PARİTE: item'ın allowed listesi doluysa liste-dışı özellik → 400.
// 2) PrinterModelService validateRefs — dpi/maxWidthMm > 0, pasif/yok defaultProfileId → 400.
// 3) LabelFormatProfileService validateRefs — widthMm/heightMm/dpi > 0, margin/gap >= 0 → 400.
// =============================================================================

import prisma from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { PrinterModelService, LabelFormatProfileService } from "../src/services/printer.service";
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
const printerModels = new PrinterModelService({ modelName: "printerModel", tableName: "PRINTER_MODEL", uniqueField: "code" });
const labelProfiles = new LabelFormatProfileService({ modelName: "labelFormatProfile", tableName: "LABEL_FORMAT_PROFILE", uniqueField: "code" });

const stamp = Date.now().toString().slice(-7);
const profileIds: string[] = [];
const printerModelIds: string[] = [];
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

    console.log("\n=== 2) PrinterModelService guard ===");
    let dpi0: unknown, mw0: unknown, badProfile: unknown;
    try {
      await printerModels.create({ code: `TST-MDG-PM-DPI-${stamp}`, name: "x", dpi: 0 }, undefined);
    } catch (e) {
      dpi0 = e;
    }
    check("dpi:0 → 400", is400(dpi0));
    try {
      await printerModels.create({ code: `TST-MDG-PM-MW-${stamp}`, name: "x", maxWidthMm: 0 }, undefined);
    } catch (e) {
      mw0 = e;
    }
    check("maxWidthMm:0 → 400", is400(mw0));
    try {
      await printerModels.create(
        { code: `TST-MDG-PM-BP-${stamp}`, name: "x", defaultProfileId: "00000000-0000-0000-0000-000000000000" },
        undefined
      );
    } catch (e) {
      badProfile = e;
    }
    check("yok defaultProfileId → 400", is400(badProfile));

    // Geçerli profil + geçerli printer-model (pozitif + defaultProfile pozitif yolu)
    const okProfileRes = await labelProfiles.create(
      { code: `TST-MDG-LP-OK-${stamp}`, name: "ok", widthMm: 100, heightMm: 148, dpi: 203, marginMm: 3, gapMm: 2 },
      undefined
    );
    const okProfileId = (okProfileRes.data as { id?: string } | null)?.id;
    if (okProfileId) profileIds.push(okProfileId);
    check("geçerli label-format-profile → ok", okProfileRes.success === true && !!okProfileId);

    const okPmRes = await printerModels.create(
      { code: `TST-MDG-PM-OK-${stamp}`, name: "ok", dpi: 203, maxWidthMm: 104, defaultProfileId: okProfileId },
      undefined
    );
    const okPmId = (okPmRes.data as { id?: string } | null)?.id;
    if (okPmId) printerModelIds.push(okPmId);
    check("geçerli printer-model (+aktif defaultProfile) → ok", okPmRes.success === true && !!okPmId);

    console.log("\n=== 3) LabelFormatProfileService guard ===");
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
    await prisma.printerModel.deleteMany({ where: { id: { in: printerModelIds } } });
    await prisma.printerModel.deleteMany({ where: { code: { startsWith: "TST-MDG-PM-" } } });
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
