// =============================================================================
// SALT-OKUNUR RAPOR: katlanmış ada göre mükerrer ana veri (2026-08-19)
// Çalıştır: npx tsx scripts/find_fold_duplicates.ts
// =============================================================================
// Arama katlaması geldikten sonra "aynı ad" tanımı GENİŞLEDİ: "ŞAHİN" ile
// "SAHIN" artık aynı kayıt sayılır (kullanıcı kararı D3). Uygulama katmanı yeni
// yazımları bu kurala göre reddeder ama GEÇMİŞ satırlara dokunmaz.
//
// Bu script o geçmişi görünür kılar. HİÇBİR ŞEY YAZMAZ — birleştirme bir İŞ
// kararıdır (hangi kayıt kalacak, siparişler/toplar hangisine bağlı).
//
// 2026-08-21 — ÜÇ TABLODA DB SEDDİ VAR: `customers` · `items` · `subcontractors`
// üzerinde partial UNIQUE (`<tablo>_nameFold_key`, `WHERE "mergedIntoId" IS NULL`;
// migration `20260821150000_name_fold_unique_live`). O tablolarda bu rapor artık
// "kısıt konulabilir mi" değil "kısıt neden düşer" sorusunun cevabıdır: sedli
// tabloda bir grup görünüyorsa migration o DB'de DEPLOY ANINDA düşer — önce
// Tanımlar → Mükerrerler ile birleştirin. Diğer tablolar uygulama bekçisiyle
// korunur; oradaki grup yalnız gözlemdir.
//
// ⚠️ SOY BAĞLI tablolarda (customers/items/colors/subcontractors) tombstone'lar
// (`mergedIntoId IS NOT NULL`) SAYILMAZ — birleşmiş kayıt aynı katlanmış adı
// meşru olarak taşımaya devam eder ve DB kısıtı da onu dışarıda bırakır.
// Sayılsaydı rapor kısıttan PESİMİST olur, "mükerrer var" deyip boş yere
// durdururdu.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";

/**
 * (tablo, kapsam kolonu) — kapsam varsa mükerrerlik o kapsam İÇİNDE aranır.
 * `lineage`: `mergedIntoId` kolonu var → tombstone'lar süzülür.
 * `dbUnique`: DB partial UNIQUE VAR → grup görünürse migration düşer.
 */
const TABLES: Array<{
  table: string;
  scope?: string;
  lineage?: boolean;
  dbUnique?: boolean;
  label: string;
}> = [
  { table: "customers", lineage: true, dbUnique: true, label: "Müşteri" },
  { table: "items", lineage: true, dbUnique: true, label: "Kumaş" },
  { table: "colors", lineage: true, label: "Renk" },
  { table: "stations", label: "İstasyon" },
  { table: "machines", scope: "stationId", label: "Makine (istasyon içinde)" },
  { table: "subcontractors", lineage: true, dbUnique: true, label: "Fason firma" },
  { table: "subcontractor_categories", label: "Fason kategorisi" },
  { table: "routes", label: "Rota" },
  { table: "product_recipes", label: "Reçete" },
  { table: "quality_grades", label: "Kalite" },
  { table: "defect_types", label: "Hata tipi" },
  { table: "return_reasons", label: "İade sebebi" },
  { table: "fabric_properties", label: "Özellik" },
  { table: "peripheral_devices", label: "Çevre birimi" },
  { table: "customer_branches", scope: "customerId", label: "Müşteri şubesi (müşteri içinde)" },
  { table: "permission_templates", label: "Yetki şablonu" },
  { table: "label_templates", label: "Etiket şablonu" },
];

async function main(): Promise<void> {
  let totalGroups = 0;
  let totalExtra = 0;
  let seddedGroups = 0;
  console.log("\n=== KATLANMIŞ ADA GÖRE MÜKERRER ANA VERİ (salt-okunur) ===\n");
  for (const t of TABLES) {
    const scopeSel = t.scope ? `"${t.scope}"::text || '|' || ` : "";
    const scopeGrp = t.scope ? `"${t.scope}", ` : "";
    const where = t.lineage ? `WHERE "mergedIntoId" IS NULL` : "";
    const rows = await prisma.$queryRawUnsafe<
      Array<{ key: string; n: bigint; detail: string }>
    >(
      `SELECT ${scopeSel}"nameFold" AS key, count(*)::bigint AS n,
              string_agg(name || ' [' || CASE WHEN "isActive" THEN 'aktif' ELSE 'PASİF' END || ']',
                         '  |  ' ORDER BY name) AS detail
       FROM "${t.table}"
       ${where}
       GROUP BY ${scopeGrp}"nameFold"
       HAVING count(*) > 1
       ORDER BY count(*) DESC, 1`,
    );
    if (rows.length === 0) continue;
    const extra = rows.reduce((a, r) => a + Number(r.n) - 1, 0);
    totalGroups += rows.length;
    totalExtra += extra;
    if (t.dbUnique) seddedGroups += rows.length;
    const tag = t.dbUnique ? "  ⛔ DB SEDDİ VAR — migration bu DB'de DÜŞER" : "";
    console.log(`── ${t.label} (${t.table}) — ${rows.length} grup, ${extra} fazla satır${tag}`);
    for (const r of rows) console.log(`     ${r.detail}`);
    console.log("");
  }
  if (totalGroups === 0) {
    console.log("Mükerrer YOK — sedli tablolarda migration güvenle uygulanır.\n");
  } else {
    console.log(
      `TOPLAM: ${totalGroups} grup / ${totalExtra} fazla satır` +
        (seddedGroups > 0 ? ` (${seddedGroups} grup DB SEDLİ tabloda).\n` : ".\n") +
        (seddedGroups > 0
          ? "⛔ Sedli tablodaki gruplar dururken `20260821150000_name_fold_unique_live`\n" +
            "   migration'ı bu DB'de DÜŞER. Önce Tanımlar → Mükerrerler ile birleştirin.\n"
          : "Sedsiz tablolardaki gruplar gözlemdir — uygulama bekçisi yeni mükerreri engeller.\n") +
        "Birleştirme kararı işletmenindir; script yazmaz.\n",
    );
  }
  await prisma.$disconnect();
  await pool.end();
}

main().catch((err) => {
  console.error("Beklenmeyen hata:", err);
  process.exit(1);
});
