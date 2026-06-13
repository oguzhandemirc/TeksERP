// =============================================================================
// Test: Saha #14 — rota şablonu fason planlamasını saklar ve WO'ya klonlar
// Çalıştır: npx tsx scripts/test_route_template_fason.ts
// Doğrulananlar:
//   1. RouteStep'e requiredCategoryId + plannedSubcontractorId yazılabiliyor
//   2. Şablondan WO açılınca adımlar fason planlamasını DEVRALIYOR (eski bug:
//      hep boş geliyordu — şema saklayamıyordu)
//   3. Formdaki stepPlanning overlay'i şablon default'unu EZEBİLİYOR
// =============================================================================
import prisma from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}
function need<T>(v: T | null | undefined, what: string): T {
  if (v == null) throw new Error(`Fixture eksik: ${what} (seed çalıştı mı?)`);
  return v;
}

async function main() {
  const suffix = Date.now().toString(36).toUpperCase();
  const svc = new WorkOrderService();

  // ── Fixture'lar (seed business-key'leriyle) ──
  const stBoya = need(
    await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }),
    "Station BOYA_FASON",
  );
  const stTambur = need(
    await prisma.station.findFirst({ where: { kind: "TAMBUR" }, select: { id: true } }),
    "TAMBUR istasyonu",
  );
  const item = need(
    await prisma.item.findFirst({ where: { isActive: true, itemType: "FABRIC" }, select: { id: true } }),
    "FABRIC item",
  );
  const category = need(
    await prisma.subcontractorCategory.findFirst({ select: { id: true } }),
    "SubcontractorCategory",
  );
  const firmA = need(
    await prisma.subcontractor.findFirst({ where: { isActive: true }, select: { id: true }, orderBy: { code: "asc" } }),
    "Subcontractor A",
  );
  const firmB = await prisma.subcontractor.findFirst({
    where: { isActive: true, id: { not: firmA.id } },
    select: { id: true },
  });

  // ── 1) Fason planlamalı şablon oluştur ──
  const route = await prisma.route.create({
    data: {
      name: `TEST-RTF-${suffix}`,
      code: `TRTF-${suffix}`.slice(0, 32),
      isActive: true,
      steps: {
        create: [
          {
            stationId: stBoya.id,
            sequence: 1,
            defaultNotes: "şablon notu",
            requiredCategoryId: category.id,
            plannedSubcontractorId: firmA.id,
          },
          { stationId: stTambur.id, sequence: 2 },
        ],
      },
    },
    include: { steps: { orderBy: { sequence: "asc" } } },
  });
  check(
    "Şablon adımı fason planlamasını sakladı",
    route.steps[0]!.plannedSubcontractorId === firmA.id &&
      route.steps[0]!.requiredCategoryId === category.id,
  );

  const createdWoIds: string[] = [];
  try {
    // ── 2) Şablondan WO aç — planlama devralınmalı ──
    const wo1 = await svc.create({
      type: "STOCK_PRODUCTION",
      batchNumber: `TEST-RTF1-${suffix}`,
      targetItemId: item.id,
      targetQuantity: 100,
      routeTemplateId: route.id,
    });
    const wo1Id = (wo1.data as { id: string }).id;
    createdWoIds.push(wo1Id);
    const steps1 = await prisma.workOrderStep.findMany({
      where: { workOrderId: wo1Id },
      orderBy: { stepSequence: "asc" },
      select: { plannedSubcontractorId: true, requiredCategoryId: true, notes: true },
    });
    check(
      "WO adımı şablondaki fason firmayı DEVRALDI",
      steps1[0]?.plannedSubcontractorId === firmA.id,
      `beklenen=${firmA.id.slice(0, 8)} gelen=${steps1[0]?.plannedSubcontractorId?.slice(0, 8) ?? "null"}`,
    );
    check("WO adımı şablondaki kategoriyi devraldı", steps1[0]?.requiredCategoryId === category.id);
    check("Şablon notu da klonlandı", steps1[0]?.notes === "şablon notu");
    check("Fason olmayan adım planlamasız kaldı", steps1[1]?.plannedSubcontractorId == null);

    // ── 3) Overlay şablonu ezebilmeli ──
    if (firmB) {
      const wo2 = await svc.create({
        type: "STOCK_PRODUCTION",
        batchNumber: `TEST-RTF2-${suffix}`,
        targetItemId: item.id,
        targetQuantity: 100,
        routeTemplateId: route.id,
        stepPlanning: [{ sequence: 1, plannedSubcontractorId: firmB.id }],
      });
      const wo2Id = (wo2.data as { id: string }).id;
      createdWoIds.push(wo2Id);
      const steps2 = await prisma.workOrderStep.findMany({
        where: { workOrderId: wo2Id },
        orderBy: { stepSequence: "asc" },
        select: { plannedSubcontractorId: true },
      });
      check("stepPlanning overlay şablon default'unu EZDİ", steps2[0]?.plannedSubcontractorId === firmB.id);
    } else {
      console.log("ℹ️  İkinci aktif fason firma yok — overlay testi atlandı");
    }
  } finally {
    // Cleanup — test kendi yarattığını siler
    for (const woId of createdWoIds) {
      await prisma.travelerCard.deleteMany({ where: { workOrderId: woId } });
      await prisma.workOrderStep.deleteMany({ where: { workOrderId: woId } });
      await prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: woId } });
      await prisma.workOrderTargetProperty.deleteMany({ where: { workOrderId: woId } }).catch(() => {});
      await prisma.workOrder.delete({ where: { id: woId } }).catch(() => {});
    }
    await prisma.routeStep.deleteMany({ where: { routeId: route.id } });
    await prisma.route.delete({ where: { id: route.id } }).catch(() => {});
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
