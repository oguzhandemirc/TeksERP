// =============================================================================
// ONARIM — kod/ad çakışması yaratan KULLANILMAMIŞ kumaş kayıtlarını sil
// =============================================================================
// KURU KOŞUM VARSAYILAN. Silmek için: --apply
//   npx tsx scripts/fix_kumas_kod_cakismasi.ts            # yalnız rapor
//   npx tsx scripts/fix_kumas_kod_cakismasi.ts --apply    # siler
//
// NEDEN
// İki şema kısıtı (kumaş ADI tekilliği ve kumaş KODU harf-duyarsız tekilliği)
// fabrika verisinde KURULAMIYOR çünkü çakışan kayıtlar var.
//
// ⚠️ ÇAKIŞAN KÜME ORTAMA GÖRE DEĞİŞİR — bu yüzden araç SABİT LİSTE TAŞIMAZ,
// her koşumda ÖLÇER. Saha kopyasında (2026-08-29) çakışanların tamamı pasif ve
// sıfır kullanımlıydı; dev'de ise aktif ama hiç kullanılmamış kayıtlar da çıktı
// (`santuk`, `SEFA`). Sabit bir liste yazsaydık prod'da yanlış kayda dokunurdu.
//
// ⚠️ NEDEN BİRLEŞTİRME DEĞİL SİLME (kullanıcı kararı 2026-08-30): birleştirme
// "şu kumaş ile bu kumaş AYNIDIR" diye KALICI bir kayıt bırakır (mezar taşı).
// Burada birleştirilecek bir geçmiş yok — kayıtlar hiç kullanılmamış — ve
// örneğin `santuk`/ŞANTUK ile `SANTUK`/BORANCIK FARKLI adlar taşıyor.
// Birleştirmek, olmayan bir özdeşliği kayda geçirirdi.
//
// ⚠️ SİLME MOTORDAN GEÇER, HAM SQL DEĞİL. `ItemService`in kalıcı silme yolu
// bağımlılık kapısını koşturur ve audit yazar; ham `DELETE` ikisini de atlar
// (`apply_merge_decisions` dersi: inceleme SQL'de, UYGULAMA MOTORDA).
//
// ⚠️ ADAYLAR SABİT LİSTE DEĞİL, ÖLÇÜMLE BULUNUR: aynı kodu (harf-duyarsız) ya
// da aynı katlanmış adı paylaşan gruplardan, PASİF ve SIFIR kullanımlı olanlar.
// Sabit id listesi yazmak, prod'da başka id'ler olduğu için işe yaramazdı.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";

const APPLY = process.argv.includes("--apply");
/**
 * AKTİF ama hiç kullanılmamış kayıtları da silmek için AÇIK liste:
 *   --kod=santuk,sefa
 *
 * ⚠️ NEDEN AYRI BİR KAPI: "sıfır kullanım" REFERANS güvenliğidir (silmek hiçbir
 * şeyi kırmaz), `isActive` ise İŞ kararıdır (birileri bu kumaşı yarın kullanmak
 * için açmış olabilir). Pasif + sıfır kullanım ikisini birden söyler ve otomatik
 * silinir; AKTİF + sıfır kullanım yalnız adı AÇIKÇA yazılırsa silinir.
 * İlk yazımda kural yalnız pasifleri seçiyordu ve kullanıcının karar verdiği
 * kaydı (aktif `santuk`) SESSİZCE atlıyordu — ölçümle yakalandı.
 */
const KODLAR = new Set(
  (process.argv.find((a) => a.startsWith("--kod="))?.slice("--kod=".length) ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean),
);

type Aday = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  cakisma: string;
  top: number;
  siparis: number;
  isEmri: number;
  alias: number;
};

async function main(): Promise<void> {
  console.log(`\n=== Kumaş kod/ad çakışması — ${APPLY ? "UYGULAMA" : "KURU KOŞUM"} ===\n`);

  // Çakışan gruplar: aynı upper(code) ya da aynı nameFold (mezar taşı hariç).
  const adaylar = await prisma.$queryRaw<Aday[]>`
    WITH gruplar AS (
      SELECT id, upper(code) AS anahtar, 'kod' AS tur FROM items
      WHERE "mergedIntoId" IS NULL
        AND upper(code) IN (
          SELECT upper(code) FROM items WHERE "mergedIntoId" IS NULL
          GROUP BY upper(code) HAVING count(*) > 1
        )
      UNION
      SELECT id, "nameFold" AS anahtar, 'ad' AS tur FROM items
      WHERE "mergedIntoId" IS NULL
        AND "nameFold" IN (
          SELECT "nameFold" FROM items WHERE "mergedIntoId" IS NULL
          GROUP BY "nameFold" HAVING count(*) > 1
        )
    )
    SELECT i.id, i.code, i.name, i."isActive", i."createdAt",
           string_agg(DISTINCT g.tur, '+') AS cakisma,
           (SELECT count(*)::int FROM rolls r WHERE r."itemId" = i.id) AS top,
           (SELECT count(*)::int FROM order_lines o WHERE o."itemId" = i.id) AS siparis,
           (SELECT count(*)::int FROM work_orders w WHERE w."targetItemId" = i.id) AS "isEmri",
           (SELECT count(*)::int FROM customer_item_aliases a WHERE a."itemId" = i.id) AS alias
    FROM gruplar g JOIN items i ON i.id = g.id
    GROUP BY i.id, i.code, i.name, i."isActive", i."createdAt"
    ORDER BY i.code
  `;

  if (adaylar.length === 0) {
    console.log("Çakışma yok — iki şema kısıtı da kurulabilir.\n");
    return;
  }

  const kullanilmamis = (a: Aday): boolean =>
    a.top === 0 && a.siparis === 0 && a.isEmri === 0 && a.alias === 0;
  // ① Pasif + sıfır kullanım → otomatik.
  // ② Aktif + sıfır kullanım → yalnız `--kod=` ile adı geçenler.
  const silinebilir = adaylar.filter(
    (a) => kullanilmamis(a) && (!a.isActive || KODLAR.has(a.code.toLowerCase())),
  );
  const kararBekleyen = adaylar.filter(
    (a) => kullanilmamis(a) && a.isActive && !KODLAR.has(a.code.toLowerCase()),
  );
  const kalan = adaylar.filter((a) => !silinebilir.includes(a) && !kararBekleyen.includes(a));

  console.log(`${adaylar.length} çakışan kayıt bulundu:\n`);
  console.log("  kod        ad          durum   çakışma  top  sip  iş  kod  KARAR");
  console.log("  ─────────  ──────────  ──────  ───────  ───  ───  ──  ───  ─────");
  for (const a of adaylar) {
    const silinir = silinebilir.includes(a);
    const bekleyen = kararBekleyen.includes(a);
    console.log(
      `  ${a.code.padEnd(9)}  ${a.name.slice(0, 10).padEnd(10)}  ` +
        `${(a.isActive ? "aktif" : "pasif").padEnd(6)}  ${a.cakisma.padEnd(7)}  ` +
        `${String(a.top).padStart(3)}  ${String(a.siparis).padStart(3)}  ` +
        `${String(a.isEmri).padStart(2)}  ${String(a.alias).padStart(3)}  ` +
        `${silinir ? "SİL" : bekleyen ? "KARAR BEKLER" : "KULLANIMDA"}`,
    );
  }

  if (kararBekleyen.length > 0) {
    console.log(
      `\n⚠️ ${kararBekleyen.length} kayıt AKTİF ama HİÇ KULLANILMAMIŞ — silmek referans`,
    );
    console.log("   açısından güvenli ama bir İŞ kararıdır. Silinecekse adını açıkça yaz:");
    console.log(
      `      --kod=${kararBekleyen.map((a) => a.code).join(",")}`,
    );
  }
  if (kalan.length > 0) {
    console.log(`\n⚠️ ${kalan.length} kayıt KULLANILIYOR — bu araç onlara DOKUNMAZ.`);
    console.log(
      "   Onlar yeniden adlandırma ya da mükerrer panelinden birleştirme ister.",
    );
  }
  console.log(`\n  Silinecek: ${silinebilir.length} kayıt\n`);

  if (silinebilir.length === 0) {
    console.log("Silinebilecek kayıt yok.\n");
    return;
  }

  if (!APPLY) {
    console.log("KURU KOŞUM — hiçbir şey silinmedi. Silmek için: --apply\n");
    return;
  }

  // ⚠️ Silme SERVİS üzerinden: bağımlılık kapısı + audit. Ham DELETE ikisini de
  // atlar ve bir kaçırılmış bağımlılıkta FK hatasıyla yarıda kalır.
  const { ItemService } = await import("../src/services/item.service");
  const svc = new ItemService({
    modelName: "item",
    tableName: "ITEM",
    searchFields: ["name", "code"],
    codeSearchFields: ["code"],
    dateFields: ["createdAt"],
  });

  let ok = 0;
  for (const a of silinebilir) {
    try {
      await svc.hardDelete(a.id);
      ok++;
      console.log(`  ✅ silindi: ${a.code} (${a.name})`);
    } catch (e) {
      console.log(`  ❌ silinemedi: ${a.code} — ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`\n${ok}/${silinebilir.length} kayıt silindi.`);
  console.log(
    "Hepsi silindiyse iki şema kısıtı artık kurulabilir " +
      "(prisma/migration-taslaklari/K2, K3).\n",
  );
}

main()
  .catch((e) => {
    console.error("HATA:", e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
