// =============================================================================
// Test: D4-J6 — sevk top listesi (Excel kaynağı) çeki listesiyle AYNI kaynaktan
// Çalıştır: npx tsx scripts/test_sevk_top_listesi.ts
// Kurulum: sevkiyat + 2 çuval + 3 top. T1 müşteri kodlu + gelen belge satırlı (top no),
//          T2 kodsuz/satırsız, T3 satırı ATASINDA olan Tambur çocuğu.
// Doğrulananlar:
//   §1 satır sayısı = sevkteki top sayısı = çeki satır sayısı
//   §2 metre toplamı = çeki listesi toplamı = fiş totals.totalMeters (eşitlik)
//   §3 müşteri kodu olmayan topta boş (null); kodlu topta kod
//   §4 müşteri top no gelen belgeden (atadan miras dahil); işlem metni
//   §5 AST: liste servisi ikinci toplayıcı DEĞİL — prisma/sorgu yok, tek kaynak
//      resolveShipmentDispatchContent; getDispatchReport da aynı kaynaktan
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { ShippingService } from "../src/services/shipping.service";
import { getShipmentRollList } from "../src/services/shipment-roll-list.service";
import { firstGrade } from "./fixture-quality-grade";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

const SRC = path.resolve(__dirname, "../src/services");
const QUERY_METHODS = new Set(["findMany", "findFirst", "findUnique", "findFirstOrThrow", "findUniqueOrThrow", "aggregate", "groupBy", "count", "$queryRaw", "$queryRawUnsafe"]);

/** Dosyadaki sorgu çağrıları + prisma importu + verilen fonksiyona çağrı sayısı. */
function scan(file: string, callee: string): { queries: string[]; prismaImport: boolean; calls: number } {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const out = { queries: [] as string[], prismaImport: false, calls: 0 };
  const walk = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && /lib\/prisma$/.test(n.moduleSpecifier.text)) out.prismaImport = true;
    if (ts.isPropertyAccessExpression(n) && QUERY_METHODS.has(n.name.text)) out.queries.push(n.getText(sf));
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === callee) out.calls++;
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return out;
}

function astChecks(): void {
  const list = scan(path.join(SRC, "shipment-roll-list.service.ts"), "resolveShipmentDispatchContent");
  check("§5a liste servisi prisma import ETMEZ", !list.prismaImport);
  check("§5b liste servisinde sorgu çağrısı YOK (ikinci toplayıcı yasak)", list.queries.length === 0, list.queries.join(", "));
  check("§5c liste servisi içeriği resolveShipmentDispatchContent'ten alır", list.calls === 1, `çağrı=${list.calls}`);
  const ship = readFileSync(path.join(SRC, "shipping.service.ts"), "utf8");
  const body = ship.slice(ship.indexOf("async getDispatchReport("), ship.indexOf("async getDirectShipmentDispatchReport("));
  check("§5d getDispatchReport aynı kaynaktan (resolveShipmentDispatchContent)", body.includes("resolveShipmentDispatchContent(") && !body.includes("collectShipmentDocContent("));
}

async function main() {
  astChecks();
  const ts0 = Date.now();
  const tag = `TEST-J6-${ts0}`;
  const grade = await firstGrade();
  const svc = new ShippingService();

  const customer = await prisma.customer.create({ data: { code: tag, name: `TEST J6 MÜŞTERİ ${ts0}` }, select: { id: true } });
  const item = await prisma.item.create({ data: { code: `${tag}-I`, name: `PERDE TUL ${ts0}`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  const shipment = await prisma.shipment.create({
    data: { shipmentNo: tag, customerId: customer.id, status: "DISPATCHED", destination: "DOMESTIC", dispatchedAt: new Date() },
    select: { id: true },
  });
  const sack1 = await prisma.sack.create({ data: { sackNo: `${tag}-S1`, customerId: customer.id, shipmentId: shipment.id, seq: 1, weightKg: 30 }, select: { id: true } });
  const sack2 = await prisma.sack.create({ data: { sackNo: `${tag}-S2`, customerId: customer.id, shipmentId: shipment.id, seq: 2, weightKg: 20 }, select: { id: true } });
  const rollIds: string[] = [];
  const mkRoll = async (n: number, qty: string, extra: { sackId?: string | null; parentRollId?: string; status?: "SHIPPED" | "TAMBUR_CONSUMED" } = {}) => {
    const r = await prisma.roll.create({
      data: {
        barcode: `${tag}-R${n}`, itemId: item.id, status: extra.status ?? "SHIPPED", currentQty: qty, initialQty: qty,
        qualityGrade: grade.code, entrySource: "SUPPLIER_RECEIPT",
        shipmentId: extra.sackId ? shipment.id : null, sackId: extra.sackId ?? null, parentRollId: extra.parentRollId ?? null,
      },
      select: { id: true },
    });
    rollIds.push(r.id);
    return r.id;
  };
  let noteId: string | null = null;
  try {
    const parent = await mkRoll(0, "200", { status: "TAMBUR_CONSUMED" });
    const r1 = await mkRoll(1, "120.5", { sackId: sack1.id });
    const r2 = await mkRoll(2, "80.25", { sackId: sack1.id });
    const r3 = await mkRoll(3, "99.75", { sackId: sack2.id, parentRollId: parent });
    await prisma.rollCustomerCode.create({ data: { rollId: r1, customerId: customer.id, code: `${tag}-MK1`, source: "BOUND_LABEL", clientToken: randomUUID() } });
    const note = await prisma.customerDeliveryNote.create({ data: { noteNo: `${tag}-N`.slice(0, 32), sourceKind: "MANUAL", processText: "KURŞUN 50G" }, select: { id: true } });
    noteId = note.id;
    await prisma.customerDeliveryNoteLine.create({ data: { noteId, lineNo: 1, senderRollNo: "MT-17", meters: new Prisma.Decimal("120.5"), rollId: r1, status: "ENTERED" } });
    await prisma.customerDeliveryNoteLine.create({ data: { noteId, lineNo: 2, senderRollNo: "MT-18", meters: new Prisma.Decimal("200"), rollId: parent, status: "ENTERED" } });

    const list = (await getShipmentRollList(shipment.id)).data!;
    const rep = (await svc.getDispatchReport(shipment.id)).data as { cekiRows: Array<{ meters: number }>; totals: { totalMeters: number; totalRolls: number } };
    const shippedCount = await prisma.roll.count({ where: { shipmentId: shipment.id } });

    // §1
    check("§1a satır sayısı = sevkteki top sayısı", list.rows.length === shippedCount && shippedCount === 3, `${list.rows.length}/${shippedCount}`);
    check("§1b satır sayısı = çeki satır sayısı", list.rows.length === rep.cekiRows.length);
    check("§1c totals.rollCount = fiş totalRolls", list.totals.rollCount === rep.totals.totalRolls);
    // §2
    const sumRows = list.rows.reduce((a, r) => a.plus(r.meters), new Prisma.Decimal(0));
    const sumCeki = rep.cekiRows.reduce((a, r) => a.plus(r.meters), new Prisma.Decimal(0));
    check("§2a metre toplamı = çeki listesi toplamı", sumRows.equals(sumCeki) && sumRows.equals("300.5"), `${sumRows}/${sumCeki}`);
    check("§2b totals.totalMeters = fiş totalMeters", list.totals.totalMeters === rep.totals.totalMeters && sumRows.equals(list.totals.totalMeters));
    // §3
    const byBarcode = new Map(list.rows.map((r) => [r.barcode, r]));
    const row1 = byBarcode.get(`${tag}-R1`);
    const row2 = byBarcode.get(`${tag}-R2`);
    const row3 = byBarcode.get(`${tag}-R3`);
    check("§3a kodlu topta müşteri kodu", row1?.customerCode === `${tag}-MK1`, String(row1?.customerCode));
    check("§3b kodsuz topta müşteri kodu boş (null)", row2 != null && row2.customerCode === null && row3?.customerCode === null);
    // §4
    check("§4a müşteri top no gelen belgeden", row1?.customerRollNo === "MT-17", String(row1?.customerRollNo));
    check("§4b Tambur çocuğu atanın top no'sunu taşır", row3?.customerRollNo === "MT-18", String(row3?.customerRollNo));
    check("§4c satırsız topta top no boş", row2?.customerRollNo === null);
    check("§4d işlem metni belge başlığından", row1?.processText === "KURŞUN 50G", String(row1?.processText));
    check("§4e desen + sevk no", row1?.desen === `PERDE TUL ${ts0}` && list.shipmentNo === tag);
  } finally {
    await prisma.rollCustomerCode.deleteMany({ where: { rollId: { in: rollIds } } });
    if (noteId) {
      await prisma.customerDeliveryNoteLine.deleteMany({ where: { noteId } });
      await prisma.customerDeliveryNote.delete({ where: { id: noteId } }).catch(() => {});
    }
    await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { parentRollId: null } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.sack.deleteMany({ where: { shipmentId: shipment.id } });
    await prisma.shipment.delete({ where: { id: shipment.id } }).catch(() => {});
    await prisma.item.delete({ where: { id: item.id } }).catch(() => {});
    await prisma.customer.delete({ where: { id: customer.id } }).catch(() => {});
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
