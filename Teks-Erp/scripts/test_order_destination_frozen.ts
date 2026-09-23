// =============================================================================
// BEKÇİ — SİPARİŞ YÖNÜ DOĞUŞTA DONAR (Order.destination)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts order_destination_frozen
//
// ⭐ NEDEN (2026-09-23, kullanıcı kararı): sipariş raporları yönü CANLI kart zincirinden (şube →
//    cari) okuyordu; cari kartı değişince geçmiş siparişlerin yönü de değişiyordu ("bugünkü yön").
//    Sevkiyatın donmuş yönüyle aynı kalıp: sipariş açılırken `resolveShipmentDestination` zinciri
//    yazılır, boşsa NULL; kart sonradan değişse de sipariş değişmez.
//
// NE ÖLÇER (HTTP — gerçek app):
//   ① cari EXPORT → sipariş EXPORT
//   ② şube DOMESTIC, cari EXPORT → sipariş DOMESTIC (şube önce)
//   ③ zincir boş → NULL ("yön belirsiz")
//   ④ gövdeden `destination` YAZILAMAZ (create ve update)
//   §⑤ ⭐ kart değişir (cari + şube) → sipariş kolonu DEĞİŞMEZ
//   ⑥ sipariş AÇIKÇA başka cariye taşınır → yön yeniden çözülür; yalnız termin değişirse dokunulmaz
//   ⑦ birleştirme haritası siparişin yönüne dokunmaz (MOVE yalnız customerId)
//
// NEGATİF SONDA (2026-09-23, ölçüldü): cari PATCH'inden sonra o carinin siparişleri
//    `resolveShipmentDestination` ile yeniden yazılınca ⑤ KIRMIZI; geri alınınca yeşil.
// =============================================================================
import type { Server } from "http";
import type { AddressInfo } from "net";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import app from "../src/app";
import prisma from "../src/lib/prisma";
import { cleanupTestCustomers } from "./fixture-customer-cleanup";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const MARK = `TEST-OYN${Date.now().toString(36).slice(-5).toUpperCase()}`;
const olusanCariler: string[] = [];
const olusanSiparisler: string[] = [];

async function main() {
  const server: Server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let token = "";
  const call = async (method: string, p: string, body?: unknown) => {
    const r = await fetch(`${base}${p}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as { data?: Record<string, unknown>; message?: string } };
  };
  const yon = async (orderId: string) => (await prisma.order.findUnique({ where: { id: orderId }, select: { destination: true } }))?.destination ?? null;
  try {
    const cred = await ensureTestAdmin();
    token = String((await call("POST", "/api/auth/login", { username: cred.username, password: cred.password })).body.data?.token ?? "");
    check("login", token.length > 20);

    const [kumas] = await prisma.item.findMany({ where: { isActive: true, itemType: "FABRIC" }, take: 1, select: { id: true } });
    const cari = async (ad: string, defaultDestination?: "DOMESTIC" | "EXPORT") => {
      const r = await call("POST", "/api/customers", { name: `${MARK} ${ad}`, isCustomerRole: true, ...(defaultDestination ? { defaultDestination } : {}) });
      const id = String(r.body.data?.id ?? "");
      olusanCariler.push(id);
      return id;
    };
    const siparis = async (customerId: string, extra: Record<string, unknown> = {}) => {
      const r = await call("POST", "/api/orders", { customerId, lines: [{ itemId: kumas?.id, quantity: 10 }], clientToken: randomUUID(), ...extra });
      const id = String(r.body.data?.id ?? "");
      if (id) olusanSiparisler.push(id);
      return { status: r.status, id };
    };

    const ihracat = await cari("İhracat", "EXPORT");
    const bos = await cari("Yönsüz");
    const sube = await call("POST", `/api/customers/${ihracat}/branches`, { name: `${MARK} Şube`, defaultDestination: "DOMESTIC" });
    const subeId = String(sube.body.data?.id ?? "");
    check("fikstür: iki cari + şube", Boolean(ihracat && bos && subeId), `şube ${sube.status}`);

    // ① ② ③
    const s1 = await siparis(ihracat);
    check("① cari EXPORT → sipariş EXPORT", s1.status === 201 && (await yon(s1.id)) === "EXPORT", `${s1.status} ${await yon(s1.id)}`);
    const s2 = await siparis(ihracat, { branchId: subeId });
    check("② şube DOMESTIC önce gelir", (await yon(s2.id)) === "DOMESTIC", `${await yon(s2.id)}`);
    const s3 = await siparis(bos);
    check("③ zincir boş → NULL", s3.status === 201 && (await yon(s3.id)) === null, `${await yon(s3.id)}`);

    // ④ gövdeden yazılamaz
    const s4 = await siparis(bos, { destination: "EXPORT" });
    check("④ create gövdesindeki destination yok sayılır", (await yon(s4.id)) === null, `${await yon(s4.id)}`);
    await call("PATCH", `/api/orders/${s4.id}`, { destination: "EXPORT" });
    check("④ update gövdesindeki destination yok sayılır", (await yon(s4.id)) === null, `${await yon(s4.id)}`);

    // ⑤ kart değişir → sipariş değişmez
    const kp = await call("PATCH", `/api/customers/${ihracat}`, { defaultDestination: "DOMESTIC" });
    const sp = await call("PATCH", `/api/customers/${ihracat}/branches/${subeId}`, { defaultDestination: "EXPORT" });
    const kartSonra = await prisma.customer.findUnique({ where: { id: ihracat }, select: { defaultDestination: true } });
    check("⑤ fikstür: cari kartı gerçekten değişti", kp.status < 300 && kartSonra?.defaultDestination === "DOMESTIC", `cari ${kp.status} · şube ${sp.status}`);
    check("⑤ ⭐ cari kartı değişti → eski sipariş EXPORT kalır", (await yon(s1.id)) === "EXPORT", `${await yon(s1.id)}`);
    check("⑤ ⭐ şube kartı değişti → eski sipariş DOMESTIC kalır", (await yon(s2.id)) === "DOMESTIC", `${await yon(s2.id)}`);

    // ⑥ açık taşıma yeniden çözer; termin değişimi dokunmaz
    const ihracat2 = await cari("İhracat 2", "EXPORT");
    const tasima = await call("PATCH", `/api/orders/${s3.id}`, { customerId: ihracat2 });
    check("⑥ sipariş başka cariye taşındı → yön yeniden çözüldü (NULL → EXPORT)", tasima.status < 300 && (await yon(s3.id)) === "EXPORT", `${tasima.status} ${await yon(s3.id)}`);
    const termin = await call("PATCH", `/api/orders/${s1.id}`, { deadline: new Date(Date.now() + 7 * 86_400_000).toISOString() });
    check("⑥ yalnız termin değişti → yön dokunulmadı", termin.status < 300 && (await yon(s1.id)) === "EXPORT", `${termin.status} ${await yon(s1.id)}`);

    // ⑦ birleştirme haritası (statik): siparişte yalnız customerId taşınır, yön yeniden dondurulmaz
    const harita = fs.readFileSync(path.join(__dirname, "../src/constants/merge-map.customer.ts"), "utf-8");
    check("⑦ birleştirme haritası siparişin yönüne dokunmaz", !/orders[^\n]*destination|destination[^\n]*orders/i.test(harita));
  } finally {
    await temizlik();
    await new Promise((r) => server.close(() => r(undefined)));
  }
}

/** Teardown: bu koşumun siparişleri + carileri (şubeler carinin temizliğinde). */
async function temizlik(): Promise<void> {
  if (olusanSiparisler.length > 0) {
    await prisma.orderLine.deleteMany({ where: { orderId: { in: olusanSiparisler } } }).catch(() => undefined);
    await prisma.order.deleteMany({ where: { id: { in: olusanSiparisler } } }).catch(() => undefined);
  }
  await cleanupTestCustomers(olusanCariler).catch(() => undefined);
}

main()
  .then(() => { console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`); })
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => { await prisma.$disconnect(); process.exit(fail > 0 ? 1 : 0); });
