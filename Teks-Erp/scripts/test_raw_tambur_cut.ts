// Ham (renksiz) top Tambur "Top Kesme" davranış testi.
// Çalıştırma:  npx ts-node scripts/test_raw_tambur_cut.ts
// Test verisi üzerinde çalışır; ürettiği rolleri sonunda temizler.
//
// Doğrulananlar:
//   1. Ham STOCK + renksiz parent kesilebilir (guard gevşetildi).
//   2. rawDestination='STOCK'     → çocuk STOCK + renksiz (üretime geri döner).
//   3. rawDestination='WAREHOUSE' → çocuk WAREHOUSE + renksiz (sevke hazır ham).
//   4. STOCK çocuk WO-bağlama filtresine (status===STOCK) uygun.
//   5. Etiket türü colorId==null → ROLL_RAW (ham STOCK, ham WAREHOUSE), renkli → ROLL_FINISHED.
//   6. finalizeWarehouseCut ham STOCK parent'ı arşivler (guard gevşetildi).
//   7. IN_PRODUCTION top kesime reddedilir (guard hâlâ koruyor).

import { RollStatus, RollEntrySource } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { TamburService } from "../src/services/tambur.service";
import { LabelService } from "../src/services/label.service";

const tambur = new TamburService();
const labels = new LabelService();
const created: string[] = []; // temizlik için üretilen roll id'leri

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function makeRawStockRoll(qty: number) {
  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!item) throw new Error("Test verisi yetersiz — aktif Item yok (önce npm run seed).");
  const roll = await prisma.roll.create({
    data: {
      barcode: `TEST-RAW-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      itemId: item.id,
      colorId: null, // RENKSİZ = ham
      width: 150,
      initialQty: qty,
      currentQty: qty,
      status: RollStatus.STOCK,
      qualityGrade: "1.KALITE",
      entrySource: RollEntrySource.SUPPLIER_RECEIPT,
    },
    select: { id: true, itemId: true },
  });
  created.push(roll.id);
  return roll;
}

async function main() {
  console.log("=== Ham Tambur Kesim Testi ===\n");

  // --- Test 1+2: ham parent, rawDestination=STOCK ---
  const p1 = await makeRawStockRoll(100);
  const r1 = await tambur.cutWarehouseRoll(p1.id, { cutLength: 30, rawDestination: "STOCK" });
  const child1 = r1.data.childRoll;
  created.push(child1.id);
  check("Ham STOCK parent kesilebildi (guard gevşek)", !!child1);
  check("STOCK hedef → çocuk STOCK", child1.status === RollStatus.STOCK, `status=${child1.status}`);
  check("STOCK çocuk renksiz kaldı (ham)", child1.colorId === null, `colorId=${child1.colorId}`);
  check("Çocuk entrySource TAMBUR_SPLIT", child1.entrySource === RollEntrySource.TAMBUR_SPLIT);
  check("Parent STOCK kaldı (bitmiş sayılmadı)", r1.data.parentRoll.status === RollStatus.STOCK,
    `status=${r1.data.parentRoll.status}`);
  check("Parent metrajı düştü (100→70)", r1.data.parentRemainingQty === 70,
    `kalan=${r1.data.parentRemainingQty}`);

  // --- Test 3: aynı parent, rawDestination=WAREHOUSE ---
  const r2 = await tambur.cutWarehouseRoll(p1.id, { cutLength: 20, rawDestination: "WAREHOUSE" });
  const child2 = r2.data.childRoll;
  created.push(child2.id);
  check("WAREHOUSE hedef → çocuk WAREHOUSE", child2.status === RollStatus.WAREHOUSE,
    `status=${child2.status}`);
  check("WAREHOUSE çocuk yine renksiz (ham-bitmiş)", child2.colorId === null,
    `colorId=${child2.colorId}`);

  // --- Test 4: STOCK çocuk WO-bağlama filtresine uygun mu (status===STOCK) ---
  // workorder.service R10: acceptedRollStatuses = [STOCK]. TAMBUR_SPLIT olması engel değil.
  const bindable = await prisma.roll.findFirst({
    where: { id: child1.id, status: RollStatus.STOCK },
    select: { id: true },
  });
  check("STOCK çocuk WO'ya bağlanabilir (status===STOCK)", !!bindable);

  // --- Test 5: etiket türü ---
  const lblRawStock = await labels.getRollLabelHtml(child1.id);
  check("Ham STOCK çocuk → etiket ROLL_RAW", lblRawStock.data.kind === "ROLL_RAW",
    `kind=${lblRawStock.data.kind}`);
  const lblRawWh = await labels.getRollLabelHtml(child2.id);
  check("Ham WAREHOUSE çocuk → etiket ROLL_RAW", lblRawWh.data.kind === "ROLL_RAW",
    `kind=${lblRawWh.data.kind}`);

  // Renkli (colorId dolu) bir top → ROLL_FINISHED kontrolü
  const color = await prisma.color.findFirst({ select: { id: true } });
  if (color) {
    const coloredRoll = await prisma.roll.create({
      data: {
        barcode: `TEST-COLORED-${Date.now()}`,
        itemId: p1.itemId,
        colorId: color.id,
        width: 150,
        initialQty: 10,
        currentQty: 10,
        status: RollStatus.WAREHOUSE,
        qualityGrade: "1.KALITE",
        entrySource: RollEntrySource.TAMBUR_SPLIT,
      },
      select: { id: true },
    });
    created.push(coloredRoll.id);
    const lblColored = await labels.getRollLabelHtml(coloredRoll.id);
    check("Renkli top → etiket ROLL_FINISHED", lblColored.data.kind === "ROLL_FINISHED",
      `kind=${lblColored.data.kind}`);
  } else {
    console.log("ℹ️  Renk yok — renkli-FINISHED testi atlandı.");
  }

  // --- Test 6: finalizeWarehouseCut ham STOCK parent'ı arşivler ---
  const fin = await tambur.finalizeWarehouseCut(p1.id, { remainingAction: "discard" });
  const archived = await prisma.roll.findUnique({ where: { id: p1.id }, select: { status: true } });
  check("finalizeWarehouseCut ham parent'ı kabul etti", !!fin.success);
  check("Ham parent TAMBUR_CONSUMED'a arşivlendi", archived?.status === RollStatus.TAMBUR_CONSUMED,
    `status=${archived?.status}`);

  // --- Test 7: IN_PRODUCTION top kesime reddedilmeli (guard koruyor) ---
  const inProd = await prisma.roll.create({
    data: {
      barcode: `TEST-INPROD-${Date.now()}`,
      itemId: p1.itemId,
      colorId: null,
      width: 150,
      initialQty: 50,
      currentQty: 50,
      status: RollStatus.IN_PRODUCTION,
      qualityGrade: "1.KALITE",
      entrySource: RollEntrySource.SUPPLIER_RECEIPT,
    },
    select: { id: true },
  });
  created.push(inProd.id);
  let rejected = false;
  try {
    await tambur.cutWarehouseRoll(inProd.id, { cutLength: 5, rawDestination: "STOCK" });
  } catch {
    rejected = true;
  }
  check("IN_PRODUCTION top kesime reddedildi (guard)", rejected);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  if (fail > 0) process.exitCode = 1;
}

async function cleanup() {
  // Test rollerini fiziksel sil (test artefaktı). Çocukları önce sil (parentRollId FK).
  if (created.length === 0) return;
  await prisma.systemLog.deleteMany({ where: { recordId: { in: created } } });
  await prisma.rollProperty.deleteMany({ where: { rollId: { in: created } } });
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: created } } });
  // parentRollId self-FK: child'ları (parentRollId set) önce sil.
  await prisma.roll.deleteMany({ where: { id: { in: created }, parentRollId: { not: null } } });
  await prisma.roll.deleteMany({ where: { id: { in: created } } });
  console.log(`Cleanup: ${created.length} test roll silindi.`);
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((e) => console.error("Cleanup hatası:", e));
    await prisma.$disconnect();
  });
