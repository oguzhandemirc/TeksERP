// =============================================================================
// TEST: master-data validation guard'ları — PR-3
// Çalıştır: npx tsx scripts/test_masterdata_guards.ts
// =============================================================================
// 1) relabel (applyManualProperties) allowed-property guard — createInitialEntry
//    PARİTE: item'ın allowed listesi doluysa liste-dışı özellik → 400.
// (LabelFormatProfileService bölümü 2026-07'de "Boyutlar" kataloğu emekliye ayrılınca
//  kaldırıldı — cihaz medyası validasyonu artık test_peripheral_registry_crud'da.
//  PrinterModelService bölümü de 2026-07'de katalogla birlikte kaldırıldı.)
// =============================================================================

import prisma from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
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

const stamp = Date.now().toString().slice(-7);
let ITEM = "",
  ROLL = "",
  PROP_A = "",
  PROP_B = "";

async function main(): Promise<void> {
  // ⚠️ FIXTURE **FLAG** SEÇMEK ZORUNDA (2026-09-05 yeşile-çekme):
  // `applyManualProperties` bir ECHO ucudur — SEÇİM (CHOICE) tipli id'yi
  // `partitionTargetableIds` ile SESSİZCE AYIRIR, 400 ATMAZ (docs/kurallar/
  // rota-renk.md: "echo uçları sessiz ayırma"). Eski fixture `valueType`
  // süzmeden "ilk iki aktif özellik"i alıyordu; DB'nin fiziksel sırası
  // değişip ikinci sıraya CHOICE olan "KAT" gelince liste-dışı özellik
  // sessizce ayrıldı ve beklenen 400 hiç doğmadı. Allowed-list paritesi
  // FLAG evreninde yaşar → fixture da FLAG seçer.
  const props = await prisma.fabricProperty.findMany({
    where: { isActive: true, valueType: "FLAG" },
    orderBy: { code: "asc" },
    select: { id: true, valueType: true },
    take: 2,
  });
  PROP_A = need(props[0], "aktif FLAG FabricProperty #1").id;
  PROP_B = need(props[1], "aktif FLAG FabricProperty #2").id;
  // Körlük zemini: fixture gerçekten FLAG mi — CHOICE'a kayarsa aşağıdaki
  // negatif kontrol vakumen yeşile döner (sessiz ayırma 400 üretmez).
  check(
    "körlük zemini: fixture özellikleri FLAG",
    props.every((p) => p.valueType === "FLAG"),
    props.map((p) => p.valueType).join(", "),
  );

  // Allowed listesi DOLU bir item (yalnız PROP_A izinli) + bir top.
  const item = await prisma.item.create({
    data: {
      code: `TST-MDG-I-${stamp}`,
      // Ad da damgalı — items.nameFold DB seddi (2026-08-21); artık kalan sabit ad
      // ikinci koşumu P2002'ye düşürürdü.
      name: `MDG TEST ÜRÜN ${stamp}`,
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
  } finally {
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
