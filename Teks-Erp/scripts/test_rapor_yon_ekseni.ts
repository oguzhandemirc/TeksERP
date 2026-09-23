// =============================================================================
// RAPORLARDA YURTİÇİ/YURTDIŞI EKSENİ — iki kaynak (R1, 2026-09-23), gerçek DB
// =============================================================================
// NEDEN: yön ekseni `Customer.defaultDestination` okuyordu — cari sonradan değişince geçmiş sevk
// raporu da değişiyordu. Kural (`reports/_destination.ts`): SEVK raporu sevkiyatın DONMUŞ yönünü,
// SİPARİŞ raporu siparişin şube → cari zincirini (bugünkü kart) okur.
// §1 boğaz ikiz: `resolveShipmentDestination` · `orderDestinationWhere` · `orderDestinationSql` aynı
//    siparişe aynı yönü verir (şubeli/şubesiz/şube boş/zincir boş).
// §2 sipariş raporu (order-intake) zinciri okur: şubesi yurtdışı olan yurtiçi carinin siparişi İHRACAT.
// §3 sevk toplayıcısı (`collectShipped`): hücre sevkiyatın yönünü taşır, süzgeç ona uygulanır; cari
//    kartı sonradan değişince sevk rakamı DEĞİŞMEZ; müşteri karnesinin sevk sütunu da aynı kaynaktan.
// §4 kg (`collectShippedWeight`): tartısız çuval 0 SAYILMAZ — kapsam "tartılı N / M".
// §5 sevk ve iade karnesi yön süzgeci sevkiyatın donmuş yönünden (R2 ③).
// Kapsam dışı (beyan): doğrudan sevkin "yön kaydı yok" kovası bu dosyada DB'de kurulmadı (fikstür
// fason zinciri ister); yüklemi `test_accounting_direct_ship` §D ölçer.
// NEGATİF SONDALAR (2026-09-23, geri alındı → 19/0): ① SQL ikizden şube düştü → §1 ×2 + §3e ❌ ·
//   ② Prisma ikizden şube düştü → §1 + §2a + §3e ❌ · ③ sevk yön süzgeci boş parça → §3c/§3d/§3e ❌ ·
//   ④ sevk süzgeci cari kartından okur → §3c/§3d/§3e ❌ · ⑤ tartısız çuval tartılı sayılır → §4b ❌
// R2 ③ sondaları (geri alındı → 24/0): ⑥ sevk karnesi süzmez → §5a/§5b ❌ · ⑦ günlük seri süzmez → §5a ❌ ·
//   ⑧ iade payı süzmez → §5d ❌ · ⑨ iade paydası süzmez → §5c ❌
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Pencere 2098-03.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { Prisma, type ShipmentDestination } from "@prisma/client";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { resolveShipmentDestination } from "../src/services/helpers/shipment-destination.helper";
import { orderDestinationSql, orderDestinationWhere } from "../src/services/reports/_destination";
import { collectShipped, collectShippedWeight } from "../src/services/reports/_shipped";
import { getOrderIntake } from "../src/services/reports/order-intake.report.service";
import { getCustomerScorecard } from "../src/services/reports/customer-scorecard.report.service";
import { getShipmentScorecard } from "../src/services/reports/shipment-scorecard.report.service";
import { getReturnScorecard } from "../src/services/reports/return-scorecard.report.service";
import { returnScorecardQuerySchema, shipmentScorecardQuerySchema } from "../src/routes/reports/sales.routes";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-RYE-${process.pid}`;
const RANGE = { from: new Date("2098-03-01T00:00:00.000Z"), to: new Date("2098-03-31T23:59:59.999Z") };
const IN = new Date("2098-03-10T09:00:00.000Z");

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(2);
  }
  const ids = { returns: [] as string[], customers: [] as string[], branches: [] as string[], orders: [] as string[], shipments: [] as string[], sacks: [] as string[], rolls: [] as string[], items: [] as string[] };
  const cari = async (n: string, d: ShipmentDestination | null) => {
    const c = await prisma.customer.create({ data: { code: `${TAG}-${n}`, name: `${TAG} ${n}`, defaultDestination: d }, select: { id: true } });
    ids.customers.push(c.id);
    return c.id;
  };
  const sube = async (customerId: string, n: string, d: ShipmentDestination | null) => {
    const b = await prisma.customerBranch.create({ data: { customerId, name: `${TAG} ${n}`, defaultDestination: d }, select: { id: true } });
    ids.branches.push(b.id);
    return b.id;
  };
  try {
    const item = await prisma.item.create({ data: { code: `${TAG}-I`, name: `${TAG} KUMAŞ`, itemType: "FABRIC" }, select: { id: true } });
    ids.items.push(item.id);
    const cE = await cari("CE", "EXPORT");
    const cD = await cari("CD", "DOMESTIC");
    const cN = await cari("CN", null);
    const bE = await sube(cD, "BE", "EXPORT");
    const bN = await sube(cD, "BN", null);
    const siparis = async (no: string, customerId: string, branchId: string | null, qty: number) => {
      const o = await prisma.order.create({
        data: { orderNumber: `${TAG}-${no}`, customerId, branchId, orderDate: IN, status: "APPROVED", lines: { create: [{ itemId: item.id, quantity: qty }] } },
        select: { id: true },
      });
      ids.orders.push(o.id);
      return { id: o.id, customerId, branchId };
    };
    const O = {
      eNoBranch: await siparis("O1", cE, null, 10),
      dBranchE: await siparis("O2", cD, bE, 20),
      dBranchN: await siparis("O3", cD, bN, 40),
      dNoBranch: await siparis("O4", cD, null, 80),
      nNoBranch: await siparis("O5", cN, null, 160),
    };

    console.log("── §1 boğaz ikiz: zincir = Prisma = SQL ──");
    for (const d of ["EXPORT", "DOMESTIC"] as const) {
      const prismaSet = new Set((await prisma.order.findMany({ where: { id: { in: ids.orders }, ...orderDestinationWhere(d) }, select: { id: true } })).map((x) => x.id));
      const sqlSet = new Set(
        (await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT o.id FROM orders o WHERE o.id IN (${Prisma.join(ids.orders.map((x) => Prisma.sql`${x}::uuid`))}) ${orderDestinationSql(d, "o")}`)).map((x) => x.id),
      );
      for (const [ad, o] of Object.entries(O)) {
        const zincir = (await resolveShipmentDestination(prisma, { customerId: o.customerId, branchId: o.branchId })).destination === d;
        check(`§1 ${d} · ${ad}: zincir=${zincir} Prisma=${prismaSet.has(o.id)} SQL=${sqlSet.has(o.id)}`, zincir === prismaSet.has(o.id) && zincir === sqlSet.has(o.id));
      }
    }

    console.log("── §2 sipariş raporu zinciri okur ──");
    const exp = await getOrderIntake(RANGE, null, { destination: "EXPORT", customerId: ids.customers });
    check("§2a İhracat = O1 (cari EXPORT) + O2 (yurtiçi carinin EXPORT şubesi) = 30 m", exp.summary.totalQty === 30, String(exp.summary.totalQty));
    const dom = await getOrderIntake(RANGE, null, { destination: "DOMESTIC", customerId: ids.customers });
    check("§2b Yurtiçi = O3 (şube yönü boş → cari) + O4 = 120 m; zincir boş O5 hiçbir kümede", dom.summary.totalQty === 120, String(dom.summary.totalQty));

    console.log("── §3 sevk toplayıcısı sevkiyatın donmuş yönünü okur ──");
    const sevk = async (customerId: string, destination: ShipmentDestination, qty: number, kg: number | null) => {
      const sh = await prisma.shipment.create({
        data: { shipmentNo: `${TAG}-S${ids.shipments.length}`, customerId, status: "DISPATCHED", destination, dispatchedAt: IN },
        select: { id: true },
      });
      ids.shipments.push(sh.id);
      const sack = await prisma.sack.create({ data: { sackNo: `${TAG}-K${ids.sacks.length}`, customerId, shipmentId: sh.id, weightKg: kg }, select: { id: true } });
      ids.sacks.push(sack.id);
      const r = await prisma.roll.create({
        data: { barcode: `${TAG}-R${ids.rolls.length}`, itemId: item.id, initialQty: qty, currentQty: qty, status: "SHIPPED", sackId: sack.id, shipmentId: sh.id },
        select: { id: true },
      });
      ids.rolls.push(r.id);
    };
    // Yurtiçi cariye İHRACAT sevkiyatı (kart ile sevkiyat farklı) + yurtiçi sevkiyat
    await sevk(cD, "EXPORT", 7, 12.5);
    await sevk(cD, "DOMESTIC", 11, null);
    const benim = (cells: Array<{ customerId: string; qty: number }>) => cells.filter((c) => ids.customers.includes(c.customerId)).reduce((a, c) => a + c.qty, 0);
    const tum = await collectShipped(RANGE);
    const hucreYon = tum.filter((c) => c.customerId === cD).map((c) => `${c.destination}:${c.qty}`).sort().join(",");
    check("§3a hücreler sevkiyatın yönünü taşır (DOMESTIC:11, EXPORT:7)", hucreYon === "DOMESTIC:11,EXPORT:7", hucreYon);
    check("§3b süzgeçsiz toplam 18", benim(tum) === 18, String(benim(tum)));
    check("§3c İhracat süzgeci → 7 (yurtiçi carinin ihracat sevkiyatı)", benim(await collectShipped(RANGE, { destination: "EXPORT" })) === 7);
    await prisma.customer.update({ where: { id: cD }, data: { defaultDestination: "EXPORT" } });
    check("§3d cari kartı EXPORT'a döndü → sevk raporu DEĞİŞMEDİ (hâlâ 7)", benim(await collectShipped(RANGE, { destination: "EXPORT" })) === 7);
    await prisma.customer.update({ where: { id: cD }, data: { defaultDestination: "DOMESTIC" } });
    const karne = await getCustomerScorecard(RANGE, null, { destination: "EXPORT", customerId: [cD] });
    const satir = karne.ranking.find((r) => r.customerId === cD);
    check("§3e müşteri karnesinin sevk sütunu da sevkiyat yönünden (EXPORT → 7)", satir?.shippedQty === 7, JSON.stringify(satir?.shippedQty));

    console.log("── §4 kg: tartısız çuval ölçülmedi, 0 değil ──");
    const kg = (await collectShippedWeight(RANGE)).filter((c) => c.customerId === cD);
    const e = kg.find((c) => c.destination === "EXPORT");
    const d = kg.find((c) => c.destination === "DOMESTIC");
    check("§4a ihracat: 12.5 kg, tartılı 1 / 1", e?.kg === 12.5 && e?.weighedSacks === 1 && e?.totalSacks === 1, JSON.stringify(e));
    check("§4b yurtiçi: tartısız → kg 0 değil ÖLÇÜLMEDİ (tartılı 0 / 1)", d?.weighedSacks === 0 && d?.totalSacks === 1, JSON.stringify(d));

    console.log("── §5 sevk ve iade karnesi yön süzgeci (sevkiyatın donmuş yönü) ──");
    const sk = await getShipmentScorecard(RANGE, null, { destination: "EXPORT" });
    check("§5a sevk karnesi İhracat → 7 m (yurtiçi carinin ihracat sevkiyatı), günlük seri de 7", sk.summary.shippedQty === 7 && sk.daily.reduce((a, x) => a + x.qty, 0) === 7, `${sk.summary.shippedQty}`);
    check("§5b sevk karnesi Yurtiçi → 11 m", (await getShipmentScorecard(RANGE, null, { destination: "DOMESTIC" })).summary.shippedQty === 11);
    const eSevk = await prisma.shipment.findFirstOrThrow({ where: { id: { in: ids.shipments }, destination: "EXPORT" }, select: { id: true } });
    const admin = await ensureTestAdmin();
    const rr = await prisma.roll.create({ data: { barcode: `${TAG}-RR`, itemId: item.id, initialQty: 2, currentQty: 2, status: "WAREHOUSE" }, select: { id: true } });
    ids.rolls.push(rr.id);
    const ret = await prisma.rollReturn.create({ data: { rollId: rr.id, customerId: cD, itemId: item.id, qty: 2, receivedById: admin.id, fromShipmentId: eSevk.id, createdAt: IN }, select: { id: true } });
    ids.returns.push(ret.id);
    const ik = await getReturnScorecard(RANGE, null, { destination: "EXPORT" });
    check("§5c iade karnesi İhracat → iade 2 m, payda ihracat brütü 9 m (7 + iade 2 geri eklenmiş)", ik.summary.returnQty === 2 && ik.summary.shippedQty === 9, JSON.stringify(ik.summary));
    check("§5d iade karnesi Yurtiçi → iade 0 (iade ihracat sevkiyatından)", (await getReturnScorecard(RANGE, null, { destination: "DOMESTIC" })).summary.returnQty === 0);
    check("§5e sözleşme: enum dışı yön 400, iki şema strict", !shipmentScorecardQuerySchema.safeParse({ destination: "MARS" }).success && !returnScorecardQuerySchema.safeParse({ baska: "1" }).success && shipmentScorecardQuerySchema.safeParse({ destination: "EXPORT" }).success);
  } finally {
    await prisma.rollReturn.deleteMany({ where: { id: { in: ids.returns } } });
    await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
    await prisma.sack.deleteMany({ where: { id: { in: ids.sacks } } });
    await prisma.shipment.deleteMany({ where: { id: { in: ids.shipments } } });
    await prisma.orderLine.deleteMany({ where: { orderId: { in: ids.orders } } });
    await prisma.order.deleteMany({ where: { id: { in: ids.orders } } });
    await prisma.customerBranch.deleteMany({ where: { id: { in: ids.branches } } });
    await prisma.item.deleteMany({ where: { id: { in: ids.items } } });
    await prisma.customer.deleteMany({ where: { id: { in: ids.customers } } });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("HATA", e);
  await pool.end();
  process.exit(1);
});
