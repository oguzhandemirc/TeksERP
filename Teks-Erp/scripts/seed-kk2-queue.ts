// Test verisi: Birkaç iş emrini KK2 (Kurşun + KK2) kuyruğuna kadar getirir.
//
// Rota: Boyahane (Fason) → Kurşun + KK2 → Tambur (gerçek üretim akışı). Her WO
// finalize edilir (refakat kartı oluşur), stok rulolar bağlanır, fasona sevk +
// kabul edilir. Kabulde "açık kumaş" (barkodsuz) çıktı toplar bir sonraki adıma
// (KK2) düşer → mobil KK2 ekranında "Kumaşı Bitir (Tambur'a)" akışı test edilir.
//
// Gerçek servisleri kullanır → akışı uçtan uca doğrular. Veri SİLMEZ, ekler.
// Çalıştır: npx ts-node scripts/seed-kk2-queue.ts
import prisma from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { KursunQcService } from "../src/services/kursun-qc.service";
import { RollStatus, StationKind, StationType } from "@prisma/client";

const woService = new WorkOrderService();
const subService = new SubcontractorService();
const kursunService = new KursunQcService();

function genBarcode(woIdx: number, rollIdx: number): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const rand = Math.floor(Math.random() * 0xffff).toString(16).toUpperCase().padStart(4, "0");
  return `TEKS-${ymd}-KK2${woIdx}${rollIdx}${rand}`;
}

async function createStockRolls(opts: {
  itemId: string;
  qualityGradeId: string;
  width: number;
  createdById: string;
  qty: number;
  count: number;
  woIdx: number;
}): Promise<{ id: string; barcode: string }[]> {
  const rolls: { id: string; barcode: string }[] = [];
  for (let i = 0; i < opts.count; i++) {
    const barcode = genBarcode(opts.woIdx, i);
    const r = await prisma.roll.create({
      data: {
        barcode,
        itemId: opts.itemId,
        initialQty: opts.qty,
        currentQty: opts.qty,
        status: RollStatus.STOCK,
        qualityGrade: "1.KALITE",
        qualityGradeId: opts.qualityGradeId,
        width: opts.width,
        createdById: opts.createdById,
      },
      select: { id: true },
    });
    rolls.push({ id: r.id, barcode });
  }
  return rolls;
}

(async () => {
  // ── Ortak referanslar ──────────────────────────────────────────────────
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  if (!admin) throw new Error("admin kullanıcı yok.");

  const grade = await prisma.qualityGrade.findFirst({ select: { id: true } });
  if (!grade) throw new Error("qualityGrade yok.");

  const [boyahane, kk2, tambur] = await Promise.all([
    prisma.station.findFirst({ where: { kind: StationKind.SUBCONTRACTOR, type: StationType.EXTERNAL, isActive: true }, select: { id: true, name: true } }),
    prisma.station.findFirst({ where: { kind: StationKind.PROCESS_QC, isActive: true }, select: { id: true, name: true } }),
    prisma.station.findFirst({ where: { kind: StationKind.TAMBUR, isActive: true }, select: { id: true, name: true } }),
  ]);
  if (!boyahane || !kk2 || !tambur) throw new Error("Boyahane / KK2 / Tambur istasyonlarından biri eksik.");

  const subcontractor = await prisma.subcontractor.findFirst({ where: { isActive: true }, select: { id: true, name: true } });
  if (!subcontractor) throw new Error("Aktif fason firma yok.");

  const items = await prisma.item.findMany({
    where: { isActive: true, itemType: "FABRIC" },
    select: { id: true, name: true },
    take: 4,
  });
  if (items.length === 0) throw new Error("Aktif FABRIC ürün yok.");

  console.log(`Rota: ${boyahane.name} → ${kk2.name} → ${tambur.name}`);
  console.log(`Fason firma: ${subcontractor.name}\n`);

  // ── Üretilecek iş emirleri ──────────────────────────────────────────────
  // newRollQtys: fason dönüşünde KK2'ye düşecek açık-kumaş toplar (her biri ayrı).
  const plan = [
    { item: items[0], width: 150, qty: 280, count: 2, newRollQtys: [260, 250] },
    { item: items[1] ?? items[0], width: 140, qty: 250, count: 3, newRollQtys: [240, 235, 220] },
    { item: items[0], width: 160, qty: 300, count: 2, newRollQtys: [560] },
  ];

  const summary: { batch: string; card: string | null; item: string; openRolls: number }[] = [];

  for (let w = 0; w < plan.length; w++) {
    const p = plan[w];

    // 1) İş emri (stoğa üretim, fason rota). create → refakat kartı otomatik.
    const woRes = await woService.create(
      {
        type: "STOCK_PRODUCTION",
        targetItemId: p.item.id,
        width: p.width,
        targetQuantity: p.qty * p.count,
        steps: [{ stationId: boyahane.id }, { stationId: kk2.id }, { stationId: tambur.id }],
      },
      admin.id,
    );
    const wo = woRes.data;
    const fasonStepId = (wo as unknown as { steps: { id: string }[] }).steps[0].id;
    console.log(`[WO ${w + 1}] ${wo.workOrderNumber}  ·  ${p.item.name}  ·  en ${p.width}  ·  ${p.count} top → fasona`);

    // 2) Stok rulolar + WO'ya bağla (ilk adım fason → henüz movement yok).
    const rolls = await createStockRolls({
      itemId: p.item.id,
      qualityGradeId: grade.id,
      width: p.width,
      createdById: admin.id,
      qty: p.qty,
      count: p.count,
      woIdx: w + 1,
    });
    await woService.attachRolls(wo.id, rolls.map((r) => r.barcode), admin.id);

    // 3) Fasona sevk (Boyahane adımı).
    await subService.dispatch(
      { workOrderId: wo.id, stepId: fasonStepId, subcontractorId: subcontractor.id, rollIds: rolls.map((r) => r.id) },
      admin.id,
    );

    // 4) Fason kabul → açık kumaş çıktısı KK2 adımına düşer.
    await subService.receive(
      {
        workOrderId: wo.id,
        stepId: fasonStepId,
        subcontractorId: subcontractor.id,
        returns: rolls.map((r) => ({ rollId: r.id })),
        newRolls: p.newRollQtys.map((qty) => ({ qty })),
      },
      admin.id,
    );
    console.log(`   fason kabul edildi → ${p.newRollQtys.length} açık-kumaş top KK2 kuyruğunda`);

    const card = await prisma.travelerCard.findFirst({
      where: { workOrderId: wo.id, status: "ACTIVE" },
      select: { barcode: true },
    });
    summary.push({ batch: wo.workOrderNumber, card: card?.barcode ?? null, item: p.item.name, openRolls: p.newRollQtys.length });
  }

  // ── Doğrulama: KK2 açık kartlar listesi ────────────────────────────────
  const openCards = await kursunService.listOpenCards();
  console.log(`\n✅ KK2 açık kart sayısı (toplam, bu seed dahil): ${openCards.data.length}\n`);

  console.log("════════ TEST İÇİN ÖZET (KK2 — Kurşun + KK2) ════════");
  for (const s of summary) {
    console.log(`\n• İş Emri: ${s.batch}  (${s.item})  ·  ${s.openRolls} açık-kumaş top`);
    console.log(`  Refakat kartı barkodu: ${s.card ?? "—"}`);
  }
  console.log(
    "\nMobil KK2 ekranı: refakat kartı barkodunu okut → açık-kumaş top seç → 'Kumaşı Bitir (Tambur'a)'.",
  );

  await prisma.$disconnect();
})().catch((e) => {
  console.error("HATA:", e);
  process.exit(1);
});
