// Demo: İade Takibi (aktif + iptal edilmiş) ve Sevkiyat listesi iade rozetini
// görebilmek için mock veri üretir. GERÇEK servis akışını kullanır
// (returnService.createReturn / cancelReturn) → roll statüleri (SHIPPED↔WAREHOUSE,
// shipmentId) ve snapshot'lar tutarlı kalır; elle inconsistent kayıt yazmaz.
//
// Idempotent: [DEMO] etiketli iade varsa tekrar üretmez (sadece durum yazdırır).
// Çalıştır: npx ts-node scripts/seed-iade-demo.ts
import prisma from "../src/lib/prisma";
import { returnService } from "../src/services/return.service";
import { RollStatus } from "@prisma/client";

const DEMO_TAG = "[DEMO]";

async function printSummary(label: string) {
  const [active, cancelled] = await Promise.all([
    prisma.rollReturn.count({ where: { cancelledAt: null } }),
    prisma.rollReturn.count({ where: { cancelledAt: { not: null } } }),
  ]);
  const badged = await prisma.shipment.findMany({
    where: { returns: { some: { cancelledAt: null } } },
    select: {
      shipmentNo: true,
      _count: { select: { returns: { where: { cancelledAt: null } } } },
    },
    orderBy: { shipmentNo: "asc" },
  });
  console.log(`\n📊 ${label}: İade Takibi → aktif=${active}, iptal=${cancelled}, hepsi=${active + cancelled}`);
  if (badged.length) {
    console.log("   Sevkiyat listesi rozetleri:");
    badged.forEach((s) => console.log(`     • ${s.shipmentNo} → ${s._count.returns} iade`));
  }
}

async function main() {
  const admin = await prisma.user.findUnique({
    where: { username: "admin" },
    select: { id: true },
  });
  if (!admin) throw new Error("admin kullanıcısı yok — önce `npm run seed` çalıştır.");

  await printSummary("ÖNCE");

  const already = await prisma.rollReturn.count({ where: { note: { startsWith: DEMO_TAG } } });
  if (already > 0) {
    console.log(`\nℹ️  ${already} adet ${DEMO_TAG} iade zaten var — idempotent, yeniden üretilmedi.`);
    await prisma.$disconnect();
    return;
  }

  const reasons = await prisma.returnReason.findMany({ select: { id: true, code: true } });
  const reasonId = (code: string) => reasons.find((r) => r.code === code)?.id ?? null;

  // Sevkiyatı olan SHIPPED top havuzu, şube bazında grupla.
  const shipped = await prisma.roll.findMany({
    where: { status: RollStatus.SHIPPED, shipmentId: { not: null } },
    select: {
      id: true,
      barcode: true,
      shipmentId: true,
      shipment: { select: { shipmentNo: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  if (shipped.length < 3) {
    console.warn(`⚠️  Yeterli SHIPPED top yok (${shipped.length} bulundu) — demo kısmi olabilir.`);
  }

  const byShipment = new Map<string, typeof shipped>();
  for (const r of shipped) {
    const arr = byShipment.get(r.shipmentId!) ?? [];
    arr.push(r);
    byShipment.set(r.shipmentId!, arr);
  }
  // En çok SHIPPED top içeren sevkiyat → 2 aktif iade (rozet "2 iade" görünsün).
  const sorted = [...byShipment.values()].sort((a, b) => b.length - a.length);
  const richest = sorted[0] ?? [];
  const activeTargets = richest.slice(0, 2);

  const created: string[] = [];
  const reasonCycle = ["HASARLI", "YANLIS_RENK_EN", "FAZLA_SEVK", "MUSTERI_VAZGECTI"];

  // --- AKTİF iadeler (aynı sevkiyattan → liste rozeti yükselir) ---
  for (let i = 0; i < activeTargets.length; i++) {
    const roll = activeTargets[i]!;
    await returnService.createReturn(
      {
        rollId: roll.id,
        reasonId: reasonId(reasonCycle[i % reasonCycle.length]!),
        note: `${DEMO_TAG} aktif iade — ${roll.barcode}`,
      },
      admin.id,
    );
    created.push(`aktif:  ${roll.barcode}  (${roll.shipment?.shipmentNo})`);
  }

  // --- İPTAL edilmiş iade: başka sevkiyattan bir topta iade al → hemen iptal et ---
  const cancelTarget = shipped.find((r) => !activeTargets.includes(r));
  if (cancelTarget) {
    const res = (await returnService.createReturn(
      {
        rollId: cancelTarget.id,
        reasonId: reasonId("YANLIS_URUN"),
        note: `${DEMO_TAG} iptal edilecek iade — ${cancelTarget.barcode}`,
      },
      admin.id,
    )) as { data?: { id?: string } };
    const rrId = res?.data?.id;
    if (rrId) {
      await returnService.cancelReturn(
        rrId,
        `${DEMO_TAG} yanlış top okutulmuştu, geri alındı`,
        admin.id,
      );
      created.push(
        `iptal:  ${cancelTarget.barcode}  (${cancelTarget.shipment?.shipmentNo}) → top sevkiyatına geri döndü`,
      );
    }
  }

  console.log(`\n✅ Üretilen demo iadeler (${created.length}):`);
  created.forEach((c) => console.log("   - " + c));

  await printSummary("SONRA");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
