// =============================================================================
// BEKÇİ — SİPARİŞ SATIRI TOLERANSI `OrderLine.tolerancePct` (Seyitoğlu 2. bölüm K4, 2026-11-11)
// =============================================================================
// Koşum: DATABASE_URL='postgresql://…/<ad>_test' npx tsx scripts/test_siparis_satir_toleransi.ts
//
//   §1 gövde: sayı ve NOKTALI metin kabul (Decimal(5,2) saklanır), virgüllü metin / 50 üstü / negatif / 3 ondalık 400,
//      null ve "" temizler; update'te gönderilmeyen alan DOKUNULMAZ, null gönderilen temizlenir
//   §2 DB CHECK `order_lines_tolerance_pct_range` (51 → ret; servis atlansa da sed)
//   §3 ⭐ boşken bayt-aynı: tolerancePct NULL siparişte durum kararı yalnız fabrika toleransıyla (aynı fixture,
//      satır toleransı olmadan COMPLETED/PARTIAL eşiği değişmez)
//   §4 ⭐ doluyken: etkin tolerans = fabrika metre + Σ aktif metre satırı miktar × %/100 (1000 m × %3 = 30 m + 5 m);
//      iptal edilmiş satırın yüzdesi katılmaz (KG satırı aktifken sipariş zaten kendiliğinden kapanmaz — ⑥ order_line_unit_ledger)
//   §5 detay (`findById`) ve liste (`findAll`) yanıtı satırda `tolerancePct` taşır
//
// ⭐ NEGATİF SONDA (2026-11-11, ölçüldü): `lineToleranceMeters` hep 0 → §4a ❌; iptal satırının yüzdesi de
//    katıldı (aktif dalı dışına taşındı) → §4b ❌; `normalizeLineTolerancePct` virgülü kabul etti → §1c ❌. Geri alındı.
// =============================================================================
import type { Request } from "express";
import { ItemUnit, OrderStatus, ShipmentStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { orderService } from "../src/routes/order.routes";
import { recomputeOrderStatusTx } from "../src/services/helpers/order-status.helper";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";

const TAG = `TST-OLT-${process.pid}`;
const FACTORY_TOL_M = 5;
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}
async function kod(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "geçti";
  } catch (e) {
    const err = e as { statusCode?: number; code?: string; message?: string };
    return err.statusCode ? String(err.statusCode) : (err.code ?? String(err.message).slice(0, 80));
  }
}

const orderIds: string[] = [];
const sackIds: string[] = [];

async function cleanup(): Promise<void> {
  if (sackIds.length) await prisma.sackAllocation.deleteMany({ where: { sackId: { in: sackIds } } });
  await prisma.sack.deleteMany({ where: { sackNo: { startsWith: `${TAG}-SK` } } });
  await prisma.shipment.deleteMany({ where: { shipmentNo: { startsWith: `${TAG}-SH` } } });
  if (orderIds.length) {
    await prisma.systemLog.deleteMany({ where: { recordId: { in: orderIds } } });
    await prisma.orderLine.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  }
  await prisma.item.deleteMany({ where: { code: { startsWith: TAG } } });
  await prisma.customer.deleteMany({ where: { code: `${TAG}-CUS` } });
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    return;
  }
  console.log("=== SİPARİŞ SATIRI TOLERANSI BEKÇİSİ ===\n");
  const admin = await ensureTestAdmin();
  try {
    const customer = await prisma.customer.create({ data: { code: `${TAG}-CUS`, name: `${TAG} müşteri` }, select: { id: true } });
    const mt = await prisma.item.create({ data: { code: `${TAG}-MT`, name: `${TAG} kumaş`, itemType: "FABRIC", unit: ItemUnit.MT }, select: { id: true } });
    const yarat = async (lines: Record<string, unknown>[]) => {
      const r = (await orderService.create({ customerId: customer.id, lines }, admin.id)) as { data: { id: string } };
      orderIds.push(r.data.id);
      return r.data.id;
    };
    const satirlar = (orderId: string) =>
      prisma.orderLine.findMany({ where: { orderId }, select: { id: true, itemId: true, quantity: true, tolerancePct: true }, orderBy: { createdAt: "asc" } });
    const pct = (v: unknown) => (v == null ? null : String(v));

    // ── §1 gövde ──
    console.log("── §1 gövde ──");
    const o1 = await yarat([{ itemId: mt.id, quantity: 100, tolerancePct: 3 }, { itemId: mt.id, quantity: 100, tolerancePct: "2.5" }, { itemId: mt.id, quantity: 100, tolerancePct: "" }]);
    const l1 = await satirlar(o1);
    check("§1a sayı (3) ve noktalı metin (\"2.5\") kabul, Decimal saklanır; \"\" → NULL", pct(l1[0]?.tolerancePct) === "3" && pct(l1[1]?.tolerancePct) === "2.5" && l1[2]?.tolerancePct === null, l1.map((l) => pct(l.tolerancePct)).join(","));
    const g = (v: unknown) => kod(() => orderService.create({ customerId: customer.id, lines: [{ itemId: mt.id, quantity: 1, tolerancePct: v }] }, admin.id));
    check("§1b 50 üstü / negatif / 3 ondalık / metin 400", (await g(51)) === "400" && (await g(-1)) === "400" && (await g("1.234")) === "400" && (await g("abc")) === "400");
    check("§1c ⭐ virgüllü metin (\"2,5\") 400 — sessiz yanlış okuma yok", (await g("2,5")) === "400");
    await orderService.update(o1, { lines: [{ id: l1[0]!.id, itemId: mt.id, quantity: 100 }, { id: l1[1]!.id, itemId: mt.id, quantity: 100, tolerancePct: null }, { id: l1[2]!.id, itemId: mt.id, quantity: 100, tolerancePct: "50" }] }, admin.id);
    const l1u = await satirlar(o1);
    check("§1d update: gönderilmeyen DOKUNULMAZ (3), null temizler, \"50\" yazılır", pct(l1u[0]?.tolerancePct) === "3" && l1u[1]?.tolerancePct === null && pct(l1u[2]?.tolerancePct) === "50", l1u.map((l) => pct(l.tolerancePct)).join(","));

    // ── §2 DB CHECK ──
    console.log("\n── §2 DB CHECK ──");
    let ck = "geçti";
    try {
      await prisma.$executeRaw`UPDATE order_lines SET "tolerancePct" = 51 WHERE id = ${l1[0]!.id}::uuid`;
    } catch (e) {
      ck = String((e as Error).message).includes("order_lines_tolerance_pct_range") ? "CHECK" : String((e as Error).message).slice(0, 120);
    }
    check("§2a DB CHECK `order_lines_tolerance_pct_range` 51'i reddeder (servis atlansa da)", ck === "CHECK", ck);

    // ── sevk fixture'ı ──
    let n = 0;
    const sevk = async (allocs: Array<{ lineId: string; qty: number }>) => {
      n++;
      const sh = await prisma.shipment.create({ data: { shipmentNo: `${TAG}-SH${n}`, customerId: customer.id, status: ShipmentStatus.DISPATCHED, dispatchedAt: new Date() }, select: { id: true } });
      const sk = await prisma.sack.create({ data: { sackNo: `${TAG}-SK${n}`, shipmentId: sh.id }, select: { id: true } });
      sackIds.push(sk.id);
      for (const a of allocs) await prisma.sackAllocation.create({ data: { sackId: sk.id, orderLineId: a.lineId, qty: a.qty } });
    };
    const durum = async (orderId: string) => {
      await prisma.$transaction((tx) => recomputeOrderStatusTx(tx, orderId, FACTORY_TOL_M));
      return (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } })).status;
    };

    // ── §3 boşken bayt-aynı ──
    console.log("\n── §3 tolerancePct NULL → bugünkü davranış ──");
    const o3 = await yarat([{ itemId: mt.id, quantity: 1000 }]);
    const l3 = await satirlar(o3);
    await sevk([{ lineId: l3[0]!.id, qty: 990 }]);
    const s3a = await durum(o3);
    await sevk([{ lineId: l3[0]!.id, qty: 6 }]);
    const s3b = await durum(o3);
    check("§3a ⭐ NULL: 10 m eksik > fabrika 5 m → PARTIAL_SHIPPED (bugünkü eşik)", s3a === OrderStatus.PARTIAL_SHIPPED, s3a);
    check("§3b NULL: 4 m eksik ≤ 5 m → COMPLETED", s3b === OrderStatus.COMPLETED, s3b);

    // ── §4 doluyken ──
    console.log("\n── §4 tolerancePct dolu → fabrika + Σ satır ──");
    const o4 = await yarat([{ itemId: mt.id, quantity: 1000, tolerancePct: 3 }]);
    const l4 = await satirlar(o4);
    await sevk([{ lineId: l4[0]!.id, qty: 964 }]);
    const s4a1 = await durum(o4);
    await sevk([{ lineId: l4[0]!.id, qty: 2 }]);
    const s4a2 = await durum(o4);
    check("§4a ⭐ %3 × 1000 = 30 m + 5 m = 35 m: 34 m eksik → COMPLETED", s4a2 === OrderStatus.COMPLETED, `${s4a1}→${s4a2}`);
    check("§4c eşik keskin: 36 m eksik → PARTIAL_SHIPPED", s4a1 === OrderStatus.PARTIAL_SHIPPED, s4a1);
    // İptal satırı (%50) ve KG satırı (%50) katılmaz: aktif MT 1000 m %0 → yalnız fabrika 5 m.
    const o5 = await yarat([{ itemId: mt.id, quantity: 1000, tolerancePct: 0 }, { itemId: mt.id, quantity: 1000, tolerancePct: 50 }]);
    const l5 = await satirlar(o5);
    await prisma.orderLine.update({ where: { id: l5[1]!.id }, data: { cancelledAt: new Date() } });
    await sevk([{ lineId: l5[0]!.id, qty: 990 }]);
    const s5 = await durum(o5);
    check("§4b ⭐ iptal edilmiş satırın yüzdesi katılmaz (10 m eksik > 5 m → PARTIAL)", s5 === OrderStatus.PARTIAL_SHIPPED, s5);

    // ── §5 yanıtlar ──
    console.log("\n── §5 detay + liste ──");
    const det = (await orderService.findById(o4)) as { data: { lines: Array<{ tolerancePct: unknown }> } };
    check("§5a detay satırı tolerancePct taşır (3)", pct(det.data.lines[0]?.tolerancePct) === "3", pct(det.data.lines[0]?.tolerancePct) ?? "null");
    const list = (await orderService.findAll({ query: { "filter[customerId]": customer.id, pageSize: "50" } } as unknown as Request)) as unknown as { data: Array<{ id: string; lines?: Array<{ tolerancePct: unknown }> }> };
    const row = list.data.find((o) => o.id === o4);
    check("§5b liste satırı tolerancePct taşır (3)", pct(row?.lines?.[0]?.tolerancePct) === "3", JSON.stringify(row?.lines?.[0] ?? null).slice(0, 120));
  } finally {
    await cleanup().catch((e) => {
      fail++;
      console.log(`❌ temizlik — ${String(e).slice(0, 300)}`);
    });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error("HATA", e);
  await pool.end();
  process.exitCode = 1;
});
