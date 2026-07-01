// KK2 (Kurşun + KK2) son değişikliklerini TABLETTEN test etmek için ortam.
//
// Üretir:
//   • Kart A — BARKODLU 3 top KK2'de açık (qty 200/200/150). Test: offline leke
//     ekle/sil, metraj > kumaş boyu reddi, KK2 Tamamla, Adımı Kapat (offline).
//   • Kart B — aynı kurulum ama tüm toplar QC2'lenip finishStep ile KAPATILMIŞ
//     (toplar Tambur'a geçmiş). Reopen-confirm akışını test etmek için.
//
// Ayrıca Kart B'de getByCardBarcode + reopenPreview'ı ÇAĞIRIP sonucu basar —
// "kapalı kart re-scan" gerçekte ne yapıyor ampirik görürüz.
//
// Veri SİLMEZ, ekler. Çalıştır: npx ts-node scripts/seed-kk2-test.ts
import prisma from "../src/lib/prisma";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { KursunQcService } from "../src/services/kursun-qc.service";
import { RollStatus, StationKind, StepStatus } from "@prisma/client";

const cards = new TravelerCardService();
const kursun = new KursunQcService();

let bc = 0;
function barcode(prefix: string): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  bc++;
  const rand = Math.floor(Math.random() * 0xffff).toString(16).toUpperCase().padStart(4, "0");
  return `TEKS${ymd}${prefix}${bc}${rand}`;
}

async function makeCard(opts: {
  adminId: string;
  itemId: string;
  colorId: string;
  gradeId: string;
  kk2StationId: string;
  tamburStationId: string;
  width: number;
  qtys: number[];
  label: string;
}): Promise<{ woId: string; batchNumber: string; cardBarcode: string | null; kk2StepId: string; rolls: { barcode: string; qty: number }[] }> {
  const stamp = `${Date.now()}`.slice(-5) + bc;
  const wo = await prisma.workOrder.create({
    data: {
      batchNumber: `KK2T-${opts.label}-${stamp}`,
      type: "STOCK_PRODUCTION",
      status: "IN_PROGRESS",
      width: opts.width,
      targetQuantity: opts.qtys.reduce((a, b) => a + b, 0),
      targetItemId: opts.itemId,
      targetColorId: opts.colorId,
      steps: {
        create: [
          { stationId: opts.kk2StationId, stepSequence: 1, status: StepStatus.ACTIVE },
          { stationId: opts.tamburStationId, stepSequence: 2, status: StepStatus.ACTIVE },
        ],
      },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  const kk2StepId = wo.steps[0].id;

  // Refakat kartı (barkod buradan gelir).
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, opts.adminId));
  const card = await prisma.travelerCard.findFirst({
    where: { workOrderId: wo.id, status: "ACTIVE" },
    select: { barcode: true },
  });

  // BARKODLU toplar KK2'de açık (open RollMovement).
  const rolls: { barcode: string; qty: number }[] = [];
  for (const qty of opts.qtys) {
    const bcode = barcode("R");
    const r = await prisma.roll.create({
      data: {
        barcode: bcode,
        itemId: opts.itemId,
        colorId: opts.colorId,
        initialQty: qty,
        currentQty: qty,
        status: RollStatus.IN_PRODUCTION,
        qualityGrade: "1.KALITE",
        qualityGradeId: opts.gradeId,
        width: opts.width,
        currentStepId: kk2StepId,
        producedInStepId: kk2StepId,
        createdById: opts.adminId,
      },
      select: { id: true },
    });
    await prisma.rollMovement.create({
      data: { rollId: r.id, workOrderStepId: kk2StepId, qtyIn: qty, operatorId: opts.adminId },
    });
    rolls.push({ barcode: bcode, qty });
  }

  return { woId: wo.id, batchNumber: wo.batchNumber, cardBarcode: card?.barcode ?? null, kk2StepId, rolls };
}

(async () => {
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  if (!admin) throw new Error("admin kullanıcı yok.");
  const grade = await prisma.qualityGrade.findFirst({ select: { id: true } });
  if (!grade) throw new Error("qualityGrade yok.");
  const item = await prisma.item.findFirst({ where: { isActive: true, itemType: "FABRIC" }, select: { id: true, name: true } });
  if (!item) throw new Error("Aktif FABRIC ürün yok.");
  const color = await prisma.color.findFirst({ where: { isActive: true }, select: { id: true, name: true } });
  if (!color) throw new Error("Aktif renk yok.");
  const [kk2, tambur] = await Promise.all([
    prisma.station.findFirst({ where: { kind: StationKind.PROCESS_QC, isActive: true }, select: { id: true, name: true } }),
    prisma.station.findFirst({ where: { kind: StationKind.TAMBUR, isActive: true }, select: { id: true, name: true } }),
  ]);
  if (!kk2 || !tambur) throw new Error("KK2 / Tambur istasyonu eksik.");

  const common = {
    adminId: admin.id,
    itemId: item.id,
    colorId: color.id,
    gradeId: grade.id,
    kk2StationId: kk2.id,
    tamburStationId: tambur.id,
    width: 200,
  };

  // ── Kart A: barkodlu toplar KK2'de açık ──
  const A = await makeCard({ ...common, qtys: [200, 200, 150], label: "ACIK" });

  // ── Kart B: aynı kurulum, sonra QC2 + finishStep ile kapat ──
  const B = await makeCard({ ...common, qtys: [180, 160], label: "KAPALI" });
  for (const r of B.rolls) {
    const roll = await prisma.roll.findFirst({ where: { barcode: r.barcode }, select: { id: true } });
    await kursun.completeQc2({ rollId: roll!.id, stepId: B.kk2StepId }, admin.id);
  }
  const finishRes = await kursun.finishStep({ stepId: B.kk2StepId }, admin.id);

  // ── AMPİRİK PROBE: kapalı kartı re-scan edince ne oluyor? ──
  let scanResult: string;
  try {
    const res = await kursun.getByCardBarcode(B.cardBarcode!);
    scanResult = `DÖNDÜ → status=${res.data.status}, rolls=${res.data.rolls.length}`;
  } catch (e) {
    scanResult = `THROW → ${(e as Error).message}`;
  }
  let previewResult: string;
  try {
    const pv = await kursun.reopenPreview(B.kk2StepId);
    previewResult = `canReopen=${pv.data.canReopen}, blockReason=${pv.data.blockReason ?? "—"}, rollCount=${pv.data.rollCount}`;
  } catch (e) {
    previewResult = `THROW → ${(e as Error).message}`;
  }

  console.log("\n══════════════════ KK2 TEST ORTAMI HAZIR ══════════════════");
  console.log(`Ürün: ${item.name} · Renk: ${color.name} · KK2: ${kk2.name} · Tambur: ${tambur.name}\n`);

  console.log("── KART A (barkodlu, KK2'de AÇIK) — offline leke / metraj / KK2 Tamamla / Adımı Kapat ──");
  console.log(`  İş emri : ${A.batchNumber}`);
  console.log(`  KART BARKODU: ${A.cardBarcode}`);
  A.rolls.forEach((r, i) => console.log(`    Top ${i + 1}: ${r.barcode}  ·  ${r.qty} mt  (metraj testi: ${r.qty + 50} gir → reddedilmeli)`));

  console.log("\n── KART B (KK2 adımı finishStep ile KAPATILDI) — reopen testi ──");
  console.log(`  İş emri : ${B.batchNumber}`);
  console.log(`  KART BARKODU: ${B.cardBarcode}`);
  console.log(`  finishStep → ${finishRes.message}`);
  console.log(`  [PROBE] getByCardBarcode(re-scan): ${scanResult}`);
  console.log(`  [PROBE] reopenPreview            : ${previewResult}`);
  console.log("\n════════════════════════════════════════════════════════════");

  await prisma.$disconnect();
})().catch((e) => {
  console.error("HATA:", e);
  process.exit(1);
});
