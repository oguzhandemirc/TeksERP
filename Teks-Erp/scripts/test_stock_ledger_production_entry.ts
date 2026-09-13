// =============================================================================
// BEKÇİ — ÜRETİMDEN DEPOYA GİRİŞ: `cutOpenFabric` çocuğu (TAMBUR_CUT) · `rescueStuckRoll` (RESCUE)
// Çalıştır: npx tsx scripts/run-all-tests.ts stock_ledger_production_entry
// =============================================================================
// NEDEN: K kümesinin GİRİŞ ikilisi (hüküm `TAMBUR-GERI-ALMA-HUKUM-2026-09-13.md` §11,
// 01 kalemi). İki yol topu stok kümesine SOKUYOR ama deftere satır yazmıyordu:
//   • açık kumaştan per-cut kesim çocuğu WAREHOUSE doğuyordu, satırsız ("kesim
//     çocuğuna satır yazılmaz" kuralı DEPO kesimine aitti — orada ebeveyn de stokta;
//     burada ebeveyn IN_PRODUCTION, mal stok kümesine İLK KEZ giriyor);
//   • istasyonda takılı topun kurtarılması IN_PRODUCTION → WAREHOUSE, satırsız.
// Fabrika kopyası (2026-09-11 damgası, ölçüldü 2026-09-14): ufuk (2026-09-13) sonrası
// doğan cutOpenFabric çocuğu 0 · ufuk sonrası kurtarma 0 ⇒ backfill YOK; tüm-zaman
// satırsız çocuk 2.912 — defter-öncesi miras, kullanıcı kararıyla onarılmaz.
//
// ÖLÇÜLENLER
//   §1 cutOpenFabric çocuğu: TEK PRODUCTION girişi, TAMBUR_CUT, metraj = kesim, uç = depo/WAREHOUSE,
//      adım damgası; ebeveyn (IN_PRODUCTION) satır ALMAZ
//   §2 ⭐ geri alma (SINGLE, adım-restore dalı) TAMBUR_UNDO ile BAĞLI tersler — net 0, çocuk CANCELLED,
//      ebeveyn metrajı geri
//   §3 ⭐ kaynak ARŞİVDE dalı (finalizeOpenFabric sonrası SINGLE): çocuk satırı yine terslenir
//   §4 rescue: TEK PRODUCTION girişi, RESCUE, metraj = currentQty, adım damgası, sebep notes'ta
//   §5 0 metrajlı takılı top: kurtarılır ama satır YAZILMAZ (taşınacak mal yok — atlama, hata değil)
//   §6 körlük zemini: fikstür satır üretti
// Negatif sondalar (2026-09-14, cp+sha256 ile geri):
//   · `cutOpenFabric`ten `postStockMove` bloğu silinince: §1a/§1b/§2/§3 kırmızı (ilk sürüm §2'de `s1[0]!.id` ile ÇÖKÜYORDU — dili ölen bekçi; `?.` ile düzeltildi)
//   · `rescueStuckRoll`dan `postStockMove` bloğu silinince: §4/§6 kırmızı
//   · `test_stok_defteri_bag_olcumu §4f` bu commit'le BİLEREK kırmızı (K 2→0, taban 1e'de)
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım.
// =============================================================================
import { RollEntrySource, RollForm, RollStatus, StepStatus, WarehouseEventType } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { TamburService } from "../src/services/tambur.service";
import { TamburUndoService } from "../src/services/tambur-undo.service";
import { InventoryService } from "../src/services/inventory.service";
import { roleGrade } from "./fixture-quality-grade";
import { STOCK_MOVE_REASON } from "../src/constants/stock-move-reasons";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const TAG = `TEST-SLPE-${Date.now()}`;
const rollIds: string[] = [];
const woIds: string[] = [];

interface Satir {
  id: string;
  eventType: WarehouseEventType;
  qty: unknown;
  toWarehouseId: string | null;
  fromWarehouseId: string | null;
  toStatus: RollStatus | null;
  reasonCode: string | null;
  workOrderStepId: string | null;
  reversesMovementId: string | null;
  notes: string | null;
}
async function satirlar(rollId: string): Promise<Satir[]> {
  return prisma.warehouseMovement.findMany({
    where: { rollId },
    orderBy: { createdAt: "asc" },
    select: { id: true, eventType: true, qty: true, toWarehouseId: true, fromWarehouseId: true, toStatus: true, reasonCode: true, workOrderStepId: true, reversesMovementId: true, notes: true },
  });
}
function net(rows: Satir[]): number {
  return rows.reduce((acc, r) => acc + (r.toWarehouseId ? Number(r.qty) : 0) - (r.fromWarehouseId ? Number(r.qty) : 0), 0);
}

/** WO + tek adım + o adımda IN_PRODUCTION top (açık kumaş: barkodsuz, form ACIK). */
async function uretimdeTop(ek: string, stationId: string, qty: number, opts: { acik: boolean; warehouseId: string | null; itemId: string; gradeCode: string }): Promise<{ rollId: string; stepId: string }> {
  const wo = await prisma.workOrder.create({ data: { workOrderNumber: `${TAG}-WO-${ek}`, status: "IN_PROGRESS" }, select: { id: true } });
  woIds.push(wo.id);
  const step = await prisma.workOrderStep.create({ data: { workOrderId: wo.id, stationId, stepSequence: 1, status: StepStatus.ACTIVE }, select: { id: true } });
  const roll = await prisma.roll.create({
    data: {
      barcode: opts.acik ? null : `${TAG}-${ek}`, form: opts.acik ? RollForm.ACIK : RollForm.TOP, itemId: opts.itemId, width: 150,
      initialQty: qty, currentQty: qty, status: RollStatus.IN_PRODUCTION, qualityGrade: opts.gradeCode,
      entrySource: RollEntrySource.SUPPLIER_RECEIPT, currentStepId: step.id, warehouseId: opts.warehouseId,
    },
    select: { id: true },
  });
  rollIds.push(roll.id);
  await prisma.rollMovement.create({ data: { rollId: roll.id, workOrderStepId: step.id, qtyIn: qty } });
  return { rollId: roll.id, stepId: step.id };
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.log(`⛔ ${engel}`); process.exit(1); }
  console.log("\n=== Üretimden depoya GİRİŞ: cutOpenFabric çocuğu · rescue ===\n");
  const tambur = new TamburService();
  const undo = new TamburUndoService();
  const inventory = new InventoryService();
  const warehouse = await prisma.warehouse.findFirst({ where: { isDefault: true }, select: { id: true } });
  const tamburSt = await prisma.station.findUnique({ where: { code: "TAMBUR_1" }, select: { id: true } });
  const kursunSt = await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } });
  if (!warehouse) throw new Error("Varsayılan depo yok (ensureDefaultWarehouse koşmamış)");
  if (!tamburSt || !kursunSt) throw new Error("TAMBUR_1 / KURSUN_KK2 istasyonu yok (seed koşmamış)");
  const itemId = (await prisma.item.create({ data: { code: TAG, name: `${TAG} kumaş`, itemType: "FABRIC" }, select: { id: true } })).id;
  const grade = await roleGrade("FIRST");

  try {
    // ── §1 cutOpenFabric çocuğu ─────────────────────────────────────────────
    const a = await uretimdeTop("A", tamburSt.id, 100, { acik: true, warehouseId: warehouse.id, itemId, gradeCode: grade.code });
    const c1 = await tambur.cutOpenFabric(a.rollId, { lengthMeters: 40, status: "WAREHOUSE", confirmMismatch: true });
    const cocuk = (c1.data as { childRoll: { id: string; status: RollStatus; warehouseId: string | null } }).childRoll;
    rollIds.push(cocuk.id);
    const s1 = await satirlar(cocuk.id);
    check("§1a çocuk TEK PRODUCTION girişi aldı, sebep TAMBUR_CUT, metraj 40", s1.length === 1 && s1[0]!.eventType === WarehouseEventType.PRODUCTION && s1[0]!.reasonCode === STOCK_MOVE_REASON.TAMBUR_CUT && Number(s1[0]!.qty) === 40, `satır=${s1.length} sebep=${s1[0]?.reasonCode} qty=${String(s1[0]?.qty)}`);
    check("§1b uç: depo + WAREHOUSE, çıkış ucu yok, adım damgalı", s1[0]?.toWarehouseId === warehouse.id && s1[0]?.toStatus === RollStatus.WAREHOUSE && s1[0]?.fromWarehouseId === null && s1[0]?.workOrderStepId === a.stepId, `to=${s1[0]?.toWarehouseId === warehouse.id} adım=${s1[0]?.workOrderStepId === a.stepId}`);
    check("§1c ebeveyn (IN_PRODUCTION, stok dışı) satır ALMADI", (await satirlar(a.rollId)).length === 0);

    // ── §2 geri alma — adım-restore dalı ────────────────────────────────────
    await undo.applyUndo(cocuk.id, undefined, { mode: "SINGLE", reason: "bekçi §2" });
    const s2 = await satirlar(cocuk.id);
    const ters2 = s2.find((r) => r.reversesMovementId !== null);
    const canli2 = await prisma.roll.findUnique({ where: { id: cocuk.id }, select: { status: true } });
    const eb2 = await prisma.roll.findUnique({ where: { id: a.rollId }, select: { currentQty: true } });
    check("§2 ⭐ SINGLE geri alma BAĞLI tersledi (TAMBUR_UNDO), net 0, çocuk CANCELLED, ebeveyn 100", s2.length === 2 && ters2?.reversesMovementId === s1[0]?.id && ters2.reasonCode === STOCK_MOVE_REASON.TAMBUR_UNDO && net(s2) === 0 && canli2?.status === RollStatus.CANCELLED && Number(eb2?.currentQty) === 100, `satır=${s2.length} bağ=${ters2?.reversesMovementId === s1[0]?.id} net=${net(s2)} durum=${canli2?.status} ebeveyn=${String(eb2?.currentQty)}`);

    // ── §3 kaynak ARŞİVDE dalı ──────────────────────────────────────────────
    const c3 = await tambur.cutOpenFabric(a.rollId, { lengthMeters: 30, status: "WAREHOUSE", confirmMismatch: true });
    const cocuk3 = (c3.data as { childRoll: { id: string } }).childRoll;
    rollIds.push(cocuk3.id);
    const fin = await tambur.finalizeOpenFabric(a.rollId, { remainingAction: "discard", varianceReasonCode: null, varianceReasonText: "bekçi §3", confirmMismatch: true });
    const kalanId = (fin.data as { remainingChildId: string | null }).remainingChildId;
    if (kalanId) rollIds.push(kalanId);
    await undo.applyUndo(cocuk3.id, undefined, { mode: "SINGLE", reason: "bekçi §3" });
    const s3 = await satirlar(cocuk3.id);
    const canli3 = await prisma.roll.findUnique({ where: { id: cocuk3.id }, select: { status: true } });
    check("§3 ⭐ kaynak arşivdeyken de çocuk satırı terslendi — net 0, çocuk CANCELLED", s3.length === 2 && net(s3) === 0 && s3.some((r) => r.reasonCode === STOCK_MOVE_REASON.TAMBUR_UNDO) && canli3?.status === RollStatus.CANCELLED, `satır=${s3.length} net=${net(s3)} durum=${canli3?.status}`);

    // ── §4 rescue ───────────────────────────────────────────────────────────
    const b = await uretimdeTop("B", kursunSt.id, 100, { acik: false, warehouseId: warehouse.id, itemId, gradeCode: grade.code });
    await inventory.rescueStuckRoll(b.rollId, { reason: "bekçi §4 — makinede kaldı" });
    const s4 = await satirlar(b.rollId);
    check("§4 rescue TEK PRODUCTION girişi: RESCUE, 100 m, depo/WAREHOUSE, adım damgalı, sebep notes'ta", s4.length === 1 && s4[0]!.reasonCode === STOCK_MOVE_REASON.RESCUE && Number(s4[0]!.qty) === 100 && s4[0]!.toWarehouseId === warehouse.id && s4[0]!.toStatus === RollStatus.WAREHOUSE && s4[0]!.workOrderStepId === b.stepId && s4[0]!.notes === "bekçi §4 — makinede kaldı", `satır=${s4.length} sebep=${s4[0]?.reasonCode} qty=${String(s4[0]?.qty)} adım=${s4[0]?.workOrderStepId === b.stepId}`);

    // ── §5 0 metrajlı takılı top ────────────────────────────────────────────
    const c = await uretimdeTop("C", kursunSt.id, 0, { acik: true, warehouseId: warehouse.id, itemId, gradeCode: grade.code });
    await inventory.rescueStuckRoll(c.rollId, { reason: "bekçi §5 — sıfır metraj" });
    const c5 = await prisma.roll.findUnique({ where: { id: c.rollId }, select: { status: true } });
    check("§5 0 metrajlı top kurtarıldı, satır YAZILMADI (taşınacak mal yok)", c5?.status === RollStatus.WAREHOUSE && (await satirlar(c.rollId)).length === 0, `durum=${c5?.status}`);

    check("§6 körlük zemini: fikstür defter satırı üretti", (await prisma.warehouseMovement.count({ where: { rollId: { in: rollIds } } })) >= 5);
  } finally {
    await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollVariance.deleteMany({ where: { OR: [{ rollId: { in: rollIds } }, { sourceRollId: { in: rollIds } }] } });
    await prisma.rollPlanDeviation.deleteMany({ where: { OR: [{ rollId: { in: rollIds } }, { childRollId: { in: rollIds } }] } }).catch(() => undefined);
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: rollIds } } });
    await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { parentRollId: null } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
    await prisma.item.deleteMany({ where: { id: itemId } });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("❌ bekçi çöktü:", e);
  await prisma.$disconnect().catch(() => undefined);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
