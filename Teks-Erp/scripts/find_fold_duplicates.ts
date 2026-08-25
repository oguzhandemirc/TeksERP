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
// migration `20260821150000_name_fold_unique_live`). 2026-08-22'den beri migration
// YUMUŞAK KAPIDIR: sedli tabloda grup varsa index'i ATLAR (NOTICE), deploy geçer;
// o tabloda sed, gruplar birleştirilip migration dosyası yeniden koşulana
// (enforce) dek EKSİK kalır. Bu rapor o tabloda "enforce neden bekliyor"
// sorusunun cevabıdır — önce Sistem → Mükerrer Kayıtlar ile birleştirin. Diğer
// tablolar uygulama bekçisiyle korunur; oradaki grup yalnız gözlemdir.
//
// 2026-08-25 — RENK DE SEDLİ, ama KENDİ KURALIYLA: `colors_nameFoldColor_key`
// (`20260825120000_color_name_unique_live`) düz `nameFold` üzerinde DEĞİL,
// `tr_fold_color(name)` ifadesi üzerindedir — ayraç + sayı-sırası bağımsız
// ("055-BEYAZ" ≡ "BEYAZ 055"). Bu rapor renk gruplarını o yüzden JS kuralıyla
// (`foldColorNameForCompare`) kurar; düz `nameFold` ile gruplasaydı seddin
// yakaladığı çiftleri KAÇIRIR, "temiz" der, migration ise ATLANDI derdi.
// (Fonksiyon migration'la gelir; JS kuralı DB'siz de doğru cevabı verir.)
//
// ⚠️ SOY BAĞLI tablolarda (customers/items/colors/subcontractors) tombstone'lar
// (`mergedIntoId IS NOT NULL`) SAYILMAZ — birleşmiş kayıt aynı katlanmış adı
// meşru olarak taşımaya devam eder ve DB kısıtı da onu dışarıda bırakır.
// Sayılsaydı rapor kısıttan PESİMİST olur, "mükerrer var" deyip boş yere
// durdururdu.
//
// KESKİN TARAMALAR (sondaki bölüm — yalnız GÖZLEM, sed bunlara BAKMAZ):
// Fabrika deploy'unda (2026-08-24) katlanmış ada göre bulunan 11 grubun dışında
// 4 gerçek mükerrer daha çıktı ve hepsi bu raporun kör noktasındaydı:
// "MİKRO CANVAS" ↔ "MIKROCANVAS" (tek fark boşluk), "BAYROFLAM" ↔ "bayroflam"
// (adlar farklı, KOD harf farkıyla aynı — `code` UNIQUE'i harf DUYARLI),
// "292-7791-GRİ" ↔ "GRİ-(292-7791)" (parantez). Bu yüzden iki ek tarama var:
// (a) noktalama/boşluk atılınca aynı olan adlar, (b) harf-duyarsız kod çakışması.
// Bunlar ENGEL değil ADAYDIR — karar yine işletmenin (Mükerrer Kayıtlar paneli).
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { foldColorNameForCompare } from "../src/services/helpers/name-normalize.helper";

/**
 * (tablo, kapsam kolonu) — kapsam varsa mükerrerlik o kapsam İÇİNDE aranır.
 * `lineage`: `mergedIntoId` kolonu var → tombstone'lar süzülür.
 * `enforce`: DB partial UNIQUE VAR (o migration dosyasıyla kurulur) → grup
 *            görünürse index o DB'de atlanmıştır, enforce bekler.
 * `colorRule`: gruplama düz `nameFold` ile değil JS renk kuralıyla.
 */
const TABLES: Array<{
  table: string;
  scope?: string;
  lineage?: boolean;
  enforce?: string;
  colorRule?: boolean;
  label: string;
}> = [
  { table: "customers", lineage: true, enforce: "20260821150000_name_fold_unique_live", label: "Müşteri" },
  { table: "items", lineage: true, enforce: "20260821150000_name_fold_unique_live", label: "Kumaş" },
  { table: "colors", lineage: true, enforce: "20260825120000_color_name_unique_live", colorRule: true, label: "Renk" },
  { table: "stations", label: "İstasyon" },
  { table: "machines", scope: "stationId", label: "Makine (istasyon içinde)" },
  { table: "subcontractors", lineage: true, enforce: "20260821150000_name_fold_unique_live", label: "Fason firma" },
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

/** Keskin taramaların kapsamı — soy bağlı + kodlu dört ana veri tablosu. */
const SHARP_TABLES: Array<{ table: string; label: string; colorRule?: boolean }> = [
  { table: "customers", label: "Müşteri" },
  { table: "items", label: "Kumaş" },
  { table: "colors", label: "Renk", colorRule: true },
  { table: "subcontractors", label: "Fason firma" },
];

type Group = { key: string; n: number; detail: string };

/** Düz `nameFold` (ya da kapsam|nameFold) ile SQL gruplama. */
async function foldGroups(t: (typeof TABLES)[number]): Promise<Group[]> {
  const scopeSel = t.scope ? `"${t.scope}"::text || '|' || ` : "";
  const scopeGrp = t.scope ? `"${t.scope}", ` : "";
  const where = t.lineage ? `WHERE "mergedIntoId" IS NULL` : "";
  const rows = await prisma.$queryRawUnsafe<Array<{ key: string; n: bigint; detail: string }>>(
    `SELECT ${scopeSel}"nameFold" AS key, count(*)::bigint AS n,
            string_agg(name || ' [' || CASE WHEN "isActive" THEN 'aktif' ELSE 'PASİF' END || ']',
                       '  |  ' ORDER BY name) AS detail
     FROM "${t.table}"
     ${where}
     GROUP BY ${scopeGrp}"nameFold"
     HAVING count(*) > 1
     ORDER BY count(*) DESC, 1`,
  );
  return rows.map((r) => ({ key: r.key, n: Number(r.n), detail: r.detail }));
}

/** Renk: JS kuralıyla (`foldColorNameForCompare`) gruplama — seddin ifadesiyle birebir. */
async function colorGroups(): Promise<Group[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string; isActive: boolean }>>(
    `SELECT name, "isActive" FROM "colors" WHERE "mergedIntoId" IS NULL ORDER BY name`,
  );
  const byKey = new Map<string, Array<{ name: string; isActive: boolean }>>();
  for (const r of rows) {
    const k = foldColorNameForCompare(r.name);
    byKey.set(k, [...(byKey.get(k) ?? []), r]);
  }
  return [...byKey.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([key, members]) => ({
      key,
      n: members.length,
      detail: members.map((m) => `${m.name} [${m.isActive ? "aktif" : "PASİF"}]`).join("  |  "),
    }))
    .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
}

async function main(): Promise<void> {
  let totalGroups = 0;
  let totalExtra = 0;
  const pendingEnforce = new Map<string, string[]>(); // migration dosyası → tablolar
  console.log("\n=== KATLANMIŞ ADA GÖRE MÜKERRER ANA VERİ (salt-okunur) ===\n");
  for (const t of TABLES) {
    const rows = t.colorRule ? await colorGroups() : await foldGroups(t);
    if (rows.length === 0) continue;
    const extra = rows.reduce((a, r) => a + r.n - 1, 0);
    totalGroups += rows.length;
    totalExtra += extra;
    if (t.enforce) pendingEnforce.set(t.enforce, [...(pendingEnforce.get(t.enforce) ?? []), t.table]);
    const tag = t.enforce ? "  ⛔ DB SEDLİ TABLO — index bu DB'de ATLANIR, enforce bekler" : "";
    const rule = t.colorRule ? " — renk kuralı: ayraç + sayı-sırası bağımsız" : "";
    console.log(`── ${t.label} (${t.table}) — ${rows.length} grup, ${extra} fazla satır${tag}${rule}`);
    for (const r of rows) console.log(`     ${r.detail}`);
    console.log("");
  }
  if (totalGroups === 0) {
    console.log(
      "Mükerrer YOK — sedli tablolarda index kurulu/kurulabilir.\n\n" +
        "ENFORCE (eksik index varsa kurar, idempotenttir):\n" +
        "  npx prisma db execute --file prisma/migrations/20260821150000_name_fold_unique_live/migration.sql\n" +
        "  npx prisma db execute --file prisma/migrations/20260825120000_color_name_unique_live/migration.sql\n" +
        "Doğrulama:\n" +
        "  psql \"$DATABASE_URL\" -c \"SELECT indexname FROM pg_indexes WHERE indexname LIKE '%_nameFold%_key';\"\n" +
        "  npx tsx scripts/test_db_invariants.ts   (§1 + §5 yeşile döner)\n",
    );
  } else {
    const sedded = [...pendingEnforce.values()].reduce((a, v) => a + v.length, 0);
    console.log(
      `TOPLAM: ${totalGroups} grup / ${totalExtra} fazla satır` +
        (sedded > 0 ? ` (${sedded} tablo DB SEDLİ).\n` : ".\n") +
        (sedded > 0
          ? "⛔ Sedli tablodaki gruplar dururken ilgili migration o tabloda index'i ATLAR\n" +
            "   (deploy geçer, sed EKSİK kalır). Önce Sistem → Mükerrer Kayıtlar ile birleştirin,\n" +
            "   sonra migration dosyasını yeniden koşun (enforce):\n" +
            [...pendingEnforce.entries()]
              .map(([file, tables]) => `     ${tables.join(", ")} → npx prisma db execute --file prisma/migrations/${file}/migration.sql`)
              .join("\n") +
            "\n"
          : "Sedsiz tablolardaki gruplar gözlemdir — uygulama bekçisi yeni mükerreri engeller.\n") +
        "Birleştirme kararı işletmenindir; script yazmaz.\n",
    );
  }

  // ── KESKİN TARAMALAR — gözlem, sed bunlara BAKMAZ ─────────────────────────
  console.log("\n=== KESKİN TARAMALAR (aday; sed bunlara BAKMAZ, karar işletmenin) ===\n");
  let sharpGroups = 0;
  for (const t of SHARP_TABLES) {
    // (a) noktalama/boşluk atılınca aynı ad — "MİKRO CANVAS" ↔ "MIKROCANVAS",
    //     "GRİ-(292-7791)" ↔ "292-7791-GRİ". Renkte taban renk kuralıdır (sıra
    //     bağımsız), sonra noktalama düşer.
    const rows = await prisma.$queryRawUnsafe<Array<{ name: string; code: string | null; nameFold: string; isActive: boolean }>>(
      `SELECT name, code::text AS code, "nameFold", "isActive" FROM "${t.table}" WHERE "mergedIntoId" IS NULL ORDER BY name`,
    );
    const byStripped = new Map<string, typeof rows>();
    for (const r of rows) {
      const base = t.colorRule ? foldColorNameForCompare(r.name) : r.nameFold ?? "";
      const k = base.replace(/[^a-z0-9]/g, "");
      if (!k) continue;
      byStripped.set(k, [...(byStripped.get(k) ?? []), r]);
    }
    // Katlanmış adı zaten AYNI olan çiftler yukarıda listelendi — burada yalnız
    // katlanmış adı FARKLI olup noktalama atılınca birleşenler.
    const strippedHits = [...byStripped.values()].filter(
      (m) => m.length > 1 && new Set(m.map((x) => (t.colorRule ? foldColorNameForCompare(x.name) : x.nameFold))).size > 1,
    );
    // (b) harf-duyarsız KOD çakışması — `code` UNIQUE'i harf DUYARLI ("MC155" ≠ "mc155").
    const byCode = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!r.code) continue;
      const k = r.code.toLocaleLowerCase("en");
      byCode.set(k, [...(byCode.get(k) ?? []), r]);
    }
    const codeHits = [...byCode.values()].filter((m) => m.length > 1);
    if (strippedHits.length === 0 && codeHits.length === 0) continue;
    sharpGroups += strippedHits.length + codeHits.length;
    console.log(`── ${t.label} (${t.table})`);
    for (const m of strippedHits)
      console.log(`     (a) noktalama/boşluk farkı:  ${m.map((x) => `${x.name} [${x.code ?? "-"}${x.isActive ? "" : ", PASİF"}]`).join("  |  ")}`);
    for (const m of codeHits)
      console.log(`     (b) kod harf farkı:          ${m.map((x) => `${x.name} [${x.code}${x.isActive ? "" : ", PASİF"}]`).join("  |  ")}`);
    console.log("");
  }
  if (sharpGroups === 0) console.log("Keskin taramalarda aday yok.\n");
  else console.log(`Keskin tarama: ${sharpGroups} aday grup — Sistem → Mükerrer Kayıtlar panelinde değerlendirin.\n`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch((err) => {
  console.error("Beklenmeyen hata:", err);
  process.exit(1);
});
