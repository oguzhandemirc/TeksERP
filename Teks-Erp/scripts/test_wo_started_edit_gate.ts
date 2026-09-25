// =============================================================================
// TEST: BAŞLAMIŞ İŞ EMRİNDE GENEL DÜZENLE KAPISI (D2b)
// Çalıştır: npx tsx scripts/test_wo_started_edit_gate.ts
// =============================================================================
// Tasarım: docs/design/IS-EMRI-HAREKET-DEFTERI.md §6.3 (seçenek A). Üretim başlamış
// (IN_PROGRESS) iş emrinde tek amaçlı yolu olan alanlar genel Düzenle'den değişmez:
//   §1 update renk değişimi → 409 WO_STARTED_USE_ACTION (field=color), renk yerinde
//   §2 update en değişimi → 409 (field=width)
//   §3 update hedef metre + plan tarihi → serbest (yıkıcı değil)
//   §4 update aynı en/renk yeniden gönderilir → serbest (değişim yok)
//   §5 replace en değişimi → 409 (field=width)
//   §6 replace sipariş bağı ekler → 409 (field=orderLinks), bağ doğmadı
//   §7 PLANNED iş emrinde replace en değişimi serbest (tam Düzenle kalır)
//   §8 tek amaçlı "Eni Değiştir" başlamış iş emrinde çalışır (yol açık)
// NEGATİF SONDA (elle, 2026-09-25): `assertStartedEditAllowed` erken `return` →
// §1/§2/§5/§6 kırmızı; yedek kopyadan geri alındı.
// =============================================================================

import prisma from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
import { WorkOrderLinkService } from "../src/services/workorder-link.service";
import { ensureTestAdmin } from "./fixture-test-user";

const svc = new WorkOrderService();
const link = new WorkOrderLinkService();
const TAG = `TST-WOSEG-${Date.now()}`;

let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

let ITEM = "", ADMIN = "", ST_FASON = "", ST_TAMBUR = "", COLOR = "", CUSTOMER = "";
const woIds: string[] = [];
const orderIds: string[] = [];

async function fikstur(): Promise<void> {
  const need = <T,>(v: T | null, label: string): T => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed' + 'seed:fixtures')`);
    return v;
  };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS").id;
  ADMIN = (await ensureTestAdmin()).id;
  ST_FASON = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON").id;
  ST_TAMBUR = need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "TAMBUR_1").id;
  COLOR = need(await prisma.color.findFirst({ where: { code: "MAVI" }, select: { id: true } }), "MAVI").id;
  CUSTOMER = (await prisma.customer.create({ data: { code: `${TAG}-CUS`, name: `${TAG} müşteri` }, select: { id: true } })).id;
}

const STEPS = () => [{ stationId: ST_FASON }, { stationId: ST_TAMBUR }];

async function yeniWo(): Promise<string> {
  const res = await svc.create({ type: "STOCK_PRODUCTION", targetItemId: ITEM, width: 180, steps: STEPS() }, ADMIN);
  const id = (res.data as { id: string }).id;
  woIds.push(id);
  return id;
}

async function hata(fn: () => Promise<unknown>): Promise<{ code?: string; field?: string } | null> {
  try { await fn(); return null; }
  catch (e) { return (e as { details?: { code?: string; field?: string } }).details ?? { code: `HATA:${(e as Error).message}` }; }
}

async function govde(id: string) {
  const wo = await prisma.workOrder.findUniqueOrThrow({ where: { id }, select: { plannedStartDate: true, plannedEndDate: true } });
  return {
    type: "STOCK_PRODUCTION", targetItemId: ITEM, width: 180, steps: STEPS(),
    plannedStartDate: wo.plannedStartDate?.toISOString(), plannedEndDate: wo.plannedEndDate?.toISOString(),
  };
}

async function main(): Promise<void> {
  console.log("=== Başlamış iş emrinde genel Düzenle kapısı ===");
  await fikstur();
  try {
    const a = await yeniWo();
    await svc.lockWorkOrder(a, ADMIN);
    const durum = (await prisma.workOrder.findUniqueOrThrow({ where: { id: a }, select: { status: true } })).status;
    check("§0 fikstür: iş emri IN_PROGRESS", durum === "IN_PROGRESS", durum);

    const h1 = await hata(() => svc.update(a, { targetColorId: COLOR }, ADMIN));
    const renk = (await prisma.workOrder.findUniqueOrThrow({ where: { id: a }, select: { targetColorId: true } })).targetColorId;
    check("§1 update renk → 409 WO_STARTED_USE_ACTION (color), renk yerinde",
      h1?.code === "WO_STARTED_USE_ACTION" && h1.field === "color" && renk === null, JSON.stringify(h1));
    const h2 = await hata(() => svc.update(a, { width: 200 }, ADMIN));
    check("§2 update en → 409 (width)", h2?.code === "WO_STARTED_USE_ACTION" && h2.field === "width", JSON.stringify(h2));
    const h3 = await hata(() => svc.update(a, { targetQuantity: 750, plannedEndDate: "2026-11-01T09:00:00.000Z" }, ADMIN));
    check("§3 update hedef metre + plan tarihi serbest", h3 === null, JSON.stringify(h3));
    const h4 = await hata(() => svc.update(a, { width: 180, targetColorId: null }, ADMIN));
    check("§4 aynı en/renk yeniden gönderilir → serbest", h4 === null, JSON.stringify(h4));

    const h5 = await hata(async () => svc.replace(a, { ...(await govde(a)), width: 210 } as Parameters<typeof svc.replace>[1], ADMIN));
    check("§5 replace en → 409 (width)", h5?.code === "WO_STARTED_USE_ACTION" && h5.field === "width", JSON.stringify(h5));

    const order = await prisma.order.create({
      data: { orderNumber: `${TAG}-ORD`, customerId: CUSTOMER, lines: { create: [{ itemId: ITEM, width: 180, quantity: 100 }] } },
      select: { id: true, lines: { select: { id: true } } },
    });
    orderIds.push(order.id);
    const h6 = await hata(async () =>
      svc.replace(a, { ...(await govde(a)), orderLineIds: [order.lines[0].id] } as Parameters<typeof svc.replace>[1], ADMIN));
    const bag = await prisma.workOrderToOrderLine.count({ where: { workOrderId: a } });
    check("§6 replace sipariş bağı ekler → 409 (orderLinks), bağ doğmadı",
      h6?.code === "WO_STARTED_USE_ACTION" && h6.field === "orderLinks" && bag === 0, `${JSON.stringify(h6)} · bağ=${bag}`);

    const b = await yeniWo();
    const h7 = await hata(async () => svc.replace(b, { ...(await govde(b)), width: 210 } as Parameters<typeof svc.replace>[1], ADMIN));
    const bEn = (await prisma.workOrder.findUniqueOrThrow({ where: { id: b }, select: { width: true } })).width;
    check("§7 PLANNED iş emrinde replace en değişimi serbest", h7 === null && Number(bEn) === 210, `${JSON.stringify(h7)} · en=${bEn}`);

    await link.changeWidth(a, 205, "başlamış iş emrinde tek amaçlı yol", ADMIN);
    const aEn = (await prisma.workOrder.findUniqueOrThrow({ where: { id: a }, select: { width: true } })).width;
    check("§8 'Eni Değiştir' başlamış iş emrinde çalışır", Number(aEn) === 205, String(aEn));
  } finally {
    await temizle();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

async function temizle(): Promise<void> {
  const cards = await prisma.travelerCard.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
  const cardIds = cards.map((c) => c.id);
  const stepIds = (await prisma.workOrderStep.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } })).map((x) => x.id);
  await prisma.travelerCardScan.deleteMany({ where: { cardId: { in: cardIds } } });
  await prisma.travelerCard.deleteMany({ where: { id: { in: cardIds } } });
  await prisma.systemLog.deleteMany({ where: { recordId: { in: [...woIds, ...stepIds, ...orderIds] } } });
  await prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
  await prisma.orderLine.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  if (CUSTOMER) await prisma.customer.deleteMany({ where: { id: CUSTOMER } });
}

main().catch(async (e) => {
  console.error("HATA:", e);
  await temizle().catch((err) => console.error("temizlik hatası:", err));
  await prisma.$disconnect();
  process.exit(1);
});
