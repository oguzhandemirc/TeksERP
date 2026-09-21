// =============================================================================
// Test: İADE KAPSAMI — sevkiyat / sevk partisi lookup + toplu iade (sevkiyat başına belge)
// Çalıştır: DATABASE_URL=… npx tsx scripts/run-all-tests.ts test_return_scope
//
// Doğrulananlar:
//   §1 `lookupShipmentForReturn`: sevkiyatın çuvalları yalnız SHIPPED toplarla, boş çuval
//      listelenmez; sipariş `rollIds` (uyan toplar) taşır; PLANNED sevkiyat 400; numara ve id ile
//   §2 `lookupLotForReturn`: partinin sevk edilmiş çuvalları SEVKİYAT BAŞINA gruplu; havuzdaki
//      (sevk edilmemiş) çuval listelenmez; partisiz/olmayan parti 404
//   §3 `createReturnBatch`: iki grup → iki `returnGroupId`, iki RETURN_DISPATCH belgesi, tek neden
//   §4 batch: 2. grup düşerse 1. grubun belgesi KALIR, `failed.index=1`, `skipped` sayılır
//   §5 batch: 1. grup düşerse hata aynen fırlar (hiçbir şey yazılmadı)
//   §6 (DB'siz) `specMatch` tek kaynak — helper `return.service`ten import eder, kopya yok
//
// ⭐ NEGATİF SONDA (2026-09-22, ölçüldü):
//   (a) helper'da `sacks.filter((s) => s.rolls.length > 0)` kaldırıldı → §1 "boş çuval listelenmez" ❌
//   (b) `createReturnBatch` döngüsünde `if (i === 0) throw err` silindi → §5 ❌
//   Geri alındığında yeşil.
// =============================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";

import prisma, { pool } from "../src/lib/prisma";
import { returnService } from "../src/services/return.service";
import { lookupLotForReturn, lookupShipmentForReturn } from "../src/services/helpers/return-scope.helper";
import { ensureTestAdmin } from "./fixture-test-user";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { firstGrade } from "./fixture-quality-grade";
import { cleanupTestCustomers } from "./fixture-customer-cleanup";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
async function err(fn: () => Promise<unknown>): Promise<string | null> {
  try { await fn(); return null; } catch (e) { return (e as Error).message; }
}

type Group = { shipment: { id: string; shipmentNo: string }; sacks: { id: string; sackNo: string; rolls: { id: string }[] }[]; orders: { id: string; rollIds: string[] }[] };

async function main() {
  // ---- §6 (DB'siz) ----
  const helperSrc = readFileSync(join(__dirname, "../src/services/helpers/return-scope.helper.ts"), "utf-8");
  check("§6 specMatch tek kaynak (helper import eder, kopya yok)",
    /import \{ specMatch \} from "\.\.\/return\.service"/.test(helperSrc) && !/function specMatch\(/.test(helperSrc));

  const ts = Date.now();
  const admin = await ensureTestAdmin();
  const grade = await firstGrade();
  const customer = await prisma.customer.create({
    data: { code: `TST-RSC-${ts}`, name: `TEST İADE KAPSAMI ${ts}` }, select: { id: true },
  });
  const item = await prisma.item.create({ data: { code: `TST-RSC-I-${ts}`, name: `KAPSAM KUMAŞ ${ts}`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  const color = await prisma.color.create({ data: { code: `TST-RSC-C-${ts}`, name: `KAPSAM EKRU ${ts}` }, select: { id: true } });
  const order = await prisma.order.create({ data: { orderNumber: `TEST-RSC-O-${ts}`, customerId: customer.id, status: "APPROVED" }, select: { id: true } });
  await prisma.orderLine.create({ data: { orderId: order.id, itemId: item.id, colorId: color.id, quantity: 500, width: 150 } });

  const mkShipment = (suffix: string, status: "DISPATCHED" | "PLANNED") =>
    prisma.shipment.create({
      data: { shipmentNo: `TEST-RSC-${suffix}-${ts}`, customerId: customer.id, status, destination: "DOMESTIC", ...(status === "DISPATCHED" ? { dispatchedAt: new Date() } : {}) },
      select: { id: true, shipmentNo: true },
    });
  const shA = await mkShipment("A", "DISPATCHED");
  const shB = await mkShipment("B", "DISPATCHED");
  const shP = await mkShipment("P", "PLANNED");
  await prisma.shipmentOrder.create({ data: { shipmentId: shA.id, orderId: order.id, isActive: true } });

  const lot = await prisma.packingGroup.create({ data: { customerId: customer.id, name: `TEST-RSC-LOT-${ts}`, status: "CLOSED" }, select: { id: true } });
  const mkSack = (suffix: string, shipmentId: string | null, seq: number | null, packageNo: number | null) =>
    prisma.sack.create({
      data: { sackNo: `TEST-RSC-SK-${suffix}-${ts}`, customerId: customer.id, shipmentId, seq, packingGroupId: lot.id, packageNo },
      select: { id: true, sackNo: true },
    });
  const sA1 = await mkSack("A1", shA.id, 1, 1);
  const sA2 = await mkSack("A2", shA.id, 2, 2); // tüm topları iade alınmış olacak → listelenmez
  const sB1 = await mkSack("B1", shB.id, 1, 3);
  const sPool = await mkSack("POOL", null, null, 4); // havuzda — iade konusu değil
  const sP = await mkSack("P", shP.id, 1, 5); // planlı

  let n = 0;
  const mkRoll = async (shipmentId: string | null, sackId: string, status: "SHIPPED" | "WAREHOUSE", width = 150) => {
    n += 1;
    return prisma.roll.create({
      data: {
        barcode: `TEST-RSC-R${n}-${ts}`, itemId: item.id, colorId: color.id, status, currentQty: 50, initialQty: 50, width,
        qualityGrade: grade.code, qualityGradeId: grade.id, entrySource: "SUPPLIER_RECEIPT", shipmentId, sackId, warehouseId: await fixtureWarehouseId(),
      },
      select: { id: true },
    });
  };
  const a1 = await mkRoll(shA.id, sA1.id, "SHIPPED");
  const a2 = await mkRoll(shA.id, sA1.id, "SHIPPED", 160); // sipariş satırına UYMAZ (en 160)
  await mkRoll(shA.id, sA2.id, "WAREHOUSE"); // "iade alınmış" gibi — SHIPPED değil
  const b1 = await mkRoll(shB.id, sB1.id, "SHIPPED");
  await mkRoll(null, sPool.id, "WAREHOUSE");
  await mkRoll(shP.id, sP.id, "WAREHOUSE");

  try {
    // ---- §1 sevkiyat lookup ----
    const byNo = (await lookupShipmentForReturn({ shipmentNo: shA.shipmentNo })).data as Group;
    check("§1 sevkiyat numarasıyla bulundu, yalnız SHIPPED toplu çuvallar", byNo.sacks.length === 1 && byNo.sacks[0]!.sackNo === sA1.sackNo, byNo.sacks.map((s) => s.sackNo).join(","));
    check("§1 ⭐ boş (iade edilmiş) çuval listelenmez", !byNo.sacks.some((s) => s.sackNo === sA2.sackNo));
    check("§1 çuvalın 2 SHIPPED topu", byNo.sacks[0]!.rolls.length === 2);
    const o = byNo.orders.find((x) => x.id === order.id);
    check("§1 ⭐ sipariş uyan top id'leriyle döner (en 150 uyar, 160 uymaz)", !!o && o.rollIds.length === 1 && o.rollIds[0] === a1.id, JSON.stringify(o?.rollIds));
    const byId = (await lookupShipmentForReturn({ shipmentId: shA.id })).data as Group;
    check("§1 id ile aynı sonuç", byId.shipment.id === shA.id && byId.sacks.length === 1);
    const plannedErr = await err(() => lookupShipmentForReturn({ shipmentId: shP.id }));
    check("§1 PLANNED sevkiyat 400", plannedErr !== null && /sevk edilmemiş/i.test(plannedErr), String(plannedErr));

    // ---- §2 parti lookup ----
    const lotRes = (await lookupLotForReturn(lot.id)).data as { lot: { id: string }; groups: Group[] };
    check("§2 ⭐ sevkiyat başına gruplu (A ve B)", lotRes.groups.length === 2 && lotRes.groups.every((g) => [shA.id, shB.id].includes(g.shipment.id)), String(lotRes.groups.length));
    const allSacks = lotRes.groups.flatMap((g) => g.sacks.map((s) => s.sackNo));
    check("§2 ⭐ havuz ve planlı çuval listelenmez", !allSacks.includes(sPool.sackNo) && !allSacks.includes(sP.sackNo), allSacks.join(","));
    const lotMissing = await err(() => lookupLotForReturn("00000000-0000-4000-8000-000000000000"));
    check("§2 olmayan parti 404", lotMissing !== null && /bulunamadı/i.test(lotMissing));

    // ---- §3 batch: iki sevkiyat → iki belge ----
    const batch = (await returnService.createReturnBatch(
      { groups: [{ rollIds: [a1.id], orderId: order.id }, { rollIds: [b1.id] }], reasonText: "TEST kapsam iade" },
      admin.id,
    )).data as { done: { returnGroupId: string; rollCount: number }[]; failed: unknown; skipped: number; rollCount: number };
    check("§3 ⭐ iki grup → iki iade, 2 top, hata yok", batch.done.length === 2 && batch.rollCount === 2 && batch.failed === null && batch.skipped === 0);
    const docs = await prisma.printedDocument.count({ where: { docType: "RETURN_DISPATCH", sourceId: { in: batch.done.map((d) => d.returnGroupId) } } });
    check("§3 ⭐ sevkiyat başına bir RETURN_DISPATCH belgesi (2)", docs === 2, String(docs));
    const a1Row = await prisma.rollReturn.findFirst({ where: { rollId: a1.id }, select: { fromShipmentId: true, orderId: true, prevSackId: true } });
    check("§3 satır sevkiyatına + siparişine + çuvalına bağlı", a1Row?.fromShipmentId === shA.id && a1Row?.orderId === order.id && a1Row?.prevSackId === sA1.id);

    // ---- §4 batch: ikinci grup düşer (a2 zaten... hayır: b1 artık SHIPPED değil) ----
    const partial = (await returnService.createReturnBatch(
      { groups: [{ rollIds: [a2.id] }, { rollIds: [b1.id] }], reasonText: "TEST kısmi" },
      admin.id,
    )).data as { done: unknown[]; failed: { index: number; message: string } | null; skipped: number };
    check("§4 ⭐ 1. grup alındı, 2. düştü (failed.index=1), skipped 0", partial.done.length === 1 && partial.failed?.index === 1 && partial.skipped === 0, JSON.stringify(partial.failed));

    // ---- §5 batch: ilk grup düşerse hata fırlar ----
    const firstErr = await err(() => returnService.createReturnBatch({ groups: [{ rollIds: [b1.id] }, { rollIds: [a1.id] }], reasonText: "TEST ilk düşer" }, admin.id));
    check("§5 ⭐ ilk grup reddi hata olarak fırlar (yazma yok)", firstErr !== null, String(firstErr));
  } finally {
    const returnIds = (await prisma.rollReturn.findMany({ where: { customerId: customer.id }, select: { id: true } })).map((r) => r.id);
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: returnIds } } }).catch(() => {});
    await prisma.warehouseMovement.deleteMany({ where: { rollReturnId: { in: returnIds } } }).catch(() => {});
    await prisma.rollReturn.deleteMany({ where: { customerId: customer.id } }).catch(() => {});
    await prisma.warehouseMovement.deleteMany({ where: { roll: { itemId: item.id } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { itemId: item.id } }).catch(() => {});
    await prisma.sack.deleteMany({ where: { customerId: customer.id } }).catch(() => {});
    await prisma.packingGroup.deleteMany({ where: { id: lot.id } }).catch(() => {});
    await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: [shA.id, shB.id, shP.id] } } }).catch(() => {});
    await prisma.shipmentEvent.deleteMany({ where: { shipmentId: { in: [shA.id, shB.id, shP.id] } } }).catch(() => {});
    await prisma.shipment.deleteMany({ where: { id: { in: [shA.id, shB.id, shP.id] } } }).catch(() => {});
    await prisma.orderLine.deleteMany({ where: { orderId: order.id } }).catch(() => {});
    await prisma.order.deleteMany({ where: { id: order.id } }).catch(() => {});
    await prisma.color.deleteMany({ where: { id: color.id } }).catch(() => {});
    await prisma.item.deleteMany({ where: { id: item.id } }).catch(() => {});
    await cleanupTestCustomers([customer.id]);
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
