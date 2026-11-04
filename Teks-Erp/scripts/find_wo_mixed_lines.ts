// =============================================================================
// Tespit: KARIŞIK KALEMLİ İŞ EMRİ — aktif sipariş bağlarında >1 kumaş ya da
// >1 (null olmayan) renk taşıyan iş emirleri. SALT OKUNUR · `--apply` YOKTUR.
// Çalıştır: npx tsx scripts/find_wo_mixed_lines.ts
//           npx tsx scripts/find_wo_mixed_lines.ts --csv     (makine okunur)
//           DATABASE_URL=<başka db> npx tsx scripts/find_wo_mixed_lines.ts
// =============================================================================
// ⚠️ BU SCRIPT HİÇBİR ŞEY YAZMAZ. Ne yapılacağına çıktıya bakılarak AYRICA
// karar verilir (canlı veri kuralı).
//
// SAHA VAKASI (2026-11): BEYAZ + EKRU kalemi tek iş emrine bağlandı, hedef renk
// NULL kaldı, mal boyahaneye renksiz gitti. Kapı artık her yolda 400 veriyor
// (`assertWorkOrderLinesSingleSpec`); bu betik kapıdan ÖNCE doğmuş kayıtları bulur.
// =============================================================================

import prisma, { pool } from "../src/lib/prisma";

const has = (f: string) => process.argv.includes(`--${f}`);
const CSV = has("csv");

type Row = {
  workOrderNumber: string;
  status: string;
  targetColor: string | null;
  colors: string[];
  items: string[];
  orders: string[];
};

async function main(): Promise<void> {
  if (has("apply")) {
    console.error("Bu betik SALT OKUNURDUR; --apply yoktur. Düzeltme ayrı kararla yapılır.");
    process.exitCode = 2;
    return;
  }

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT wo."workOrderNumber"                                         AS "workOrderNumber",
           wo."status"::text                                            AS "status",
           tc."name"                                                    AS "targetColor",
           COALESCE(ARRAY_AGG(DISTINCT c."name") FILTER (WHERE c."name" IS NOT NULL), '{}') AS "colors",
           ARRAY_AGG(DISTINCT i."name")                                 AS "items",
           ARRAY_AGG(DISTINCT o."orderNumber")                          AS "orders"
      FROM "work_order_to_order_lines" l
      JOIN "work_orders" wo ON wo."id" = l."workOrderId"
      JOIN "order_lines" ol ON ol."id" = l."orderLineId"
      JOIN "orders"      o  ON o."id"  = ol."orderId"
      JOIN "items"       i  ON i."id"  = ol."itemId"
      LEFT JOIN "colors" c  ON c."id"  = ol."colorId"
      LEFT JOIN "colors" tc ON tc."id" = wo."targetColorId"
     WHERE l."unlinkedAt" IS NULL
     GROUP BY wo."id", wo."workOrderNumber", wo."status", tc."name"
    HAVING COUNT(DISTINCT ol."colorId") FILTER (WHERE ol."colorId" IS NOT NULL) > 1
        OR COUNT(DISTINCT ol."itemId") > 1
     ORDER BY wo."workOrderNumber"`;

  if (CSV) {
    console.log("is_emri;statu;hedef_renk;renkler;kumaslar;siparisler");
    for (const r of rows) {
      console.log(
        [r.workOrderNumber, r.status, r.targetColor ?? "", r.colors.join("|"), r.items.join("|"), r.orders.join("|")].join(";"),
      );
    }
    return;
  }

  if (rows.length === 0) {
    console.log("Karışık renk/kumaş kalemli iş emri yok.");
    return;
  }
  console.log(`Karışık renk/kumaş kalemli ${rows.length} iş emri:\n`);
  for (const r of rows) {
    console.log(`${r.workOrderNumber}  [${r.status}]  hedef renk: ${r.targetColor ?? "YOK (NULL)"}`);
    console.log(`  renkler : ${r.colors.join(", ") || "-"}`);
    console.log(`  kumaşlar: ${r.items.join(", ")}`);
    console.log(`  siparişler: ${r.orders.join(", ")}\n`);
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
