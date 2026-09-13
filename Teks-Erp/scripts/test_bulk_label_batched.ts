// =============================================================================
// TEST: getBulkRollLabelsHtml batched refactor — BYTE-IDENTİK çıktı kanıtı
// Çalıştır: npx tsx scripts/test_bulk_label_batched.ts
// =============================================================================
// Refactor getBulkRollLabelsHtml'i O(N) sorgudan O(1)'e indirdi (preloaded
// BulkLabelContext). KANIT: bulk çıktısı, DEĞİŞMEYEN per-roll getRollLabelHtml
// yolundan (preloaded=undefined → eski sorgular = ground truth) AYNI şekilde
// kompoze edilen çıktıyla BYTE-IDENTİK olmalı. Branch matrisi (RAW/FINISHED,
// snapshot ①②③, WO-inference ④, alias) tek bulk'ta kapsanır.
// =============================================================================

import prisma from "../src/lib/prisma";
import { roleGrade } from "./fixture-quality-grade";
import { LabelService } from "../src/services/label.service";
import { WorkOrderStatus, RollStatus } from "@prisma/client";

let pass = 0,
  fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}
function need<T>(v: T | null | undefined, what: string): T {
  if (v == null) throw new Error(`Fixture bulunamadı: ${what}`);
  return v;
}
// printedAt = new Date() (DD.MM.YYYY HH:mm) — tek satır vs bulk arası ms/dakika
// farkını ele (byte-equality date alanına takılmasın).
const maskDate = (s: string) => s.replace(/\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}/g, "DATE");

const svc = new LabelService();
let ITEM = "",
  COLOR = "",
  GRADE = "",
  GRADE_CODE = "",
  ADMIN = "",
  STATION = "";
let testCustomerId = "";
const rollBarcodes: string[] = [];
const woIds: string[] = [];
const orderIds: string[] = [];
const stamp = Date.now().toString().slice(-7);

async function setup(): Promise<string[]> {
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS").id;
  const _gradeRow = await roleGrade("FIRST");
  GRADE = _gradeRow.id;
  GRADE_CODE = _gradeRow.code;
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin").id;
  STATION = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON").id;
  const allowed = await prisma.itemAllowedColor.findFirst({ where: { itemId: ITEM }, select: { colorId: true } });
  COLOR = allowed ? allowed.colorId : need(await prisma.color.findFirst({ where: { isActive: true }, select: { id: true } }), "renk").id;

  // İzole test müşterisi + alias'ları (alias batching dalını kapsamak için).
  const cust = await prisma.customer.create({
    data: { code: `TST-BLK-C-${stamp}`, name: `Bulk Test Müşteri ${stamp}` },
  });
  testCustomerId = cust.id;
  await prisma.customerItemAlias.create({ data: { customerId: cust.id, itemId: ITEM, alias: "BLK-ITEM-ALIAS" } });
  await prisma.customerColorAlias.create({ data: { customerId: cust.id, colorId: COLOR, alias: "BLK-COLOR-ALIAS", assigned: true } });

  // order + orderLine (branch ① snapshot + branch ④ WO-link için, override'lı).
  const order = await prisma.order.create({
    data: {
      orderNumber: `TST-BLK-ORD-${stamp}`,
      customerId: cust.id,
      status: "APPROVED",
      lines: {
        create: [{ itemId: ITEM, colorId: COLOR, width: 150, quantity: 100, customerItemName: "OVR-ITEM", customerColorName: "OVR-COLOR" }],
      },
    },
    include: { lines: true },
  });
  orderIds.push(order.id);
  const orderLineId = order.lines[0].id;

  // WO + step + link (branch ④ WO-inference).
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-BLK-WO-${stamp}`,
      type: "STOCK_PRODUCTION",
      status: WorkOrderStatus.IN_PROGRESS,
      width: 150,
      targetItemId: ITEM,
      steps: { create: [{ stationId: STATION, stepSequence: 1, status: "PENDING" as const }] },
    },
    include: { steps: true },
  });
  woIds.push(wo.id);
  const stepId = wo.steps[0].id;
  await prisma.workOrderToOrderLine.create({ data: { workOrderId: wo.id, orderLineId } });

  let i = 0;
  const mk = async (cfg: { colorId: string | null; snapshot?: unknown; producedInStepId?: string }) => {
    const barcode = `TST-BLK-R${i++}-${stamp}`;
    rollBarcodes.push(barcode);
    const r = await prisma.roll.create({
      data: {
        barcode,
        itemId: ITEM,
        colorId: cfg.colorId,
        status: RollStatus.WAREHOUSE,
        currentQty: 100,
        initialQty: 100,
        width: 150,
        qualityGrade: GRADE_CODE,
        qualityGradeId: GRADE,
        createdById: ADMIN,
        producedInStepId: cfg.producedInStepId ?? null,
        lastLabelSnapshot: (cfg.snapshot ?? undefined) as never,
      },
      select: { id: true },
    });
    return r.id;
  };

  // Branch matrisi:
  const r1 = await mk({ colorId: null }); // RAW, branch ④ müşterisiz
  const r2 = await mk({ colorId: COLOR }); // FINISHED, branch ④ müşterisiz
  const r3 = await mk({ colorId: COLOR, snapshot: { customerId: testCustomerId } }); // ② + alias (MASTER)
  const r4 = await mk({ colorId: COLOR, snapshot: { orderLineId } }); // ① override (OVR)
  const r5 = await mk({ colorId: COLOR, snapshot: { stock: true } }); // ③ stok, müşterisiz
  const r6 = await mk({ colorId: COLOR, producedInStepId: stepId }); // ④ WO-inference (override)
  return [r1, r2, r3, r4, r5, r6];
}

async function run(ids: string[]): Promise<void> {
  console.log("\n=== getBulkRollLabelsHtml byte-identik kanıtı ===");
  const copies = 2;

  // GROUND TRUTH: per-roll (preloaded=undefined → eski sorgular) çıktılarını bulk
  // metodunun YAPTIĞI GİBİ kompoze et.
  const bodyRe = /<body[^>]*>([\s\S]*?)<\/body>/i;
  let head = "";
  const bodies: string[] = [];
  for (const id of ids) {
    const full = (await svc.getRollLabelHtml(id, undefined, { copies })).data.html;
    if (!head) {
      const openIdx = full.search(/<body[^>]*>/i);
      head = openIdx >= 0 ? full.slice(0, full.match(/<body[^>]*>/i)![0].length + openIdx) : "";
    }
    const m = full.match(bodyRe);
    if (m) bodies.push(m[1]);
  }
  const combinedBody = bodies
    .map((b, i) => (i === 0 ? b : `<div style="page-break-before: always;">${b}</div>`))
    .join("\n");
  const expected = head
    ? `${head}\n${combinedBody}\n</body></html>`
    : `<!doctype html><html><head><meta charset="utf-8"></head><body>${combinedBody}</body></html>`;

  // ACTUAL: batched bulk yolu (preloaded).
  const bulkRes = await svc.getBulkRollLabelsHtml(ids, { copies });
  const bulk = bulkRes.data.html;

  check("bulk count == top sayısı", bulkRes.data.count === ids.length, `${bulkRes.data.count}/${ids.length}`);
  check(
    "bulk çıktısı == per-roll-kompoze (BYTE-IDENTİK, date-masked)",
    maskDate(bulk) === maskDate(expected),
    `len ${bulk.length} vs ${expected.length}`
  );

  // Ek güven: alias/override içerik gerçekten basılıyor mu (dalların canlı olduğu).
  check("alias dalı render edildi (BLK-ITEM-ALIAS bulk'ta)", bulk.includes("BLK-ITEM-ALIAS"));
  check("override dalı render edildi (OVR-ITEM bulk'ta)", bulk.includes("OVR-ITEM"));

  // ── NATIVE bulk (diyalogsuz seri/BT tek-job) — aynı fixture matrisi ─────────
  // bulk-native = N topun native bloklarının ardışık birleşimi. GROUND TRUTH:
  // per-roll getRollLabelNative (preloaded=undefined) çıktılarını concat et.
  const nativeBlocks: string[] = [];
  for (const id of ids) {
    nativeBlocks.push((await svc.getRollLabelNative(id, undefined, { copies })).data.content);
  }
  const expectedNative = nativeBlocks.join("");
  const nativeRes = await svc.getBulkRollLabelsNative(ids, { copies });
  check("native bulk count == top sayısı", nativeRes.data.count === ids.length, `${nativeRes.data.count}/${ids.length}`);
  check("native bulk dili tanımlı", typeof nativeRes.data.language === "string" && nativeRes.data.language.length > 0, nativeRes.data.language);
  check(
    "native bulk == per-roll-native concat (byte-identik, date-masked)",
    maskDate(nativeRes.data.content) === maskDate(expectedNative),
    `len ${nativeRes.data.content.length} vs ${expectedNative.length}`,
  );
  check("native bulk içeriği boş değil", nativeRes.data.content.length > 0);
}

async function cleanup(): Promise<void> {
  const rolls = await prisma.roll.findMany({ where: { barcode: { startsWith: "TST-BLK-R" } }, select: { id: true } });
  await prisma.roll.deleteMany({ where: { id: { in: rolls.map((r) => r.id) } } });
  await prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
  const lines = await prisma.orderLine.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
  await prisma.orderLine.deleteMany({ where: { id: { in: lines.map((l) => l.id) } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  if (testCustomerId) {
    await prisma.customerItemAlias.deleteMany({ where: { customerId: testCustomerId } });
    await prisma.customerColorAlias.deleteMany({ where: { customerId: testCustomerId } });
    await prisma.customer.deleteMany({ where: { id: testCustomerId } });
  }
}

async function main(): Promise<void> {
  let ids: string[] = [];
  try {
    ids = await setup();
    await run(ids);
  } finally {
    await cleanup();
    console.log("(test verisi temizlendi)");
  }
  console.log("──────────────────────────────────────────");
  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
