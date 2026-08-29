// =============================================================================
// AUDIT REPRO — KYY-2-02: eşzamanlı `createShipment` aynı sipariş satırına ÇİFT tahsis
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER (aşağıdaki guard).
// Beklenen (sağlıklı sistem): iki sevkiyat SIRALI koşarken ikincisi
//   `need = quantity - shippedQty` = 0 görür ve TAHSİS YAZMAZ; aynı iki çağrı
//   PARALEL koşunca da sonuç AYNI olmalı (Σ SackAllocation ≤ OL.quantity).
// Gözlenen: (çalıştırınca doldur — log audit/repro/KYY-2-02.log)
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_KYY-2-02.ts
//
// Ölçülen değişmez: INV-SEV-01 / INV-SEV-02 (`OL.shippedQty = Σ SA.qty[DISPATCHED]`,
//   tahsis ⊆ ihtiyaç). INV-SEV-08 (Σ sevk ≤ quantity) BİLİNÇLİ zorlanmıyor — bu
//   yüzden script SIRALI kolu da ölçer: fark yalnız eşzamanlılıktan doğuyorsa
//   bu bir YARIŞ'tır, tasarım sabiti değildir.
// Bayrak: `shipping.confirmationEnabled` DEĞİŞTİRİLMEZ (dev+saha: false → tek
//   adımda DISPATCHED). Okunur, loglanır.
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

import { RollStatus, OrderStatus, RollEntrySource } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { ShippingService } from "../src/services/shipping.service";

const ship = new ShippingService();
const STAMP = `AUDITREPRO-KYY-2-02-${Math.random().toString(36).slice(2, 8)}`;

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
      barcode: `${STAMP}-R${Date.now()}${Math.floor(Math.random() * 1e6)}`.toUpperCase(),
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

/** Commit SONRASI, DB'den ölç. */
async function measure(lineId: string): Promise<{ alloc: number; shipped: number; quantity: number }> {
  const line = await prisma.orderLine.findUnique({
    where: { id: lineId },
    select: { shippedQty: true, quantity: true },
  });
  const agg = await prisma.sackAllocation.aggregate({
    where: { orderLineId: lineId },
    _sum: { qty: true },
  });
  return {
    alloc: Number(agg._sum.qty ?? 0),
    shipped: Number(line!.shippedQty),
    quantity: Number(line!.quantity),
  };
}

async function runArm(
  label: string,
  width: number,
  parallel: boolean,
  n = 2,
): Promise<{ alloc: number; shipped: number; quantity: number }> {
  const { orderId, lineId } = await makeOrder(100, width);
  const sacks: string[] = [];
  for (let i = 0; i < n; i++) {
    const bc = await makeRoll(100, width);
    sacks.push(await filledSack([bc]));
  }

  const call = (sackId: string) =>
    ship
      .createShipment({ sackIds: [sackId], customerId, orderIds: [orderId] })
      .then((r) => {
        const d = (r as { data: { id: string; shipmentNo: string } }).data;
        createdShipments.push(d.id);
        return { ok: true as const, no: d.shipmentNo };
      })
      .catch((e: unknown) => ({ ok: false as const, err: (e as Error).message }));

  const t0 = Date.now();
  let res: Array<{ ok: boolean; no?: string; err?: string }>;
  if (parallel) {
    res = await Promise.all(sacks.map((s) => call(s)));
  } else {
    res = [];
    for (const s of sacks) res.push(await call(s));
  }
  const ms = Date.now() - t0;
  console.log(
    `   [${label}] ${sacks.length} çağrı / ${ms} ms · ` +
      res.map((r) => (r.ok ? `OK(${r.no})` : `ERR(${(r.err ?? "").slice(0, 50)})`)).join(" | "),
  );
  const m = await measure(lineId);
  console.log(`   [${label}] quantity=${m.quantity} · Σ SackAllocation=${m.alloc} · shippedQty=${m.shipped}`);
  return m;
}

async function main(): Promise<void> {
  console.log(`=== AUDIT REPRO KYY-2-02 — createShipment çift tahsis (${STAMP}) ===\n`);

  const flag = await prisma.systemSetting.findUnique({ where: { key: "shipping.confirmationEnabled" } });
  console.log(`shipping.confirmationEnabled = ${JSON.stringify(flag?.value ?? null)} (DEĞİŞTİRİLMEDİ)\n`);

  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  const cust = await prisma.customer.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!item || !cust) throw new Error("Test verisi yetersiz (Item/Customer yok — npm run seed).");
  itemId = item.id;
  customerId = cust.id;

  // ── KONTROL KOLU: SIRALI (referans davranış) ──
  console.log("--- KOL 1: SIRALI iki createShipment (aynı sipariş satırı, 2 ayrı çuval × 100 m) ---");
  const seq = await runArm("SIRALI", 90101, false);
  check(
    "S1 sıralı koşumda tahsis ihtiyacı aşmıyor (Σ alloc ≤ quantity)",
    seq.alloc <= seq.quantity,
    `Σ=${seq.alloc} ≤ ${seq.quantity}`,
  );

  // ── DENEY KOLU: PARALEL ──
  console.log("\n--- KOL 2: PARALEL iki createShipment (aynı sipariş satırı) ---");
  const par = await runArm("PARALEL", 90102, true);
  check(
    "P1 paralel koşumda tahsis ihtiyacı aşmıyor (Σ alloc ≤ quantity)",
    par.alloc <= par.quantity,
    `Σ=${par.alloc} ≤ ${par.quantity}`,
  );
  check(
    "P2 paralel sonuç SIRALI sonuçla aynı (yarış yok)",
    par.alloc === seq.alloc && par.shipped === seq.shipped,
    `paralel(alloc=${par.alloc},shipped=${par.shipped}) vs sıralı(alloc=${seq.alloc},shipped=${seq.shipped})`,
  );

  // ── TEKRAR: 5 tur paralel, kaçında bozuluyor ──
  console.log("\n--- KOL 3: PARALEL × 5 tekrar (kararlılık) ---");
  let broke = 0;
  for (let i = 0; i < 5; i++) {
    const m = await runArm(`P#${i + 1}`, 90200 + i, true);
    if (m.alloc > m.quantity) broke++;
  }
  console.log(`\n5 paralel turun ${broke} tanesinde Σ alloc > quantity oldu.`);
  check("R1 5 turun hiçbirinde ihtiyaç aşılmadı", broke === 0, `bozulan=${broke}/5`);

  // ── KOL 4: 5 EŞZAMANLI çağrı (kuyruk derinliği artınca koruma dayanıyor mu) ──
  console.log("\n--- KOL 4: 5 EŞZAMANLI createShipment (aynı sipariş satırı, 5 çuval × 100 m) ---");
  const wide = await runArm("PARALEL-5", 90301, true, 5);
  check(
    "W1 5 eşzamanlı çağrıda da tahsis ihtiyacı aşmıyor",
    wide.alloc <= wide.quantity,
    `Σ=${wide.alloc} ≤ ${wide.quantity}`,
  );

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
    await prisma.orderLine.deleteMany({ where: { orderId: { in: createdOrders } } });
    await prisma.order.deleteMany({ where: { id: { in: createdOrders } } });
    await prisma.systemLog.deleteMany({
      where: {
        OR: [
          { recordId: { in: [...createdShipments, ...createdRolls, ...createdSacks, ...createdOrders] } },
        ],
      },
    });
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
