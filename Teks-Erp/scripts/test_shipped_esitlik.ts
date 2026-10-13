// =============================================================================
// `collectShipped` SORGU EŞİTLİĞİ — Perf-2 B6 davranış kilidi (2026-10-13)
//
// B6 sevk edilmiş topları okuyan yarıya bir yarı-birleşim ekledi (planlayıcı
// sevk edilmiş TÜM topları hash'liyordu). Bu değişiklik YALNIZ hızdır: sonuç
// kümesi değişikliğin ÖNCESİNDEKİ sorguyla hücre hücre aynı olmalı. Önceki sorgu
// aşağıda DONDURULMUŞ referans olarak durur; `collectShipped` ondan sapınca kırmızı.
//
// Fikstür (2097-05, başka bekçilerle çakışmaz): iki yön · iki kumaş · iade
// geri-eklemesi (iptalli + iptalsiz) · aralık dışı sevk · PLANNED anomali.
// Doğrudan sevk yarısı B6'da değişmedi; tüm-DB karşılaştırması onu da kapsar.
//
// Koşum: npx tsx scripts/test_shipped_esitlik.ts
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { Prisma, type ShipmentDestination } from "@prisma/client";
import { collectShipped, type ShippedCell } from "../src/services/reports/_shipped";
import { shipmentDestinationSql } from "../src/services/reports/_destination";
import { directShipmentsMatchDestinationFilter } from "../src/services/helpers/direct-shipment-destination.helper";
import type { DateRange } from "../src/services/reports/_shared";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

const TAG = `TSE-${Date.now()}`;
const RANGE: DateRange = { from: new Date("2097-05-01T00:00:00.000Z"), to: new Date("2097-05-31T23:59:59.999Z") };
const ICERDE = new Date("2097-05-15T10:00:00.000Z");
const DISARDA = new Date("2097-07-15T10:00:00.000Z");
const HER_SEY: DateRange = { from: new Date("1970-01-01T00:00:00.000Z"), to: new Date("2100-01-01T00:00:00.000Z") };

/** B6 ÖNCESİ sorgu — DONDURULMUŞ referans; değiştirme (eşitliğin tek ölçüsü). */
async function referans(range: DateRange, destination?: ShipmentDestination): Promise<ShippedCell[]> {
  const withDirect = directShipmentsMatchDestinationFilter(destination);
  const rows = await prisma.$queryRaw<
    Array<{ customerId: string; customerName: string; itemId: string | null; itemName: string | null;
      colorId: string | null; colorName: string | null; destination: ShipmentDestination | null;
      rollCount: bigint; qty: number | null }>
  >(Prisma.sql`
    WITH disp AS (
      SELECT id, "customerId", destination FROM shipments
      WHERE status = 'DISPATCHED'
        AND "dispatchedAt" >= ${range.from} AND "dispatchedAt" <= ${range.to}
        ${shipmentDestinationSql(destination, "shipments")}
    ),
    parts AS (
      SELECT d."customerId", d.destination, r."itemId", r."colorId", 1::int AS cnt, r."currentQty" AS qty
      FROM rolls r JOIN disp d ON d.id = r."shipmentId"
      UNION ALL
      SELECT d."customerId", d.destination, rr."itemId", rr."colorId", 1::int, rr.qty
      FROM roll_returns rr JOIN disp d ON d.id = rr."fromShipmentId"
      WHERE rr."cancelledAt" IS NULL
      ${withDirect ? Prisma.sql`UNION ALL
      SELECT ds."customerId", NULL::"ShipmentDestination", r."itemId", r."colorId", 1::int, r."currentQty"
      FROM direct_shipments ds JOIN rolls r ON r."directShipmentId" = ds.id
      WHERE ds."shippedAt" >= ${range.from} AND ds."shippedAt" <= ${range.to}
      UNION ALL
      SELECT ds."customerId", NULL::"ShipmentDestination", NULL::uuid, NULL::uuid, 0::int,
             ds."totalQty" - COALESCE((SELECT SUM(r2."currentQty") FROM rolls r2 WHERE r2."directShipmentId" = ds.id), 0)
      FROM direct_shipments ds
      WHERE ds."shippedAt" >= ${range.from} AND ds."shippedAt" <= ${range.to}
        AND ds."totalQty" <> COALESCE((SELECT SUM(r2."currentQty") FROM rolls r2 WHERE r2."directShipmentId" = ds.id), 0)` : Prisma.empty}
    )
    SELECT p."customerId" AS "customerId", cu.name AS "customerName", p."itemId" AS "itemId", i.name AS "itemName",
           p."colorId" AS "colorId", c.name AS "colorName", p.destination AS "destination",
           SUM(p.cnt) AS "rollCount", SUM(p.qty)::float AS "qty"
    FROM parts p
    JOIN customers cu ON cu.id = p."customerId"
    LEFT JOIN items i ON i.id = p."itemId"
    LEFT JOIN colors c ON c.id = p."colorId"
    GROUP BY p."customerId", cu.name, p."itemId", i.name, p."colorId", c.name, p.destination
  `);
  return rows.map((r) => ({
    customerId: r.customerId, customerName: r.customerName, itemId: r.itemId, itemName: r.itemName,
    colorId: r.colorId, colorName: r.colorName, destination: r.destination,
    rollCount: Number(r.rollCount), qty: Number(r.qty ?? 0),
  }));
}

/** Sırasız küme karşılaştırması için kararlı anahtar (hücre + sayılar). */
function anahtarlar(cells: ShippedCell[]): string[] {
  return cells
    .map((c) => [c.customerId, c.itemId, c.colorId, c.destination, c.customerName, c.itemName, c.colorName, c.rollCount, c.qty.toFixed(3)].join("|"))
    .sort();
}
function esit(a: ShippedCell[], b: ShippedCell[]): boolean {
  const x = anahtarlar(a);
  const y = anahtarlar(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

const ids = { rolls: [] as string[], returns: [] as string[], shipments: [] as string[], items: [] as string[], customers: [] as string[], user: "" };

async function main(): Promise<void> {
  console.log("\n=== collectShipped — B6 öncesi sorguyla eşitlik ===\n");
  const user = await prisma.user.create({
    data: { username: `${TAG}-u`.toLowerCase(), passwordHash: "x", fullName: `${TAG} kullanıcı` },
    select: { id: true },
  });
  ids.user = user.id;
  const mkItem = async (k: string) => {
    const it = await prisma.item.create({ data: { code: `${TAG}-${k}`, name: `${TAG} ${k}`, itemType: "FABRIC" }, select: { id: true } });
    ids.items.push(it.id);
    return it.id;
  };
  const mkCustomer = async (k: string) => {
    const c = await prisma.customer.create({ data: { code: `${TAG}-${k}`, name: `${TAG} ${k}` }, select: { id: true } });
    ids.customers.push(c.id);
    return c.id;
  };
  const [i1, i2] = [await mkItem("I1"), await mkItem("I2")];
  const [c1, c2] = [await mkCustomer("C1"), await mkCustomer("C2")];
  const mkShipment = async (k: string, customerId: string, destination: ShipmentDestination, status: "DISPATCHED" | "PLANNED", at: Date) => {
    const s = await prisma.shipment.create({
      data: { shipmentNo: `${TAG}-${k}`, customerId, destination, status, dispatchedAt: at },
      select: { id: true },
    });
    ids.shipments.push(s.id);
    return s.id;
  };
  const mkRoll = async (itemId: string, qty: number, shipmentId: string | null) => {
    const r = await prisma.roll.create({
      data: { itemId, initialQty: qty, currentQty: qty, status: shipmentId ? "SHIPPED" : "WAREHOUSE", entrySource: "SUPPLIER_RECEIPT", shipmentId, barcode: `${TAG}-R${ids.rolls.length}` },
      select: { id: true },
    });
    ids.rolls.push(r.id);
    return r.id;
  };
  const mkReturn = async (rollId: string, customerId: string, itemId: string, qty: number, fromShipmentId: string, cancelled: boolean) => {
    const rr = await prisma.rollReturn.create({
      data: { rollId, customerId, itemId, qty, receivedById: user.id, fromShipmentId, createdAt: ICERDE,
        ...(cancelled ? { cancelledAt: ICERDE, cancelReason: "test" } : {}) },
      select: { id: true },
    });
    ids.returns.push(rr.id);
  };

  const sYurtici = await mkShipment("S1", c1, "DOMESTIC", "DISPATCHED", ICERDE);
  const sYurtdisi = await mkShipment("S2", c2, "EXPORT", "DISPATCHED", ICERDE);
  const sDisarda = await mkShipment("S3", c1, "DOMESTIC", "DISPATCHED", DISARDA);
  const sPlanned = await mkShipment("S4", c1, "DOMESTIC", "PLANNED", ICERDE);
  await mkRoll(i1, 100, sYurtici);
  await mkRoll(i1, 50.5, sYurtici);
  await mkRoll(i2, 70, sYurtici);
  await mkRoll(i2, 30, sYurtdisi);
  await mkRoll(i1, 999, sDisarda);
  await mkRoll(i1, 777, sPlanned);
  const iadeli = await mkRoll(i1, 40, null);
  await mkReturn(iadeli, c1, i1, 40, sYurtici, false);
  const iptalIadeli = await mkRoll(i2, 25, null);
  await mkReturn(iptalIadeli, c2, i2, 25, sYurtdisi, true);

  // §1 pozitif kontrol — boş küme eşitliği marifet değil
  const yeni = await collectShipped(RANGE);
  const toplam = yeni.reduce((a, c) => a + c.qty, 0);
  check("§1 ⭐ fikstür penceresi BRÜT toplamı 290,5 (canlı 250,5 + iade 40; aralık dışı/PLANNED/iptalli iade yok)", Math.abs(toplam - 290.5) < 1e-9, `gelen ${toplam}`);

  // §2 fikstür penceresinde üç süzgeç
  for (const d of [undefined, "DOMESTIC", "EXPORT"] as const) {
    const a = await collectShipped(RANGE, d ? { destination: d } : {});
    const b = await referans(RANGE, d);
    check(`§2 fikstür penceresi · yön=${d ?? "hepsi"} — hücreler referansla birebir`, esit(a, b), `${a.length} hücre`);
  }

  // §3 tüm DB (doğrudan sevk ve ortamın geri kalanı dahil)
  for (const d of [undefined, "DOMESTIC", "EXPORT"] as const) {
    const a = await collectShipped(HER_SEY, d ? { destination: d } : {});
    const b = await referans(HER_SEY, d);
    check(`§3 tüm DB · yön=${d ?? "hepsi"} — hücreler referansla birebir`, esit(a, b), `${a.length} hücre`);
  }
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    // FK sırası: iade → top → sevkiyat → ürün/müşteri/kullanıcı.
    if (ids.returns.length) await prisma.rollReturn.deleteMany({ where: { id: { in: ids.returns } } });
    if (ids.rolls.length) await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
    if (ids.shipments.length) await prisma.shipment.deleteMany({ where: { id: { in: ids.shipments } } });
    if (ids.customers.length) await prisma.customer.deleteMany({ where: { id: { in: ids.customers } } });
    if (ids.items.length) await prisma.item.deleteMany({ where: { id: { in: ids.items } } });
    if (ids.user) await prisma.user.deleteMany({ where: { id: ids.user } });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
