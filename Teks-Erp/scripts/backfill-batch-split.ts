// One-off: mevcut rulolara Phase 4 dal kimliği (Roll.batchSplitId) doldurur.
// Idempotent — sadece NULL olanları doldurur, veri silmez/değiştirmez.
// Anahtar = origin SubcontractorDispatch.id. Zincir:
//   1) sevk edilen orijinal toplar       → dispatch.id
//   2) o sevki kabul eden born roll'lar   → (receipt kaynak dispatch'i) dispatch.id
//   3) Tambur'da bölünen çocuklar         → parent.batchSplitId (çok seviyeli)
// Çalıştır: npx ts-node scripts/backfill-batch-split.ts
import prisma from "../src/lib/prisma";

(async () => {
  // 1) Orijinal sevk topları.
  const dispatches = await prisma.subcontractorDispatch.findMany({
    select: { id: true, items: { select: { rollId: true } } },
  });
  let c1 = 0;
  for (const d of dispatches) {
    const rollIds = d.items.map((i) => i.rollId);
    if (rollIds.length === 0) continue;
    const res = await prisma.roll.updateMany({
      where: { id: { in: rollIds }, batchSplitId: null },
      data: { batchSplitId: d.id },
    });
    c1 += res.count;
  }
  console.log(`1) Orijinal sevk topları: ${c1} rulo damgalandı`);

  // 2) Born roll'lar (fason dönüşü açık kumaş) — receipt'in kaynak dispatch'i.
  const receipts = await prisma.subcontractorReceipt.findMany({
    select: { id: true, items: { select: { sourceDispatchItem: { select: { dispatchId: true } } } } },
  });
  let c2 = 0;
  for (const r of receipts) {
    const dispatchId = r.items.map((i) => i.sourceDispatchItem?.dispatchId).find(Boolean);
    if (!dispatchId) continue;
    const res = await prisma.roll.updateMany({
      where: { parentReceiptId: r.id, batchSplitId: null },
      data: { batchSplitId: dispatchId },
    });
    c2 += res.count;
  }
  console.log(`2) Born roll'lar: ${c2} rulo damgalandı`);

  // 3) Tambur çocukları (ve daha derin) — parent zincirinden kalıt.
  let c3 = 0;
  let pass = 0;
  let changed = 0;
  do {
    changed = 0;
    pass++;
    const orphans = await prisma.roll.findMany({
      where: { batchSplitId: null, parentRollId: { not: null } },
      select: { id: true, parent: { select: { batchSplitId: true } } },
    });
    for (const o of orphans) {
      if (o.parent?.batchSplitId) {
        await prisma.roll.update({ where: { id: o.id }, data: { batchSplitId: o.parent.batchSplitId } });
        changed++;
        c3++;
      }
    }
  } while (changed > 0 && pass < 20);
  console.log(`3) Tambur çocukları: ${c3} rulo damgalandı (${pass} geçiş)`);

  const total = await prisma.roll.count({ where: { batchSplitId: { not: null } } });
  console.log(`\n✅ Backfill bitti. Toplam dal kimlikli rulo: ${total}`);
  await prisma.$disconnect();
})().catch((e) => {
  console.error("HATA:", e);
  process.exit(1);
});
