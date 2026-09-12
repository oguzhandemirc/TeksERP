// =============================================================================
// BEKÇİ — ADIMI YENİDEN AÇMAK DEFTERDEN ÇIKIŞ YAZAR (stok defteri, reopen ters yolu)
// Çalıştır: npx tsx scripts/run-all-tests.ts stock_ledger_kursun_reopen
// =============================================================================
// NEDEN: son adımı kapatmak `finalizeRollsAtLastStep` ile depoya GİRİŞ yazıyor,
// ama adımı YENİDEN AÇMAK deftere hiç dokunmuyordu. finish → yeniden aç → finish
// turunda İKİ giriş bir çıkışsız kalıyordu; sapma topun metrajı × tur kadar
// birikiyor ve mutabakat her turda biraz daha kayıyordu.
//
// Kural: "deftere yazan her ileri kaynağın ters yolu olmalı". Yeniden açmak
// ileri satırı NE SİLER NE DEĞİŞTİRİR — ona bağlı bir TERS satır yazar.
//
// ÖLÇÜLENLER
//   §1 Adımı kapatma depoya giriş yazar (mevcut ileri yol)
//   §2 Yeniden açma ters satır yazar — bağ · yön · sebep · metraj
//   §3 ⭐ Tur sonunda NET SIFIR (top üretime döndü, stokta değil)
//   §4 ⭐ İKİNCİ TUR: 2 giriş + 1 çıkış, net = METRAJ (iki katı DEĞİL)
//   §5 ⭐ İkinci yeniden açma İKİNCİ ileri satırı tersler — aynı satır iki kez
//      terslenmez, yani tekrar eden tur P2002'ye düşmez
//   §6 Körlük zemini: fikstür gerçekten dört satır üretti
// =============================================================================
import { RollOperationType, RollStatus, StationKind, StepStatus, WarehouseEventType, WorkOrderStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { KursunQcService } from "../src/services/kursun-qc.service";
import { STOCK_MOVE_REASON } from "../src/constants/stock-move-reasons";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const TAG = `TEST-SLKR-${Date.now()}`;
const rollIds: string[] = [];
let itemId = "";
let gradeId = "";
let stationId = "";
let woId = "";
let stepId = "";

interface Satir {
  id: string;
  eventType: WarehouseEventType;
  qty: unknown;
  fromWarehouseId: string | null;
  toWarehouseId: string | null;
  fromStatus: RollStatus | null;
  toStatus: RollStatus | null;
  reasonCode: string | null;
  reversesMovementId: string | null;
}

async function satirlar(rollId: string): Promise<Satir[]> {
  return prisma.warehouseMovement.findMany({
    where: { rollId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, eventType: true, qty: true,
      fromWarehouseId: true, toWarehouseId: true, fromStatus: true, toStatus: true,
      reasonCode: true, reversesMovementId: true,
    },
  });
}

/** Defter etkisi: giriş ucu +, çıkış ucu −. */
function net(rows: Satir[]): number {
  return rows.reduce((acc, r) => {
    const q = Number(r.qty);
    return acc + (r.toWarehouseId ? q : 0) - (r.fromWarehouseId ? q : 0);
  }, 0);
}

/** Topu adıma geri koyar ve açık hareketini açar — "finish" öncesi durum. */
async function turuBaslat(rollId: string): Promise<void> {
  await prisma.rollMovement.create({ data: { rollId, workOrderStepId: stepId, qtyIn: 100 } });
}

async function main(): Promise<void> {
  console.log("\n=== Adımı yeniden açma: defter ters kaydı ===\n");
  const svc = new KursunQcService();
  const warehouse = await prisma.warehouse.findFirst({ where: { isDefault: true }, select: { id: true } });
  if (!warehouse) throw new Error("Varsayılan depo yok (ensureDefaultWarehouse koşmamış)");

  itemId = (await prisma.item.create({ data: { code: TAG, name: `${TAG} kumaş`, itemType: "FABRIC" }, select: { id: true } })).id;
  const grade = await prisma.qualityGrade.create({
    data: { code: `${TAG}-W`, name: "Test depo kalitesi", targetStatus: RollStatus.WAREHOUSE },
    select: { id: true, code: true },
  });
  gradeId = grade.id;
  // ⚠️ Kendi istasyonunu kurar: "ortamdaki herhangi bir PROCESS_QC" üstüne test
  // kurmak temiz DB'de düşer, dolu DB'de vakumen yeşil kalır.
  const station = await prisma.station.create({
    data: { code: `${TAG}-IST`.slice(0, 32), name: `${TAG} KK2`, kind: StationKind.PROCESS_QC, type: "INTERNAL" },
    select: { id: true },
  });
  stationId = station.id;

  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `${TAG}-WO`, status: WorkOrderStatus.IN_PROGRESS },
    select: { id: true },
  });
  woId = wo.id;
  // TEK adım → `nextStep` yok → finish son-adım dalını (finalize) sürer.
  const step = await prisma.workOrderStep.create({
    data: { workOrderId: woId, stationId, stepSequence: 1, status: StepStatus.ACTIVE },
    select: { id: true },
  });
  stepId = step.id;

  const roll = await prisma.roll.create({
    data: {
      barcode: `${TAG}-R`, itemId, initialQty: 100, currentQty: 100,
      status: RollStatus.IN_PRODUCTION, currentStepId: stepId,
      warehouseId: warehouse.id, entrySource: "SUPPLIER_RECEIPT",
      qualityGrade: grade.code, qualityGradeId: gradeId,
    },
    select: { id: true },
  });
  rollIds.push(roll.id);
  await turuBaslat(roll.id);
  // `finishStep`in kapısı: bu adımda fiilen yapılmış QC2 kaydı olmayan top varsa
  // adım kapanmaz. Kayıt yeniden açmada KORUNUR (servis bilerek silmiyor), yani
  // ikinci tur için tekrar yazmaya gerek yok.
  await prisma.rollOperation.create({
    data: { rollId: roll.id, workOrderStepId: stepId, operationType: RollOperationType.QC2_COMPLETED },
  });

  // ── §1 — birinci finish ───────────────────────────────────────────────────
  await svc.finishStep({ stepId });
  const tur1 = await satirlar(roll.id);
  const ileri1 = tur1[0];
  check(
    "§1 Adımı kapatma depoya GİRİŞ yazdı",
    tur1.length === 1 && ileri1?.eventType === WarehouseEventType.PRODUCTION &&
      ileri1?.toWarehouseId === warehouse.id && ileri1?.toStatus === RollStatus.WAREHOUSE &&
      net(tur1) === 100,
    `satır=${tur1.length} net=${net(tur1)}`,
  );

  // ── §2 + §3 — birinci reopen ──────────────────────────────────────────────
  await svc.reopenStep({ stepId });
  const tur2 = await satirlar(roll.id);
  const ters1 = tur2.find((r) => r.reversesMovementId !== null);
  check(
    "§2 ⭐ Yeniden açma ters satır yazdı — bağ, yön ve sebep doğru",
    tur2.length === 2 && ters1?.reversesMovementId === ileri1?.id &&
      ters1?.fromWarehouseId === warehouse.id && ters1?.toWarehouseId === null &&
      ters1?.fromStatus === RollStatus.WAREHOUSE &&
      ters1?.reasonCode === STOCK_MOVE_REASON.KURSUN_REOPEN && Number(ters1?.qty) === 100,
    `satır=${tur2.length} sebep=${String(ters1?.reasonCode)}`,
  );
  check("§3 ⭐ NET SIFIR: top üretime döndü, stokta görünmüyor", net(tur2) === 0, `net=${net(tur2)}`);
  const canli = await prisma.roll.findUnique({ where: { id: roll.id }, select: { status: true, currentStepId: true } });
  check("§3b Top IN_PRODUCTION'a ve bu adıma geri çekildi", canli?.status === RollStatus.IN_PRODUCTION && canli?.currentStepId === stepId);

  // ── §4 + §5 — ikinci tur ──────────────────────────────────────────────────
  await svc.finishStep({ stepId });
  const tur3 = await satirlar(roll.id);
  check(
    "§4 ⭐ İkinci tur: 2 giriş + 1 çıkış, net = METRAJ (iki katı DEĞİL)",
    tur3.length === 3 && net(tur3) === 100,
    `satır=${tur3.length} net=${net(tur3)}`,
  );
  const ileri2 = tur3.find((r) => r.reversesMovementId === null && r.id !== ileri1?.id);

  await svc.reopenStep({ stepId });
  const tur4 = await satirlar(roll.id);
  const tersler = tur4.filter((r) => r.reversesMovementId !== null);
  check(
    "§5 ⭐ İkinci yeniden açma İKİNCİ ileri satırı tersledi (aynı satır iki kez terslenmedi)",
    tersler.length === 2 &&
      tersler.some((r) => r.reversesMovementId === ileri1?.id) &&
      tersler.some((r) => r.reversesMovementId === ileri2?.id) &&
      net(tur4) === 0,
    `ters=${tersler.length} net=${net(tur4)}`,
  );

  check("§6 Körlük zemini: fikstür dört satır üretti (2 ileri + 2 ters)", tur4.length === 4, `n=${tur4.length}`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  try {
    if (rollIds.length) {
      // Ters satırlar ÖNCE: `reversesMovementId` FK'sı RESTRICT.
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds }, reversesMovementId: { not: null } } });
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
    if (stationId) await prisma.station.deleteMany({ where: { id: stationId } });
    if (gradeId) await prisma.qualityGrade.deleteMany({ where: { id: gradeId } });
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } });
    console.log("(test verisi temizlendi)");
  } catch (e) { console.error("cleanup hata:", e instanceof Error ? e.message : e); }
}

main()
  .catch((e) => { console.error("💥 ÇÖKTÜ:", e); fail++; })
  .finally(async () => { await cleanup(); await prisma.$disconnect(); await pool.end(); process.exit(fail > 0 ? 1 : 0); });
