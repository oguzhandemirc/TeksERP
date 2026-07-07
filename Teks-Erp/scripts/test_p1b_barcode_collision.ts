// =============================================================================
// Test: F117 — clientBarcode idempotency SADECE payload özdeşse (çapraz-cihaz
// barkod çakışması sessiz veri kaybı yaratmamalı).
// Çalıştır: npx tsx scripts/test_p1b_barcode_collision.ts
//   1. Aynı clientBarcode + AYNI payload → idempotent (aynı id, yeni top YOK)
//   2. Aynı clientBarcode + FARKLI ürün → 409 BARCODE_COLLISION
//   3. Aynı clientBarcode + FARKLI metre → 409
//   4. O barkodla DB'de tam 1 Roll (2. ve sonraki girişler yaratmadı)
// =============================================================================
import prisma from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { ItemService } from "../src/services/item.service";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const inventory = new InventoryService();
const itemService = new ItemService({
  modelName: "item",
  tableName: "ITEM",
  searchFields: ["code", "name"],
  defaultInclude: {
    allowedColors: { include: { color: true } },
    allowedProperties: { include: { property: true } },
  },
});

async function main() {
  const ts = Date.now();
  const BC = `TEKS20260708${ts.toString(16).slice(-8).toUpperCase().padStart(8, "0")}`;
  const itemIds: string[] = [];
  const rollIds: string[] = [];

  try {
    // Fixture: iki farklı test ürünü
    for (const suf of ["A", "B"]) {
      const r = await itemService.create(
        { code: `TEST-P1B-${suf}-${ts}`, name: `TEST P1B ${suf}`, itemType: "FABRIC", unit: "MT" },
        undefined,
      );
      itemIds.push((r.data as { id: string }).id);
    }

    // 1) İlk giriş
    const first = await inventory.createInitialEntry(
      { itemId: itemIds[0], colorId: null, initialQty: 100, clientBarcode: BC },
      undefined,
    );
    const firstId = (first.data as { id: string }).id;
    rollIds.push(firstId);
    check("1) İlk giriş başarılı", first.success === true && !!firstId, firstId);

    // 2) Aynı payload → idempotent (aynı id)
    const again = await inventory.createInitialEntry(
      { itemId: itemIds[0], colorId: null, initialQty: 100, clientBarcode: BC },
      undefined,
    );
    check("2) Aynı payload idempotent (aynı id, yeni top yok)", (again.data as { id: string }).id === firstId);

    // 3) Aynı barkod + FARKLI ürün → 409 BARCODE_COLLISION
    let collision = false, code = "";
    try {
      await inventory.createInitialEntry(
        { itemId: itemIds[1], colorId: null, initialQty: 100, clientBarcode: BC },
        undefined,
      );
    } catch (e) {
      if (e instanceof AppError) { collision = e.statusCode === 409; code = (e.details as { code?: string })?.code ?? ""; }
    }
    check("3) Farklı ürün + aynı barkod → 409 BARCODE_COLLISION", collision && code === "BARCODE_COLLISION", code);

    // 4) Aynı barkod + FARKLI metre → 409
    let qtyCollision = false;
    try {
      await inventory.createInitialEntry(
        { itemId: itemIds[0], colorId: null, initialQty: 200, clientBarcode: BC },
        undefined,
      );
    } catch (e) {
      if (e instanceof AppError) qtyCollision = e.statusCode === 409;
    }
    check("4) Farklı metre + aynı barkod → 409", qtyCollision);

    // 5) O barkodla tam 1 Roll
    const cnt = await prisma.roll.count({ where: { barcode: BC } });
    check("5) DB'de o barkodla tam 1 Roll (sessiz veri kaybı yok)", cnt === 1, `count=${cnt}`);
  } finally {
    if (rollIds.length) {
      await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    }
    if (itemIds.length) {
      await prisma.itemAllowedColor.deleteMany({ where: { itemId: { in: itemIds } } });
      await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  }
}

main();
