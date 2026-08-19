// =============================================================================
// Test: Backend denetimi P0 regresyon kilitleri
// Çalıştır: npx tsx scripts/test_audit_p0.ts
// Doğrulananlar:
//   F208 — ItemService.update liste-replace dalı mass-assignment'a kapalı:
//     ham gövdeye gömülü nested ilişki-write'ı ({rolls:{deleteMany:{}}}) İŞLEMEZ,
//     ürünün Roll'ları silinmez; meşru scalar güncelleme (name) yine çalışır.
//   F112 — Roll.softDelete statü beyaz listesi: SHIPPED / *_CONSUMED / AT_KARTELA
//     topu iptal EDİLEMEZ (conflict); STOCK topu iptal EDİLEBİLİR (CANCELLED).
//   F129 — generateSplitBarcode ayraçsız (tire yok — el tarayıcı -→* bozmaz).
// =============================================================================
import prisma from "../src/lib/prisma";
import { ItemService } from "../src/services/item.service";
import { InventoryService } from "../src/services/inventory.service";
import { AppError } from "../src/utils/app-error";
import { RollStatus } from "@prisma/client";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

// Route config'iyle birebir (item.routes.ts).
const itemService = new ItemService({
  modelName: "item",
  tableName: "ITEM",
  searchFields: ["name"],
  codeSearchFields: ["code"],
  defaultInclude: {
    allowedColors: { include: { color: true } },
    allowedProperties: { include: { property: true } },
  },
});
const inventory = new InventoryService();

async function main() {
  const ts = Date.now();
  const itemCode = `TEST-P0-ITEM-${ts}`;
  let itemId = "";
  const rollIds: string[] = [];

  try {
    // ── Fixture: bir ürün + o ürüne bağlı bir Roll ──────────────────────────
    const created = await itemService.create(
      { code: itemCode, name: "TEST P0 URUN", itemType: "FABRIC", unit: "MT" },
      undefined,
    );
    itemId = (created.data as { id: string }).id;
    check("fixture: ürün oluştu", !!itemId, itemId);

    const guardRoll = await prisma.roll.create({
      data: {
        barcode: `TESTP0${ts}A`,
        itemId,
        initialQty: "100.000",
        currentQty: "100.000",
        qualityGrade: "1. Kalite",
        status: RollStatus.STOCK,
      },
      select: { id: true },
    });
    rollIds.push(guardRoll.id);

    // ── F208: kütlesel-atama ile Roll silme DENEMESİ ────────────────────────
    // Ham gövdeye Prisma nested-write gömüyoruz. Fix sayesinde sanitizeWriteData
    // 'rolls' anahtarını atmalı → guardRoll HAYATTA kalmalı.
    let f208Threw = false;
    try {
      await itemService.update(
        itemId,
        {
          allowedColorIds: [],
          rolls: { deleteMany: {} },
        } as unknown as Record<string, unknown>,
        undefined,
      );
    } catch {
      // Sanitize sessizce atar; hata beklemeyiz ama gelirse de silme olmamalı.
      f208Threw = true;
    }
    const guardStillThere = await prisma.roll.findUnique({
      where: { id: guardRoll.id },
      select: { id: true },
    });
    check(
      "F208: nested-write ile Roll silme ENGELLENDİ (guard roll hayatta)",
      guardStillThere !== null,
      f208Threw ? "(update hata verdi ama roll korundu)" : "",
    );

    // Meşru scalar güncelleme (name) hâlâ çalışıyor mu?
    await itemService.update(itemId, { name: "TEST P0 URUN 2" }, undefined);
    const renamed = await prisma.item.findUnique({
      where: { id: itemId },
      select: { name: true },
    });
    check(
      "F208: meşru name güncellemesi çalışıyor (regresyon yok)",
      renamed?.name === "TEST P0 URUN 2",
      renamed?.name,
    );

    // ── F112: softDelete statü beyaz listesi ────────────────────────────────
    // SHIPPED top → iptal edilemez (conflict).
    const shippedRoll = await prisma.roll.create({
      data: {
        barcode: `TESTP0${ts}S`,
        itemId,
        initialQty: "50.000",
        currentQty: "50.000",
        qualityGrade: "1. Kalite",
        status: RollStatus.SHIPPED,
      },
      select: { id: true },
    });
    rollIds.push(shippedRoll.id);
    let shippedBlocked = false;
    try {
      await inventory.softDelete(shippedRoll.id, undefined);
    } catch (e) {
      shippedBlocked = e instanceof AppError && e.statusCode === 409;
    }
    const shippedAfter = await prisma.roll.findUnique({
      where: { id: shippedRoll.id },
      select: { status: true },
    });
    check(
      "F112: SHIPPED top iptal ENGELLENDİ (409 conflict)",
      shippedBlocked && shippedAfter?.status === RollStatus.SHIPPED,
      shippedAfter?.status,
    );

    // STOCK top → iptal edilebilir (CANCELLED).
    const stockRoll = await prisma.roll.create({
      data: {
        barcode: `TESTP0${ts}K`,
        itemId,
        initialQty: "30.000",
        currentQty: "30.000",
        qualityGrade: "1. Kalite",
        status: RollStatus.STOCK,
      },
      select: { id: true },
    });
    rollIds.push(stockRoll.id);
    const cancelRes = await inventory.softDelete(stockRoll.id, undefined);
    const stockAfter = await prisma.roll.findUnique({
      where: { id: stockRoll.id },
      select: { status: true },
    });
    check(
      "F112: STOCK top iptal EDİLEBİLİR (CANCELLED, fiziksel silme değil)",
      cancelRes.success === true && stockAfter?.status === RollStatus.CANCELLED,
      stockAfter?.status,
    );

    // (F129 split-barkod testi kaldırıldı — split çocukları artık FRESH kısa barkod
    //  alıyor; parent-türevi `generateSplitBarcode` biçimi silindi. Barkod ayraçsızlığı
    //  test_roll_barcode.ts'te ROLL_BARCODE_RE ile kapsanıyor.)
  } finally {
    // Cleanup — test kendi yarattığını siler.
    if (rollIds.length) {
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    }
    if (itemId) {
      await prisma.itemAllowedColor.deleteMany({ where: { itemId } });
      await prisma.itemAllowedProperty.deleteMany({ where: { itemId } });
      await prisma.item.deleteMany({ where: { id: itemId } });
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  }
}

main();
