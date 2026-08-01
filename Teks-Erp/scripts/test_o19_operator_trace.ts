// =============================================================================
// Test: O-19 — sevkiyat operatör izi (Çuval Depo modeli).
// Çalıştır: npx tsx scripts/test_o19_operator_trace.ts
//   1. weighSack tartı → Sack.weighedById=userId + weighedAt set.
//   2. openSack açılışta tartıyla → weighedById set (weighSack ile parite).
//   3. Yeniden tartı (weighSack) → en son tartan kazanır.
//   5. dispatchShipment → Shipment.dispatchedById set (sevk eden izi).
//   6. İçerik değişince (roll çıkar → resetSackWeightsTx) → weighedById/weighedAt/weightKg temizlenir.
// Not: mühür (sealSack/Sack.sealedAt/sealedById) + markReady/Shipment.readyById KALDIRILDI —
//      çuval depoda düzenlenebilir; sevk izi Shipment.dispatchedById'de tutulur.
// =============================================================================
import { RollStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { ShippingService } from "../src/services/shipping.service";

const CONFIRM_KEY = "shipping.confirmationEnabled";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const shipping = new ShippingService();

async function main() {
  const ts = Date.now();
  const custIds: string[] = [];
  const sackIds: string[] = [];
  const shipmentIds: string[] = [];
  const rollIds: string[] = [];

  try {
    // Sevk onayı bayrağını AÇ → createShipment PLANNED kurar; dispatchShipment ile ayrıca
    // sevk edilir (dispatchedById = sevk eden izi bu adımda yazılır). Onay kapalıyken
    // createShipment tek adımda dispatch ederdi → ayrı dispatchShipment izini gözlemleyemezdik.
    await prisma.systemSetting.upsert({
      where: { key: CONFIRM_KEY },
      update: { value: true },
      create: { key: CONFIRM_KEY, value: true },
    });

    const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
    const admin2 = await prisma.user.findFirst({ where: { username: { not: "admin" } }, select: { id: true } });
    const uid1 = admin!.id;
    const uid2 = admin2?.id ?? admin!.id;

    const item = await prisma.item.findFirst({ where: { itemType: "FABRIC", isActive: true }, select: { id: true } });
    const cust = await prisma.customer.create({ data: { code: `TEST-O19-${ts}`, name: "TEST O19" }, select: { id: true } });
    custIds.push(cust.id);
    const customerId = cust.id;

    const makeRoll = async (n: number) => {
      const r = await prisma.roll.create({
        data: { barcode: `TEST-O19-R${n}-${ts}`, itemId: item!.id, initialQty: "40.000", currentQty: "40.000", qualityGrade: "1. Kalite", status: RollStatus.WAREHOUSE },
        select: { id: true, barcode: true },
      });
      rollIds.push(r.id);
      return r;
    };

    // ── sack1: aç → okut → tart → yeniden tart → sevkiyat kur (PLANNED) → dispatch ──
    const roll1 = await makeRoll(1);
    const sack1 = ((await shipping.openSack({ customerId })).data as { id: string }).id;
    sackIds.push(sack1);
    await shipping.scanIntoSack({ sackId: sack1, barcode: roll1.barcode! });

    // 1) weighSack tartı → weighedById=uid1 + weighedAt
    await shipping.weighSack({ sackId: sack1, weightKg: 50 }, uid1);
    let s = await prisma.sack.findUnique({ where: { id: sack1 }, select: { weighedById: true, weighedAt: true } });
    check("1) weighSack tartı → weighedById=userId + weighedAt set", s?.weighedById === uid1 && s?.weighedAt != null, `weighedById=${s?.weighedById === uid1}`);

    // 3) yeniden tartı → en son tartan kazanır
    await shipping.weighSack({ sackId: sack1, weightKg: 60 }, uid2);
    // `weighedAt` select'te KALMALI: `s` yukarıdaki ilk sorgudan tipini alıyor,
    // dar select onu uyumsuz kılıyordu (bu kontrol yalnız weighedById'ye bakar).
    s = await prisma.sack.findUnique({ where: { id: sack1 }, select: { weighedById: true, weighedAt: true } });
    check("3) yeniden tartı → en son tartan kazanır", s?.weighedById === uid2);

    // 5) dispatchShipment → Shipment.dispatchedById (çuval depodan seçilerek sevkiyata girer)
    const shipmentId = ((await shipping.createShipment({ sackIds: [sack1], customerId })).data as { id: string }).id;
    shipmentIds.push(shipmentId);
    await shipping.dispatchShipment(shipmentId, { plateNumber: "34ABC34", driverName: "Ali Veli" }, uid1);
    const sh = await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { dispatchedById: true, status: true } });
    check("5) dispatchShipment → Shipment.dispatchedById=userId", sh?.dispatchedById === uid1 && sh?.status === "DISPATCHED", `dispatchedById=${sh?.dispatchedById === uid1}`);

    // ── 2) openSack açılışta tartıyla → weighedById set (parite) ──
    const sack2 = ((await shipping.openSack({ customerId, weightKg: 30 }, uid1)).data as { id: string }).id;
    sackIds.push(sack2);
    s = await prisma.sack.findUnique({ where: { id: sack2 }, select: { weighedById: true, weighedAt: true } });
    check("2) openSack açılış tartısı → weighedById set (parite)", s?.weighedById === uid1 && s?.weighedAt != null);

    // ── 6) içerik değişince tartan izi temizlenir ──
    const roll2 = await makeRoll(2);
    const sack3 = ((await shipping.openSack({ customerId })).data as { id: string }).id;
    sackIds.push(sack3);
    await shipping.scanIntoSack({ sackId: sack3, barcode: roll2.barcode! });
    await shipping.weighSack({ sackId: sack3, weightKg: 70 }, uid1);
    const before = await prisma.sack.findUnique({ where: { id: sack3 }, select: { weighedById: true } });
    await shipping.removeRollFromSack({ rollId: roll2.id });
    const after = await prisma.sack.findUnique({ where: { id: sack3 }, select: { weighedById: true, weighedAt: true, weightKg: true } });
    check(
      "6) içerik değişince (roll çıkar) → weighedById/weighedAt/weightKg temizlendi",
      before?.weighedById === uid1 && after?.weighedById === null && after?.weighedAt === null && after?.weightKg === null,
      `önce=${before?.weighedById === uid1} sonra-null=${after?.weighedById === null}`,
    );
  } finally {
    // Sevk onayı bayrağını varsayılana (KAPALI) döndür — paylaşımlı dev DB.
    await prisma.systemSetting
      .upsert({ where: { key: CONFIRM_KEY }, update: { value: false }, create: { key: CONFIRM_KEY, value: false } })
      .catch(() => {});
    await prisma.sackAllocation.deleteMany({ where: { sackId: { in: sackIds } } });
    await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { shipmentId: null, sackId: null } });
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: shipmentIds } } });
    await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.sack.deleteMany({ where: { id: { in: sackIds } } });
    await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: custIds } } });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  }
}

main();
