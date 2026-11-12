// =============================================================================
// BEKÇİ — Müşteri dönem özeti (cari-be madde 3, 2026-11-12)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_customer_period_summary.ts
//
// ÖLÇÜLENLER (fikstür 2099, `now` parametresiyle; iki müşteri — süzgeç sızıntısı görünür):
//   §1 sayılar: brüt sevk metre/irsaliye (önceki dönem dahil, değişim %), ciro para birimi başına + fiyatsız satır
//      sayısı, sipariş adet/metre; öteki müşterinin sevki/siparişi/cirosu girmez
//   §2 eşitlik: sevk = `collectShipped` müşteri hücreleri toplamı; sipariş = süzgeçsiz karnenin müşteri satırı
//   §3 kapılar: `report:sales` yok → üç ölçü `null`; var → üçü dolu
//   §4 fail-closed: tanınmayan dönem / parametre 400 şeması; olmayan cari 404
//   §5 HTTP: uç `customer:read` ile 200, izinsiz 403, kötü dönem 400; alt router'ın toplu kapısı `/:id`e SIZMAZ
//      (yalnız `mobile:sevkiyat` taşıyan kullanıcı `GET /api/customers/:id` 200 alır)
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; temizlik `finally`de.
// Negatif sonda (2026-11-12): (a) sevk SQL'inden müşteri süzgeci düştü → §1 "öteki müşteri girmez" ❌;
// (b) ciro kapısı `can.sevkTutar` yerine `true` → §3 ❌; (c) bağlama `/:customerId` genişliğine alınınca §5 sızıntı ❌.
// =============================================================================
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import app from "../src/app";
import { AuthService } from "../src/services/auth.service";
import prisma, { pool } from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { periodSummaryQuerySchema } from "../src/routes/customer-period-summary.routes";
import { getCustomerPeriodSummary } from "../src/services/customer-period-summary.service";
import { resolvePanoPencere } from "../src/services/dashboard/pano-donem";
import { collectShipped } from "../src/services/reports/_shipped";
import { getOrderIntake } from "../src/services/reports/order-intake.report.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); } else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

const TAG = `TEST-CPS-${randomUUID().slice(0, 6)}`;
const NOW = new Date("2099-03-15T12:00:00.000Z");
const ALL = { userId: "test-cps", permissions: ["*"] };
const SALES = { userId: "test-cps", permissions: ["customer:read", "report:sales"] };
const PLAIN = { userId: "test-cps", permissions: ["customer:read"] };
const ids = { users: [] as string[], rolls: [] as string[], shipments: [] as string[], orders: [] as string[], items: [] as string[], customers: [] as string[], sacks: [] as string[] };

async function fixtures() {
  const item = await prisma.item.create({ data: { code: `${TAG}-I`, name: `${TAG} KUMAŞ`, itemType: "FABRIC" }, select: { id: true } });
  ids.items.push(item.id);
  const mkCustomer = async (n: string) => {
    const c = await prisma.customer.create({ data: { code: `${TAG}-${n}`, name: `${TAG} ${n}` }, select: { id: true } });
    ids.customers.push(c.id);
    return c.id;
  };
  const mkOrder = async (customerId: string, n: string, lines: Array<{ quantity: number; unitPrice?: number }>) => {
    const o = await prisma.order.create({
      data: { orderNumber: `${TAG}-${n}`, customerId, orderDate: new Date("2099-03-15T07:00:00.000Z"), status: "APPROVED", lines: { create: lines.map((l) => ({ itemId: item.id, ...l })) } },
      select: { id: true, lines: { select: { id: true, unitPrice: true } } },
    });
    ids.orders.push(o.id);
    return o;
  };
  const mkShipment = async (customerId: string, n: string, at: string, qty: number, alloc: Array<{ orderLineId: string; qty: number }>) => {
    const sh = await prisma.shipment.create({ data: { shipmentNo: `${TAG}-${n}`, customerId, status: "DISPATCHED", dispatchedAt: new Date(at) }, select: { id: true } });
    ids.shipments.push(sh.id);
    const sack = await prisma.sack.create({ data: { sackNo: `${TAG}-K${n}`, shipmentId: sh.id, customerId }, select: { id: true } });
    ids.sacks.push(sack.id);
    if (alloc.length) await prisma.sackAllocation.createMany({ data: alloc.map((a) => ({ sackId: sack.id, ...a })) });
    const r = await prisma.roll.create({ data: { barcode: `${TAG}-R${n}`, itemId: item.id, initialQty: qty, currentQty: qty, status: "SHIPPED", entrySource: "SUPPLIER_RECEIPT", shipmentId: sh.id }, select: { id: true } });
    ids.rolls.push(r.id);
  };
  const a = await mkCustomer("A");
  const b = await mkCustomer("B");
  const oa = await mkOrder(a, "OA", [{ quantity: 200, unitPrice: 10 }, { quantity: 30 }]);
  const ob = await mkOrder(b, "OB", [{ quantity: 500, unitPrice: 99 }]);
  const priced = oa.lines.find((l) => l.unitPrice !== null)!;
  const unpriced = oa.lines.find((l) => l.unitPrice === null)!;
  await mkShipment(a, "SA1", "2099-03-15T09:00:00.000Z", 100, [{ orderLineId: priced.id, qty: 70 }, { orderLineId: unpriced.id, qty: 30 }]);
  await mkShipment(a, "SA0", "2099-02-01T09:00:00.000Z", 40, []); // önceki dönem (ay penceresinin öncesi)
  await mkShipment(b, "SB1", "2099-03-15T10:00:00.000Z", 500, [{ orderLineId: ob.lines[0]!.id, qty: 500 }]);
  return { a, b };
}

async function cleanup(): Promise<void> {
  await prisma.sackAllocation.deleteMany({ where: { sackId: { in: ids.sacks } } });
  await prisma.sack.deleteMany({ where: { id: { in: ids.sacks } } });
  await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
  await prisma.shipment.deleteMany({ where: { id: { in: ids.shipments } } });
  await prisma.orderLine.deleteMany({ where: { orderId: { in: ids.orders } } });
  await prisma.order.deleteMany({ where: { id: { in: ids.orders } } });
  await prisma.item.deleteMany({ where: { id: { in: ids.items } } });
  await prisma.cariAccount.deleteMany({ where: { customerId: { in: ids.customers } } });
  await prisma.customer.deleteMany({ where: { id: { in: ids.customers } } });
  for (const u of ids.users) {
    await prisma.userPermission.deleteMany({ where: { userId: u } });
    await prisma.session.deleteMany({ where: { userId: u } }).catch(() => undefined);
    await prisma.systemLog.deleteMany({ where: { userId: u } });
    await prisma.user.delete({ where: { id: u } }).catch(() => undefined);
  }
}

async function httpSection(a: string): Promise<void> {
  console.log("\n── §5 HTTP ──");
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const login = async (ek: string, perms: string[]): Promise<string> => {
      const username = `${TAG}-${ek}`.toLowerCase();
      const u = await prisma.user.create({ data: { username, fullName: `${TAG} ${ek}`, passwordHash: await AuthService.hashPassword("test123456"), isActive: true }, select: { id: true } });
      ids.users.push(u.id);
      const rows = await prisma.permission.findMany({ where: { code: { in: perms } }, select: { id: true } });
      if (rows.length) await prisma.userPermission.createMany({ data: rows.map((p) => ({ userId: u.id, permissionId: p.id })) });
      const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password: "test123456" }) });
      const t = ((await r.json()) as { data?: { token?: string } }).data?.token;
      if (!t) throw new Error(`login başarısız: ${username}`);
      return t;
    };
    const get = async (path: string, token: string) => (await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } })).status;
    const reader = await login("okur", ["customer:read"]);
    const mobile = await login("mobil", ["mobile:sevkiyat"]);
    check("uç customer:read ile 200", (await get(`/api/customers/${a}/period-summary?donem=hafta`, reader)) === 200);
    check("kötü dönem 400", (await get(`/api/customers/${a}/period-summary?donem=ceyrek`, reader)) === 400);
    check("customer:read yok → 403", (await get(`/api/customers/${a}/period-summary`, mobile)) === 403);
    check("toplu kapı /:id'e sızmaz (mobil okur kartı alır)", (await get(`/api/customers/${a}`, mobile)) === 200);
  } finally {
    server.close();
  }
}

function is400(f: () => unknown): boolean {
  try { f(); return false; } catch (e) { return (e as { name?: string }).name === "ZodError"; }
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    return;
  }
  console.log("=== Müşteri dönem özeti bekçisi ===\n");
  try {
    const { a, b } = await fixtures();
    const sa = await getCustomerPeriodSummary(a, "ay", ALL, NOW);
    const sb = await getCustomerPeriodSummary(b, "ay", ALL, NOW);

    console.log("── §1 sayılar ──");
    check("sevk metre 100, önceki 40, değişim %150", sa.sevk?.metre.deger === 100 && sa.sevk.metre.onceki === 40 && sa.sevk.metre.degisimYuzde === 150, JSON.stringify(sa.sevk?.metre));
    check("irsaliye 1 (önceki 1)", sa.sevk?.irsaliye.deger === 1 && sa.sevk.irsaliye.onceki === 1);
    const tryA = sa.ciro?.tutarlar.find((t) => t.paraBirimi === "TRY");
    check("ciro TRY 700 (70 × 10), fiyatsız satır 1 (0 sayılmaz)", tryA?.deger === 700 && sa.ciro?.fiyatsizSatir === 1, JSON.stringify(sa.ciro));
    check("sipariş adet 1, metre 230", sa.siparis?.adet.deger === 1 && sa.siparis.metre.deger === 230, JSON.stringify(sa.siparis));
    check("öteki müşteri girmez (B sevk 500, ciro 49500)", sb.sevk?.metre.deger === 500 && sb.ciro?.tutarlar.find((t) => t.paraBirimi === "TRY")?.deger === 49500 && sa.sevk?.metre.deger !== 600);
    check("aralık fabrika günü anahtarı", sa.aralik.bitis === "2099-03-15" && /^\d{4}-\d{2}-\d{2}$/.test(sa.aralik.baslangic), JSON.stringify(sa.aralik));

    console.log("\n── §2 eşitlik (tek kaynak) ──");
    const w = resolvePanoPencere("ay", NOW);
    const cells = await collectShipped(w.aralik);
    const shippedA = cells.filter((c) => c.customerId === a).reduce((s, c) => s + c.qty, 0);
    check("sevk = collectShipped müşteri hücreleri", sa.sevk?.metre.deger === Math.round(shippedA * 10) / 10, `hücre=${shippedA}`);
    const intake = await getOrderIntake(w.aralik, w.oncekiAralik);
    const rowA = intake.byCustomer.find((r) => r.key === a);
    check("sipariş metresi = süzgeçsiz karnenin müşteri satırı", rowA !== undefined && sa.siparis?.metre.deger === rowA.qty, JSON.stringify(rowA));

    console.log("\n── §3 kapılar ──");
    const plain = await getCustomerPeriodSummary(a, "ay", PLAIN, NOW);
    check("report:sales yok → sevk/ciro/sipariş null", plain.sevk === null && plain.ciro === null && plain.siparis === null);
    const sales = await getCustomerPeriodSummary(a, "ay", SALES, NOW);
    check("report:sales var → üçü dolu", sales.sevk !== null && sales.ciro !== null && sales.siparis !== null);

    console.log("\n── §4 fail-closed ──");
    check("tanınmayan dönem 400", is400(() => periodSummaryQuerySchema.parse({ donem: "ceyrek" })));
    check("tanınmayan parametre 400", is400(() => periodSummaryQuerySchema.parse({ donem: "ay", x: "1" })));
    check("dönem verilmezse geçer (varsayılan ay)", !is400(() => periodSummaryQuerySchema.parse({})));
    let nf = false;
    try { await getCustomerPeriodSummary(randomUUID(), "ay", ALL, NOW); } catch (e) { nf = e instanceof AppError && e.statusCode === 404; }
    check("olmayan cari 404", nf);
    await httpSection(a);
  } finally {
    await cleanup();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main()
  .catch((e) => {
    console.error("HATA", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
