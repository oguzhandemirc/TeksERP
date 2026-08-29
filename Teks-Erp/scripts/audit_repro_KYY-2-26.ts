// =============================================================================
// AUDIT REPRO — KYY-2-26: eşzamanlı `unlinkOrderLine` → "tip = bağın aynası" bozuluyor
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER (aşağıdaki guard).
// Beklenen (sağlıklı sistem): iki bağın ikisi de kalkınca iş emri 0 bağla kalır ve
//   `type` STOCK_PRODUCTION'a döner (2026-08-21 kararı: "tip HİÇBİR yerde beyan değil,
//   bağdan türer"; bekçi `test_consistency_derived §21`).
// Gözlenen: (çalıştırınca doldur — log audit/repro/KYY-2-26.log)
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_KYY-2-26.ts
//
// Ölçülen değişmez: WO-tip aynası — `WorkOrder.type = ORDER_PRODUCTION ⇔ ∃ bağ`.
// Mekanizma: `unlinkOrderLine` (`workorder-link.service.ts:453-473`) "son bağ mı"
//   kararını tx DIŞINDA okunan `links` dizisinden verir (`lastLinkOfOrderWo` :445);
//   iki eşzamanlı istek de "2 bağ var → son değil" görür, ikisi de siler ve tip
//   flip bloğuna HİÇ girilmez. WO satırı kilitlenmiyor (`touchWorkOrderTx` bu
//   serviste HİÇ çağrılmıyor — grep ile doğrulandı).
// Migration/flag/ayar DEĞİŞTİRİLMEZ.
// =============================================================================
import "dotenv/config";

function devDbGuard(): void {
  const url = process.env.DATABASE_URL ?? "";
  if ((process.env.NODE_ENV ?? "") === "production" || (process.env.APP_ENV ?? "") === "production")
    throw new Error("REPRO: production ortamında koşturulamaz");
  let host = "",
    db = "";
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    db = decodeURIComponent(u.pathname.replace(/^\//, ""));
  } catch {
    throw new Error("REPRO: DATABASE_URL çözümlenemedi (fail-closed)");
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(host))
    throw new Error(`REPRO: yerel olmayan host reddedildi: ${host}`);
  if (/saha|prod|canli|sahin/i.test(db) && db !== "adnansahin_db")
    throw new Error(`REPRO: prod kopyası/prod adı reddedildi: ${db}`);
}
devDbGuard();

import { OrderStatus, WorkOrderStatus, WorkOrderType } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { WorkOrderLinkService } from "../src/services/workorder-link.service";

const linkSvc = new WorkOrderLinkService();
const STAMP = `AUDITREPRO-KYY-2-26-${Math.random().toString(36).slice(2, 8)}`;

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

const createdOrders: string[] = [];
const createdWos: string[] = [];

let itemId = "";
let customerId = "";
let seq = 0;

async function makeScenario(): Promise<{ woId: string; lineIds: string[] }> {
  seq += 1;
  const order = await prisma.order.create({
    data: {
      orderNumber: `${STAMP}-O${seq}-${Math.floor(Math.random() * 1e6)}`,
      customerId,
      status: OrderStatus.APPROVED,
      lines: {
        create: [
          { itemId, colorId: null, width: null, quantity: 100 },
          { itemId, colorId: null, width: null, quantity: 100 },
        ],
      },
    },
    select: { id: true, lines: { select: { id: true } } },
  });
  createdOrders.push(order.id);

  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `${STAMP}-W${seq}-${Math.floor(Math.random() * 1e6)}`.slice(0, 40),
      type: WorkOrderType.ORDER_PRODUCTION,
      status: WorkOrderStatus.PLANNED,
      targetItemId: itemId, // STOK'a dönebilmesi için hedef kumaş dolu (400 guard'ı geçilsin)
      targetQuantity: 200,
      plannedStartDate: new Date(),
      plannedEndDate: new Date(Date.now() + 86400_000),
      orderLinks: {
        create: order.lines.map((l) => ({ orderLineId: l.id, allocatedQty: 0 })),
      },
    },
    select: { id: true },
  });
  createdWos.push(wo.id);
  return { woId: wo.id, lineIds: order.lines.map((l) => l.id) };
}

/** Commit SONRASI, DB'DEN oku. */
async function state(woId: string): Promise<{ type: WorkOrderType; links: number }> {
  const wo = await prisma.workOrder.findUnique({ where: { id: woId }, select: { type: true } });
  const links = await prisma.workOrderToOrderLine.count({ where: { workOrderId: woId } });
  return { type: wo!.type, links };
}

async function runArm(label: string, parallel: boolean): Promise<{ type: WorkOrderType; links: number }> {
  const { woId, lineIds } = await makeScenario();
  const call = (lineId: string) =>
    linkSvc
      .unlinkOrderLine(woId, lineId)
      .then((r) => ({ ok: true as const, changed: r.data.typeChanged }))
      .catch((e: unknown) => ({ ok: false as const, err: (e as Error).message }));

  let res: Array<{ ok: boolean; changed?: boolean; err?: string }>;
  if (parallel) {
    res = await Promise.all(lineIds.map((l) => call(l)));
  } else {
    res = [];
    for (const l of lineIds) res.push(await call(l));
  }
  console.log(
    `   [${label}] ${res.map((r) => (r.ok ? `OK(typeChanged=${r.changed})` : `ERR(${(r.err ?? "").slice(0, 50)})`)).join(" | ")}`,
  );
  const st = await state(woId);
  console.log(`   [${label}] SONUÇ: bağ=${st.links} · type=${st.type}`);
  return st;
}

async function main(): Promise<void> {
  console.log(`=== AUDIT REPRO KYY-2-26 — sipariş bağı sökme / tip aynası (${STAMP}) ===\n`);

  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  const cust = await prisma.customer.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!item || !cust) throw new Error("Test verisi yetersiz (Item/Customer yok — npm run seed).");
  itemId = item.id;
  customerId = cust.id;

  // ── KOL 1: SIRALI (referans davranış) ──
  console.log("--- KOL 1: SIRALI iki unlinkOrderLine (2 bağlı ORDER_PRODUCTION iş emri) ---");
  const seqSt = await runArm("SIRALI", false);
  check(
    "S1 sıralı: 0 bağ kalınca type=STOCK_PRODUCTION",
    seqSt.links === 0 && seqSt.type === WorkOrderType.STOCK_PRODUCTION,
    `bağ=${seqSt.links} type=${seqSt.type}`,
  );

  // ── KOL 2: PARALEL ──
  console.log("\n--- KOL 2: PARALEL iki unlinkOrderLine (aynı iş emri, iki farklı satır) ---");
  const parSt = await runArm("PARALEL", true);
  check(
    "P1 paralel: 0 bağ kalınca type=STOCK_PRODUCTION (ayna korunuyor)",
    parSt.links === 0 && parSt.type === WorkOrderType.STOCK_PRODUCTION,
    `bağ=${parSt.links} type=${parSt.type}`,
  );

  // ── KOL 3: 10 tekrar, kaçında ayna bozuluyor ──
  console.log("\n--- KOL 3: PARALEL × 10 tekrar ---");
  let broke = 0;
  for (let i = 0; i < 10; i++) {
    const st = await runArm(`P#${i + 1}`, true);
    if (st.links === 0 && st.type !== WorkOrderType.STOCK_PRODUCTION) broke++;
  }
  console.log(`\n10 paralel turun ${broke} tanesinde "0 bağ ama type=ORDER_PRODUCTION" oluştu.`);
  check("R1 10 turun hiçbirinde ayna bozulmadı", broke === 0, `bozulan=${broke}/10`);

  // ── Mutabakat sorgusu (test_consistency_derived §21 ile aynı soru) ──
  const drift = await prisma.$queryRaw<Array<{ id: string; type: string; n: bigint }>>`
    SELECT w."id", w."type"::text AS type, COUNT(l."orderLineId") AS n
    FROM "work_orders" w
    LEFT JOIN "work_order_to_order_lines" l ON l."workOrderId" = w."id"
    WHERE w."workOrderNumber" LIKE ${STAMP + "%"}
    GROUP BY w."id", w."type"
    HAVING (w."type" = 'ORDER_PRODUCTION' AND COUNT(l."orderLineId") = 0)
        OR (w."type" = 'STOCK_PRODUCTION' AND COUNT(l."orderLineId") > 0)
  `;
  console.log(`\nMutabakat (§21 ikizi): bu koşumun ürettiği tutarsız WO sayısı = ${drift.length}`);
  check("C1 §21 mutabakatı temiz (tip ↔ bağ)", drift.length === 0, `drift=${drift.length}`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

/** Bu repro'nun ÖNCEKİ koşumlarından kalan artıkları da toplar (prefix bazlı). */
async function cleanup(): Promise<void> {
  const PREFIX = "AUDITREPRO-KYY-2-26-";
  try {
    const wos = await prisma.workOrder.findMany({
      where: { workOrderNumber: { startsWith: PREFIX } },
      select: { id: true },
    });
    const orders = await prisma.order.findMany({
      where: { orderNumber: { startsWith: PREFIX } },
      select: { id: true },
    });
    const woIds = [...new Set([...createdWos, ...wos.map((w) => w.id)])];
    const orderIds = [...new Set([...createdOrders, ...orders.map((o) => o.id)])];

    await prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: { in: woIds } } });
    const cards = await prisma.travelerCard.findMany({
      where: { workOrderId: { in: woIds } },
      select: { id: true },
    });
    if (cards.length > 0) {
      await prisma.travelerCardScan.deleteMany({ where: { cardId: { in: cards.map((c) => c.id) } } });
      await prisma.travelerCard.deleteMany({ where: { id: { in: cards.map((c) => c.id) } } });
    }
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
    await prisma.orderLine.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...woIds, ...orderIds] } } });
    console.log(`\n[temizlik] ${woIds.length} iş emri / ${orderIds.length} sipariş silindi.`);
  } catch (e) {
    console.error("Temizlik hatası:", e);
  }
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
