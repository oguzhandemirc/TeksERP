// =============================================================================
// TEST: Manuel nitelik düzeltme + zorunlu sebep (applyManualProperties reason)
// Çalıştır: npx tsx scripts/test_manual_attributes_reason.ts
// =============================================================================
// Kapsam (PR-2):
//   1) reason ile çağrı → audit event=MANUAL_ATTRIBUTE + reason kaydedilir.
//   2) reason'sız çağrı (saha Yeniden Etiketle yolu) → event=RELABEL (geriye uyum).
//   3) SCRAP/CANCELLED top → reddedilir.
//   4) Barkodsuz açık kumaşta da çalışır (rollId tabanlı).
//   5) Geçersiz/pasif renk → reddedilir.
// =============================================================================

import prisma from "../src/lib/prisma";
import { roleGrade } from "./fixture-quality-grade";
import { InventoryService } from "../src/services/inventory.service";
import { RollStatus } from "@prisma/client";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}
async function expectThrow(label: string, fn: () => Promise<unknown>): Promise<void> {
  try { await fn(); check(label, false, "hata bekleniyordu, atılmadı"); }
  catch { check(label, true); }
}

const inv = new InventoryService();
let ITEM = "", GRADE = "", ADMIN = "", COLOR = "", PROPERTY = "";
let GRADE_CODE = "";
const rollIds: string[] = [];
let bc = 0;
function barcode(): string { bc++; return `TST-MAN-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase()}${bc}`; }

async function resolveFixtures(): Promise<void> {
  const need = (v: { id: string } | null, label: string): string => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed')`);
    return v.id;
  };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS");
  const _gradeRow = await roleGrade("FIRST");
  GRADE = _gradeRow.id;
  GRADE_CODE = _gradeRow.code;
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin");
  // Item allowed-list varsa onun içinden seç (aksi halde applyManualProperties reddeder).
  const allowedColor = await prisma.itemAllowedColor.findFirst({ where: { itemId: ITEM }, select: { colorId: true } });
  COLOR = allowedColor?.colorId
    ?? need(await prisma.color.findFirst({ where: { isActive: true }, select: { id: true } }), "renk");
  const allowedProp = await prisma.itemAllowedProperty.findFirst({ where: { itemId: ITEM }, select: { propertyId: true } });
  PROPERTY = allowedProp?.propertyId
    ?? need(await prisma.fabricProperty.findFirst({ where: { isActive: true }, select: { id: true } }), "özellik");
}

async function makeRoll(status: RollStatus, withBarcode: boolean): Promise<string> {
  const r = await prisma.roll.create({
    data: {
      barcode: withBarcode ? barcode() : null,
      itemId: ITEM, initialQty: 100, currentQty: 100,
      status, qualityGrade: GRADE_CODE, qualityGradeId: GRADE,
      entrySource: withBarcode ? "SUPPLIER_RECEIPT" : "SUBCONTRACTOR_RETURN",
      createdById: ADMIN,
    },
    select: { id: true },
  });
  rollIds.push(r.id);
  return r.id;
}

async function lastOverrideLog(rollId: string): Promise<Record<string, unknown> | null> {
  const log = await prisma.systemLog.findFirst({
    where: { recordId: rollId, tableName: "ROLL_MANUAL_OVERRIDE" },
    orderBy: { createdAt: "desc" },
    select: { newData: true },
  });
  return (log?.newData ?? null) as Record<string, unknown> | null;
}

async function main(): Promise<void> {
  await resolveFixtures();
  try {
    console.log("\n=== 1) reason ile → MANUAL_ATTRIBUTE ===");
    const r1 = await makeRoll(RollStatus.STOCK, true);
    await inv.applyManualProperties(r1, { colorId: COLOR, propertyIds: [PROPERTY], reason: "Saha: yanlış renk düzeltildi" }, ADMIN);
    const log1 = await lastOverrideLog(r1);
    check("audit event=MANUAL_ATTRIBUTE", log1?.event === "MANUAL_ATTRIBUTE", `event=${log1?.event}`);
    check("audit reason kaydedildi", log1?.reason === "Saha: yanlış renk düzeltildi");
    const r1after = await prisma.roll.findUniqueOrThrow({ where: { id: r1 }, select: { colorId: true } });
    check("renk uygulandı", r1after.colorId === COLOR);

    console.log("\n=== 2) reason'sız → RELABEL (geriye uyum) ===");
    const r2 = await makeRoll(RollStatus.STOCK, true);
    await inv.applyManualProperties(r2, { colorId: COLOR, propertyIds: [] }, ADMIN);
    const log2 = await lastOverrideLog(r2);
    check("audit event=RELABEL", log2?.event === "RELABEL", `event=${log2?.event}`);
    check("audit reason=null", log2?.reason === null);

    console.log("\n=== 3) SCRAP/CANCELLED reddedilir ===");
    const rScrap = await makeRoll(RollStatus.SCRAP, true);
    await expectThrow("SCRAP top → red", () =>
      inv.applyManualProperties(rScrap, { colorId: COLOR, propertyIds: [], reason: "test" }, ADMIN));
    const rCancel = await makeRoll(RollStatus.CANCELLED, true);
    await expectThrow("CANCELLED top → red", () =>
      inv.applyManualProperties(rCancel, { colorId: COLOR, propertyIds: [], reason: "test" }, ADMIN));

    console.log("\n=== 4) Barkodsuz açık kumaşta çalışır ===");
    const rOpen = await makeRoll(RollStatus.IN_PRODUCTION, false);
    await inv.applyManualProperties(rOpen, { colorId: COLOR, propertyIds: [PROPERTY], reason: "Açık kumaş renk düzelt" }, ADMIN);
    const rOpenAfter = await prisma.roll.findUniqueOrThrow({ where: { id: rOpen }, select: { colorId: true } });
    check("barkodsuz top rengi uygulandı", rOpenAfter.colorId === COLOR);

    console.log("\n=== 5) Geçersiz renk reddedilir ===");
    const r5 = await makeRoll(RollStatus.STOCK, true);
    await expectThrow("geçersiz colorId → red", () =>
      inv.applyManualProperties(r5, { colorId: "00000000-0000-0000-0000-000000000000", propertyIds: [], reason: "test" }, ADMIN));
  } finally {
    await cleanup();
    console.log("(test verisi temizlendi)");
  }
  console.log("──────────────────────────────────────────");
  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

async function cleanup(): Promise<void> {
  await prisma.systemLog.deleteMany({ where: { recordId: { in: rollIds }, tableName: "ROLL_MANUAL_OVERRIDE" } });
  await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
