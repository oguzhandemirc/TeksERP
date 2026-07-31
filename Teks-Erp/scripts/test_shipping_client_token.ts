// =============================================================================
// Test: Sack/Shipment clientToken idempotency (G-7 / A4 — 2026-07-31 denetimi)
// Çalıştır: npx tsx scripts/test_shipping_client_token.ts
// Doğrulananlar:
//   1. openSack aynı token'la iki kez → TEK çuval (ikinci çağrı cached döner)
//   2. Farklı token → yeni çuval (replay yanlışlıkla her şeyi yutmuyor)
//   3. createShipment aynı token'la iki kez → TEK sevkiyat, aynı shipmentNo
//   4. Token'sız çağrı eskisi gibi çalışır (geri uyum)
// =============================================================================
import { randomUUID } from "crypto";
import prisma from "../src/lib/prisma";
import { ShippingService } from "../src/services/shipping.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

const TS = Date.now().toString(36);
const service = new ShippingService();

async function main() {
  const made = { customerId: "", itemId: "", rollId: "", sackIds: [] as string[], shipmentId: "" };
  try {
    const customer = await prisma.customer.create({
      data: { code: `TEST-SCT-${TS}`, name: `TEST Sevk Token ${TS}` },
      select: { id: true },
    });
    made.customerId = customer.id;

    // --- 1) openSack replay ---
    const t1 = randomUUID();
    const r1 = await service.openSack({ customerId: customer.id, clientToken: t1 });
    const s1 = r1.data as { id: string; sackNo: string };
    made.sackIds.push(s1.id);
    const r2 = await service.openSack({ customerId: customer.id, clientToken: t1 });
    const s2 = r2.data as { id: string; sackNo: string };
    check("openSack aynı token → aynı çuval", s1.id === s2.id && s1.sackNo === s2.sackNo, `${s1.sackNo} vs ${s2.sackNo}`);
    const sackCount1 = await prisma.sack.count({ where: { clientToken: t1 } });
    check("DB'de o token'la TEK çuval var", sackCount1 === 1);

    // --- 2) Farklı token → yeni çuval ---
    const t2 = randomUUID();
    const r3 = await service.openSack({ customerId: customer.id, clientToken: t2 });
    const s3 = r3.data as { id: string };
    made.sackIds.push(s3.id);
    check("farklı token → farklı çuval", s3.id !== s1.id);

    // --- 4a) Token'sız geri uyum ---
    const r4 = await service.openSack({ customerId: customer.id });
    const s4 = r4.data as { id: string };
    made.sackIds.push(s4.id);
    check("token'sız openSack eskisi gibi çalışır", !!s4.id);

    // --- 3) createShipment replay (sack1 içine bir top koy) ---
    const item = await prisma.item.create({
      data: { code: `TEST-SCT-I-${TS}`, name: `TEST Kumaş SCT ${TS}`, itemType: "FABRIC" },
      select: { id: true },
    });
    made.itemId = item.id;
    const roll = await prisma.roll.create({
      data: {
        barcode: `TEST-SCT-R-${TS}`,
        itemId: item.id,
        initialQty: 100,
        currentQty: 100,
        status: "WAREHOUSE",
        sackId: s1.id,
      },
      select: { id: true },
    });
    made.rollId = roll.id;

    const t3 = randomUUID();
    const c1 = await service.createShipment({ sackIds: [s1.id], customerId: customer.id, clientToken: t3 });
    const sh1 = c1.data as { id: string; shipmentNo: string; dispatched: boolean };
    made.shipmentId = sh1.id;
    const c2 = await service.createShipment({ sackIds: [s1.id], customerId: customer.id, clientToken: t3 });
    const sh2 = c2.data as { id: string; shipmentNo: string };
    check("createShipment aynı token → aynı sevkiyat", sh1.id === sh2.id && sh1.shipmentNo === sh2.shipmentNo, `${sh1.shipmentNo} vs ${sh2.shipmentNo}`);
    const shipCount = await prisma.shipment.count({ where: { clientToken: t3 } });
    check("DB'de o token'la TEK sevkiyat var", shipCount === 1);
    // Replay, çuval claim'ine hiç girmediği için 409 da atmamalı — c2 success döndü (yukarıda kanıtlandı).
    check("replay 409 yerine success döndü", (c2 as { success: boolean }).success === true);
  } finally {
    if (made.rollId) await prisma.roll.deleteMany({ where: { id: made.rollId } }).catch(() => {});
    if (made.sackIds.length) await prisma.sack.deleteMany({ where: { id: { in: made.sackIds } } }).catch(() => {});
    if (made.shipmentId) {
      await prisma.shipmentOrder.deleteMany({ where: { shipmentId: made.shipmentId } }).catch(() => {});
      await prisma.shipment.deleteMany({ where: { id: made.shipmentId } }).catch(() => {});
    }
    if (made.itemId) await prisma.item.deleteMany({ where: { id: made.itemId } }).catch(() => {});
    if (made.customerId) await prisma.customer.deleteMany({ where: { id: made.customerId } }).catch(() => {});
    await prisma.$disconnect();
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
