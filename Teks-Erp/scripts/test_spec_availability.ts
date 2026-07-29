// Sipariş formu spec-müsaitlik (getSpecAvailability) testi.
// Çalıştırma:  npx tsx scripts/test_spec_availability.ts
//
// Sözleşme: spec (kumaş+renk+en) için "Depoda / Üretimde / Ham" anlık metraj.
//   freeWarehouse = WAREHOUSE, renk+en BİREBİR (shipmentId=null, sackId=null)
//   freeStock     = STOCK, renk-JOKER (renksiz ham renkli talebe de sayılır) + en-AGNOSTİK
//   inProduction  = canlı WO'ların hedef-spec başına in-flight'ı (committed − finished)
//
// Veri: tek kullanımlık item + 2 renk + istasyon + çuval + müşteri/sevkiyat + roll'lar
// + PLANNED WO (TEST- prefix, business-key; hardcoded UUID yok). finally'de temizlenir.
//
// Doğrulananlar:
//   1. Depo renk+en birebir (R1 sayılır; R2 farklı en, R3 farklı renk, R7/R8 çuval/sevk hariç)
//   2. Ham renk-joker + en-agnostik (R4 renksiz + R5 aynı renk; R6 farklı renk hariç)
//   3. Üretimde: PLANNED WO adımındaki roll (initialQty=120) → 120
//   4. Farklı en sorgusu: Depo en-birebir (R2), Ham en-agnostik (değişmez), Üretimde 0
//   5. Renksiz sorgu: Depo yalnız renksizle eşleşir (0), Ham tümü sayılır
//   6. width null↔null eşleşmesi
//   7. Dönüş tipleri gerçek number

import { RollStatus, StationType, WorkOrderStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { OrderService } from "../src/services/order.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  const svc = new OrderService({
    modelName: "order",
    tableName: "ORDER",
    searchFields: ["orderNumber"],
    dateFields: ["createdAt", "deadline"],
    nestedCreateFields: ["lines"],
  });

  const ts = Date.now();
  const item = await prisma.item.create({
    data: { code: `TST-SPEC-ITM-${ts}`, name: "Test Spec Ürün", itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  const colorA = await prisma.color.create({
    data: { code: `TST-SPEC-CLRA-${ts}`, name: "Test Spec Renk A" },
    select: { id: true },
  });
  const colorB = await prisma.color.create({
    data: { code: `TST-SPEC-CLRB-${ts}`, name: "Test Spec Renk B" },
    select: { id: true },
  });
  const station = await prisma.station.create({
    data: { code: `TST-SPEC-STN-${ts}`, name: "Test Spec İstasyon", type: StationType.INTERNAL },
    select: { id: true },
  });
  const sack = await prisma.sack.create({
    data: { sackNo: `TST-SPEC-SACK-${ts}` },
    select: { id: true },
  });
  const customer = await prisma.customer.create({
    data: { code: `TST-SPEC-CUS-${ts}`, name: "Test Spec Müşteri" },
    select: { id: true },
  });
  const shipment = await prisma.shipment.create({
    data: { shipmentNo: `TST-SPEC-SHP-${ts}`, customerId: customer.id },
    select: { id: true },
  });

  const rollIds: string[] = [];
  let workOrderId = "";
  let stepId = "";

  const mkRoll = async (
    n: number,
    data: {
      status: RollStatus;
      colorId?: string | null;
      width?: number | null;
      qty: number;
      sackId?: string;
      shipmentId?: string;
      currentStepId?: string;
    },
  ): Promise<void> => {
    const r = await prisma.roll.create({
      data: {
        barcode: `TST-SPEC-ROLL-${ts}-${n}`,
        itemId: item.id,
        colorId: data.colorId ?? null,
        width: data.width ?? null,
        initialQty: data.qty,
        currentQty: data.qty,
        status: data.status,
        sackId: data.sackId,
        shipmentId: data.shipmentId,
        currentStepId: data.currentStepId,
      },
      select: { id: true },
    });
    rollIds.push(r.id);
  };

  try {
    // ── Serbest stok roll'ları (hepsi item=itemA) ──
    await mkRoll(1, { status: RollStatus.WAREHOUSE, colorId: colorA.id, width: 180, qty: 100 }); // depo eşleşir
    await mkRoll(2, { status: RollStatus.WAREHOUSE, colorId: colorA.id, width: 150, qty: 50 });  // farklı en
    await mkRoll(3, { status: RollStatus.WAREHOUSE, colorId: colorB.id, width: 180, qty: 30 });  // farklı renk
    await mkRoll(4, { status: RollStatus.STOCK, colorId: null, width: 200, qty: 70 });           // ham renksiz joker
    await mkRoll(5, { status: RollStatus.STOCK, colorId: colorA.id, width: 180, qty: 25 });      // ham aynı renk
    await mkRoll(6, { status: RollStatus.STOCK, colorId: colorB.id, width: 180, qty: 40 });      // ham farklı renk
    await mkRoll(7, { status: RollStatus.WAREHOUSE, colorId: colorA.id, width: 180, qty: 999, sackId: sack.id });         // çuvalda → hariç
    await mkRoll(8, { status: RollStatus.WAREHOUSE, colorId: colorA.id, width: 180, qty: 888, shipmentId: shipment.id }); // sevkte → hariç
    await mkRoll(9, { status: RollStatus.WAREHOUSE, colorId: colorA.id, width: null, qty: 60 }); // en-null depo

    // ── Üretimde: PLANNED WO (targetItem=itemA, renk=A, en=180) + adım + roll ──
    const wo = await prisma.workOrder.create({
      data: {
        workOrderNumber: `TEST-SPEC-WO-${ts}`,
        status: WorkOrderStatus.PLANNED,
        targetItemId: item.id,
        targetColorId: colorA.id,
        width: 180,
      },
      select: { id: true },
    });
    workOrderId = wo.id;
    const step = await prisma.workOrderStep.create({
      data: { workOrderId: wo.id, stationId: station.id, stepSequence: 1 },
      select: { id: true },
    });
    stepId = step.id;
    await mkRoll(10, {
      status: RollStatus.IN_PRODUCTION,
      colorId: colorA.id,
      width: 180,
      qty: 120,
      currentStepId: step.id,
    });

    // 1-3. Ana sorgu: (itemA, colorA, 180)
    const r1 = (await svc.getSpecAvailability({ itemId: item.id, colorId: colorA.id, width: 180 })).data;
    check("1. Depo renk+en birebir (yalnız R1) → 100", r1.freeWarehouse === 100, `freeWarehouse=${r1.freeWarehouse}`);
    check("2. Ham renk-joker (R4+R5) → 95", r1.freeStock === 95, `freeStock=${r1.freeStock}`);
    check("3. Üretimde (WO adımı, 120) → 120", r1.inProduction === 120, `inProduction=${r1.inProduction}`);

    // 4. Farklı en (itemA, colorA, 150): Depo en-birebir → R2 (50); Ham en-agnostik → 95; Üretimde 0
    const r150 = (await svc.getSpecAvailability({ itemId: item.id, colorId: colorA.id, width: 150 })).data;
    check("4a. Farklı en: Depo en-birebir → 50", r150.freeWarehouse === 50, `freeWarehouse=${r150.freeWarehouse}`);
    check("4b. Farklı en: Ham en-agnostik → 95", r150.freeStock === 95, `freeStock=${r150.freeStock}`);
    check("4c. Farklı en: Üretimde (WO en=180) → 0", r150.inProduction === 0, `inProduction=${r150.inProduction}`);

    // 5. Renksiz sorgu (itemA, —, 180): Depo yalnız renksizle eşleşir (yok → 0); Ham tümü (70+25+40)
    const rNoColor = (await svc.getSpecAvailability({ itemId: item.id, width: 180 })).data;
    check("5a. Renksiz: Depo yalnız renksiz eşleşir → 0", rNoColor.freeWarehouse === 0, `freeWarehouse=${rNoColor.freeWarehouse}`);
    check("5b. Renksiz: Ham tümü sayılır (R4+R5+R6) → 135", rNoColor.freeStock === 135, `freeStock=${rNoColor.freeStock}`);

    // 6. width null↔null (itemA, colorA, —): Depo R9 (60); Ham en-agnostik (95)
    const rNullW = (await svc.getSpecAvailability({ itemId: item.id, colorId: colorA.id })).data;
    check("6. width null↔null: Depo (R9) → 60", rNullW.freeWarehouse === 60, `freeWarehouse=${rNullW.freeWarehouse}`);

    // 7. Dönüş tipleri gerçek number (Decimal string sızıntısı yok)
    check(
      "7. Dönüş tipleri number",
      typeof r1.freeWarehouse === "number" &&
        typeof r1.inProduction === "number" &&
        typeof r1.freeStock === "number",
    );
  } finally {
    // Sıra: roll (WO adımına/çuvala/sevke bağlı) → step → WO → sack/shipment → master.
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    if (stepId) await prisma.workOrderStep.deleteMany({ where: { id: stepId } });
    if (workOrderId) await prisma.workOrder.deleteMany({ where: { id: workOrderId } });
    await prisma.sack.deleteMany({ where: { id: sack.id } });
    await prisma.shipment.deleteMany({ where: { id: shipment.id } });
    await prisma.customer.delete({ where: { id: customer.id } }).catch(() => undefined);
    await prisma.station.delete({ where: { id: station.id } }).catch(() => undefined);
    await prisma.color.deleteMany({ where: { id: { in: [colorA.id, colorB.id] } } });
    await prisma.item.delete({ where: { id: item.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Beklenmeyen hata:", err);
  process.exit(1);
});
