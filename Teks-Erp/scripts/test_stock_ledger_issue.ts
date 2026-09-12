// =============================================================================
// BEKÇİ — ÜRETİME ALMA DEPODAN ÇIKIŞ YAZAR (stok defteri A2-c)
// Çalıştır: npx tsx scripts/run-all-tests.ts stock_ledger_issue
// =============================================================================
// NEDEN: depodaki mal iş emrine alınınca raftan İNİYOR ama defter bunu
// görmüyordu. Giriş tarafı (A2-a/A2-b) yazılıp çıkış tarafı yazılmasaydı defter
// tek yönlü şişerdi — "ileri yolu yazıp geri yolu yazmayan defter, hiç
// olmayandan daha tehlikelidir" (defter.md).
//
// ÖLÇÜLENLER
//   §1 WAREHOUSE topu üretime alınınca TEK çıkış satırı (yön · statü · metraj · sebep)
//   §2 STOCK topu da çıkış yazar — fromStatus topun GERÇEK önceki statüsüdür
//   §3 Deposuz top satır YAZMAZ
//   §4 ⭐ Satır claim ÖNCESİ durumu taşır: fromStatus IN_PRODUCTION DEĞİLDİR
//   §5 ⭐ İş emrinden ÇIKARMA (detach) GİRİŞ yazar — çıkışın karşılığı
//   §6 ⭐ Giriş metrajı ÇIKARMA ANINDAKİ metrajdır (ters kayıt olsaydı eski
//      metraj geri yazılır ve üretimde eriyen mal stoğa fazla girerdi)
//   §7 Deposuz top çıkarmada da satır YAZMAZ
// =============================================================================
import { RollStatus, WarehouseEventType } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
import { STOCK_MOVE_REASON } from "../src/constants/stock-move-reasons";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const TAG = `TEST-SLI-${Date.now()}`;
const rollIds: string[] = [];
let woId = "";
let stepId = "";
let itemId = "";

async function rowsOf(rollId: string) {
  return prisma.warehouseMovement.findMany({
    where: { rollId },
    select: { eventType: true, qty: true, fromWarehouseId: true, toWarehouseId: true, fromStatus: true, reasonCode: true, workOrderStepId: true },
  });
}

async function main(): Promise<void> {
  console.log("\n=== Üretime alma: depodan çıkış defteri ===\n");
  const svc = new WorkOrderService();
  const warehouse = await prisma.warehouse.findFirst({ where: { isDefault: true }, select: { id: true } });
  const station = await prisma.station.findUnique({ where: { code: "KK1_1" }, select: { id: true } });
  if (!warehouse || !station) throw new Error("Fikstür eksik: varsayılan depo / KK1_1 istasyonu");

  itemId = (await prisma.item.create({ data: { code: TAG, name: `${TAG} kumaş`, itemType: "FABRIC" }, select: { id: true } })).id;
  const wo = await prisma.workOrder.create({ data: { workOrderNumber: `${TAG}-WO`, status: "PLANNED" }, select: { id: true } });
  woId = wo.id;
  stepId = (await prisma.workOrderStep.create({
    data: { workOrderId: woId, stationId: station.id, stepSequence: 1, status: "PENDING" },
    select: { id: true },
  })).id;

  const mk = async (suffix: string, status: RollStatus, warehouseId: string | null): Promise<{ id: string; barcode: string }> => {
    const barcode = `${TAG}-${suffix}`;
    const r = await prisma.roll.create({
      data: { barcode, itemId, initialQty: 120, currentQty: 120, status, warehouseId, entrySource: "SUPPLIER_RECEIPT" },
      select: { id: true },
    });
    rollIds.push(r.id);
    return { id: r.id, barcode };
  };

  const rWh = await mk("A", RollStatus.WAREHOUSE, warehouse.id);
  const rStock = await mk("B", RollStatus.STOCK, warehouse.id);
  const rNoWh = await mk("C", RollStatus.WAREHOUSE, null);

  const res = await svc.attachRolls(woId, [rWh.barcode, rStock.barcode, rNoWh.barcode]);
  check("§0 Kurulum: üç top da iş emrine alındı", res.data?.attached === 3, `alınan=${res.data?.attached} hata=${(res.data?.errors ?? []).join("|")}`);

  const whRows = await rowsOf(rWh.id);
  check("§1a Depodaki topa TEK çıkış satırı yazıldı", whRows.length === 1, `satır=${whRows.length}`);
  check(
    "§1b ⭐ Satır PRODUCTION, yön ÇIKIŞ, metraj ve adım doğru",
    whRows[0]?.eventType === WarehouseEventType.PRODUCTION &&
      whRows[0]?.fromWarehouseId === warehouse.id && whRows[0]?.toWarehouseId === null &&
      Number(whRows[0]?.qty) === 120 && whRows[0]?.workOrderStepId === stepId,
    `${whRows[0]?.eventType}/${String(whRows[0]?.qty)}`,
  );
  check("§1c Sebep kodu PRODUCTION_ISSUE", whRows[0]?.reasonCode === STOCK_MOVE_REASON.PRODUCTION_ISSUE, String(whRows[0]?.reasonCode));
  check("§4 ⭐ fromStatus claim ÖNCESİ statü (WAREHOUSE), IN_PRODUCTION değil", whRows[0]?.fromStatus === RollStatus.WAREHOUSE, String(whRows[0]?.fromStatus));

  const stockRows = await rowsOf(rStock.id);
  check("§2 STOCK topu da çıkış yazdı ve fromStatus STOCK", stockRows.length === 1 && stockRows[0]?.fromStatus === RollStatus.STOCK, `satır=${stockRows.length} statü=${String(stockRows[0]?.fromStatus)}`);
  check("§3 Deposuz top satır YAZMADI", (await rowsOf(rNoWh.id)).length === 0);

  // ── §5..§7 — İŞ EMRİNDEN ÇIKARMA (detach) ─────────────────────────────────
  // Çıkışın karşılığı yazılmazsa iş emrinden çıkarılan top defterde sonsuza dek
  // "üretimde" kalır ve depo bakiyesi eksik görünür.
  // ⚠️ Metraj üretimde ERİTİLİYOR: ters kayıt yazılsaydı 120 m geri konurdu,
  // oysa rafa dönen 90 m. Bu, "detach ters kayıt değil yeni ileri satırdır"
  // kararının ölçülebilir gerekçesi.
  await prisma.roll.update({ where: { id: rWh.id }, data: { currentQty: 90 } });
  const det = await svc.detachRolls(woId, [rWh.id, rNoWh.id]);
  check("§5a Kurulum: iki top iş emrinden çıkarıldı", det.data?.detached === 2, `çıkarılan=${det.data?.detached} hata=${(det.data?.errors ?? []).join("|")}`);

  const whAfter = await rowsOf(rWh.id);
  const giris = whAfter.find((r) => r.toWarehouseId !== null);
  check(
    "§5b ⭐ Çıkarma GİRİŞ satırı yazdı — yön, hedef depo ve sebep doğru",
    whAfter.length === 2 && giris?.toWarehouseId === warehouse.id &&
      giris?.fromWarehouseId === null && giris?.reasonCode === STOCK_MOVE_REASON.WO_DETACH &&
      giris?.eventType === WarehouseEventType.PRODUCTION,
    `satır=${whAfter.length} sebep=${String(giris?.reasonCode)}`,
  );
  check(
    "§6 ⭐ Giriş metrajı ÇIKARMA anındaki metraj (120 değil 90)",
    Number(giris?.qty) === 90,
    `qty=${String(giris?.qty)}`,
  );
  const netWh = whAfter.reduce((a, r) => a + (r.toWarehouseId ? Number(r.qty) : 0) - (r.fromWarehouseId ? Number(r.qty) : 0), 0);
  check("§6b Net = üretimde eriyen fark (−120 + 90 = −30)", netWh === -30, `net=${netWh}`);
  check("§7 Deposuz top çıkarmada da satır YAZMADI", (await rowsOf(rNoWh.id)).length === 0);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  try {
    if (rollIds.length) {
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.systemLog.deleteMany({ where: { recordId: { in: rollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    }
    if (woId) {
      await prisma.batch.deleteMany({ where: { workOrderId: woId } });
      await prisma.workOrderStep.deleteMany({ where: { workOrderId: woId } });
      await prisma.systemLog.deleteMany({ where: { recordId: woId } });
      await prisma.workOrder.deleteMany({ where: { id: woId } });
    }
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } });
    console.log("(test verisi temizlendi)");
  } catch (e) { console.error("cleanup hata:", e instanceof Error ? e.message : e); }
}

main()
  .catch((e) => { console.error("💥 ÇÖKTÜ:", e); fail++; })
  .finally(async () => { await cleanup(); await prisma.$disconnect(); await pool.end(); process.exit(fail > 0 ? 1 : 0); });
