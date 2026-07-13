// =============================================================================
// finalizeRollsAtLastStep helper testi — "her rotanın son adımı final üretir" çekirdek.
// Farklı rulolar (barkodlu / barkodsuz açık kumaş / FIRE kalite) son-adım finalize'ından
// geçirilir:
//   - durum kaliteden çözülür (1.KALITE→WAREHOUSE, FIRE→SCRAP, kod yok→WAREHOUSE),
//   - barkodsuz açık kumaşa barkod ÜRETİLİR (WAREHOUSE→"F", SCRAP→"H"); mevcut barkod KORUNUR,
//   - form ACIK, currentStepId null, qualityGradeId boşsa katalogdan backfill.
// Koşum: npx tsx scripts/test_finalize_last_step.ts
// =============================================================================
import prisma from "../src/lib/prisma";
import { RollStatus, RollForm } from "@prisma/client";
import { finalizeRollsAtLastStep } from "../src/services/helpers/roll-finalize.helper";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

async function main(): Promise<void> {
  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  const gWarehouse = await prisma.qualityGrade.findFirst({ where: { targetStatus: RollStatus.WAREHOUSE, isActive: true }, select: { id: true, code: true } });
  if (!item || !gWarehouse) throw new Error("fixture eksik (item / WAREHOUSE hedefli kalite)");
  const stamp = Date.now();
  const created: string[] = [];
  // SCRAP hedefli kalite seed'de yok (hepsi WAREHOUSE) → non-WAREHOUSE çözümünü test etmek
  // için geçici bir grade yarat (finally'de silinir).
  const gScrap = await prisma.qualityGrade.create({
    data: { code: `TEST-SCRAP-${stamp}`, name: "Test SCRAP kalite", targetStatus: RollStatus.SCRAP },
    select: { id: true, code: true },
  });

  const mk = async (data: Record<string, unknown>): Promise<string> => {
    const r = await prisma.roll.create({
      data: {
        itemId: item.id, initialQty: 100, currentQty: 100, status: RollStatus.IN_PRODUCTION,
        currentStepId: null, entrySource: "SUPPLIER_RECEIPT", form: RollForm.TOP, ...data,
      } as never,
      select: { id: true },
    });
    created.push(r.id);
    return r.id;
  };

  try {
    // 1) Barkodlu 1.kalite (WAREHOUSE hedefli), qualityGradeId NULL → backfill beklenir.
    const rBarcoded = await mk({ barcode: `TFIN-${stamp}-A`, qualityGrade: gWarehouse.code, qualityGradeId: null });
    // 2) Barkodsuz açık kumaş (fason dönüşü benzeri), 1.kalite → WAREHOUSE + barkod ÜRETİLİR.
    const rOpen = await mk({ barcode: null, qualityGrade: gWarehouse.code, qualityGradeId: gWarehouse.id, entrySource: "SUBCONTRACTOR_RETURN", form: RollForm.ACIK });
    // 3) Barkodsuz FIRE kalite → SCRAP (barkod tipi "H").
    const rFire = await mk({ barcode: null, qualityGrade: gScrap.code, qualityGradeId: gScrap.id });

    await prisma.$transaction(async (tx) => {
      await finalizeRollsAtLastStep(tx, [rBarcoded, rOpen, rFire]);
    });

    const a = await prisma.roll.findUniqueOrThrow({ where: { id: rBarcoded }, select: { status: true, barcode: true, form: true, qualityGradeId: true, currentStepId: true } });
    const b = await prisma.roll.findUniqueOrThrow({ where: { id: rOpen }, select: { status: true, barcode: true, form: true } });
    const c = await prisma.roll.findUniqueOrThrow({ where: { id: rFire }, select: { status: true, barcode: true } });

    check("Barkodlu 1.kalite → WAREHOUSE", a.status === RollStatus.WAREHOUSE, a.status);
    check("Barkodlu topun barkodu KORUNDU", a.barcode === `TFIN-${stamp}-A`, a.barcode ?? "null");
    check("Finalize form ACIK yaptı", a.form === RollForm.ACIK, a.form);
    check("qualityGradeId katalogdan backfill edildi", a.qualityGradeId === gWarehouse.id);
    check("currentStepId temizlendi", a.currentStepId === null);

    check("Açık kumaş → WAREHOUSE", b.status === RollStatus.WAREHOUSE, b.status);
    check("Açık kumaşa 'F' barkodu ÜRETİLDİ", !!b.barcode && /^T\d{6}F\d{4}$/.test(b.barcode), b.barcode ?? "null");
    check("Açık kumaş form ACIK", b.form === RollForm.ACIK);

    check("FIRE kalite → SCRAP (kaliteden çözüldü)", c.status === RollStatus.SCRAP, c.status);
    check("SCRAP topa 'H' barkodu üretildi", !!c.barcode && /^T\d{6}H\d{4}$/.test(c.barcode), c.barcode ?? "null");

    // Idempotent: ikinci finalize barkodu değiştirmemeli.
    const bcBefore = b.barcode;
    await prisma.$transaction(async (tx) => { await finalizeRollsAtLastStep(tx, [rOpen]); });
    const b2 = await prisma.roll.findUniqueOrThrow({ where: { id: rOpen }, select: { barcode: true } });
    check("Re-finalize idempotent (barkod değişmedi)", b2.barcode === bcBefore, b2.barcode ?? "null");
  } finally {
    await prisma.roll.deleteMany({ where: { id: { in: created } } }).catch(() => {});
    await prisma.qualityGrade.delete({ where: { id: gScrap.id } }).catch(() => {});
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => { console.error("HATA:", e); fail++; })
  .finally(async () => { await prisma.$disconnect(); process.exit(fail > 0 ? 1 : 0); });
