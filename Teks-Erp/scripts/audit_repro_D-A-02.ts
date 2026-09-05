// =============================================================================
// AUDIT REPRO — D-A-02: `recomputeOrderStatusTx`u `touchOrderLinesTx` OLMADAN çağıran
// yollar (order.service.ts:2537 `update`, :3411 `reopen`) eşzamanlı sevk onayının
// yazdığı `shippedQty`yi SESSİZCE SIFIRLIYOR (lost update).
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER.
// Beklenen (sağlıklı sistem): iki yol da helper'ın KİLİT PROTOKOLÜNÜ uygular
//   (`order-status.helper.ts:205-210`) → hangi sıra olursa olsun son değer defterle
//   (SackAllocation) UYUŞUR.
// Gözlenen: çalıştırınca doldur — log audit/repro/D-A-02.log
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_D-A-02.ts
// =============================================================================
// MEKANİZMA:
//   `recomputeOrderStatusTx` defteri KİLİTSİZ okur (computeLineLedgerTx) ve denormu
//   (OrderLine.shippedQty + Order.shippedQty + Order.status) yazar. READ COMMITTED
//   altında T2'nin okuması T1'in COMMIT'inden ÖNCE, yazımı SONRA gerçekleşebilir:
//   T2 satır kilidinde bekler, uyanır ve BAYAT değeri yazar. Helper docstring'i
//   çağıranı "tam satır kümesini `touchOrderLinesTx` ile ÖNCE kilitle" diye
//   uyarır; shipping (:1878/:1975/:2210) ve subcontractor (:6233) uyar,
//   order.service `update`/`reopen` UYMAZ.
// =============================================================================
import "dotenv/config";

function devDbGuard(): void {
  const url = process.env.DATABASE_URL ?? "";
  if ((process.env.NODE_ENV ?? "") === "production" || (process.env.APP_ENV ?? "") === "production")
    throw new Error("REPRO: production ortamında koşturulamaz");
  let host = "", db = "";
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

import { ItemType, ShipmentStatus, OrderStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { touchOrderLinesTx, recomputeOrderStatusTx } from "../src/services/helpers/order-status.helper";

const RAND = Math.random().toString(36).slice(2, 8);
const STAMP = `AUDITREPRO-D-A-02-${RAND}`;

let fail = 0;
const ok = (m: string) => console.log(`✅ ${m}`);
const bad = (m: string) => { console.log(`❌ ${m}`); fail++; };
const info = (m: string) => console.log(`   ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ids = {
  customerId: "", itemId: "", orderId: "", lineId: "",
  shipmentId: "", sackId: "", allocationId: "",
};

/** Sevk onayı (performDispatchTx) protokolü: touch → ledger değişimi → recompute. */
async function dispatchLikeTx(holdMs: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await touchOrderLinesTx(tx, [ids.lineId]);                       // satır kilidi
    await tx.shipment.update({                                        // defter değişir
      where: { id: ids.shipmentId },
      data: { status: ShipmentStatus.DISPATCHED, dispatchedAt: new Date() },
    });
    await sleep(holdMs);                                              // rakip tx araya girsin
    await recomputeOrderStatusTx(tx, ids.orderId);
  }, { timeout: 30_000, maxWait: 20_000 });
}

/** `order.service.update`/`reopen` yolu: recompute, ÖNCE touchOrderLinesTx YOK. */
async function orderEditTxWithoutTouch(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await recomputeOrderStatusTx(tx, ids.orderId);
  }, { timeout: 30_000, maxWait: 20_000 });
}

/** Aynı yol, protokole UYARSA (negatif sonda / düzeltmenin ispatı). */
async function orderEditTxWithTouch(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const lines = await tx.orderLine.findMany({ where: { orderId: ids.orderId }, select: { id: true } });
    await touchOrderLinesTx(tx, lines.map((l) => l.id));
    await recomputeOrderStatusTx(tx, ids.orderId);
  }, { timeout: 30_000, maxWait: 20_000 });
}

async function readState() {
  const line = await prisma.orderLine.findUniqueOrThrow({
    where: { id: ids.lineId }, select: { shippedQty: true, quantity: true },
  });
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: ids.orderId }, select: { shippedQty: true, status: true },
  });
  const ledger = await prisma.sackAllocation.aggregate({
    where: { orderLineId: ids.lineId, sack: { shipment: { status: ShipmentStatus.DISPATCHED } } },
    _sum: { qty: true },
  });
  return {
    lineShipped: Number(line.shippedQty),
    orderShipped: Number(order.shippedQty),
    orderStatus: order.status,
    ledgerShipped: Number(ledger._sum.qty ?? 0),
  };
}

async function resetToPlanned(): Promise<void> {
  await prisma.shipment.update({
    where: { id: ids.shipmentId },
    data: { status: ShipmentStatus.PLANNED, dispatchedAt: null },
  });
  await prisma.orderLine.update({ where: { id: ids.lineId }, data: { shippedQty: 0 } });
  await prisma.order.update({
    where: { id: ids.orderId },
    data: { shippedQty: 0, status: OrderStatus.APPROVED, completedAt: null },
  });
}

async function main(): Promise<void> {
  console.log(`\n=== ${STAMP} — shippedQty lost update (recompute kilitsiz) ===\n`);

  const customer = await prisma.customer.create({
    data: { code: `ARDA02${RAND}`.slice(0, 32), name: `${STAMP} müşteri` }, select: { id: true },
  });
  ids.customerId = customer.id;
  const item = await prisma.item.create({
    data: { code: `ARDA02I${RAND}`.slice(0, 32), name: `${STAMP} kumaş`, itemType: ItemType.FABRIC },
    select: { id: true },
  });
  ids.itemId = item.id;
  const order = await prisma.order.create({
    data: {
      orderNumber: `${STAMP}-SIP`.slice(0, 64),
      customerId: ids.customerId,
      status: OrderStatus.APPROVED,
      lines: { create: [{ itemId: ids.itemId, quantity: 1000 }] },
    },
    select: { id: true, lines: { select: { id: true } } },
  });
  ids.orderId = order.id;
  ids.lineId = order.lines[0].id;
  const shipment = await prisma.shipment.create({
    data: { shipmentNo: `${STAMP}-SVK`.slice(0, 64), customerId: ids.customerId, status: ShipmentStatus.PLANNED },
    select: { id: true },
  });
  ids.shipmentId = shipment.id;
  const sack = await prisma.sack.create({
    data: { sackNo: `${STAMP}-CV`.slice(0, 64), shipmentId: ids.shipmentId, seq: 1 },
    select: { id: true },
  });
  ids.sackId = sack.id;
  const alloc = await prisma.sackAllocation.create({
    data: { sackId: ids.sackId, orderLineId: ids.lineId, qty: 400 }, select: { id: true },
  });
  ids.allocationId = alloc.id;
  info(`fixture: sipariş 1000 m, çuval tahsisi 400 m, sevkiyat PLANNED`);

  try {
    // ── SENARYO A: KİLİTSİZ recompute (order.service.update/reopen yolu) ──────
    await resetToPlanned();
    {
      const t1 = dispatchLikeTx(900);
      await sleep(250);                       // T2, T1 COMMIT etmeden defteri okusun
      const t2 = orderEditTxWithoutTouch();
      const res = await Promise.allSettled([t1, t2]);
      res.forEach((r, i) => { if (r.status === "rejected") info(`T${i + 1} düştü: ${(r.reason as Error).message}`); });

      const st = await readState();
      info(`A) defter=${st.ledgerShipped} · OrderLine.shippedQty=${st.lineShipped} · Order.shippedQty=${st.orderShipped} · status=${st.orderStatus}`);
      if (st.lineShipped !== st.ledgerShipped) {
        bad(
          `A) LOST UPDATE: defterde ${st.ledgerShipped} m sevk var ama denormda ${st.lineShipped} m yazılı ` +
          `(sipariş "${st.orderStatus}" görünüyor; ekranda ${1000 - st.lineShipped} m AÇIK kalıyor)`,
        );
      } else {
        ok(`A) denorm defterle uyuştu (${st.lineShipped}) — bu koşumda zamanlama tutmadı`);
      }
    }

    // ── SENARYO B (negatif sonda): AYNI yol protokole uyarsa ─────────────────
    await resetToPlanned();
    {
      const t1 = dispatchLikeTx(900);
      await sleep(250);
      const t2 = orderEditTxWithTouch();
      const res = await Promise.allSettled([t1, t2]);
      res.forEach((r, i) => { if (r.status === "rejected") info(`T${i + 1} düştü: ${(r.reason as Error).message}`); });

      const st = await readState();
      info(`B) defter=${st.ledgerShipped} · OrderLine.shippedQty=${st.lineShipped} · Order.shippedQty=${st.orderShipped} · status=${st.orderStatus}`);
      if (st.lineShipped === st.ledgerShipped) {
        ok("B) `touchOrderLinesTx` ÖNCE çağrılınca lost update YOK — düzeltmenin yönü doğrulandı");
      } else {
        bad(`B) protokole uyulduğu hâlde sapma var (${st.lineShipped} ≠ ${st.ledgerShipped}) — teşhis eksik`);
      }
    }
  } finally {
    await prisma.sackAllocation.deleteMany({ where: { orderLineId: ids.lineId } });
    await prisma.sack.deleteMany({ where: { id: ids.sackId } });
    await prisma.shipment.deleteMany({ where: { id: ids.shipmentId } });
    await prisma.orderLine.deleteMany({ where: { orderId: ids.orderId } });
    await prisma.order.deleteMany({ where: { id: ids.orderId } });
    await prisma.item.deleteMany({ where: { id: ids.itemId } });
    await prisma.customer.deleteMany({ where: { id: ids.customerId } });
    await prisma.$disconnect();
    await pool.end().catch(() => undefined);
  }

  console.log(`\n=== SONUÇ: ${fail === 0 ? "değişmez korundu" : `${fail} kırmızı`} ===\n`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error("REPRO ÇÖKTÜ:", e);
  process.exitCode = 1;
});
