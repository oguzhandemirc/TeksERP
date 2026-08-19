// =============================================================================
// KAYIT KÜNYESİ geriye dönük doldurma — audit'ten createdById/updatedById
// Çalıştır: npx tsx scripts/backfill-record-provenance.ts [--apply]
// =============================================================================
// Tasarım: docs/design/KAYIT-KUNYESI-TASARIM.md
//
// ⚠️ ZAMANA DUYARLI: kaynak veri `system_logs`'ta duruyor ama 6 ayda
// `system_log_archives`'a taşınıyor. Ne kadar erken koşulursa o kadar eksiksiz.
// (Bu script arşivi DE tarar — taşınmış olsa bile bulur.)
//
// ⚠️ DRY-RUN VARSAYILAN (canlı veri kuralı). `--apply` verilmeden hiçbir şey
// yazılmaz; etkilenecek kayıt sayısı tablo tablo listelenir.
//
// ⚠️ UYDURMA YOK: audit'te eşleşme bulunamayan kayıt `null` kalır. "En yakın
// kullanıcıyı ata" gibi bir tahmin, künyenin tüm değerini yok ederdi.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";

const APPLY = process.argv.includes("--apply");

/** Prisma model adı → audit `tableName` değeri. */
const MAP: Array<{ model: string; table: string }> = [
  { model: "color", table: "COLOR" },
  { model: "customer", table: "CUSTOMER" },
  { model: "customerBranch", table: "CUSTOMER_BRANCH" },
  { model: "defectType", table: "DEFECT_TYPE" },
  { model: "fabricProperty", table: "FABRIC_PROPERTY" },
  { model: "item", table: "ITEM" },
  { model: "machine", table: "MACHINE" },
  { model: "order", table: "ORDER" },
  { model: "peripheralDevice", table: "PERIPHERAL_DEVICE" },
  { model: "productRecipe", table: "PRODUCT_RECIPE" },
  { model: "qualityGrade", table: "QUALITY_GRADE" },
  { model: "returnReason", table: "RETURN_REASON" },
  { model: "route", table: "ROUTE" },
  { model: "station", table: "STATION" },
  { model: "subcontractor", table: "SUBCONTRACTOR" },
  { model: "labelTemplate", table: "LABEL_TEMPLATE" },
  { model: "batch", table: "BATCH" },
];

/**
 * Tek SQL'de doldurma: sıcak tablo + arşiv birleşiminden kaydın İLK CREATE'i
 * (createdById) ve SON kaydı (updatedById) bulunur.
 *
 * `DISTINCT ON` PostgreSQL'e özgü ama burada doğru araç: kayıt başına tek satır
 * seçmek için pencere fonksiyonu + alt sorgudan hem kısa hem hızlı.
 */
async function backfill(model: string, table: string): Promise<{ created: number; updated: number }> {
  const phys = await prisma.$queryRawUnsafe<{ t: string }[]>(
    `SELECT c.relname AS t FROM pg_class c
     JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind='r'
       AND EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name=c.relname AND column_name='createdById')
       AND c.relname = $1`,
    tableNameFor(model),
  );
  if (phys.length === 0) return { created: -1, updated: -1 };
  const t = phys[0]!.t;

  const countSql = (col: "createdById" | "updatedById", action: string, order: string) => `
    SELECT count(*)::int AS n FROM "${t}" x
    WHERE x."${col}" IS NULL AND EXISTS (
      SELECT 1 FROM (
        SELECT "userId" FROM system_logs
         WHERE "tableName"=$1 AND "recordId"=x.id::text AND "userId" IS NOT NULL ${action}
        UNION ALL
        SELECT "userId" FROM system_log_archives
         WHERE "tableName"=$1 AND "recordId"=x.id::text AND "userId" IS NOT NULL ${action}
      ) s
    )`;
  const updSql = (col: "createdById" | "updatedById", action: string, order: string) => `
    UPDATE "${t}" x SET "${col}" = (
      SELECT s."userId" FROM (
        SELECT "userId", "createdAt" FROM system_logs
         WHERE "tableName"=$1 AND "recordId"=x.id::text AND "userId" IS NOT NULL ${action}
        UNION ALL
        SELECT "userId", "createdAt" FROM system_log_archives
         WHERE "tableName"=$1 AND "recordId"=x.id::text AND "userId" IS NOT NULL ${action}
      ) s ORDER BY s."createdAt" ${order} LIMIT 1
    ) WHERE x."${col}" IS NULL`;

  const CREATE_F = `AND action='CREATE'`;
  const ANY_F = ``;
  if (!APPLY) {
    const c = await prisma.$queryRawUnsafe<{ n: number }[]>(countSql("createdById", CREATE_F, "ASC"), table);
    const u = await prisma.$queryRawUnsafe<{ n: number }[]>(countSql("updatedById", ANY_F, "DESC"), table);
    return { created: c[0]!.n, updated: u[0]!.n };
  }
  const c = await prisma.$executeRawUnsafe(updSql("createdById", CREATE_F, "ASC"), table);
  const u = await prisma.$executeRawUnsafe(updSql("updatedById", ANY_F, "DESC"), table);
  return { created: c, updated: u };
}

/** Prisma model adı → fiziksel tablo adı (@@map değerleri). */
function tableNameFor(model: string): string {
  const M: Record<string, string> = {
    color: "colors", customer: "customers", customerBranch: "customer_branches",
    defectType: "defect_types", fabricProperty: "fabric_properties", item: "items",
    machine: "machines", order: "orders", peripheralDevice: "peripheral_devices",
    productRecipe: "product_recipes", qualityGrade: "quality_grades",
    returnReason: "return_reasons", route: "routes", station: "stations",
    subcontractor: "subcontractors", labelTemplate: "label_templates", batch: "batches",
  };
  return M[model] ?? model;
}

async function main(): Promise<void> {
  console.log(`=== Kayıt künyesi backfill — ${APPLY ? "UYGULAMA" : "DRY-RUN (yazma yok)"} ===\n`);
  let tc = 0, tu = 0;
  for (const { model, table } of MAP) {
    const r = await backfill(model, table);
    if (r.created < 0) { console.log(`  ⚠️ ${model}: künye kolonu yok, atlandı`); continue; }
    tc += r.created; tu += r.updated;
    if (r.created || r.updated) {
      console.log(`  ${model.padEnd(18)} oluşturan: ${String(r.created).padStart(5)}   son değiştiren: ${String(r.updated).padStart(5)}`);
    }
  }
  console.log(`\n  TOPLAM  oluşturan: ${tc}   son değiştiren: ${tu}`);
  if (!APPLY) console.log("\n  → Uygulamak için: npx tsx scripts/backfill-record-provenance.ts --apply");
  await prisma.$disconnect(); await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
