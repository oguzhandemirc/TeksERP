// =============================================================================
// Test: Saha #16 — sipariş numarası override (boş = otomatik)
// Çalıştır: npx tsx scripts/test_order_number_override.ts
// Doğrulananlar:
//   1. orderNumber verilmeden create → otomatik YYYYMMDD-N üretilir
//   2. Elle verilen orderNumber aynen kullanılır
//   3. Aynı numarayla ikinci create → 409
//   4. update yolu orderNumber'ı EZEMEZ (whitelist korunur)
// =============================================================================
import prisma from "../src/lib/prisma";
import { OrderService } from "../src/services/order.service";

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

async function main() {
  const ts = Date.now();
  const svc = new OrderService({
    modelName: "order",
    tableName: "ORDER",
    searchFields: ["orderNumber"],
    defaultInclude: { lines: true },
    nestedCreateFields: ["lines"],
  });

  const customer = await prisma.customer.create({
    data: { code: `TST-ONO-${ts}`, name: "Test Müşteri ONO" },
    select: { id: true },
  });
  const item = await prisma.item.create({
    data: { code: `TST-ONO-ITM-${ts}`, name: "TEST ONO ÜRÜN", itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  const orderIds: string[] = [];
  const manualNo = `TEST-MANUEL-${ts}`;

  try {
    // 1) Otomatik üretim
    const auto = await svc.create(
      { customerId: customer.id, lines: [{ itemId: item.id, quantity: 50 }] },
      undefined,
    );
    const autoRec = auto.data as { id: string; orderNumber: string };
    orderIds.push(autoRec.id);
    check(
      "Boş bırakılınca otomatik YYYYMMDD-N üretildi",
      /^\d{8}-\d+$/.test(autoRec.orderNumber),
      autoRec.orderNumber,
    );

    // 2) Manuel numara
    const manual = await svc.create(
      {
        customerId: customer.id,
        orderNumber: `  ${manualNo}  `, // trim de doğrulanır
        lines: [{ itemId: item.id, quantity: 25 }],
      },
      undefined,
    );
    const manualRec = manual.data as { id: string; orderNumber: string };
    orderIds.push(manualRec.id);
    check("Elle verilen numara aynen kullanıldı (trim'li)", manualRec.orderNumber === manualNo);

    // 3) Çakışma → 409
    let conflicted = false;
    try {
      await svc.create(
        { customerId: customer.id, orderNumber: manualNo, lines: [{ itemId: item.id, quantity: 10 }] },
        undefined,
      );
    } catch (e) {
      conflicted = (e as { statusCode?: number }).statusCode === 409;
    }
    check("Aynı numarayla ikinci sipariş 409 ile reddedildi", conflicted);

    // 4) Update orderNumber'ı ezemez (M-3 whitelist)
    await svc.update(manualRec.id, { orderNumber: "HACKLENDI-1" } as Record<string, unknown>, undefined);
    const after = await prisma.order.findUnique({
      where: { id: manualRec.id },
      select: { orderNumber: true },
    });
    check("Update orderNumber'ı değiştiremedi (whitelist)", after?.orderNumber === manualNo);
  } finally {
    for (const id of orderIds) {
      await prisma.orderLine.deleteMany({ where: { orderId: id } });
      await prisma.order.delete({ where: { id } }).catch(() => {});
    }
    await prisma.item.delete({ where: { id: item.id } }).catch(() => {});
    await prisma.customer.delete({ where: { id: customer.id } }).catch(() => {});
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
