// =============================================================================
// AUDIT REPRO — S-2-01: `createShipment` sipariş satırlarını tx'in BAŞINDA
//   (`computeSackAllocations`, ACTIVE_LINE süzgeciyle) okur; satır kilidini
//   (`touchOrderLinesTx`) ise ancak `performDispatchTx` içinde, tahsis YAZILDIKTAN
//   SONRA alır. Arada commit eden `cancelOrderLine` GÖRÜLMEZ → mal İPTAL EDİLMİŞ
//   kaleme yazılır ve sevk edilir.
//
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER (aşağıdaki guard).
// Beklenen (sağlıklı sistem): hiçbir `SackAllocation` satırı `cancelledAt` dolu bir
//   `OrderLine`a bağlanmaz — ne sıralı ne paralel koşumda.
// Gözlenen: (çalıştırınca doldur — log audit/repro/S-2-01.log)
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_S-2-01.ts
//
// Ölçülen değişmez: INV-SIP-01 / INV-SIP-02 ("açık talep" = iptal edilmemiş kalem;
//   iptal edilmiş kaleme YENİ sevk yazılmaz) + INV-SEV-02 (tahsis ⊆ açık ihtiyaç).
// Bayrak: `shipping.confirmationEnabled` DEĞİŞTİRİLMEZ — yalnız okunup loglanır.
//   Sahada `false` (V-4 §0) → createShipment tek tx'te DISPATCHED üretir, yani bu
//   yarışın penceresi TEK transaction'ın içindedir ve operatörün görebileceği bir
//   "planlı sevkiyat" ara adımı YOKTUR.
// Ön koşul: `order_lines.cancelledAt` kolonu (migration 20260827100000). Yoksa
//   script bunu AÇIKÇA söyler ve durur (saha 2026-08-25 kopyasında kolon YOK).
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

import fs from "node:fs";
import path from "node:path";
import { RollStatus, OrderStatus, RollEntrySource } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { ShippingService } from "../src/services/shipping.service";
import { OrderService } from "../src/services/order.service";

const ship = new ShippingService();
const orderSvc = new OrderService({ modelName: "order", tableName: "ORDER" });

const RAND = Math.random().toString(36).slice(2, 8).toUpperCase();
const STAMP = `AUDITREPRO-S-2-01-${RAND}`;

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
const info = (m: string): void => console.log(`   ${m}`);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const createdRolls: string[] = [];
const createdSacks: string[] = [];
const createdShipments: string[] = [];
const createdOrders: string[] = [];

let itemId = "";
let customerId = "";

async function makeOrder(lineQty: number, width: number): Promise<{ orderId: string; lineId: string }> {
  const order = await prisma.order.create({
    data: {
      orderNumber: `${STAMP}-${Math.floor(Math.random() * 1e6)}`,
      customerId,
      status: OrderStatus.APPROVED,
      lines: { create: [{ itemId, colorId: null, width, quantity: lineQty }] },
    },
    select: { id: true, lines: { select: { id: true } } },
  });
  createdOrders.push(order.id);
  return { orderId: order.id, lineId: order.lines[0]!.id };
}

async function makeRoll(qty: number, width: number): Promise<string> {
  const roll = await prisma.roll.create({
    data: {
      barcode: `${STAMP}-R${Date.now()}${Math.floor(Math.random() * 1e6)}`.toUpperCase().slice(0, 60),
      itemId,
      colorId: null,
      width,
      initialQty: qty,
      currentQty: qty,
      status: RollStatus.WAREHOUSE,
      qualityGrade: "1.KALITE",
      entrySource: RollEntrySource.SUPPLIER_RECEIPT,
    },
    select: { id: true, barcode: true },
  });
  createdRolls.push(roll.id);
  return roll.barcode!;
}

async function filledSack(barcodes: string[]): Promise<string> {
  const opened = (await ship.openSack({ customerId })) as { data: { id: string } };
  const sackId = opened.data.id;
  createdSacks.push(sackId);
  for (const bc of barcodes) await ship.scanIntoSack({ sackId, barcode: bc });
  return sackId;
}

/** Commit SONRASI, DB'DEN ölç: iptal edilmiş kaleme yazılmış tahsis var mı? */
async function measure(lineId: string): Promise<{
  cancelled: boolean;
  alloc: number;
  shipped: number;
  quantity: number;
  orderStatus: OrderStatus;
}> {
  const line = await prisma.orderLine.findUniqueOrThrow({
    where: { id: lineId },
    select: { cancelledAt: true, shippedQty: true, quantity: true, order: { select: { status: true } } },
  });
  const agg = await prisma.sackAllocation.aggregate({
    where: { orderLineId: lineId },
    _sum: { qty: true },
  });
  return {
    cancelled: line.cancelledAt != null,
    alloc: Number(agg._sum.qty ?? 0),
    shipped: Number(line.shippedQty),
    quantity: Number(line.quantity),
    orderStatus: line.order.status,
  };
}

/** Tek tur: sevkiyat kurma ile kalem iptalini `staggerMs` gecikmeyle çakıştır. */
async function runRound(width: number, staggerMs: number): Promise<{
  hit: boolean;
  detail: string;
}> {
  const { orderId, lineId } = await makeOrder(100, width);
  const bc = await makeRoll(100, width);
  const sackId = await filledSack([bc]);

  const shipCall = ship
    .createShipment({ sackIds: [sackId], customerId, orderIds: [orderId] })
    .then((r) => {
      const d = (r as { data: { id: string; shipmentNo: string } }).data;
      createdShipments.push(d.id);
      return `sevk OK(${d.shipmentNo})`;
    })
    .catch((e: unknown) => `sevk ERR(${(e as Error).message.slice(0, 60)})`);

  const cancelCall = (async () => {
    if (staggerMs > 0) await sleep(staggerMs);
    try {
      await orderSvc.cancelOrderLine(orderId, lineId, undefined, { reasonText: `${STAMP} yarış sondası` });
      return "iptal OK";
    } catch (e) {
      return `iptal ERR(${(e as Error).message.slice(0, 60)})`;
    }
  })();

  const [a, b] = await Promise.all([shipCall, cancelCall]);
  const m = await measure(lineId);
  // İHLAL: kalem iptal edilmiş AMA üstüne tahsis yazılmış (yani mal iptal edilen
  // talebe kaydedilmiş ve sevk edilmiş).
  const hit = m.cancelled && m.alloc > 0;
  return {
    hit,
    detail:
      `${a} | ${b} · iptal=${m.cancelled} Σalloc=${m.alloc} shippedQty=${m.shipped} ` +
      `quantity=${m.quantity} sipariş=${m.orderStatus}`,
  };
}

async function main(): Promise<void> {
  console.log(`\n=== AUDIT REPRO S-2-01 — createShipment ∥ cancelOrderLine (${STAMP}) ===\n`);

  const flag = await prisma.systemSetting.findUnique({ where: { key: "shipping.confirmationEnabled" } });
  console.log(`shipping.confirmationEnabled = ${JSON.stringify(flag?.value ?? null)} (DEĞİŞTİRİLMEDİ)\n`);

  // Ön koşul: cancelledAt kolonu var mı (saha 08-25 kopyasında YOK).
  try {
    await prisma.orderLine.findFirst({ select: { cancelledAt: true } });
  } catch (e) {
    console.error(
      "ÖN KOŞUL YOK: `order_lines.cancelledAt` okunamadı — migration 20260827100000 " +
        `bu DB'de uygulanmamış. (${(e as Error).message.slice(0, 120)})`,
    );
    fail++;
    return;
  }

  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  const cust = await prisma.customer.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!item || !cust) throw new Error("Test verisi yetersiz (Item/Customer yok — npm run seed).");
  itemId = item.id;
  customerId = cust.id;

  // ── KOL A: KONTROL — iptal ÖNCE, sevkiyat SONRA (sıralı referans davranış) ──
  console.log("--- KOL A (kontrol): kalem ÖNCE iptal edilir, sevkiyat SONRA kurulur ---");
  {
    const { orderId, lineId } = await makeOrder(100, 70101);
    const bc = await makeRoll(100, 70101);
    const sackId = await filledSack([bc]);
    await orderSvc.cancelOrderLine(orderId, lineId, undefined, { reasonText: `${STAMP} kontrol` });
    try {
      const r = (await ship.createShipment({ sackIds: [sackId], customerId, orderIds: [orderId] })) as {
        data: { id: string; shipmentNo: string };
      };
      createdShipments.push(r.data.id);
      info(`sevkiyat kuruldu: ${r.data.shipmentNo}`);
    } catch (e) {
      info(`sevkiyat düştü: ${(e as Error).message.slice(0, 80)}`);
    }
    const m = await measure(lineId);
    info(`A) iptal=${m.cancelled} Σalloc=${m.alloc} shippedQty=${m.shipped} sipariş=${m.orderStatus}`);
    check(
      "A1 sıralı koşumda iptal edilmiş kaleme tahsis YAZILMIYOR (ACTIVE_LINE süzgeci çalışıyor)",
      m.alloc === 0,
      `Σalloc=${m.alloc}`,
    );
  }

  // ── KOL B: YARIŞ — farklı gecikmelerle 12 tur ──
  console.log("\n--- KOL B (yarış): createShipment ∥ cancelOrderLine, 12 tur × değişken gecikme ---");
  let hits = 0;
  const stagger = [0, 0, 1, 2, 3, 5, 8, 10, 12, 15, 20, 25];
  for (let i = 0; i < stagger.length; i++) {
    const r = await runRound(70200 + i, stagger[i]!);
    console.log(`   [tur ${i + 1} · +${stagger[i]}ms] ${r.hit ? "İHLAL" : "temiz"} — ${r.detail}`);
    if (r.hit) hits++;
  }
  check(
    "B1 hiçbir turda iptal edilmiş kaleme tahsis yazılmadı",
    hits === 0,
    `ihlal=${hits}/${stagger.length}`,
  );

  // ── KOL C: KAYNAK SONDASI — kilit sonrası taze doğrulama var mı? ──
  console.log("\n--- KOL C (kaynak sondası): kilit ALINDIKTAN sonra tahsis yeniden doğrulanıyor mu? ---");
  {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "src", "services", "shipping.service.ts"),
      "utf8",
    );
    const dispatchBody = src.slice(
      src.indexOf("private async performDispatchTx"),
      src.indexOf("async dispatchShipment("),
    );
    const revalidates =
      dispatchBody.includes("cancelledAt") ||
      dispatchBody.includes("ACTIVE_LINE") ||
      dispatchBody.includes("writeShipmentAllocationsTx");
    check(
      "C1 performDispatchTx tahsisi kilit altında yeniden doğruluyor/hesaplıyor",
      revalidates,
      revalidates
        ? "doğrulama izi bulundu"
        : "gövdede ne `cancelledAt`/`ACTIVE_LINE` kontrolü ne de yeniden hesap var — tahsis DONMUŞ olarak terfi ediyor",
    );
    const allocIdx = src.indexOf("await this.writeShipmentAllocationsTx(tx, created.id");
    const touchIdx = src.indexOf("await touchOrderLinesTx(tx, lineRows.map((l) => l.id));");
    check(
      "C2 satır kilidi (touchOrderLinesTx) tahsis YAZIMINDAN ÖNCE alınıyor",
      allocIdx > 0 && touchIdx > 0 && touchIdx < allocIdx,
      `writeShipmentAllocationsTx@${allocIdx} · touchOrderLinesTx@${touchIdx} (kilit SONRA alınıyorsa sıra load-bearing biçimde yanlış)`,
    );
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  try {
    await prisma.rollVariance.deleteMany({ where: { rollId: { in: createdRolls } } });
    await prisma.sackAllocation.deleteMany({ where: { sackId: { in: createdSacks } } });
    await prisma.roll.updateMany({
      where: { id: { in: createdRolls } },
      data: { shipmentId: null, sackId: null },
    });
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: createdShipments } } });
    await prisma.sack.deleteMany({ where: { id: { in: createdSacks } } });
    await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: createdShipments } } });
    await prisma.shipment.deleteMany({ where: { id: { in: createdShipments } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: createdRolls } } });
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: createdRolls } } });
    await prisma.roll.deleteMany({ where: { id: { in: createdRolls } } });
    await prisma.workOrderToOrderLine.deleteMany({ where: { orderLine: { orderId: { in: createdOrders } } } });
    await prisma.orderLine.deleteMany({ where: { orderId: { in: createdOrders } } });
    await prisma.order.deleteMany({ where: { id: { in: createdOrders } } });
    await prisma.systemLog.deleteMany({
      where: {
        recordId: {
          in: [...createdShipments, ...createdRolls, ...createdSacks, ...createdOrders],
        },
      },
    });
  } catch (e) {
    console.error("Temizlik hatası:", e);
  }
}

main()
  .catch((e) => {
    console.error("REPRO ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
