// =============================================================================
// BEKÇİ — ÜRETİMDEN DEPOYA GİRİŞ DEFTERE YAZILIR (stok defteri A2-a)
// Çalıştır: npx tsx scripts/run-all-tests.ts stock_ledger_production
// =============================================================================
// NEDEN: depo defteri "konum defteri"ydi ve üretimden depoya inen mal için satır
// YAZMIYORDU. Ölçüm (fabrika kopyası): depoda duran 516 topun girişi yoktu.
// Fabrika verisi bu yolları SINAYAMAZ (o kurulumda her top final statüde doğmuş),
// bu yüzden kapsama yalnız fikstürle kurulur.
//
// ÖLÇÜLENLER
//   §1 Son adım finalize: depoya inen topa PRODUCTION satırı (yön, statü, metraj, sebep)
//   §2 Fire (SCRAP) satır YAZMAZ — top üretime girerken zaten stoktan çıkmıştı
//   §3 Deposuz top satır YAZMAZ (yazılacak depo yok; sessiz atlama BURADA meşru)
//   §4 Dispozisyon motoru (WO kapanış) depoya indirirken PRODUCTION satırı yazar
//   §5 İptal (CANCELLED) satır YAZMAZ — stok dışından stok dışına
// =============================================================================
import { Prisma, RollForm, RollStatus, WarehouseEventType } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { finalizeRollsAtLastStep } from "../src/services/helpers/roll-finalize.helper";
import { applyRollDispositionsTx } from "../src/services/helpers/roll-disposition.helper";
import { STOCK_MOVE_REASON } from "../src/constants/stock-move-reasons";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const TAG = `TEST-SLP-${Date.now()}`;
const rollIds: string[] = [];
let itemId = "";
let gradeWhId = "";
let gradeScrapId = "";

async function movementsOf(rollId: string) {
  return prisma.warehouseMovement.findMany({
    where: { rollId },
    select: { eventType: true, qty: true, fromWarehouseId: true, toWarehouseId: true, toStatus: true, reasonCode: true },
  });
}

async function main(): Promise<void> {
  console.log("\n=== Üretimden depoya giriş defteri ===\n");
  const warehouse = await prisma.warehouse.findFirst({ where: { isDefault: true }, select: { id: true } });
  if (!warehouse) throw new Error("Varsayılan depo yok (ensureDefaultWarehouse koşmamış)");

  itemId = (await prisma.item.create({ data: { code: TAG, name: `${TAG} kumaş`, itemType: "FABRIC" }, select: { id: true } })).id;
  const gWh = await prisma.qualityGrade.create({ data: { code: `${TAG}-W`, name: "Test depo kalitesi", targetStatus: RollStatus.WAREHOUSE }, select: { id: true, code: true } });
  const gScrap = await prisma.qualityGrade.create({ data: { code: `${TAG}-S`, name: "Test fire kalitesi", targetStatus: RollStatus.SCRAP }, select: { id: true, code: true } });
  gradeWhId = gWh.id; gradeScrapId = gScrap.id;

  const mkRoll = async (suffix: string, gradeCode: string, gradeId: string, warehouseId: string | null): Promise<string> => {
    const r = await prisma.roll.create({
      data: {
        barcode: `${TAG}-${suffix}`, itemId, initialQty: 100, currentQty: 100,
        status: RollStatus.IN_PRODUCTION, form: RollForm.TOP,
        qualityGrade: gradeCode, qualityGradeId: gradeId, warehouseId,
      },
      select: { id: true },
    });
    rollIds.push(r.id);
    return r.id;
  };

  // ── §1 + §2 + §3 — finalize ───────────────────────────────────────────────
  const rWh = await mkRoll("A", gWh.code, gWh.id, warehouse.id);
  const rScrap = await mkRoll("B", gScrap.code, gScrap.id, warehouse.id);
  const rNoWh = await mkRoll("C", gWh.code, gWh.id, null);
  await prisma.$transaction(async (tx) => { await finalizeRollsAtLastStep(tx, [rWh, rScrap, rNoWh]); });

  const mWh = await movementsOf(rWh);
  check("§1a Depoya inen topa TEK satır yazıldı", mWh.length === 1, `satır=${mWh.length}`);
  check(
    "§1b ⭐ Satır PRODUCTION, yön GİRİŞ, statü ve metraj doğru",
    mWh[0]?.eventType === WarehouseEventType.PRODUCTION &&
      mWh[0]?.toWarehouseId === warehouse.id && mWh[0]?.fromWarehouseId === null &&
      mWh[0]?.toStatus === RollStatus.WAREHOUSE && Number(mWh[0]?.qty) === 100,
    `${mWh[0]?.eventType}/${mWh[0]?.toStatus}/${String(mWh[0]?.qty)}`,
  );
  check("§1c Sebep kodu PRODUCTION_RECEIPT", mWh[0]?.reasonCode === STOCK_MOVE_REASON.PRODUCTION_RECEIPT, String(mWh[0]?.reasonCode));
  check("§2 ⭐ Fire (SCRAP) satır YAZMADI", (await movementsOf(rScrap)).length === 0);
  check("§3 Deposuz top satır YAZMADI", (await movementsOf(rNoWh)).length === 0);

  // ── §4 + §5 — dispozisyon motoru ──────────────────────────────────────────
  const rDisp = await mkRoll("D", gWh.code, gWh.id, warehouse.id);
  const rCancel = await mkRoll("E", gWh.code, gWh.id, warehouse.id);
  const snap = (id: string) => ({ id, barcode: null, status: RollStatus.IN_PRODUCTION, currentQty: new Prisma.Decimal(100), weightKg: null });
  await prisma.$transaction(async (tx) => {
    await applyRollDispositionsTx(tx, {
      origin: "WO_CLOSE", reason: "bekçi: depoya indir",
      rolls: [snap(rDisp)], dispositions: [{ rollId: rDisp, action: "WAREHOUSE", qualityGradeId: gWh.id }],
    });
  });
  await prisma.$transaction(async (tx) => {
    await applyRollDispositionsTx(tx, {
      origin: "WO_CANCEL", reason: "bekçi: iptal",
      rolls: [snap(rCancel)], dispositions: [{ rollId: rCancel, action: "CANCELLED" }],
    });
  });
  const mDisp = await movementsOf(rDisp);
  check(
    "§4 ⭐ Dispozisyon depoya indirince PRODUCTION satırı yazdı",
    mDisp.length === 1 && mDisp[0]?.eventType === WarehouseEventType.PRODUCTION &&
      mDisp[0]?.toStatus === RollStatus.WAREHOUSE && mDisp[0]?.reasonCode === STOCK_MOVE_REASON.DISPOSITION,
    `satır=${mDisp.length} sebep=${String(mDisp[0]?.reasonCode)}`,
  );
  check("§5 ⭐ İptal satır YAZMADI (stok dışından stok dışına)", (await movementsOf(rCancel)).length === 0);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  try {
    if (rollIds.length) {
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    }
    if (gradeWhId) await prisma.qualityGrade.deleteMany({ where: { id: { in: [gradeWhId, gradeScrapId] } } });
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } });
    console.log("(test verisi temizlendi)");
  } catch (e) { console.error("cleanup hata:", e instanceof Error ? e.message : e); }
}

main()
  .catch((e) => { console.error("💥 ÇÖKTÜ:", e); fail++; })
  .finally(async () => { await cleanup(); await prisma.$disconnect(); await pool.end(); process.exit(fail > 0 ? 1 : 0); });
