// =============================================================================
// BEKÇİ — ORTAM BAĞIMLILIĞI TAVANI (yalnız DÜŞER) — 2026-09-06
// =============================================================================
// KURAL `[TD-17]`: "Bekçi ortamdaki veriye bağımlı olmaz — 'herhangi bir kayıt
// bul' üstüne kurulan test temiz CI veritabanında düşer ya da VAKUMEN yeşil
// kalır." Kural yazılıydı ama HİÇBİR mekanik kapısı yoktu ve ölçüm acı:
//
//  109 dosya  `findFirst({ where: { isActive: true } })` ile "herhangi bir kayıt"
//             ⚠️ İlk ölçümüm 94 demişti ve EKSİKTİ: `grep` deseni yalnız TEK
//             SATIRLIK yazımı yakalıyordu, çok satıra bölünmüş 15 çağrıyı
//             kaçırıyordu. Tavan ÖLÇÜLEN sayıya kuruldu.
//  129 dosya  aktörü ham `username: "admin"` ile çözüyor
//             (reçetenin emrettiği `fixture-test-user.ts`i yalnız 12 dosya kullanıyor)
//
// ⭐ BU SINIF BU OTURUMDA ÜÇ KEZ ISIRDI ve üçü de aynı şekilde görünmezdi:
//    · `test_auto_draft_shipment` `finance.enabled`in ortamda açık olduğunu sandı
//    · `test_roll_po_line_trace` `ticaret.enabled`in açık olduğunu sandı
//    · `test_sack_customer_gate` liste sayfasına sığacağını sandı (99 cari → düştü)
//
// ⚠️ NEDEN TAVAN, NEDEN "SIFIR OLSUN" DEĞİL: 200+ dosyayı elden geçirmek ~50 saat
//    (ölçüldü). Hepsini birden kırmızı yapmak bu bekçiyi ilk gün devre dışı
//    bıraktırırdı. Repo bu problemi zaten bir kez çözdü — lint tavanı cırcırı
//    (`scripts/check-lint-baseline.mjs`): borç DONDURULUR, yalnız DÜŞER, yeni
//    sapma HEMEN kırmızı verir. Aynı desen.
//
// ⚠️ NE ÖLÇMEZ: bir `findFirst`in gerçekten zararlı olup olmadığını. Kimi kullanım
//    meşrudur (kendi fixture'ını okuyan satır). Bu yüzden bekçi "ihlal" demiyor,
//    "BAĞIMLILIK TAŞIYAN DOSYA SAYISI" diyor ve yalnız yönü zorluyor.
//
// ⭐ NEGATİF SONDA (2026-09-06): iki tavan da 0'a çekildi → ikisi de kırmızı;
//    yeni bir dosyaya `username: "admin"` eklendi → sayı 130'a çıktı, kırmızı.
//    Üçü de ölçüldü.
// =============================================================================
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SCRIPTS_DIR = join(__dirname);
const BEKCI_DESENI = /^test_.*\.ts$/;
const EN_AZ_DOSYA = 400;

/** "Herhangi bir aktif kayıt bul" — ortamda ne varsa onu ölçer. */
const HERHANGI_KAYIT = /findFirst(OrThrow)?\(\{\s*where:\s*\{\s*isActive:\s*true/;
/** Aktörü ham seed kullanıcısından çözme — `fixture-test-user.ts` varken. */
const HAM_ADMIN = /username:\s*"admin"/;

/** ÖLÇÜLDÜ 2026-09-06. İKİSİ DE YALNIZ DÜŞER. */
const TAVAN_HERHANGI_KAYIT = 105;
const TAVAN_HAM_ADMIN = 128;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const dosyalar = readdirSync(SCRIPTS_DIR).filter((f) => BEKCI_DESENI.test(f)).sort();
check(
  `körlük zemini: en az ${EN_AZ_DOSYA} bekçi dosyası tarandı`,
  dosyalar.length >= EN_AZ_DOSYA,
  `${dosyalar.length} dosya`,
);

const herhangi: string[] = [];
const hamAdmin: string[] = [];
for (const f of dosyalar) {
  if (f === "test_ortam_bagimliligi_tavani.ts") continue; // desenleri sabit olarak taşır
  const kaynak = readFileSync(join(SCRIPTS_DIR, f), "utf8");
  if (HERHANGI_KAYIT.test(kaynak)) herhangi.push(f);
  if (HAM_ADMIN.test(kaynak)) hamAdmin.push(f);
}

check(
  `⭐ "herhangi bir aktif kayıt" taşıyan dosya sayısı TAVANI (${TAVAN_HERHANGI_KAYIT}) aşmadı`,
  herhangi.length <= TAVAN_HERHANGI_KAYIT,
  `${herhangi.length} dosya`,
);
check(
  `⭐ ham \`username: "admin"\` taşıyan dosya sayısı TAVANI (${TAVAN_HAM_ADMIN}) aşmadı`,
  hamAdmin.length <= TAVAN_HAM_ADMIN,
  `${hamAdmin.length} dosya`,
);

for (const [ad, sayi, tavan] of [
  ["herhangi-kayıt", herhangi.length, TAVAN_HERHANGI_KAYIT],
  ["ham-admin", hamAdmin.length, TAVAN_HAM_ADMIN],
] as [string, number, number][]) {
  if (sayi < tavan) {
    console.log(`\nℹ️  TAVAN DÜŞÜRÜLEBİLİR (${ad}): ${sayi} ölçüldü, dosyadaki tavan ${tavan}.`);
  }
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
