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
// Ayrıca DB UNIQUE index'inin neden konmadığının kanıt yüzeyidir: bu rapor boş
// dönene kadar `CREATE UNIQUE INDEX` deploy anında migration'ı düşürür.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";

/** (tablo, kapsam kolonu) — kapsam varsa mükerrerlik o kapsam İÇİNDE aranır. */
const TABLES: Array<{ table: string; scope?: string; label: string }> = [
  { table: "customers", label: "Müşteri" },
  { table: "items", label: "Kumaş" },
  { table: "colors", label: "Renk" },
  { table: "stations", label: "İstasyon" },
  { table: "machines", scope: "stationId", label: "Makine (istasyon içinde)" },
  { table: "subcontractors", label: "Fason firma" },
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
  console.log("\n=== KATLANMIŞ ADA GÖRE MÜKERRER ANA VERİ (salt-okunur) ===\n");
  for (const t of TABLES) {
    const scopeSel = t.scope ? `"${t.scope}"::text || '|' || ` : "";
    const scopeGrp = t.scope ? `"${t.scope}", ` : "";
    const rows = await prisma.$queryRawUnsafe<
      Array<{ key: string; n: bigint; detail: string }>
    >(
      `SELECT ${scopeSel}"nameFold" AS key, count(*)::bigint AS n,
              string_agg(name || ' [' || CASE WHEN "isActive" THEN 'aktif' ELSE 'PASİF' END || ']',
                         '  |  ' ORDER BY name) AS detail
       FROM "${t.table}"
       GROUP BY ${scopeGrp}"nameFold"
       HAVING count(*) > 1
       ORDER BY count(*) DESC, 1`,
    );
    if (rows.length === 0) continue;
    const extra = rows.reduce((a, r) => a + Number(r.n) - 1, 0);
    totalGroups += rows.length;
    totalExtra += extra;
    console.log(`── ${t.label} (${t.table}) — ${rows.length} grup, ${extra} fazla satır`);
    for (const r of rows) console.log(`     ${r.detail}`);
    console.log("");
  }
  if (totalGroups === 0) {
    console.log("Mükerrer YOK — DB UNIQUE index'i güvenle eklenebilir.\n");
  } else {
    console.log(
      `TOPLAM: ${totalGroups} grup / ${totalExtra} fazla satır.\n` +
        "Bu satırlar dururken `CREATE UNIQUE INDEX ... (\"nameFold\")` migration'ı\n" +
        "deploy anında DÜŞER. Birleştirme kararı işletmenindir; script yazmaz.\n",
    );
  }
  await prisma.$disconnect();
  await pool.end();
}

main().catch((err) => {
  console.error("Beklenmeyen hata:", err);
  process.exit(1);
});
