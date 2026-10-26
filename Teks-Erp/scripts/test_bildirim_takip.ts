// =============================================================================
// BEKÇİ — KAYIT TAKİBİ (N4-MOTOR, plan §5.3): oluşturan otomatik takipçi + takip uçları
// Çalıştır: npx tsx scripts/run-all-tests.ts test_bildirim_takip
// =============================================================================
//   §1 üç doğuş noktası (sipariş `insertPreparedOrderTx` · iş emri `createWorkOrderTx` · dokuma işi `createWeavingOrder`)
//      aynı tx'te oluşturanı TAKIP/OLUSTURAN yazar; kullanıcısız doğuş yazmaz, düşmez
//   §2 ⭐ doğuşun dönüşü bayt-eşit: statik — helper dönüşü çağrının sonucunu AYNEN döner (sarmalayıcı değişken)
//   §3 takip uçları: GET/DELETE/PUT durum geçişleri · ⭐ BIRAKTI, oluşturan otomatiğinin tekrarıyla EZİLMEZ ·
//      kaydı göremeyen 404 · tanınmayan tür 400
//
// NEGATİF SONDA (2026-10-25, md5 ile birebir geri alındı): `followAsCreatorTx`te `ON CONFLICT … DO NOTHING` →
// `DO UPDATE SET state='TAKIP'` → §3c §3d ❌ (13/2; BIRAKTI ezildi).
// Global ayar yazar (`bildirim.gelenKutusuEnabled`); fikstür bulduğu değere döner. Kendi kayıtlarını siler.
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WeavingExecutionKind } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { OrderService } from "../src/services/order.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { createWeavingOrder } from "../src/services/weaving-order.service";
import { followAsCreatorTx } from "../src/services/helpers/record-follow.helper";
import { BildirimFikstur } from "./lib/bildirim-http-fikstur";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const ek = Date.now().toString(36);
const fx = new BildirimFikstur(`btakip-${ek}`);
const made = { orders: [] as string[], workOrders: [] as string[], weaving: [] as string[], items: [] as string[], customers: [] as string[], stations: [] as string[] };

const orderSvc = new OrderService({
  modelName: "order", tableName: "ORDER", searchFields: [], codeSearchFields: ["orderNumber"],
  defaultInclude: { lines: true }, nestedCreateFields: ["lines"],
});
const wos = new WorkOrderService();

const follow = (userId: string, where: Record<string, string>) => {
  // Kimliği boş süzgeç bütün satırlara eşleşirdi (sessiz yeşil); kimlik zorunlu.
  if (Object.values(where).some((v) => typeof v !== "string" || v.length !== 36)) throw new Error(`takip süzgeci kimliksiz: ${JSON.stringify(where)}`);
  return prisma.recordFollow.findFirst({ where: { userId, ...where }, select: { state: true, reason: true } });
};

const unwrap = <T>(r: unknown): T => ((r as { data?: T }).data ?? (r as T));

function statik(): void {
  console.log("=== §2 dönüş bayt-eşit (statik) ===");
  const src = (f: string) => readFileSync(join(__dirname, "..", "src", f), "utf8");
  const order = src("services/order.service.ts");
  const ins = order.slice(order.indexOf("async insertPreparedOrderTx("), order.indexOf("private nextOrderNumber("));
  check(
    "§2a sipariş: insertOrderTx sonucu takip yazıldıktan sonra AYNEN döner",
    /const created = await this\.insertOrderTx\(tx, p, orderNumber\);[\s\S]*followAsCreatorTx\(tx, p\.actorUserId, \{ orderId: created\.id as string \}\);\s*return created;/.test(ins),
  );
  const wo = src("services/helpers/workorder-event.helper.ts");
  const cw = wo.slice(wo.indexOf("export async function createWorkOrderTx"), wo.indexOf("export async function recordWorkOrderFieldChangesTx"));
  check("§2b iş emri: `wo` aynen döner", /followAsCreatorTx\(tx, ctx\.userId, \{ workOrderId: row\.id \}\);\s*return wo;\s*\}/.test(cw));
  const wv = src("services/weaving-order.service.ts");
  check("§2c dokuma işi: takip, dönüş satırı okunmadan ÖNCE aynı tx'te", /followAsCreatorTx\(tx, userId, \{ weavingOrderId: row\.id \}\);\s*return \{ fresh: true as const/.test(wv));
}

async function main(): Promise<void> {
  console.log("\n=== Kayıt takibi — doğuş + uçlar ===\n");
  try {
    statik();
    await fx.ac();
    await fx.bayrak(true);
    const u = await fx.kullanici("sahip", ["order:read", "workorder:read", "weavingorder:read"]);
    const yabanci = await fx.kullanici("yabanci", ["admin:users"]);

    const item = await prisma.item.create({ data: { code: `TST-BTK-I-${ek}`, name: `BTK KUMAŞ ${ek}`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
    made.items.push(item.id);
    const customer = await prisma.customer.create({ data: { code: `TST-BTK-C-${ek}`, name: `BTK MÜŞTERİ ${ek}` }, select: { id: true } });
    made.customers.push(customer.id);
    const station = await prisma.station.create({ data: { code: `TST-BTK-S-${ek}`.slice(0, 32), name: `BTK İstasyon ${ek}`, type: "INTERNAL" }, select: { id: true } });
    made.stations.push(station.id);

    console.log("\n=== §1 doğuş noktaları ===");
    const order = unwrap<Record<string, unknown>>(await orderSvc.create({ customerId: customer.id, lines: [{ itemId: item.id, quantity: 10, width: 150 }] }, u.id));
    const orderId = order.id as string;
    made.orders.push(orderId);
    const fo = await follow(u.id, { orderId });
    check("§1a sipariş doğuşu → TAKIP/OLUSTURAN", fo?.state === "TAKIP" && fo?.reason === "OLUSTURAN", JSON.stringify(fo));
    check("§1b sipariş dönüşü değişmedi (id + satırlar)", typeof order.orderNumber === "string" && Array.isArray(order.lines), Object.keys(order).length.toString());

    const wo = unwrap<{ id: string }>(await wos.create({ type: "STOCK_PRODUCTION", targetItemId: item.id, steps: [{ stationId: station.id, notes: null }] } as never, u.id));
    made.workOrders.push(wo.id);
    const fw = await follow(u.id, { workOrderId: wo.id });
    check("§1c iş emri doğuşu → TAKIP/OLUSTURAN", fw?.state === "TAKIP" && fw?.reason === "OLUSTURAN", JSON.stringify(fw));

    const wv = unwrap<{ id: string }>(await createWeavingOrder({ itemId: item.id, executionKind: WeavingExecutionKind.IN_HOUSE, plannedM: 100 } as never, u.id));
    made.weaving.push(wv.id);
    const fv = await follow(u.id, { weavingOrderId: wv.id });
    check("§1d dokuma işi doğuşu → TAKIP/OLUSTURAN", fv?.state === "TAKIP" && fv?.reason === "OLUSTURAN", JSON.stringify(fv));

    const anon = unwrap<{ id: string }>(await createWeavingOrder({ itemId: item.id, executionKind: WeavingExecutionKind.IN_HOUSE, plannedM: 50 } as never, undefined));
    made.weaving.push(anon.id);
    const nAnon = await prisma.recordFollow.count({ where: { weavingOrderId: anon.id } });
    check("§1e kullanıcısız doğuş takip yazmaz, düşmez", typeof anon.id === "string" && nAnon === 0, `${anon.id} ${nAnon}`);

    console.log("\n=== §3 takip uçları ===");
    const yol = `/api/bildirim/takip/siparis/${orderId}`;
    const g = await fx.istek(u.token, "GET", yol);
    check("§3a GET → takip, OLUSTURAN", g.status === 200 && g.json?.data?.takip === true && g.json?.data?.neden === "OLUSTURAN", JSON.stringify(g.json?.data));
    const d = await fx.istek(u.token, "DELETE", yol);
    check("§3b DELETE → BIRAKTI (satır silinmez)", d.status === 200 && d.json?.data?.durum === "BIRAKTI", JSON.stringify(d.json?.data));
    await prisma.$transaction((tx) => followAsCreatorTx(tx, u.id, { orderId }));
    const after = await follow(u.id, { orderId });
    check("§3c ⭐ BIRAKTI, oluşturan otomatiğinin tekrarıyla EZİLMEZ", after?.state === "BIRAKTI", JSON.stringify(after));
    const p = await fx.istek(u.token, "PUT", yol);
    check("§3d PUT → yeniden TAKIP (ELLE)", p.status === 200 && p.json?.data?.takip === true && p.json?.data?.neden === "ELLE", JSON.stringify(p.json?.data));
    const y = await fx.istek(yabanci.token, "GET", yol);
    check("§3e kaydı göremeyen → 404", y.status === 404, `${y.status}`);
    const t = await fx.istek(u.token, "GET", `/api/bildirim/takip/fatura/${orderId}`);
    check("§3f tanınmayan takip türü → 400", t.status === 400, `${t.status}`);
    const n = await fx.istek(u.token, "GET", `/api/bildirim/takip/is-emri/${orderId}`);
    check("§3g tür ↔ kimlik uyuşmazlığı (sipariş id'si iş emri diye) → 404", n.status === 404, `${n.status}`);
  } finally {
    await prisma.recordFollow.deleteMany({ where: { OR: [{ orderId: { in: made.orders } }, { workOrderId: { in: made.workOrders } }, { weavingOrderId: { in: made.weaving } }] } });
    await fx.kapat();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (err) => {
  console.error("❌ beklenmeyen hata:", err);
  await fx.kapat().catch(() => undefined);
  await prisma.$disconnect();
  process.exitCode = 1;
});
