// "Niyet kaydı" (snapshot) ile "fiziksel baskı audit'i" (LABEL_PRINTED) ayrımı.
// Çalıştırma:  npx tsx scripts/test_label_snapshot_audit_split.ts
//
// Sektör-standardı: seedRollLabelSnapshot YALNIZ snapshot yazar (audit YOK) —
// yazıcısız/iptal niyet kaydı için. recordPrintEvent snapshot + tam BİR
// LABEL_PRINTED audit yazar (gerçek baskı). Doğrulananlar:
//   1. seed → lastLabelSnapshot.customerId yazılır, LABEL_PRINT_EVENT delta = 0.
//   2. recordPrintEvent → snapshot durur, LABEL_PRINT_EVENT delta = +1.
//   3. seed {stock:true} → snapshot.stock=true, audit delta = 0.

import { RollStatus, RollEntrySource } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { LabelService } from "../src/services/label.service";

const labels = new LabelService();
const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

let rollId: string | null = null;
let customerId: string | null = null;

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

const auditCount = (id: string) =>
  prisma.systemLog.count({ where: { recordId: id, tableName: "LABEL_PRINT_EVENT" } });
const snapOf = async (id: string) =>
  ((await prisma.roll.findUnique({ where: { id }, select: { lastLabelSnapshot: true } }))
    ?.lastLabelSnapshot ?? null) as Record<string, unknown> | null;

async function main() {
  console.log("=== Etiket niyet/audit ayrımı testi ===\n");

  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!item) throw new Error("Test verisi yetersiz — aktif Item yok (npm run seed).");
  const customer = await prisma.customer.create({
    data: { code: `TEST-AUD-${stamp}`, name: `TEST Audit ${stamp}` },
    select: { id: true, name: true },
  });
  customerId = customer.id;
  const roll = await prisma.roll.create({
    data: {
      barcode: `TEST-AUD-${stamp}`,
      itemId: item.id,
      colorId: null,
      width: 150,
      initialQty: 50,
      currentQty: 50,
      status: RollStatus.WAREHOUSE,
      qualityGrade: "1.KALITE",
      entrySource: RollEntrySource.SUPPLIER_RECEIPT,
    },
    select: { id: true },
  });
  rollId = roll.id;

  const base = await auditCount(roll.id);

  // --- 1. seed (müşteri) → snapshot yazılır, audit YOK ---
  await labels.seedRollLabelSnapshot(roll.id, undefined, { customerId: customer.id });
  const s1 = await snapOf(roll.id);
  check("1a seed snapshot.customerId yazdı", s1?.customerId === customer.id, JSON.stringify(s1));
  check("1b seed audit YAZMADI (delta=0)", (await auditCount(roll.id)) === base);

  // --- 2. recordPrintEvent → snapshot durur + tam 1 audit ---
  await labels.recordPrintEvent(roll.id, undefined, { customerId: customer.id });
  const s2 = await snapOf(roll.id);
  check("2a recordPrintEvent snapshot.customerId korudu", s2?.customerId === customer.id);
  check("2b recordPrintEvent tam 1 LABEL_PRINTED yazdı (delta=+1)", (await auditCount(roll.id)) === base + 1,
    `count=${await auditCount(roll.id)} base=${base}`);

  // --- 3. seed {stock:true} → stok snapshot, audit YOK ---
  await labels.seedRollLabelSnapshot(roll.id, undefined, { stock: true });
  const s3 = await snapOf(roll.id);
  check("3a seed {stock:true} → snapshot.stock=true", s3?.stock === true && s3?.customerId === undefined, JSON.stringify(s3));
  check("3b seed {stock} audit YAZMADI (delta hâlâ +1)", (await auditCount(roll.id)) === base + 1);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  if (fail > 0) process.exitCode = 1;
}

async function cleanup() {
  if (rollId) {
    await prisma.systemLog.deleteMany({ where: { recordId: rollId } });
    await prisma.roll.deleteMany({ where: { id: rollId } });
  }
  if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } });
  console.log("Cleanup: test kayıtları silindi.");
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((e) => console.error("Cleanup hatası:", e));
    await prisma.$disconnect();
    await pool.end(); // havuz kapanmazsa süreç 30s idle bekler
  });
