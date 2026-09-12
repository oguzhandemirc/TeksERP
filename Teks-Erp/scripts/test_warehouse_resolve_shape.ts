// =============================================================================
// BEKÇİ — HEDEF DEPO ÇÖZÜMÜNÜN ŞEKLİ (yapısal sonda)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts warehouse_resolve_shape
//
// ⭐ NEDEN YAPISAL (davranışsal değil) — ve bu gerekçe olmadan böyle bir bekçi
//    YAZILMAZ: `resolveTargetWarehouseId`in 409 dalı BUGÜN ULAŞILAMAZ.
//    Ölçüldü (d9, 2026-09-12/13): boş fikstürde `DP-MERKEZ`i boot işi değil
//    İSTEĞİN KENDİSİ doğuruyor; üçüncü kademe de helper'ın kendi gövdesinde
//    (`await ensureDefaultWarehouse()` → tekrar oku → hâlâ yoksa `conflict`).
//    Yani 409 ancak YARATMANIN DÜŞTÜĞÜ durumda basılır = DB yazılamıyor demektir.
//    Bir HTTP sondası o durumu kuramaz; kurabilseydi bu dosya gereksiz olurdu.
//
// ⚠️ O YÜZDEN BURADA ÖLÇÜLEN DAVRANIŞ DEĞİL ŞEKİLDİR: üç kademenin durduğu,
//    uzlaştırmanın FIRLATMADAN ÖNCE çağrıldığı, ve fırlatmanın `null` dönüşe
//    geri çevrilmediği. Şekil bozulursa 409 dalı sessizce ya ULAŞILIR (veri
//    kusuru: `WAREHOUSE` statüsü + `warehouseId: null`) ya da FAIL-OPEN'a döner.
//
// ⭐ HER TERİM AYRI NEGATİF SONDA TAŞIR (d9'un şartı). Üç terimi tek bir çift-
//    terimli tripwire'a koymak, terimlerden biri yeniden adlandırıldığında bekçiyi
//    YEŞİL ama KORUMASIZ bırakırdı — kapının dördüncü ölüm biçimi (2026-09-12).
//    Her yüklem, o terimi SİLİNMİŞ bir kopyaya karşı da koşulur ve kırmızı
//    verdiği ÖLÇÜLÜR; bekçi kendi ısırığını her koşumda kanıtlar.
//
// ⚠️ FAIL-OPEN KAPANDI (2026-09-12): helper artık `null` DÖNMEZ, 409 FIRLATIR.
//    Bu dosya o kararın geri alınmadığını ölçer — davranışını değil.
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";

const KAYNAK_YOLU = join(__dirname, "..", "src", "services", "helpers", "warehouse.helper.ts");

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`);
  }
}

/** `export async function <ad>(` ile başlayan gövdeyi sütun-0 `}`'a kadar keser. */
function govde(kaynak: string, ad: string): string {
  const bas = kaynak.indexOf(`export async function ${ad}(`);
  if (bas < 0) return "";
  const son = kaynak.indexOf("\n}", bas);
  return son < 0 ? kaynak.slice(bas) : kaynak.slice(bas, son + 2);
}

/**
 * Bir terimi ölçer ve AYNI yüklemi o terim SİLİNMİŞ kopyaya karşı da koşar.
 * İkinci koşum kırmızı vermiyorsa yüklem o terime BAĞLI DEĞİLDİR — yani bekçi
 * bir şey ölçüyor gibi görünüp hiçbir şey ölçmüyordur.
 */
function terim(ad: string, yuklem: (k: string) => boolean, boz: (k: string) => string, kaynak: string): void {
  check(ad, yuklem(kaynak));
  const bozuk = boz(kaynak);
  check(`   ↳ sonda: terim silinince ISIRIYOR`, bozuk !== kaynak && !yuklem(bozuk));
}

function main(): void {
  console.log("=== Hedef depo çözümü — yapısal sonda ===\n");
  const kaynak = readFileSync(KAYNAK_YOLU, "utf8");

  // KÖRLÜK ZEMİNİ: dosya taşınır/boşalırsa her yüklem sessizce false olur ve
  // "3 kırmızı" ile "dosya yok" aynı ekrana çıkar.
  check("körlük zemini: kaynak okundu", kaynak.length > 2000, `${kaynak.length} bayt`);
  const resolveGovde = govde(kaynak, "resolveTargetWarehouseId");
  const ensureGovde = govde(kaynak, "ensureDefaultWarehouse");
  check("körlük zemini: iki gövde de bulundu", resolveGovde.length > 100 && ensureGovde.length > 100,
    `resolve=${resolveGovde.length} ensure=${ensureGovde.length}`);

  console.log("\n§1 — ÜÇ KADEME duruyor mu (union'dan bir değer ölürse kademe de ölmüştür)");
  // `DefaultWarehouseResult.action` union'ı kademelerin AYNASIDIR: her kademe
  // kendi etiketini döndürür, yani etiketin yokluğu kademenin yokluğudur.
  for (const kademe of ["exists", "promoted", "created"] as const) {
    terim(
      `§1 "${kademe}" kademesi: union'da VE ensureDefaultWarehouse gövdesinde`,
      (k) =>
        new RegExp(`action:\\s*"exists"\\s*\\|\\s*"promoted"\\s*\\|\\s*"created"`).test(k) &&
        new RegExp(`action:\\s*"${kademe}"`).test(govde(k, "ensureDefaultWarehouse")),
      (k) => k.replace(new RegExp(`action: "${kademe}"`, "g"), `action: "SONDA"`),
      kaynak,
    );
  }

  console.log("\n§2 — uzlaştırma FIRLATMADAN ÖNCE çağrılıyor mu (sıra kuralın kendisi)");
  terim(
    "§2 `ensureDefaultWarehouse()` resolveTargetWarehouseId gövdesinde",
    (k) => /await ensureDefaultWarehouse\(\)/.test(govde(k, "resolveTargetWarehouseId")),
    (k) => k.replace("await ensureDefaultWarehouse();", "// sonda: çağrı kaldırıldı"),
    kaynak,
  );
  terim(
    "§2 ⭐ çağrı `throw`dan ÖNCE (sonra çağrılsa uzlaştırma hiç koşmazdı)",
    (k) => {
      const g = govde(k, "resolveTargetWarehouseId");
      const cagri = g.indexOf("await ensureDefaultWarehouse()");
      const firlat = g.indexOf("throw AppError.conflict");
      return cagri >= 0 && firlat >= 0 && cagri < firlat;
    },
    // Sonda SIRAYI bozar, terimi silmez: fırlatma çağrıdan ÖNCEYE alınırsa
    // uzlaştırma hiç koşmaz ama kod DERLENİR ve iki terim de yerinde DURUR —
    // "her iki kelime de var" diye bakan bir tripwire burada yeşil kalırdı.
    (k) =>
      k.replace(
        "await ensureDefaultWarehouse();",
        'throw AppError.conflict("sonda");\n  await ensureDefaultWarehouse();',
      ),
    kaynak,
  );

  console.log("\n§3 — fırlatma `null` dönüşe GERİ ÇEVRİLMEMİŞ (fail-open kapalı kalsın)");
  terim(
    "§3 imza `Promise<string>` (nullable DEĞİL)",
    (k) => /export async function resolveTargetWarehouseId\([\s\S]*?\):\s*Promise<string>\s*\{/.test(k),
    (k) => k.replace("): Promise<string> {", "): Promise<string | null> {"),
    kaynak,
  );
  terim(
    "§3 son dal `AppError.conflict` FIRLATIYOR (`return null` değil)",
    (k) => /throw AppError\.conflict\(/.test(govde(k, "resolveTargetWarehouseId")),
    (k) => k.replace("throw AppError.conflict(", "return null; AppError.conflict("),
    kaynak,
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
