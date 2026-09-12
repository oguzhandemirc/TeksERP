// =============================================================================
// GERİ DOLDURMA — `Roll.labelCustomerId` (2026-08-09)
// =============================================================================
// Kolon `lastLabelSnapshot.customerId`'nin sorgulanabilir aynasıdır ve yalnız
// BUNDAN SONRAKİ baskılarda dolar. Bu script geçmiş satırları JSON'dan okuyup
// kolona taşır.
//
//   npx tsx scripts/backfill_roll_label_customer.ts            # KURU ANLATIM
//   npx tsx scripts/backfill_roll_label_customer.ts --apply    # yazar
//
// ⚠️ DRY-RUN VARSAYILAN (kök CLAUDE.md: canlı veriye dokunan script kuralı) —
// `--apply` öncesi etkilenecek her kayıt somut listelenir.
//
// ⚠️ `{orderLineId}` taşıyan snapshot'lar da çözülür: müşteri o kalemin
// siparişinden gelir. Yalnız `{customerId}` bakmak, sipariş kalemine basılmış
// toplarda kolonu boş bırakır ve müşteri filtresi onları SESSİZCE atlardı.
//
// ⚠️ `{stock: true}` satırları ATLANIR — stok etiketi BİLİNÇLİ bir seçimdir,
// "müşteri bilinmiyor" değil. Onlara bir müşteri uydurmak, filtrenin cevabını
// yanlışlardı.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { izDustuUyarisi, onarimIziYaz } from "./lib/onarim-izi";

const APPLY = process.argv.includes("--apply");
const BATCH = 500;

interface Snap {
  customerId?: unknown;
  orderLineId?: unknown;
  stock?: unknown;
}

async function main(): Promise<void> {
  console.log(APPLY ? "▶ UYGULAMA MODU (yazacak)" : "▶ KURU ANLATIM (hiçbir şey yazılmaz)");

  // Yalnız kolonu boş VE snapshot'ı olan toplar. `labelCustomerId` dolu satırlara
  // dokunulmaz — canlı yazım her zaman daha günceldir.
  // ⚠️ JSON kolonda "null değil" → `Prisma.DbNull` (düz `null` DERLENMEZ).
  // Prisma JSON alanlarında iki ayrı null vardır: DB NULL (`DbNull`) ve JSON
  // `null` literali (`JsonNull`); burada aranan DB NULL'dur.
  const candidates = await prisma.roll.findMany({
    where: { labelCustomerId: null, lastLabelSnapshot: { not: Prisma.DbNull } },
    select: { id: true, barcode: true, lastLabelSnapshot: true },
  });
  console.log(`Aday (kolonu boş + snapshot'ı olan): ${candidates.length}`);

  const direct: Array<{ id: string; barcode: string | null; customerId: string }> = [];
  const viaLine: Array<{ id: string; barcode: string | null; orderLineId: string }> = [];
  let stockSkipped = 0;
  let unparsable = 0;

  for (const r of candidates) {
    const s = (r.lastLabelSnapshot ?? null) as Snap | null;
    if (!s || typeof s !== "object") {
      unparsable++;
      continue;
    }
    if (typeof s.customerId === "string" && s.customerId) {
      direct.push({ id: r.id, barcode: r.barcode, customerId: s.customerId });
    } else if (typeof s.orderLineId === "string" && s.orderLineId) {
      viaLine.push({ id: r.id, barcode: r.barcode, orderLineId: s.orderLineId });
    } else if (s.stock === true) {
      stockSkipped++;
    } else {
      unparsable++;
    }
  }

  // Sipariş kalemi → müşteri çözümü (tek sorguda).
  const lineIds = [...new Set(viaLine.map((v) => v.orderLineId))];
  const lines = lineIds.length
    ? await prisma.orderLine.findMany({
        where: { id: { in: lineIds } },
        select: { id: true, order: { select: { customerId: true } } },
      })
    : [];
  const custByLine = new Map(lines.map((l) => [l.id, l.order.customerId]));

  const plan: Array<{ id: string; barcode: string | null; customerId: string; via: string }> = [
    ...direct.map((d) => ({ ...d, via: "snapshot.customerId" })),
    ...viaLine
      .map((v) => {
        const c = custByLine.get(v.orderLineId);
        return c ? { id: v.id, barcode: v.barcode, customerId: c, via: "orderLine→order" } : null;
      })
      .filter((x): x is { id: string; barcode: string | null; customerId: string; via: string } => x !== null),
  ];
  const orphanLines = viaLine.length - plan.filter((p) => p.via === "orderLine→order").length;

  console.log(`\nDoldurulacak       : ${plan.length}`);
  console.log(`  · snapshot.customerId : ${direct.length}`);
  console.log(`  · orderLine→order     : ${plan.length - direct.length}`);
  console.log(`Atlanan — stok etiketi : ${stockSkipped}  (bilinçli seçim, müşteri YOK)`);
  console.log(`Atlanan — kalem yok    : ${orphanLines}  (silinmiş sipariş kalemi)`);
  console.log(`Atlanan — çözülemeyen  : ${unparsable}`);

  // Müşteri gerçekten var mı — silinmiş/pasif müşteriye FK yazmak migration'ı
  // patlatır. Yazmadan önce doğrula.
  const custIds = [...new Set(plan.map((p) => p.customerId))];
  const liveCust = await prisma.customer.findMany({
    where: { id: { in: custIds } },
    select: { id: true },
  });
  const liveSet = new Set(liveCust.map((c) => c.id));
  const writable = plan.filter((p) => liveSet.has(p.customerId));
  const dangling = plan.length - writable.length;
  if (dangling > 0) console.log(`Atlanan — müşteri yok  : ${dangling}`);

  console.log("\n── Etkilenecek kayıtlar ──");
  for (const p of writable.slice(0, 50)) {
    console.log(`  ${p.barcode ?? "(barkodsuz)"} → ${p.customerId}  [${p.via}]`);
  }
  if (writable.length > 50) console.log(`  … ve ${writable.length - 50} kayıt daha`);

  if (!APPLY) {
    console.log("\n⚠️ KURU ANLATIM — hiçbir şey yazılmadı. Yazmak için: --apply");
    return;
  }

  // Müşteri başına gruplayıp toplu update (satır satır update 10-50x yavaş).
  const byCustomer = new Map<string, string[]>();
  for (const p of writable) {
    const arr = byCustomer.get(p.customerId) ?? [];
    arr.push(p.id);
    byCustomer.set(p.customerId, arr);
  }
  let written = 0;
  for (const [customerId, ids] of byCustomer) {
    for (let i = 0; i < ids.length; i += BATCH) {
      const slice = ids.slice(i, i + BATCH);
      const res = await prisma.roll.updateMany({
        // `labelCustomerId: null` koşulu KORUNUR: script koşarken canlı bir baskı
        // araya girip kolonu doldurmuş olabilir ve o değer daha günceldir.
        where: { id: { in: slice }, labelCustomerId: null },
        data: { labelCustomerId: customerId },
      });
      written += res.count;
    }
  }
  console.log(`\n✔ ${written} kayıt güncellendi.`);

  const SCRIPT = "scripts/backfill_roll_label_customer.ts";
  const izYazildi = await onarimIziYaz({
    script: SCRIPT,
    action: "ROLL_LABEL_CUSTOMER_BACKFILL",
    tableName: "ROLL",
    olcum: {
      guncellenen: written,
      planlanan: plan.length,
      atlanan: plan.length - written,
      musteriSayisi: byCustomer.size,
    },
  });
  if (!izYazildi) {
    console.error(izDustuUyarisi(SCRIPT, false));
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
