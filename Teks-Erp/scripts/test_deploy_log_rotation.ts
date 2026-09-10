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
//   §2 üç ayarın üçü de DEĞERİYLE veriliyor (max_size 10M · retain 14 ·
//      compress true) ve çıkış kodları TOPLANMIYOR (hangi ayar düştü, adıyla)
//   §3 kurulum FAIL DEĞİL — internetsiz makinede sürüm çıkışını kesmiyor
//   §4 rotasyonun hedefi duruyor: PAKETE GİREN `Teks-Erp/ecosystem.config.js`
//   §5 ecosystem TEK KAYNAK; pm2 adı `-UygulamaAdi` → env → dosya zinciriyle gelir
//
// ⭐ NEGATİF SONDA (2026-09-06/07, BEŞİ DE ölçüldü — her biri ayrı koşum):
//    ① `& $pm2 install pm2-logrotate` satırı yorumlandı            → §1 KIRMIZI
//    ② `pm2-logrotate:max_size` satırı silindi                     → §2 KIRMIZI
//    ③ `Uyar` → `Fail` (blok sürüm çıkışını keser hâle geldi)      → §3 KIRMIZI
//    ④ `Teks-Erp/ecosystem.config.js`te `out_file:` yorumlandı     → §4 KIRMIZI
//    ⑤ `time: true` → `time: false`                                → §4 KIRMIZI
//    ⑥ pm2 adı dosyaya sabitlendi                                 → §5 KIRMIZI
//    ⑦ `kur.ps1`ten env yazımı kaldırıldı                          → §5 KIRMIZI
//    ⑧ `kur.ps1` paketten çıkarıldı                                → §5 KIRMIZI
//    ⑨ ikinci ecosystem dosyası geri kondu                         → §5 KIRMIZI
//    Hepsi geri alındığında yeşil.
//
//    ⚠️ SONDANIN KENDİSİ DÖRT KEZ BEKÇİYİ DÜZELTTİ: ①, ③ ve ④ İLK yazımda
//    ısırmadı, çünkü aranan metin bloğun YORUMUNDA ya da UYARI CÜMLESİNDE de
//    geçiyordu. Dördüncüsü daha kötüydü: §4 YANLIŞ DOSYAYI okuyordu
//    (`deploy/ecosystem.fabrika.js` pakete GİRMEZ; `paketle.ps1` sahadaki
//    dosyayı `Teks-Erp/ecosystem.config.js`ten kopyalar). "Bekçi yeşil" ile
//    "kural korunuyor" arasındaki fark tam burası.
// =============================================================================
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const KOK = join(__dirname, "..", "..");
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const kur = readFileSync(join(KOK, "deploy", "kur.ps1"), "utf8");
// ⚠️ PAKETE GİREN DOSYA BUDUR. `deploy/ecosystem.fabrika.js` DEĞİL — o, 2026-09-04
// yan-yana kurulumunda BİR KEZ elle kopyalanmış bir varyanttır ve `paketle.ps1`
// onu pakete koymaz (`Copy-Item "$proj\ecosystem.config.js"`). Bekçi ilk yazımda
// yanlış dosyayı ölçüyordu: paketlenen dosyadan `out_file` silinse YEŞİL kalırdı.
const eco = readFileSync(join(KOK, "Teks-Erp", "ecosystem.config.js"), "utf8");

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
  komutVar(/^(?:&\s+\$pm2|\$\w+\s*=\s*Pm2Kos|Pm2Kos)\s+install\s+pm2-logrotate\b/),
);

// ── §2 ÜÇ AYAR DA VERİLİYOR ─────────────────────────────────────────────────
// Yalnız `install` yetmez: modül varsayılanları (retain 30, sıkıştırma yok)
// bu makinenin ölçülen hacmine göre seçilmedi. Üçü de ADIYLA aranır.
console.log("\n§2 — üç ayar da veriliyor");
// ⚠️ 2026-09-10'da ÇAĞRI ŞEKLİ DEĞİŞTİ: üç `Pm2Kos set` satırı yerine ADLI bir
//    tablo + döngü var (çıkış kodlarını TOPLAMAK yanlıştı — hangi ayarın
//    yazılamadığını söylemiyordu ve negatif kod toplamı sıfıra bile çekebilirdi).
//    Bekçi ŞEKLİ değil KURALI ölçmeli: üç ayar adı da yazılıyor ve `Pm2Kos set`
//    `pm2-logrotate:` önekiyle çağrılıyor.
check(
  "⭐ ayarlar `Pm2Kos set pm2-logrotate:<ad>` ile veriliyor",
  komutVar(/Pm2Kos\s+set\s+"?pm2-logrotate:/),
);
for (const [ayar, deger] of [["max_size", "10M"], ["retain", "14"], ["compress", "true"]]) {
  check(
    `⭐ \`pm2-logrotate:${ayar}\` ayarı ${deger} olarak veriliyor`,
    komutVar(new RegExp(`Ad\\s*=\\s*"${ayar}"[^\\n]*Deger\\s*=\\s*"${deger}"`)) ||
      komutVar(new RegExp(`(?:&\\s+\\$pm2|Pm2Kos)\\s+set\\s+"?pm2-logrotate:${ayar}"?\\s+${deger}\\b`)),
  );
}
// ⭐ ÇIKIŞ KODLARI TOPLANMAZ: toplam bir kod DEĞİLDİR ve hangi ayarın düştüğünü
//    söylemez. Sunucudaki oturumun 2026-09-07 notu; ölçülebilir hâle getirildi.
check(
  "⭐ çıkış kodları TOPLANMIYOR (`+=` ile kod biriktirme yok)",
  !/\$\w*[Kk]od\s*\+=/.test(komutlar.join("\n")),
  "başarısız ayarlar ADIYLA raporlanır",
);

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

// ── §5 TEK KAYNAK ────────────────────────────────────────────────────────────
// ⭐ `deploy/ecosystem.fabrika.js` 2026-09-07'de SİLİNDİ. Yorumlar hariç
//    paketlenen dosyayla birebir aynıydı; TEK farkı pm2 adıydı ve o ad ayrıştığı
//    için bir sonraki güncelleme aynı porta İKİNCİ uygulama kaldıracaktı
//    ([4/9] yanlış adı arar → hiçbir şey silmez, [8/9] ikincisini başlatır).
//    İkinci bir ecosystem dosyası geri gelirse aynı sınıf yeniden doğar.
console.log("\n§5 — ecosystem TEK KAYNAK, pm2 adı `-UygulamaAdi`dan gelir");
check(
  "⭐ ikinci bir ecosystem dosyası YOK (`deploy/` altında)",
  !existsSync(join(KOK, "deploy", "ecosystem.fabrika.js")) &&
    !existsSync(join(KOK, "deploy", "ecosystem.yan-yana.js")),
);
check(
  "⭐ pm2 adı env'den okunuyor (dosyaya sabitlenmemiş)",
  ecoVar(/^name:\s*process\.env\.TEKSERP_PM2_AD\s*\|\|/),
);
const kurKomut = kur
  .split("\n").map((l) => l.trim())
  .filter((l) => l.length > 0 && !l.startsWith("#"));
check(
  "⭐ `kur.ps1` başlatmadan ÖNCE o adı env'e yazıyor ([4/9] sildiği ile [8/9] başlattığı aynı olsun)",
  kurKomut.some((l) => /^\$env:TEKSERP_PM2_AD\s*=\s*\$uygulama/.test(l)),
);
check(
  "⭐ `kur.ps1` pakete giriyor (paket ile onu kuran script ayrışamaz)",
  readFileSync(join(KOK, "deploy", "paketle.ps1"), "utf8")
    .split("\n").some((l) => /^\s*Copy-Item\s+"\$repo\\deploy\\kur\.ps1"/.test(l)),
);

// ── §6 NATIVE ÇAĞRIDA YÖNLENDİRME YOK ────────────────────────────────────────
// ⭐ Fabrika sunucusunda ÖLÇÜLDÜ (2026-09-07, PowerShell 5.1): `$ErrorActionPreference
//    = "Stop"` yürürlükteyken bir native komutun stderr'ini YÖNLENDİRMEK
//    (`2>$null` / `2>&1`) o satırı ÖLÜMCÜL yapar — komut BAŞARILI olsa bile,
//    stderr'e tek satır yazması yeter. `pm2 delete <olmayan>` tam bunu yapıyor
//    ve o çağrı GERİ ALMA yolunun ilk adımı: güncelleme yarıda kalınca
//    çalıştırılacak araç, tam o anda hiçbir şey yapmadan ölüyordu.
//    Çağrılar `Pm2Kos` yardımcısına taşındı (yönlendirme yok + EAP=Continue).
console.log("\n§6 — native çağrılarda stderr yönlendirmesi yok");
const yonlendiren = kur
  .split("\n")
  .map((l, i) => ({ n: i + 1, t: l.trim() }))
  .filter((x) => !x.t.startsWith("#") && /(?:^|\s)2>(?:&1|\$null)/.test(x.t));
check(
  "⭐ `kur.ps1`te yönlendirilmiş native çağrı YOK (EAP=Stop altında ölümcül)",
  yonlendiren.length === 0,
  yonlendiren.length ? `satır ${yonlendiren.map((x) => x.n).join(", ")}` : "temiz",
);
check(
  "⭐ `Pm2Kos` yardımcısı tanımlı ve EAP'yi geri koyuyor",
  /function\s+Pm2Kos\b/.test(kur) && /finally\s*\{\s*\$ErrorActionPreference\s*=\s*\$eskiEAP/.test(kur),
);

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
