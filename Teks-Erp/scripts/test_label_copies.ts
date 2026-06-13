// =============================================================================
// Test: Saha #6 — etiket kopya adedi (default 2, override'lı)
// Çalıştır: npx tsx scripts/test_label_copies.ts
// Doğrulananlar:
//   1. readLabelCopies default 2 (ayar yokken)
//   2. getRollLabelHtml default ayarla 2 etiket sayfası döner
//   3. copies override (1 ve 3) çalışır, 5 üstü kırpılır
// =============================================================================
import prisma from "../src/lib/prisma";
import { LabelService } from "../src/services/label.service";
import { readLabelCopies, SETTING_KEYS } from "../src/services/system-setting.service";

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
const countLabels = (html: string) => (html.match(/class="label"/g) ?? []).length;

async function main() {
  const svc = new LabelService();

  // Ayar yokken default 2 (varsa mevcut değeri not et, test sonunda dokunma —
  // yalnız ayar YOKSA default'u doğrula).
  const existing = await prisma.systemSetting.findUnique({
    where: { key: SETTING_KEYS.LABEL_COPIES },
  });
  const flagVal = await readLabelCopies();
  if (!existing) {
    check("Ayar yokken default 2", flagVal === 2, `okunan=${flagVal}`);
  } else {
    console.log(`ℹ️  label.copies ayarı mevcut (${JSON.stringify(existing.value)}) — default testi atlandı`);
  }

  // Kendi fixture'ını yarat (hazır veriye dayanma — taze/CI DB'de barkodlu top yok).
  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!item) throw new Error("Seed ürünü yok (npm run seed)");
  const roll = await prisma.roll.create({
    data: {
      barcode: `TEST-LBLC-${Date.now()}`,
      itemId: item.id,
      status: "WAREHOUSE",
      currentQty: 100,
      initialQty: 100,
      width: 150,
      qualityGrade: "A",
      entrySource: "SUPPLIER_RECEIPT",
    },
    select: { id: true, barcode: true },
  });

  try {
    const def = await svc.getRollLabelHtml(roll.id);
    check(
      `Default baskı ${flagVal} etiket sayfası içeriyor`,
      countLabels(def.data.html) === flagVal,
      `sayfa=${countLabels(def.data.html)}`,
    );

    const one = await svc.getRollLabelHtml(roll.id, undefined, { copies: 1 });
    check("copies=1 override tek etiket", countLabels(one.data.html) === 1);

    const three = await svc.getRollLabelHtml(roll.id, undefined, { copies: 3 });
    check("copies=3 override üç etiket", countLabels(three.data.html) === 3);
    check(
      "3 kopyada 2 sayfa kesmesi var (page-break-after)",
      (three.data.html.match(/page-break-after: always/g) ?? []).length === 2,
    );

    const ten = await svc.getRollLabelHtml(roll.id, undefined, { copies: 10 });
    check("copies=10 → 5'e kırpılır", countLabels(ten.data.html) === 5);
  } finally {
    await prisma.roll.delete({ where: { id: roll.id } }).catch(() => {});
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
