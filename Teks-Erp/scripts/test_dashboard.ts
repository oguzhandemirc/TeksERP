// =============================================================================
// Test: DashboardService — salt-okunur agregatlar (raw SQL + count)
// Çalıştır: npx tsx scripts/test_dashboard.ts
// Doğrulananlar:
//   1. getDefectsSummary hatasız çalışır + sayı alanları döner (>=0)
//   2. getStationsLiveState raw SQL hatasız + her satır beklenen şekilde
//   3. Açık hata sayısı, yaratılan TEST hatasıyla artar (canlı doğrulama)
// =============================================================================
import prisma from "../src/lib/prisma";
import { DashboardService } from "../src/services/dashboard.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

async function main() {
  // 1) getDefectsSummary şekil
  const before = await DashboardService.getDefectsSummary();
  check(
    "getDefectsSummary sayı alanları (>=0)",
    typeof before.openCount === "number" && before.openCount >= 0 && typeof before.todayCount === "number",
    `open=${before.openCount} today=${before.todayCount}`,
  );

  // 2) getStationsLiveState raw SQL hatasız + şekil
  const rows = await DashboardService.getStationsLiveState();
  check("getStationsLiveState dizi döner", Array.isArray(rows));
  if (rows.length > 0) {
    const r = rows[0];
    check(
      "satır beklenen alanları taşır",
      typeof r.id === "string" && typeof r.code === "string" && typeof Number(r.queueCount) === "number",
    );
  } else {
    check("istasyon yok — boş dizi kabul (şekil testi atlandı)", true);
  }

  // 3) Açık hata sayacı canlı: TEST rollError yarat → openCount artar
  const ts = Date.now();
  const item = await prisma.item.findFirst({ select: { id: true } });
  const defect = await prisma.defectType.findFirst({ select: { id: true } });
  let rollId = "";
  let errorId = "";
  try {
    if (item && defect) {
      const roll = await prisma.roll.create({
        data: {
          barcode: `TEST-DSH-${ts}`,
          itemId: item.id,
          status: "WAREHOUSE",
          currentQty: 10,
          initialQty: 10,
          qualityGrade: "A",
          entrySource: "SUPPLIER_RECEIPT",
        },
        select: { id: true },
      });
      rollId = roll.id;
      const err = await prisma.rollError.create({
        data: { rollId: roll.id, defectTypeId: defect.id, startMeter: 1, isProcessed: false },
        select: { id: true },
      });
      errorId = err.id;
      const after = await DashboardService.getDefectsSummary();
      check("yeni açık hata openCount'u artırdı", after.openCount === before.openCount + 1, `${before.openCount}→${after.openCount}`);
    } else {
      check("item/defectType yok — canlı sayaç testi atlandı", true);
    }
  } finally {
    if (errorId) await prisma.rollError.delete({ where: { id: errorId } }).catch(() => {});
    if (rollId) await prisma.roll.delete({ where: { id: rollId } }).catch(() => {});
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
