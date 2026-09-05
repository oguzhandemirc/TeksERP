// =============================================================================
// Test: Muhasebe dökümü + fiş — FASONDAN DOĞRUDAN SEVK (DirectShipment) kapsamı
// Çalıştır: npx tsx scripts/test_accounting_direct_ship.ts
// Kurulum: taze müşteri (izole scope) → WO[BOYA_FASON] → 2 top (PATOS, renkli, 250cm,
//   100+150m) fasona dispatch → executeDirectShip (250m'yi bir sipariş satırına karşıla).
// Doğrulananlar:
//   A. buildDispatchAccountingExport (filter[customerId]=taze müşteri):
//      - shipments: 1 satır, sackCount=0 (çuval yok), rollCount=2, 250m, kg=0, vergi no
//      - detail: PATOS grubu 2 top / 250m / 250cm + orderNos dolu
//      - byCustomer / byProduct / totals tutarlı (çuval sevkiyatlarıyla AYNI yapı)
//   B. getDirectShipmentDispatchReport (fiş): header DOMESTIC/DISPATCHED, products 1,
//      sacks:[], cekiRows 2 (sackCode "—", kg 0), totals doğru.
// =============================================================================
import type { Request } from "express";
import prisma from "../src/lib/prisma";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { ShippingService } from "../src/services/shipping.service";
import { buildDispatchAccountingExport } from "../src/services/accounting-export.service";
import { printedDocumentService } from "../src/services/printed-document.service";
import { RollStatus, PrintedDocType } from "@prisma/client";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const sub = new SubcontractorService();
const cards = new TravelerCardService();
const shipping = new ShippingService();

interface ExportData {
  shipments: Array<{ shipmentNo: string; taxNumber: string; destination: string; branchName: string; branchCode: string; sackCount: number; rollCount: number; totalMeters: number; totalKg: number }>;
  detail: Array<{ shipmentNo: string; itemName: string; width: number | null; rollCount: number; meters: number; orderNos: string }>;
  byCustomer: Array<{ customerName: string; shipmentCount: number; rollCount: number; sackCount: number; totalMeters: number; totalKg: number }>;
  byProduct: Array<{ itemName: string; rollCount: number; totalMeters: number }>;
  totals: { shipmentCount: number; sackCount: number; rollCount: number; totalMeters: number; totalKg: number };
}
interface Report {
  header: { shipmentNo: string; customerName: string; destination: string; status: string; branchCode: string | null };
  products: Array<{ name: string; rollCount: number; totalMeters: number }>;
  sacks: unknown[];
  cekiRows: Array<{ sackCode: string; kg: number; meters: number }>;
  totals: { totalRolls: number; totalMeters: number; totalKg: number; sackCount: number };
}

async function main(): Promise<void> {
  const ts = Date.now();
  const need = (v: { id: string } | null, label: string): string => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed')`);
    return v.id;
  };
  const ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS");
  const GRADE = need(await prisma.qualityGrade.findFirst({ where: { code: "1.KALITE" }, select: { id: true } }), "QualityGrade");
  const ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin");
  const ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON");
  const SUB_BOYER = (await ensureTestDyeHouse()).id;
  const WIDTH = 250;

  // Taze müşteri + renk → export scope'u yalnız bizim doğrudan sevke inhisar etsin.
  const customer = await prisma.customer.create({
    data: { code: `TST-ADS-${ts}`, name: `TEST DIRECT MUHASEBE ${ts}`, taxNumber: "9998887776" },
    select: { id: true },
  });
  // AD da damgalı: `colors_nameFoldColor_key` ifade-UNIQUE'i ad üzerindedir —
  // damgasız ad ikinci koşumu P2002'ye düşürür.
  const color = await prisma.color.create({ data: { code: `TST-ADS-C-${ts}`, name: `LACIVERT-TEST ${ts}` }, select: { id: true } });
  // İhracat şubesi (kod'lu) — şube kodunun export/fiş/belgeye aktığını doğrulamak için.
  const branch = await prisma.customerBranch.create({
    data: { customerId: customer.id, code: "IHR-01", name: "İhracat Şubesi" },
    select: { id: true },
  });

  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-ADS-${`${ts}`.slice(-8)}`,
      type: "STOCK_PRODUCTION", status: "IN_PROGRESS", width: WIDTH,
      targetQuantity: 1000, targetItemId: ITEM,
      steps: { create: [{ stationId: ST_BOYA, stepSequence: 1, status: "PENDING" }] },
    },
    include: { steps: true },
  });
  const stepId = wo.steps[0]!.id;
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));

  const mkRoll = (qty: number) =>
    prisma.roll.create({
      data: {
        barcode: `TST-ADS-R${qty}-${ts}`, itemId: ITEM, colorId: color.id,
        initialQty: qty, currentQty: qty, status: RollStatus.STOCK,
        qualityGrade: "1.KALITE", qualityGradeId: GRADE, width: WIDTH, createdById: ADMIN,
      },
      select: { id: true },
    });
  const r1 = await mkRoll(100);
  const r2 = await mkRoll(150);

  const order = await prisma.order.create({
    data: { orderNumber: `TST-ADS-ORD-${ts}`, customerId: customer.id, branchId: branch.id, status: "APPROVED", lines: { create: [{ itemId: ITEM, colorId: color.id, width: WIDTH, quantity: 300 }] } },
    include: { lines: true },
  });
  const orderLineId = order.lines[0]!.id;

  const dsp = await sub.dispatch({ workOrderId: wo.id, stepId, subcontractorId: SUB_BOYER, rollIds: [r1.id, r2.id] }, ADMIN);
  const dispatchId = (dsp.data as { id: string }).id;

  await sub.executeDirectShip(
    { dispatchId, reason: "muhasebe direct export testi", customerId: customer.id, branchId: branch.id, orderLineAllocations: [{ orderLineId, qty: 250 }] },
    ADMIN,
  );

  const directShipment = await prisma.directShipment.findFirst({ where: { dispatchId }, select: { id: true, shipmentNo: true } });

  try {
    // ---- A) Toplu dönem export'u DIRECT'i kapsıyor mu? (müşteri-scope) ----
    const req = { query: { "filter[customerId]": customer.id } } as unknown as Request;
    const d = (await buildDispatchAccountingExport(req)).data as ExportData;

    check("export: tek satır (doğrudan sevk)", d.shipments.length === 1, `${d.shipments.length}`);
    const s = d.shipments[0];
    check(
      "export shipment: çuval=0 / top=2 / 250m / kg=0",
      s?.sackCount === 0 && s?.rollCount === 2 && s?.totalMeters === 250 && s?.totalKg === 0,
      `${s?.sackCount}/${s?.rollCount}/${s?.totalMeters}/${s?.totalKg}`,
    );
    check("export shipment: vergi no + yön DOMESTIC", s?.taxNumber === "9998887776" && s?.destination === "DOMESTIC", `${s?.taxNumber}/${s?.destination}`);
    check("export shipment: şube adı + KODU (ihracat)", s?.branchName === "İhracat Şubesi" && s?.branchCode === "IHR-01", `${s?.branchName}/${s?.branchCode}`);

    const det = d.detail.find((x) => x.itemName === "PATOS");
    check("export detail: PATOS 2 top / 250m / 250cm", det?.rollCount === 2 && det?.meters === 250 && det?.width === 250, `${det?.rollCount}/${det?.meters}/${det?.width}`);
    check("export detail: orderNos dolu", (det?.orderNos ?? "").includes("TST-ADS-ORD"), det?.orderNos);

    check("export byCustomer: 1 sevk / 2 top / 0 çuval / 250m", d.byCustomer.length === 1 && d.byCustomer[0]?.shipmentCount === 1 && d.byCustomer[0]?.rollCount === 2 && d.byCustomer[0]?.sackCount === 0 && d.byCustomer[0]?.totalMeters === 250);
    const pP = d.byProduct.find((p) => p.itemName === "PATOS");
    check("export byProduct: PATOS 250m / 2 top", pP?.totalMeters === 250 && pP?.rollCount === 2);
    check(
      "export totals: 1 sevk / 0 çuval / 2 top / 250m / 0 kg",
      d.totals.shipmentCount === 1 && d.totals.sackCount === 0 && d.totals.rollCount === 2 && d.totals.totalMeters === 250 && d.totals.totalKg === 0,
      `${d.totals.shipmentCount}/${d.totals.sackCount}/${d.totals.rollCount}/${d.totals.totalMeters}/${d.totals.totalKg}`,
    );

    // ---- B) Fiş — getDirectShipmentDispatchReport (çuval sevkiyatı fişiyle aynı şekil) ----
    const rep = (await shipping.getDirectShipmentDispatchReport(directShipment!.id)).data as Report;
    check("fiş header: DOMESTIC + DISPATCHED", rep.header.destination === "DOMESTIC" && rep.header.status === "DISPATCHED");
    check("fiş header: shipmentNo eşleşir", rep.header.shipmentNo === directShipment!.shipmentNo);
    check("fiş header: şube kodu IHR-01", rep.header.branchCode === "IHR-01", rep.header.branchCode ?? "(null)");
    check("fiş products: 1 grup / 2 top / 250m", rep.products.length === 1 && rep.products[0]?.rollCount === 2 && rep.products[0]?.totalMeters === 250, `${rep.products.length}`);
    check("fiş products: ad 'PATOS ... 250cm.' formatı", (rep.products[0]?.name ?? "").startsWith("PATOS") && (rep.products[0]?.name ?? "").includes("250cm."), rep.products[0]?.name);
    check("fiş sacks: BOŞ (çuval yok)", Array.isArray(rep.sacks) && rep.sacks.length === 0);
    check("fiş cekiRows: 2 satır / sackCode '—' / kg 0", rep.cekiRows.length === 2 && rep.cekiRows.every((c) => c.sackCode === "—" && c.kg === 0), `${rep.cekiRows.length}`);
    check("fiş cekiRows: metre toplamı 250", rep.cekiRows.reduce((a, c) => a + c.meters, 0) === 250);
    check("fiş totals: 2 top / 250m / 0 kg / 0 çuval", rep.totals.totalRolls === 2 && rep.totals.totalMeters === 250 && rep.totals.totalKg === 0 && rep.totals.sackCount === 0);

    // ---- D) Fiş baskı HTML'i — muhasebe Fiş dialog'unun DIRECT için yaptığı TAM çağrı:
    //         getHtml(SUBCONTRACTOR_DIRECT_SHIP, DirectShipment.id). Donmuş belge dönmeli. ----
    const htmlRes = await printedDocumentService.getHtml(PrintedDocType.SUBCONTRACTOR_DIRECT_SHIP, directShipment!.id);
    const htmlStr = (htmlRes.data as { html?: string })?.html ?? "";
    check("fiş HTML: SUBCONTRACTOR_DIRECT_SHIP donmuş irsaliye (DirectShipment.id ile) döndü", Boolean(htmlStr));
    // 2026-07-28: belge artık TEK "İhracat Kodu" satırı basıyor (şube ihracat kodu
    // ?? şirket ihracat kodu). Şube kodu doluysa "İhracat Kodu: IHR-01" görünür.
    check("fiş HTML: şube ihracat kodu belgede 'İhracat Kodu' olarak görünür", htmlStr.includes("İhracat Kodu") && htmlStr.includes("IHR-01"));

    // ---- C) Regresyon: DIRECT'i istemeyen scope (olmayan müşteri) → 0 sevk ----
    const emptyReq = { query: { "filter[customerId]": "00000000-0000-0000-0000-000000000000" } } as unknown as Request;
    const ed = (await buildDispatchAccountingExport(emptyReq)).data as ExportData;
    check("scope izolasyonu: başka müşteride 0 sevk", ed.shipments.length === 0, `${ed.shipments.length}`);
  } finally {
    // Temizlik — bağımlılık sırasıyla.
    const rolls = await prisma.roll.findMany({ where: { barcode: { startsWith: `TST-ADS-` } }, select: { id: true } });
    const rollIds = rolls.map((r) => r.id);
    await prisma.printedDocument.deleteMany({ where: { sourceId: dispatchId } });
    await prisma.subcontractorDirectShipAllocation.deleteMany({ where: { dispatchId } });
    if (directShipment) await prisma.directShipment.deleteMany({ where: { id: directShipment.id } });
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: dispatchId } });
    await prisma.orderLine.deleteMany({ where: { orderId: order.id } });
    await prisma.order.delete({ where: { id: order.id } }).catch(() => {});
    await prisma.travelerCard.deleteMany({ where: { workOrderId: wo.id } });
    await prisma.batch.deleteMany({ where: { workOrderId: wo.id } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: wo.id } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, dispatchId, wo.id, order.id] } } });
    await prisma.workOrder.delete({ where: { id: wo.id } }).catch(() => {});
    await prisma.customerBranch.deleteMany({ where: { id: branch.id } }).catch(() => {});
    await prisma.color.delete({ where: { id: color.id } }).catch(() => {});
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
