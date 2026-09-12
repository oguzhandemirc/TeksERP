// =============================================================================
// BEKÇİ — TAMBUR FİNALİZE ÇOCUĞU DEPOYA GİRİŞ YAZAR (stok defteri A2-b)
// Çalıştır: npx tsx scripts/run-all-tests.ts stock_ledger_tambur
// =============================================================================
// NEDEN: fabrika kopyasında depoda duran 516 topun (17.696,9 m) girişi YOKTU ve
// hepsi tambur finalize çocuğuydu — bu kurulumda depoya giriş fiilen çocuğun
// DOĞUMUYLA oluyor. Eski gerekçe "çocuğa satır yazmak malı iki kez saydırır"
// diyordu; ölçüm bunu çürüttü: EBEVEYNİN de çıkışı yoktu. Doğru cevap "satır
// yok" değil, ebeveynin stok dışı olduğunu görmek.
//
// ÖLÇÜLENLER
//   §1 Depoya inen her çocuğa TEK PRODUCTION satırı (yön · statü · metraj · sebep)
//   §2 ⭐ EBEVEYN satır YAZMAZ — IN_PRODUCTION'dı, yani zaten stok dışıydı
//   §3 Fire (SCRAP) çocuk satır YAZMAZ
// =============================================================================
import { RollStatus, StationKind, WarehouseEventType } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { TamburService } from "../src/services/tambur.service";
import { STOCK_MOVE_REASON } from "../src/constants/stock-move-reasons";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const TAG = `TEST-SLT-${Date.now()}`;
const rollIds: string[] = [];
let woId = "";
let stepId = "";
let itemId = "";
const gradeIds: string[] = [];

async function main(): Promise<void> {
  console.log("\n=== Tambur finalize çocuğu: depoya giriş defteri ===\n");
  const svc = new TamburService();
  const warehouse = await prisma.warehouse.findFirst({ where: { isDefault: true }, select: { id: true } });
  const station = await prisma.station.findUnique({ where: { code: "TAMBUR_1" }, select: { id: true } });
  if (!warehouse || !station) throw new Error("Fikstür eksik: varsayılan depo / TAMBUR_1 istasyonu");

  itemId = (await prisma.item.create({ data: { code: TAG, name: `${TAG} kumaş`, itemType: "FABRIC" }, select: { id: true } })).id;
  const gWh = await prisma.qualityGrade.create({ data: { code: `${TAG}-W`, name: "Test depo kalitesi", targetStatus: RollStatus.WAREHOUSE }, select: { id: true, code: true } });
  const gScrap = await prisma.qualityGrade.create({ data: { code: `${TAG}-S`, name: "Test fire kalitesi", targetStatus: RollStatus.SCRAP }, select: { id: true, code: true } });
  gradeIds.push(gWh.id, gScrap.id);

  const wo = await prisma.workOrder.create({ data: { workOrderNumber: `${TAG}-WO`, status: "IN_PROGRESS" }, select: { id: true } });
  woId = wo.id;
  const step = await prisma.workOrderStep.create({
    data: { workOrderId: woId, stationId: station.id, stepSequence: 1, status: "ACTIVE" },
    select: { id: true },
  });
  stepId = step.id;
  const parent = await prisma.roll.create({
    data: {
      barcode: `${TAG}-P`, itemId, initialQty: 300, currentQty: 300,
      status: RollStatus.IN_PRODUCTION, currentStepId: stepId,
      warehouseId: warehouse.id, entrySource: "SUPPLIER_RECEIPT",
    },
    select: { id: true },
  });
  rollIds.push(parent.id);
  await prisma.rollMovement.create({ data: { rollId: parent.id, workOrderStepId: stepId, qtyIn: 300 } });

  const res = await svc.finalize({
    rollId: parent.id,
    decisions: [],
    cuts: [
      { length: 200, qualityGrade: gWh.code, relatedErrorIds: [] },
      { length: 100, qualityGrade: gScrap.code, relatedErrorIds: [] },
    ],
    confirmMismatch: true,
  });
  const children = res.data?.splitRolls ?? [];
  children.forEach((c) => rollIds.push(c.id));
  check("§0 Kurulum: iki çocuk doğdu", children.length === 2, `çocuk=${children.length}`);

  const whChild = children.find((c) => c.status === RollStatus.WAREHOUSE);
  const scrapChild = children.find((c) => c.status === RollStatus.SCRAP);
  const rowsOf = async (id: string) =>
    prisma.warehouseMovement.findMany({
      where: { rollId: id },
      select: { eventType: true, qty: true, fromWarehouseId: true, toWarehouseId: true, toStatus: true, reasonCode: true },
    });

  const whRows = whChild ? await rowsOf(whChild.id) : [];
  check("§1a Depoya inen çocuğa TEK satır yazıldı", whRows.length === 1, `satır=${whRows.length}`);
  check(
    "§1b ⭐ Satır PRODUCTION, yön GİRİŞ, statü ve metraj doğru",
    whRows[0]?.eventType === WarehouseEventType.PRODUCTION &&
      whRows[0]?.toWarehouseId === warehouse.id && whRows[0]?.fromWarehouseId === null &&
      whRows[0]?.toStatus === RollStatus.WAREHOUSE && Number(whRows[0]?.qty) === 200,
    `${whRows[0]?.eventType}/${whRows[0]?.toStatus}/${String(whRows[0]?.qty)}`,
  );
  check("§1c Sebep kodu TAMBUR_FINALIZE", whRows[0]?.reasonCode === STOCK_MOVE_REASON.TAMBUR_FINALIZE, String(whRows[0]?.reasonCode));
  check("§2 ⭐ EBEVEYN satır YAZMADI (stok dışıydı — çift sayım yok)", (await rowsOf(parent.id)).length === 0);
  check("§3 Fire (SCRAP) çocuk satır YAZMADI", scrapChild ? (await rowsOf(scrapChild.id)).length === 0 : false);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  try {
    if (rollIds.length) {
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.systemLog.deleteMany({ where: { recordId: { in: rollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    }
    if (stepId) await prisma.workOrderStep.deleteMany({ where: { id: stepId } });
    if (woId) { await prisma.systemLog.deleteMany({ where: { recordId: woId } }); await prisma.workOrder.deleteMany({ where: { id: woId } }); }
    if (gradeIds.length) await prisma.qualityGrade.deleteMany({ where: { id: { in: gradeIds } } });
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } });
    console.log("(test verisi temizlendi)");
  } catch (e) { console.error("cleanup hata:", e instanceof Error ? e.message : e); }
}

main()
  .catch((e) => { console.error("💥 ÇÖKTÜ:", e); fail++; })
  .finally(async () => { await cleanup(); await prisma.$disconnect(); await pool.end(); process.exit(fail > 0 ? 1 : 0); });
