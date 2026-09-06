// =============================================================================
// BEKÇİ — SAHADA LOG ROTASYONU KURULUYOR MU (`kur.ps1` → pm2-logrotate)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts deploy_log_rotation
//
// ⭐ NEDEN YAZILDI: pm2 log dosyasını KENDİSİ döndürmez. Bu üç ops dokümanında
//    yazılıydı (KURULUM · DEPLOY-RUNBOOK · URETIM-KONTROL-LISTESI) ama HİÇBİR
//    SCRIPT yapmıyordu — yani bir insanın kontrol listesindeki maddeyi elle
//    uygulamasına bağlıydı. Fabrikada uygulanmamış: 2026-09-06'da ölçüldü,
//    `backend-out-0.log` 5 haftada 57 MB tek dosya olmuştu ve içinde arama
//    yapılamıyordu ("geçen salı ne oldu" sorusunun cevabı oradaydı, ulaşılamadı).
//
//    NSSM'den pm2'ye geçerken kaybolan bir davranış. Artık `kur.ps1` [8/9]
//    kuruyor; bu bekçi o satırların SİLİNMEDİĞİNİ ölçer.
//
// NE ÖLÇER: dokümandaki cümlenin kodda karşılığı olduğunu.
//   §1 `kur.ps1` pm2-logrotate KURUYOR
//   §2 üç ayarın üçü de veriliyor (max_size · retain · compress)
//   §3 kurulum FAIL DEĞİL — internetsiz makinede sürüm çıkışını kesmiyor
//   §4 rotasyonun hedefi duruyor: `ecosystem.fabrika.js` hâlâ dosyaya yazıyor
//
// ⭐ NEGATİF SONDA (2026-09-06/07, BEŞİ DE ölçüldü — her biri ayrı koşum):
//    ① `& $pm2 install pm2-logrotate` satırı yorumlandı            → §1 KIRMIZI
//    ② `pm2-logrotate:max_size` satırı silindi                     → §2 KIRMIZI
//    ③ `Uyar` → `Fail` (blok sürüm çıkışını keser hâle geldi)      → §3 KIRMIZI
//    ④ `out_file:` yorumlandı                                      → §4 KIRMIZI
//    ⑤ `time: true` → `time: false`                                → §4 KIRMIZI
//    Hepsi geri alındığında yeşil.
//
//    ⚠️ SONDANIN KENDİSİ ÜÇ KEZ BEKÇİYİ DÜZELTTİ: ①, ③ ve ④ İLK yazımda
//    ısırmadı, çünkü aranan metin bloğun YORUMUNDA ya da UYARI CÜMLESİNDE de
//    geçiyordu. "Bekçi yeşil" ile "kural korunuyor" arasındaki fark tam burası.
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";

const KOK = join(__dirname, "..", "..");
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const kur = readFileSync(join(KOK, "deploy", "kur.ps1"), "utf8");
const eco = readFileSync(join(KOK, "deploy", "ecosystem.fabrika.js"), "utf8");

// ── BLOK SINIRI ─────────────────────────────────────────────────────────────
// Aramalar SERBEST METİNDE değil, bloğun KOMUT SATIRLARINDA yapılır.
// ⚠️ İlk yazımda iki kez yanlış ölçüldü ve ikisi de sondada yakalandı:
//   ① `Fail` kelimesi bloğun KENDİ YORUMUNDA ("Fail DEGIL: ...") geçiyordu;
//   ② `$pm2 install pm2-logrotate` metni, kurulum düşünce basılan UYARI
//      CÜMLESİNİN içinde de geçiyor ("internet gelince elle: ...") — gerçek
//      çağrı silindiği hâlde bekçi YEŞİL kalıyordu.
// Ders: bir kabuk script'inde "şu komut çağrılıyor mu" sorusu, satırın komutla
// BAŞLAMASIYLA ölçülür; ham `includes` yorumu ve mesajı da sayar.
const bas = kur.indexOf("# --- Log rotasyonu");
const sonrakiBaslik = kur.indexOf("\n# --- ", bas + 1);
const blok = bas < 0 ? "" : kur.slice(bas, sonrakiBaslik < 0 ? kur.length : sonrakiBaslik);
/** Bloğun yorumsuz, kırpılmış komut satırları. */
const komutlar = blok
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.length > 0 && !l.startsWith("#"));
const komutVar = (re: RegExp): boolean => komutlar.some((l) => re.test(l));

// ── §1 KURULUM VAR MI ───────────────────────────────────────────────────────
console.log("\n§1 — kur.ps1 pm2-logrotate kuruyor");
check("körlük zemini: kur.ps1 okundu ve pm2 kullanıyor", kur.length > 1000 && kur.includes("$pm2"));
check("körlük zemini: adlandırılmış logrotate bloğu bulundu", bas >= 0 && komutlar.length >= 5,
  `${komutlar.length} komut satırı`);
check(
  "⭐ `pm2 install pm2-logrotate` GERÇEKTEN çağrılıyor (uyarı metninde geçmesi sayılmaz)",
  komutVar(/^&\s+\$pm2\s+install\s+pm2-logrotate\b/),
);

// ── §2 ÜÇ AYAR DA VERİLİYOR ─────────────────────────────────────────────────
// Yalnız `install` yetmez: modül varsayılanları (retain 30, sıkıştırma yok)
// bu makinenin ölçülen hacmine göre seçilmedi. Üçü de ADIYLA aranır.
console.log("\n§2 — üç ayar da veriliyor");
for (const ayar of ["max_size", "retain", "compress"]) {
  check(
    `⭐ \`pm2 set pm2-logrotate:${ayar}\` veriliyor`,
    komutVar(new RegExp(`^&\\s+\\$pm2\\s+set\\s+pm2-logrotate:${ayar}\\s+\\S`)),
  );
}

// ── §3 SÜRÜM ÇIKIŞINI KESMİYOR ──────────────────────────────────────────────
// İnternetsiz makinede `pm2 install` düşer. Rotasyonsuz çalışmak HİÇ
// çalışmamaktan iyidir — mDNS firewall kuralıyla aynı gerekçe.
console.log("\n§3 — kurulum başarısız olursa sürüm yine çıkar");
const govde = komutlar.join("\n");
check(
  "⭐ logrotate bloğu try/catch içinde ve `Fail` çağırmıyor (fail-open, bilinçli)",
  govde.includes("try {") && govde.includes("} catch") && !/\bFail\b/.test(govde),
);
check(
  "başarısızlıkta görünür uyarı basılıyor (sessiz atlama yok)",
  /Uyar\s+"pm2-logrotate kurulamadi/.test(kur),
);

// ── §4 ROTASYONUN HEDEFİ DURUYOR ────────────────────────────────────────────
// Rotasyon DOSYAYA yazılan log'u döndürür. `out_file`/`error_file` kaldırılırsa
// pm2 kendi varsayılan klasörüne yazar ve buradaki ayar başka dosyayı döndürür.
console.log("\n§4 — ecosystem hâlâ bilinen dosyaya yazıyor");
// ⚠️ Yine YORUMSUZ satırda aranır — `// out_file:` diye yorumlanmış bir satır
// ham metinde hâlâ eşleşiyordu ve sonda ısırmıyordu (bu dosyada ÜÇÜNCÜ kez;
// mekanik bekçinin tek gerçek riski budur: metni okur, KODU okuduğunu sanır).
const ecoKomutlari = eco
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.length > 0 && !l.startsWith("//") && !l.startsWith("*") && !l.startsWith("/*"));
const ecoVar = (re: RegExp): boolean => ecoKomutlari.some((l) => re.test(l));
check("körlük zemini: ecosystem okundu", ecoKomutlari.length > 20, `${ecoKomutlari.length} satır`);
check("⭐ `out_file` GERÇEKTEN tanımlı (yorum satırı sayılmaz)", ecoVar(/^out_file:\s*\S/));
check("⭐ `error_file` GERÇEKTEN tanımlı", ecoVar(/^error_file:\s*\S/));
check("zaman damgası açık (`time: true`) — rotasyon sonrası satır tarihi kaybolmasın", ecoVar(/^time:\s*true/));

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
