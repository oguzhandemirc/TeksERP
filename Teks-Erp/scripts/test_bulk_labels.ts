// =============================================================================
// Test: Saha #7 — toplu etiket HTML (birleşik belge)
// Çalıştır: npx tsx scripts/test_bulk_labels.ts
// Doğrulananlar:
//   1. getBulkRollLabelsHtml N topun barkodunu tek belgede içerir
//   2. Toplar arası page-break var (her top kendi sayfası)
//   3. Boş liste 400
// =============================================================================
import prisma from "../src/lib/prisma";
import { LabelService } from "../src/services/label.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

async function main() {
  const ts = Date.now();
  const svc = new LabelService();
  const item = await prisma.item.create({
    data: { code: `TST-BLK-${ts}`, name: `BULK ÜRÜN ${ts}`, itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  const mkRoll = (n: number) =>
    prisma.roll.create({
      data: {
        barcode: `TESTBLK${n}${ts}`,
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
  const r1 = await mkRoll(1);
  const r2 = await mkRoll(2);

  try {
    const res = await svc.getBulkRollLabelsHtml([r1.id, r2.id], { copies: 1 });
    const html = res.data.html;
    check("Her iki barkod belgede var", html.includes(r1.barcode!) && html.includes(r2.barcode!));
    check("count=2", res.data.count === 2);
    check("Toplar arası page-break var", /page-break-before:\s*always/i.test(html));
    check("Tek <html> belgesi (birleşik)", (html.match(/<html/gi) ?? []).length === 1);

    let emptyErr = false;
    try {
      await svc.getBulkRollLabelsHtml([], {});
    } catch (e) {
      emptyErr = (e as { statusCode?: number }).statusCode === 400;
    }
    check("Boş liste 400", emptyErr);
  } finally {
    await prisma.roll.deleteMany({ where: { id: { in: [r1.id, r2.id] } } });
    await prisma.item.delete({ where: { id: item.id } }).catch(() => {});
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
