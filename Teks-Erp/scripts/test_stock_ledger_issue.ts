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
//   §5 ⭐ İş emri İPTALİ çıkışı BAĞLI tersle kapatır (net 0), top GELDİĞİ YERE döner
//   §6 ⭐ Üretimde değişen metraj AYRI satırdır (PRODUCTION_VARIANCE): 120 → 90 dönüşte
//      ters +120 · fark −30 · stoğa dönen net +90
//   §7 Metraj değişmediyse (stoktan alınan top) fark satırı DOĞMAZ
//   §8 Satırsız (deposuz) top STOCK'a döner, DAMGALANIR, satır doğmaz — beyanlı borç
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
    select: {
      id: true, eventType: true, qty: true, fromWarehouseId: true, toWarehouseId: true, fromStatus: true, toStatus: true,
      reasonCode: true, workOrderStepId: true, reversesMovementId: true,
    },
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

  // ── §5..§8 — İŞ EMRİ İPTALİ: toplar geldiği yere döner ─────────────────────
  // Üretimde metraj ERİYEBİLİR: bağlı ters ileri satırın metrajını geri koyar (120),
  // fark (−30) ayrı olgu olarak yazılır — "top döndü" ile "metraj değişti" iki satır.
  await prisma.roll.update({ where: { id: rWh.id }, data: { currentQty: 90 } });
  await svc.softDelete(woId);

  const whAfter = await rowsOf(rWh.id);
  const ileri = whRows[0];
  const ters = whAfter.find((r) => r.reversesMovementId !== null);
  const fark = whAfter.find((r) => r.reasonCode === STOCK_MOVE_REASON.PRODUCTION_VARIANCE);
  const whRoll = await prisma.roll.findUnique({ where: { id: rWh.id }, select: { status: true, warehouseId: true, currentQty: true } });
  check("§5a ⭐ Depodan alınan top iptalde DEPOYA döndü (ham stoğa değil)",
    whRoll?.status === RollStatus.WAREHOUSE && whRoll?.warehouseId === warehouse.id, `${whRoll?.status}`);
  check("§5b ⭐ Çıkış BAĞLI tersle kapandı — ileri satıra bağlı, ROLL_DETACH, depoya giriş, tam metraj",
    ters?.reversesMovementId === ileri?.id && ters?.reasonCode === STOCK_MOVE_REASON.ROLL_DETACH &&
      ters?.toWarehouseId === warehouse.id && ters?.toStatus === RollStatus.WAREHOUSE && Number(ters?.qty) === 120,
    `bağ=${ters?.reversesMovementId === ileri?.id} sebep=${String(ters?.reasonCode)} qty=${String(ters?.qty)}`);
  check("§6a ⭐ Üretim farkı AYRI satır: ADJUST, depodan ÇIKIŞ, 30 m",
    whAfter.length === 3 && fark?.eventType === WarehouseEventType.ADJUST && fark?.fromWarehouseId === warehouse.id &&
      fark?.toWarehouseId === null && Number(fark?.qty) === 30,
    `satır=${whAfter.length} fark=${String(fark?.qty)}`);
  const net = (rows: typeof whAfter) => rows.reduce((a, r) => a + (r.toWarehouseId ? Number(r.qty) : 0) - (r.fromWarehouseId ? Number(r.qty) : 0), 0);
  check("§6b Stoğa dönen net +90 (ters +120 · fark −30), top 90 m",
    net(whAfter.filter((r) => r.id !== ileri?.id)) === 90 && Number(whRoll?.currentQty) === 90,
    `dönüş neti=${net(whAfter.filter((r) => r.id !== ileri?.id))} top=${String(whRoll?.currentQty)}`);

  const stAfter = await rowsOf(rStock.id);
  const stRoll = await prisma.roll.findUnique({ where: { id: rStock.id }, select: { status: true } });
  check("§7 ⭐ Metraj değişmeyen top: yalnız bağlı ters, fark satırı YOK, STOCK'a döndü",
    stAfter.length === 2 && stAfter.some((r) => r.reversesMovementId === stockRows[0]?.id) &&
      !stAfter.some((r) => r.reasonCode === STOCK_MOVE_REASON.PRODUCTION_VARIANCE) && stRoll?.status === RollStatus.STOCK,
    `satır=${stAfter.length} durum=${stRoll?.status}`);

  // §3 ile karıştırma: o ALMA anında satırsızdı; iptalde bu top STOK KÜMESİNE girer
  // (terfi) ve depo damgalanır, ama bağlanacak ileri satır olmadığı için satır doğmaz.
  const noWhRows = await rowsOf(rNoWh.id);
  const noWhRoll = await prisma.roll.findUnique({ where: { id: rNoWh.id }, select: { status: true, warehouseId: true } });
  check("§8 Satırsız top STOCK'a döndü, DAMGALANDI, satır doğmadı (beyanlı borç)",
    noWhRoll?.status === RollStatus.STOCK && noWhRoll?.warehouseId !== null && noWhRows.length === 0,
    `durum=${noWhRoll?.status} damga=${noWhRoll?.warehouseId !== null} satır=${noWhRows.length}`);

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
  } catch (e) {
    // Yutulan temizlik hatası kalıntı bırakır: bekçi kırmızı verir.
    fail++;
    console.error("❌ TEMİZLİK HATASI — kalıntı kaldı:", e instanceof Error ? e.message.split("\n").map((l) => l.trim()).filter(Boolean).pop() : e);
  }
}

main()
  .catch((e) => { console.error("💥 ÇÖKTÜ:", e); fail++; })
  .finally(async () => { await cleanup(); await prisma.$disconnect(); await pool.end(); process.exit(fail > 0 ? 1 : 0); });
