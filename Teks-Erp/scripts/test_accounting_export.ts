// =============================================================================
// Test: Muhasebe Excel dökümü (accounting-export.service)
// Çalıştır: npx tsx scripts/test_accounting_export.ts
// Kurulum: 1 müşteri (vergi no'lu), 2 ürün (A/B), 1 renk, 1 DISPATCHED sevkiyat
//   (EXPORT, 2 çuval). Çuval-1: 2 top (A, renkli, 150cm, 35'er m, 65,8kg),
//   Çuval-2: 1 top (A, 150cm, 35m) + 1 top (B, ensiz, 40m, 40kg). + 1 iade (A, 10m).
// Doğrulananlar:
//   1. shipments: tek satır, çuval/top/metre/kg/vergi no/yön doğru
//   2. detail: ürün+renk+en grubu (A=3 top/105m, B=1 top/40m)
//   3. byCustomer: müşteri icmali (1 sevk, 145m, 105,8kg)
//   4. byProduct: ürün icmali (A 105m, B 40m)
//   5. returns + returnMeters (iade A, 10m)
//   6. totals tutarlı; filtre (filter[customerId]) scope eder
// =============================================================================
import type { Request } from "express";
import prisma from "../src/lib/prisma";
import { buildDispatchAccountingExport } from "../src/services/accounting-export.service";
import { AppError } from "../src/utils/app-error";

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

interface ExportData {
  shipments: Array<{
    shipmentNo: string;
    taxNumber: string;
    destination: string;
    sackCount: number;
    rollCount: number;
    totalMeters: number;
    totalKg: number;
  }>;
  detail: Array<{ shipmentNo: string; itemName: string; colorName: string; width: number | null; rollCount: number; meters: number }>;
  byCustomer: Array<{ customerName: string; shipmentCount: number; rollCount: number; sackCount: number; totalMeters: number; totalKg: number }>;
  byProduct: Array<{ itemName: string; rollCount: number; totalMeters: number }>;
  returns: Array<{ itemName: string; customerName: string; fromShipmentNo: string; meters: number; reason: string }>;
  totals: { shipmentCount: number; sackCount: number; rollCount: number; totalMeters: number; totalKg: number; returnMeters: number };
  range: { mode?: string; selectedCount?: number; from?: string | null; to?: string | null };
}

async function main() {
  const ts = Date.now();

  const someUser = await prisma.user.findFirst({ select: { id: true } });
  if (!someUser) throw new Error("Seed kullanıcı yok — önce npm run seed");

  const customer = await prisma.customer.create({
    data: { code: `TST-AEX-${ts}`, name: "TEST MUHASEBE MÜŞTERİ", taxNumber: "1234567890" },
    select: { id: true },
  });
  const itemA = await prisma.item.create({
    data: { code: `TST-AEX-A-${ts}`, name: "MC 156", itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  const itemB = await prisma.item.create({
    data: { code: `TST-AEX-B-${ts}`, name: "NEPS VUAL", itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  const color = await prisma.color.create({
    data: { code: `TST-AEX-C-${ts}`, name: "BEYAZ-GÜMÜŞ" },
    select: { id: true },
  });
  const shipment = await prisma.shipment.create({
    data: {
      shipmentNo: `TEST-AEX-${ts}`,
      customerId: customer.id,
      status: "DISPATCHED",
      destination: "EXPORT",
      procedureCode: "GB-2026-999",
      dispatchedAt: new Date(),
    },
    select: { id: true },
  });
  const sack1 = await prisma.sack.create({
    data: { sackNo: `TEST-AEX-SK1-${ts}`, customerId: customer.id, shipmentId: shipment.id, seq: 1, manualCode: `TST-AEX-AMB1-${ts}`, weightKg: 65.8 },
    select: { id: true },
  });
  const sack2 = await prisma.sack.create({
    data: { sackNo: `TEST-AEX-SK2-${ts}`, customerId: customer.id, shipmentId: shipment.id, seq: 2, manualCode: `TST-AEX-AMB2-${ts}`, weightKg: 40 },
    select: { id: true },
  });
  const mkRoll = (n: number, itemId: string, colorId: string | null, sackId: string, qty: number, w: number | null) =>
    prisma.roll.create({
      data: {
        barcode: `TEST-AEX-R${n}-${ts}`,
        itemId,
        colorId,
        status: "SHIPPED",
        currentQty: qty,
        initialQty: qty,
        width: w,
        qualityGrade: "A",
        entrySource: "SUPPLIER_RECEIPT",
        shipmentId: shipment.id,
        sackId,
      },
      select: { id: true },
    });

  const r1 = await mkRoll(1, itemA.id, color.id, sack1.id, 35, 150);
  const r2 = await mkRoll(2, itemA.id, color.id, sack1.id, 35, 150);
  const r3 = await mkRoll(3, itemA.id, color.id, sack2.id, 35, 150);
  const r4 = await mkRoll(4, itemB.id, null, sack2.id, 40, null);

  const ret = await prisma.rollReturn.create({
    data: {
      rollId: r1.id,
      fromShipmentId: shipment.id,
      customerId: customer.id,
      itemId: itemA.id,
      colorId: color.id,
      width: 150,
      qty: 10,
      reasonText: "Test iade",
      receivedById: someUser.id,
    },
    select: { id: true },
  });

  try {
    // filter[customerId] ile scope — gerçek query yolu (parseQueryParams).
    const req = { query: { "filter[customerId]": customer.id } } as unknown as Request;
    const res = await buildDispatchAccountingExport(req);
    const d = res.data as ExportData;

    // 1) shipments
    check("shipments: tek satır", d.shipments.length === 1, `${d.shipments.length}`);
    const s = d.shipments[0];
    check(
      "shipment: 2 çuval / 4 top / 145m / 105,8kg",
      s?.sackCount === 2 && s?.rollCount === 4 && s?.totalMeters === 145 && Math.abs(s.totalKg - 105.8) < 0.001,
      `${s?.sackCount}/${s?.rollCount}/${s?.totalMeters}/${s?.totalKg}`
    );
    check("shipment: vergi no + yön", s?.taxNumber === "1234567890" && s?.destination === "EXPORT", `${s?.taxNumber}/${s?.destination}`);

    // 2) detail (ürün+renk+en grubu)
    const dA = d.detail.find((r) => r.itemName === "MC 156");
    const dB = d.detail.find((r) => r.itemName === "NEPS VUAL");
    check("detail: MC 156 3 top / 105m / 150cm", dA?.rollCount === 3 && dA?.meters === 105 && dA?.width === 150, `${dA?.rollCount}/${dA?.meters}/${dA?.width}`);
    check("detail: NEPS VUAL 1 top / 40m / ensiz", dB?.rollCount === 1 && dB?.meters === 40 && dB?.width === null);

    // 3) byCustomer
    check("byCustomer: tek müşteri", d.byCustomer.length === 1);
    const c = d.byCustomer[0];
    check(
      "byCustomer: 1 sevk / 4 top / 2 çuval / 145m / 105,8kg",
      c?.shipmentCount === 1 && c?.rollCount === 4 && c?.sackCount === 2 && c?.totalMeters === 145 && Math.abs(c.totalKg - 105.8) < 0.001
    );

    // 4) byProduct
    const pA = d.byProduct.find((p) => p.itemName === "MC 156");
    const pB = d.byProduct.find((p) => p.itemName === "NEPS VUAL");
    check("byProduct: MC 156 105m / 3 top", pA?.totalMeters === 105 && pA?.rollCount === 3);
    check("byProduct: NEPS VUAL 40m / 1 top", pB?.totalMeters === 40 && pB?.rollCount === 1);

    // 5) returns
    check("returns: 1 iade satırı", d.returns.length === 1, `${d.returns.length}`);
    const rr = d.returns[0];
    check(
      "return: ürün/müşteri/sevk/metre/neden",
      rr?.itemName === "MC 156" && rr?.customerName === "TEST MUHASEBE MÜŞTERİ" && rr?.fromShipmentNo === `TEST-AEX-${ts}` && rr?.meters === 10 && rr?.reason === "Test iade"
    );

    // 6) totals
    check(
      "totals: 1 sevk / 2 çuval / 4 top / 145m / 105,8kg / iade 10m",
      d.totals.shipmentCount === 1 &&
        d.totals.sackCount === 2 &&
        d.totals.rollCount === 4 &&
        d.totals.totalMeters === 145 &&
        Math.abs(d.totals.totalKg - 105.8) < 0.001 &&
        d.totals.returnMeters === 10,
      `${d.totals.shipmentCount}/${d.totals.sackCount}/${d.totals.rollCount}/${d.totals.totalMeters}/${d.totals.totalKg}/${d.totals.returnMeters}`
    );

    // Toplam tutarlılık: shipments toplamı = byCustomer toplamı = byProduct metre
    const sumShipMeters = d.shipments.reduce((a, r) => a + r.totalMeters, 0);
    const sumCustMeters = d.byCustomer.reduce((a, r) => a + r.totalMeters, 0);
    const sumProdMeters = d.byProduct.reduce((a, r) => a + r.totalMeters, 0);
    check(
      "tutarlılık: shipments = byCustomer = byProduct metre",
      sumShipMeters === sumCustMeters && sumCustMeters === sumProdMeters && sumShipMeters === d.totals.totalMeters
    );

    // 7) SEÇİM (A) modu — ?ids= yalnız işaretli sevkleri döndürür + range.mode
    const selReq = { query: { ids: shipment.id } } as unknown as Request;
    const sd = (await buildDispatchAccountingExport(selReq)).data as ExportData;
    check(
      "selection: ids ile yalnız o sevk",
      sd.shipments.length === 1 && sd.shipments[0]?.shipmentNo === `TEST-AEX-${ts}`,
      `${sd.shipments.length}`
    );
    check("selection: range.mode=selection, count=1", sd.range?.mode === "selection" && sd.range?.selectedCount === 1);
    check("selection: iade fromShipmentId'e göre kapsanır", sd.returns.length === 1);

    // Olmayan (ama geçerli formatlı) id → 0 sevk (filtre gerçekten uygulanıyor)
    const emptyReq = { query: { ids: "00000000-0000-0000-0000-000000000000" } } as unknown as Request;
    const ed = (await buildDispatchAccountingExport(emptyReq)).data as ExportData;
    check("selection: olmayan id → 0 sevk", ed.shipments.length === 0);

    // Geçersiz (UUID olmayan) ids → 500 değil, açık 400
    let badIdsRejected = false;
    try {
      await buildDispatchAccountingExport({ query: { ids: "abc,not-a-uuid" } } as unknown as Request);
    } catch (e) {
      badIdsRejected = e instanceof AppError && e.statusCode === 400;
    }
    check("selection: geçersiz ids → 400 (500 değil)", badIdsRejected);
  } finally {
    await prisma.rollReturn.delete({ where: { id: ret.id } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: [r1.id, r2.id, r3.id, r4.id] } } });
    await prisma.sack.deleteMany({ where: { shipmentId: shipment.id } });
    await prisma.shipment.delete({ where: { id: shipment.id } }).catch(() => {});
    await prisma.color.delete({ where: { id: color.id } }).catch(() => {});
    await prisma.item.deleteMany({ where: { id: { in: [itemA.id, itemB.id] } } });
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
