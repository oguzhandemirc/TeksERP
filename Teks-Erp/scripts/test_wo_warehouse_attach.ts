// =============================================================================
// Faz 4 — WO artık WAREHOUSE/A1_STOCK topu da alır ("her işlem final üretir": bir depo
// topu yeni WO'ya sokulabilir). Doğrulananlar:
//   1) WAREHOUSE (renkli) top → attach → IN_PRODUCTION → detach → WAREHOUSE'a döner (F1).
//   2) STOCK (renksiz/ham) top → attach → IN_PRODUCTION → detach → STOCK'a döner (F1).
//   3) Çuvaldaki WAREHOUSE top → attach REDDEDİLİR (F5), top çuvalda WAREHOUSE kalır.
// Koşum: npx tsx scripts/test_wo_warehouse_attach.ts
// =============================================================================
import prisma from "../src/lib/prisma";
import { roleGrade } from "./fixture-quality-grade";
import { WorkOrderService } from "../src/services/workorder.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { RollStatus } from "@prisma/client";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const svc = new WorkOrderService();
const cards = new TravelerCardService();

let ITEM = "", GRADE = "", ADMIN = "", COLOR = "", ST_KURSUN = "";
let GRADE_CODE = "";
const woIds: string[] = [];
const sackIds: string[] = [];
const rollIds: string[] = [];
let bc = 0;
// ⚠️ `.toUpperCase()` load-bearing: `toString(16)` küçük harf hex üretir, oysa
// GERÇEK barkodlar her zaman BÜYÜK harftir (kod üretimi + canlı veride 0 istisna)
// ve okutma yolu artık girdiyi büyütüyor (normalizeScanCode, 2026-08-17). Küçük
// harfli fixture, üretimde var olmayan bir durumu sınayıp testi yanlış yere
// kırmızıya düşürüyordu. Diğer ~20 test dosyası bu konvansiyonu zaten taşıyor.
const barcode = (): string => `TST-WHA-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase()}${bc++}`;

async function fixtures(): Promise<void> {
  const need = (v: { id: string } | null, l: string): string => { if (!v) throw new Error(`fixture eksik: ${l}`); return v.id; };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS");
  const _gradeRow = await roleGrade("FIRST");
  GRADE = _gradeRow.id;
  GRADE_CODE = _gradeRow.code;
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin");
  COLOR = need(await prisma.color.findFirst({ where: { isActive: true }, select: { id: true } }), "color");
  ST_KURSUN = need(await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } }), "KURSUN_KK2");
}

async function makeRoll(status: RollStatus, colorId: string | null): Promise<{ id: string; barcode: string }> {
  const code = barcode();
  const r = await prisma.roll.create({
    data: {
      barcode: code, itemId: ITEM, colorId, initialQty: 100, currentQty: 100,
      status, qualityGrade: GRADE_CODE, qualityGradeId: GRADE, width: 250, createdById: ADMIN,
    },
    select: { id: true },
  });
  rollIds.push(r.id);
  return { id: r.id, barcode: code };
}

async function makeWo(): Promise<string> {
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-WHA-${Date.now()}${Math.floor(Math.random() * 1000)}`, type: "STOCK_PRODUCTION",
      status: "PLANNED", width: 250, targetQuantity: 1000, targetItemId: ITEM,
      steps: { create: [{ stationId: ST_KURSUN, stepSequence: 1, status: "PENDING" as const }] },
    },
    select: { id: true },
  });
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  woIds.push(wo.id);
  return wo.id;
}

const statusOf = async (id: string): Promise<RollStatus> =>
  (await prisma.roll.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

async function main(): Promise<void> {
  await fixtures();
  try {
    // 1) WAREHOUSE (renkli) → attach → IN_PRODUCTION → detach → WAREHOUSE
    {
      const wo = await makeWo();
      const r = await makeRoll(RollStatus.WAREHOUSE, COLOR);
      await svc.attachRolls(wo, [r.barcode], ADMIN);
      check("1a: WAREHOUSE top attach → IN_PRODUCTION", (await statusOf(r.id)) === RollStatus.IN_PRODUCTION, await statusOf(r.id));
      await svc.detachRolls(wo, [r.id], ADMIN);
      check("1b: detach → WAREHOUSE'a döndü (F1: renkli→depo)", (await statusOf(r.id)) === RollStatus.WAREHOUSE, await statusOf(r.id));
    }

    // 2) STOCK (renksiz/ham) → attach → IN_PRODUCTION → detach → STOCK
    {
      const wo = await makeWo();
      const r = await makeRoll(RollStatus.STOCK, null);
      await svc.attachRolls(wo, [r.barcode], ADMIN);
      check("2a: STOCK top attach → IN_PRODUCTION", (await statusOf(r.id)) === RollStatus.IN_PRODUCTION, await statusOf(r.id));
      await svc.detachRolls(wo, [r.id], ADMIN);
      check("2b: detach → STOCK'a döndü (F1: renksiz→ham)", (await statusOf(r.id)) === RollStatus.STOCK, await statusOf(r.id));
    }

    // 3) Çuvaldaki WAREHOUSE top → attach REDDEDİLİR (F5)
    {
      const wo = await makeWo();
      const r = await makeRoll(RollStatus.WAREHOUSE, COLOR);
      const sack = await prisma.sack.create({ data: { sackNo: `TST-WHA-SACK-${Date.now()}` }, select: { id: true } });
      sackIds.push(sack.id);
      await prisma.roll.update({ where: { id: r.id }, data: { sackId: sack.id } });
      const res = (await svc.attachRolls(wo, [r.barcode], ADMIN)) as { data: { attached: number; errors: string[] } };
      check("3a: çuvaldaki top attach EDİLMEDİ (attached=0)", res.data.attached === 0, `attached=${res.data.attached}`);
      check("3b: hata mesajı çuval/sevkiyat diyor", res.data.errors.some((e) => /çuval|sevk/i.test(e)), JSON.stringify(res.data.errors));
      check("3c: top hâlâ WAREHOUSE (çuvalda)", (await statusOf(r.id)) === RollStatus.WAREHOUSE, await statusOf(r.id));
    }
  } finally {
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { sackId: null } }).catch(() => {});
    await prisma.sack.deleteMany({ where: { id: { in: sackIds } } }).catch(() => {});
    const cardRows = await prisma.travelerCard.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
    await prisma.travelerCardScan.deleteMany({ where: { cardId: { in: cardRows.map((c) => c.id) } } }).catch(() => {});
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } }).catch(() => {});
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => { console.error("HATA:", e); fail++; })
  .finally(async () => { await prisma.$disconnect(); process.exit(fail > 0 ? 1 : 0); });
