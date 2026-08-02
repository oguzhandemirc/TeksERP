// =============================================================================
// Liste gürültüsü: iptal edilmiş kayıtlar varsayılan olarak gizli
// Çalıştır: npx tsx scripts/test_hide_cancelled_lists.ts
//
// Kapsam (3 cephe):
//  1. Karar mantığı — buildHideCancelledWhere: bayrak yoksa dokunma, açık DURUM
//     filtresi varsa dokunma (çelişip listeyi boşaltmasın), aksi halde notIn.
//  2. Uçtan uca — Sipariş / İş Emri / Sevkiyat listelerinde iptalli kayıt
//     bayrakla GİZLENİR, bayraksız GÖRÜNÜR (parametresiz eski davranış korunur —
//     mobil ve entegrasyon istemcileri etkilenmemeli).
//  3. ⚠️ REGRESYON — İş Emri sızıntısı. workorder.service `buildWhereClause`'a
//     filtreleri ALLOWLIST'siz geçirir (Order'daki safeFilters süzgeci orada YOK):
//     `hideCancelled` filtre kümesinden silinmezse `where.hideCancelled` olarak
//     Prisma'ya gider ve liste "Unknown argument" 500'ü verir. Bu testin 3. cephesi
//     tam olarak o sızıntıyı kovalar — silme satırı kaldırılırsa KIRMIZI olur.
// =============================================================================
import type { Request } from "express";
import prisma, { pool } from "../src/lib/prisma";
import { OrderStatus, ShipmentStatus, WorkOrderStatus } from "@prisma/client";
import { buildHideCancelledWhere } from "../src/services/helpers/hidden-status.helper";
import { OrderService } from "../src/services/order.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { shippingService } from "../src/services/shipping.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`✅ ${label}`);
  } else {
    fail++;
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** fake Request — parseQueryParams `filter[x]` anahtarını query'den okur. */
function req(query: Record<string, string>): Request {
  return { query } as unknown as Request;
}

const STAMP = `TEST-HC-${process.pid}`;
const orderService = new OrderService({
  modelName: "order",
  tableName: "ORDER",
  searchFields: ["orderNumber"],
  dateFields: ["createdAt", "deadline"],
});
const woService = new WorkOrderService();

interface Row {
  id: string;
}
function ids(res: unknown): string[] {
  const data = (res as { data?: Row[] }).data ?? [];
  return data.map((d) => d.id);
}

async function main() {
  // ── 1) Karar mantığı ────────────────────────────────────────────────────────
  console.log("\n── 1) buildHideCancelledWhere karar mantığı ──");
  check(
    "bayrak yoksa dokunmaz",
    buildHideCancelledWhere({}, ["CANCELLED"]) === undefined,
  );
  check(
    "bayrak 'false' ise dokunmaz",
    buildHideCancelledWhere({ hideCancelled: "false" }, ["CANCELLED"]) === undefined,
  );
  check(
    "açık DURUM filtresi varsa dokunmaz (çelişki → boş liste olurdu)",
    buildHideCancelledWhere({ hideCancelled: "true", status: "CANCELLED" }, [
      "CANCELLED",
    ]) === undefined,
  );
  const w = buildHideCancelledWhere({ hideCancelled: "true" }, ["CANCELLED"]);
  check(
    "bayrak varsa notIn üretir",
    JSON.stringify(w) === JSON.stringify({ status: { notIn: ["CANCELLED"] } }),
    JSON.stringify(w),
  );

  // ── Fixture ─────────────────────────────────────────────────────────────────
  const customer = await prisma.customer.findFirst({ where: { isActive: true } });
  if (!customer) throw new Error("Fixture: aktif müşteri yok");

  const [orderLive, orderCancelled] = await Promise.all([
    prisma.order.create({
      data: { orderNumber: `${STAMP}-O1`, customerId: customer.id, status: OrderStatus.PENDING },
    }),
    prisma.order.create({
      data: { orderNumber: `${STAMP}-O2`, customerId: customer.id, status: OrderStatus.CANCELLED },
    }),
  ]);
  const [woLive, woCancelled] = await Promise.all([
    prisma.workOrder.create({
      data: { workOrderNumber: `${STAMP}-W1`, status: WorkOrderStatus.PLANNED },
    }),
    prisma.workOrder.create({
      data: { workOrderNumber: `${STAMP}-W2`, status: WorkOrderStatus.CANCELLED },
    }),
  ]);
  const [shipLive, shipCancelled] = await Promise.all([
    prisma.shipment.create({
      data: { shipmentNo: `${STAMP}-S1`, customerId: customer.id, status: ShipmentStatus.PLANNED },
    }),
    prisma.shipment.create({
      data: { shipmentNo: `${STAMP}-S2`, customerId: customer.id, status: ShipmentStatus.CANCELLED },
    }),
  ]);

  try {
    // ── 2) Sipariş ────────────────────────────────────────────────────────────
    console.log("\n── 2) Sipariş listesi ──");
    const oAll = ids(await orderService.findAll(req({ search: STAMP, pageSize: "100" })));
    check("bayraksız: iptalli sipariş GÖRÜNÜR (eski davranış korunur)",
      oAll.includes(orderCancelled.id) && oAll.includes(orderLive.id),
      `görülen=${oAll.length}`);
    const oHidden = ids(
      await orderService.findAll(req({ search: STAMP, pageSize: "100", "filter[hideCancelled]": "true" })),
    );
    check("bayrakla: iptalli sipariş GİZLİ, diğeri durur",
      !oHidden.includes(orderCancelled.id) && oHidden.includes(orderLive.id),
      `görülen=${oHidden.length}`);
    const oExplicit = ids(
      await orderService.findAll(
        req({ search: STAMP, pageSize: "100", "filter[hideCancelled]": "true", "filter[status]": "CANCELLED" }),
      ),
    );
    check("bayrak + açık 'Durum: İptal' → kullanıcı niyeti kazanır (liste boş DEĞİL)",
      oExplicit.includes(orderCancelled.id),
      `görülen=${oExplicit.length}`);

    // ── 3) İş Emri (sızıntı regresyonu burada) ────────────────────────────────
    console.log("\n── 3) İş Emri listesi ──");
    const wAll = ids(await woService.findAll(req({ search: STAMP, pageSize: "100" })));
    check("bayraksız: iptalli İE GÖRÜNÜR",
      wAll.includes(woCancelled.id) && wAll.includes(woLive.id),
      `görülen=${wAll.length}`);
    let woLeak: string | null = null;
    let wHidden: string[] = [];
    try {
      wHidden = ids(
        await woService.findAll(req({ search: STAMP, pageSize: "100", "filter[hideCancelled]": "true" })),
      );
    } catch (e) {
      woLeak = e instanceof Error ? e.message.split("\n")[0] : String(e);
    }
    check("REGRESYON: bayrak Prisma where'ine SIZMAZ (allowlist'siz servis)",
      woLeak === null,
      woLeak ?? undefined);
    check("bayrakla: iptalli İE GİZLİ, diğeri durur",
      !wHidden.includes(woCancelled.id) && wHidden.includes(woLive.id),
      `görülen=${wHidden.length}`);

    // ── 4) Sevkiyat ───────────────────────────────────────────────────────────
    console.log("\n── 4) Sevkiyat listesi ──");
    const sAll = ids(await shippingService.listShipments(req({ search: STAMP, pageSize: "100" })));
    check("bayraksız: iptalli sevkiyat GÖRÜNÜR",
      sAll.includes(shipCancelled.id) && sAll.includes(shipLive.id),
      `görülen=${sAll.length}`);
    const sHidden = ids(
      await shippingService.listShipments(
        req({ search: STAMP, pageSize: "100", "filter[hideCancelled]": "true" }),
      ),
    );
    check("bayrakla: iptalli sevkiyat GİZLİ, diğeri durur",
      !sHidden.includes(shipCancelled.id) && sHidden.includes(shipLive.id),
      `görülen=${sHidden.length}`);
    const sExplicit = ids(
      await shippingService.listShipments(
        req({ search: STAMP, pageSize: "100", "filter[hideCancelled]": "true", status: "CANCELLED" }),
      ),
    );
    check("bayrak + ?status=CANCELLED → açık niyet kazanır",
      sExplicit.includes(shipCancelled.id),
      `görülen=${sExplicit.length}`);
  } finally {
    await prisma.shipment.deleteMany({ where: { id: { in: [shipLive.id, shipCancelled.id] } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: [woLive.id, woCancelled.id] } } });
    await prisma.order.deleteMany({ where: { id: { in: [orderLive.id, orderCancelled.id] } } });
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
