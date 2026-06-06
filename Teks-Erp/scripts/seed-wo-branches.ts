// Test verisi: Bir iş emrinde PARALEL fason dalları (çoklu sevk) senaryosu üretir.
// Amaç: tam sayfa "Dallar (Fason Partileri)" lane görünümünü + rota dağılım
// şeridini gerçek veriyle test etmek. Gerçek servisleri (dispatch/receive)
// kullanır → multi-dispatch akışını da uçtan uca doğrular. Veri SİLMEZ, ekler.
//
// Çalıştır: npx ts-node scripts/seed-wo-branches.ts
import prisma from "../src/lib/prisma";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { RollStatus } from "@prisma/client";

const sub = new SubcontractorService();

function genBarcode(i: number): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const rand = Math.floor(Math.random() * 0xffffffff).toString(16).toUpperCase().padStart(8, "0");
  return `TEKS-${ymd}-${rand}${i}`;
}

async function createStockRolls(opts: {
  itemId: string;
  qualityGradeId: string;
  width: number | null;
  createdById: string;
  qty: number;
  count: number;
}): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < opts.count; i++) {
    const r = await prisma.roll.create({
      data: {
        barcode: genBarcode(i),
        itemId: opts.itemId,
        initialQty: opts.qty,
        currentQty: opts.qty,
        status: RollStatus.STOCK,
        qualityGrade: "1.KALITE",
        qualityGradeId: opts.qualityGradeId,
        width: opts.width,
        createdById: opts.createdById,
      },
      select: { id: true, barcode: true },
    });
    ids.push(r.id);
    console.log(`   + STOCK rulo ${r.barcode} (${opts.qty}m)`);
  }
  return ids;
}

(async () => {
  // 1) Fason adımlı bir WO bul (PLANNED/IN_PROGRESS).
  const wo = await prisma.workOrder.findFirst({
    where: {
      status: { in: ["PLANNED", "IN_PROGRESS"] },
      steps: { some: { station: { type: "EXTERNAL" } } },
    },
    select: {
      id: true,
      batchNumber: true,
      targetItemId: true,
      width: true,
      steps: {
        select: { id: true, requiredCategoryId: true, station: { select: { name: true, type: true } } },
        orderBy: { stepSequence: "asc" },
      },
    },
  });
  if (!wo) throw new Error("Fason adımlı PLANNED/IN_PROGRESS iş emri bulunamadı.");
  const fasonStep = wo.steps.find((s) => s.station?.type === "EXTERNAL");
  if (!fasonStep) throw new Error("Fason (EXTERNAL) adımı yok.");
  if (!wo.targetItemId) throw new Error("WO targetItemId boş — test rulosu eşleştirilemez.");
  console.log(`İş emri: ${wo.batchNumber} (${wo.id})  ·  Fason adımı: ${fasonStep.station?.name}`);

  // 2) Bu kategoriye hizmet veren fason firma.
  const link = fasonStep.requiredCategoryId
    ? await prisma.subcontractorToCategory.findFirst({
        where: { categoryId: fasonStep.requiredCategoryId },
        select: { subcontractorId: true, subcontractor: { select: { name: true } } },
      })
    : await prisma.subcontractor.findFirst({ where: { isActive: true }, select: { id: true, name: true } }).then((s) => s && { subcontractorId: s.id, subcontractor: { name: s.name } });
  if (!link) throw new Error("Uygun fason firma bulunamadı.");
  const subcontractorId = "subcontractorId" in link ? link.subcontractorId : "";
  console.log(`Fason firma: ${link.subcontractor?.name} (${subcontractorId})`);

  // 3) Yardımcılar: admin + bir kalite grade.
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  if (!admin) throw new Error("admin kullanıcı yok.");
  const grade = await prisma.qualityGrade.findFirst({ select: { id: true } });
  if (!grade) throw new Error("qualityGrade yok.");
  const common = { itemId: wo.targetItemId, qualityGradeId: grade.id, width: wo.width ? Number(wo.width) : null, createdById: admin.id };

  // ── DAL B: sevk → kabul (RETURNED, çıktı Kurşun'da) ──────────────────────
  console.log("\n[DAL B] Sevk + kabul (RETURNED → çıktı bir sonraki adımda):");
  const bRolls = await createStockRolls({ ...common, qty: 250, count: 2 });
  const bDisp = await sub.dispatch(
    { workOrderId: wo.id, stepId: fasonStep.id, subcontractorId, rollIds: bRolls },
    admin.id,
  );
  console.log(`   sevk: ${bDisp.message}`);
  const bRecv = await sub.receive(
    {
      workOrderId: wo.id,
      stepId: fasonStep.id,
      subcontractorId,
      returns: bRolls.map((rollId) => ({ rollId })),
      newRolls: [{ qty: 480 }], // 2×250 → tek açık-kumaş top (boyahane dönüşü)
    },
    admin.id,
  );
  console.log(`   kabul: ${bRecv.message}`);

  // ── DAL C: sevk → AÇIK (OPEN, hâlâ boyahanede) ───────────────────────────
  console.log("\n[DAL C] Sevk (OPEN → hâlâ fasonda):");
  const cRolls = await createStockRolls({ ...common, qty: 300, count: 2 });
  const cDisp = await sub.dispatch(
    { workOrderId: wo.id, stepId: fasonStep.id, subcontractorId, rollIds: cRolls },
    admin.id,
  );
  console.log(`   sevk: ${cDisp.message}`);

  // 4) Sonuç özeti — branches endpoint mantığıyla aynı.
  const branches = await prisma.subcontractorDispatch.findMany({
    where: { workOrderId: wo.id },
    orderBy: { dispatchedAt: "asc" },
    select: {
      dispatchNo: true,
      cancelledAt: true,
      items: { select: { receiptItems: { select: { id: true } } } },
    },
  });
  console.log(`\n✅ WO ${wo.batchNumber} artık ${branches.length} dal taşıyor:`);
  for (const b of branches) {
    const received = b.items.filter((it) => it.receiptItems.length > 0).length;
    const st = b.cancelledAt ? "İPTAL" : received === 0 ? "AÇIK (fasonda)" : received >= b.items.length ? "DÖNDÜ" : "KISMİ";
    console.log(`   ${b.dispatchNo}  ${b.items.length} top  →  ${st}`);
  }
  console.log(`\nTest için: Electron'da İş Emirleri → ${wo.batchNumber} → slide-over → "Tam Ekran Aç" → "Dallar" bölümü.`);
  await prisma.$disconnect();
})().catch((e) => {
  console.error("HATA:", e);
  process.exit(1);
});
