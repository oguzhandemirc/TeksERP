// =============================================================================
// BEKÇİ — KURULUM TAŞIMASI ISRAR EDİYOR MU (`kur.ps1` [5/9] dosya kilidi yarışı)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts deploy_move_retry
//
// ⭐ NEDEN VAR — SAHADA ÖLÇÜLDÜ (2026-09-07 sabahı, 2.9.8 kurulumu):
//    [4/9] `pm2 delete` döndü, [5/9] `Move-Item app` "dosya başka bir işlem
//    tarafından kullanılıyor" ile düştü. Kapanan node sürecinin ÇALIŞMA DİZİNİ
//    `app\` ve işletim sistemi dizin tanıtıcısını pm2 komutu döndükten SONRA
//    bırakıyor. Bu bir YARIŞ: aynı paket, aynı komut üç dakika sonra sorunsuz
//    geçti. Önceki iki kurulumda yarış kazanılmıştı — yani "çalışıyordu" bir
//    kanıt değildi ve bu bekçi olmasa üçüncü kez de kanıt sayılacaktı.
//
// NE ÖLÇER:
//   §1 Yardımcı VAR ve son denemede hatayı AYNEN fırlatıyor (yutmuyor).
//      Yutsaydı düşen bir taşımadan sonra kurulum yarım veriyle devam ederdi —
//      otomatik geri alma hiç koşmazdı. Bu, sessiz ve en kötü sonuç.
//   §2 Taşıma yapan DÖRT yer de yardımcıyı kullanıyor: [5/9] · otomatik geri
//      alma · `-GeriAl` aracının iki taşıması. Biri çıplak `Move-Item`a
//      dönerse aynı yarış oradan geri gelir.
//   §3 [4/9] ile [5/9] arasında yatışma beklemesi var (yarışı DARALTIR, tek
//      başına çözmez — asıl sed §1'deki tekrar).
//
// ⚠️ ARAMA KOMUT SATIRLARINDA: `Move-Item` kelimesi bu dosyanın yorumlarında ve
//    kur.ps1'in kendi açıklamalarında da geçiyor. Ham `includes` ile ölçseydik
//    gerçek çağrı çıplak `Move-Item`a döndüğünde bekçi YEŞİL kalırdı — kardeş
//    bekçi `test_deploy_log_rotation` bu hatayı iki kez yaptı, ders oradan.
//
// ⭐ NEGATİF SONDA (ölçüldü 2026-09-07, üçü de KIRMIZI verdi ve geri alındı):
//    ① [5/9]'daki `TasiIsrarla` çıplak `Move-Item`a çevrildi     → §2 KIRMIZI
//    ② `throw` satırı yardımcıdan silindi (hata yutuldu)          → §1 KIRMIZI
//    ③ [4/9] sonrasındaki `Start-Sleep` silindi                   → §3 KIRMIZI
//
// ⭐ DAVRANIŞ AYRICA ELLE ÖLÇÜLDÜ (pwsh, macOS): normal taşıma tek denemede
//    geçiyor; hedef meşgulken 3 deneme yapıp sonuncuda hatayı fırlatıyor.
//    Bu bekçi KAYNAK sözleşmesini kilitler — pwsh her ortamda yok.
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

/** Yorumsuz, kırpılmış komut satırları — yorumdaki metin çağrı sayılmaz. */
const komutlar = kur
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.length > 0 && !l.startsWith("#"));

// ── §0 KÖRLÜK ZEMİNİ ────────────────────────────────────────────────────────
console.log("\n§0 — körlük zemini");
check("kur.ps1 okundu", kur.length > 1000, `${kur.length} karakter`);
check("komut satırları ayrıştı", komutlar.length > 200, `${komutlar.length} satır`);

// ── §1 YARDIMCI VAR VE HATAYI YUTMUYOR ──────────────────────────────────────
console.log("\n§1 — ısrarlı taşıma yardımcısı");
const fnBas = kur.indexOf("function TasiIsrarla");
check("⭐ `TasiIsrarla` tanımlı", fnBas > 0);
const fnSon = fnBas < 0 ? -1 : kur.indexOf("\n}", fnBas);
const govde = fnBas < 0 ? "" : kur.slice(fnBas, fnSon < 0 ? kur.length : fnSon);
const govdeKomut = govde
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.length > 0 && !l.startsWith("#"));

check("gövdede döngü var (tek deneme değil)", /for\s*\(/.test(govde));
check("denemeler arasında bekleme var", govdeKomut.some((l) => /Start-Sleep/.test(l)));
check(
  "⭐ SON denemede hata AYNEN fırlatılıyor (yutulursa kurulum yarım veriyle devam eder)",
  // ⚠️ `throw` satır BAŞINDA değil: `if ($i -eq $deneme) { throw }` biçiminde.
  //    İlk yazımda `^throw` arandı ve bekçi kendi kodunu YANLIŞ ölçtü.
  govdeKomut.some((l) => /\bthrow\b/.test(l)),
  govdeKomut.find((l) => /throw/.test(l)) ?? "throw YOK",
);
check(
  "taşıma `-ErrorAction Stop` ile yapılıyor (yoksa catch hiç koşmaz)",
  govdeKomut.some((l) => /Move-Item .*-ErrorAction Stop/.test(l)),
);

// ── §2 TAŞIYAN HER YER YARDIMCIYI KULLANIYOR ────────────────────────────────
console.log("\n§2 — dört taşıma yerinin dördü de ısrarlı");
// Yardımcının KENDİ gövdesindeki `Move-Item` meşrudur; dışarıdaki her çıplak
// çağrı yarışın geri döndüğü bir kapıdır.
const disKomutlar = komutlar.filter((l) => !govdeKomut.includes(l));
// ⚠️ `Write-Host` satırları HARİÇ: geri alma yarıda kalınca basılan "elle şunu
//    koş" mesajı da `Move-Item` kelimesini taşıyor. Metni komut sanmak, kardeş
//    bekçinin iki kez düştüğü tuzağın AYNISI — ama ters yönde: burada YANLIŞ
//    KIRMIZI verir ve gerçek bir düzeltmeyi engellerdi.
const ciplak = disKomutlar.filter(
  (l) => /(^|[^-\w])Move-Item\b/.test(l) && !/^Write-Host\b/.test(l),
);
check(
  "⭐ yardımcı DIŞINDA çıplak `Move-Item` çağrısı YOK",
  ciplak.length === 0,
  ciplak.join(" · ") || "temiz",
);
const kullanim = disKomutlar.filter((l) => /\bTasiIsrarla\b/.test(l));
check(
  "⭐ dört taşıma yeri de yardımcıyı çağırıyor ([5/9] · otomatik geri alma · -GeriAl ×2)",
  kullanim.length === 4,
  `${kullanim.length} çağrı`,
);

// ── §3 YATIŞMA BEKLEMESİ ────────────────────────────────────────────────────
console.log("\n§3 — [4/9] sonrası yatışma beklemesi");
const dortBas = kur.indexOf("[4/9] pm2 uygulamasi durduruluyor");
const besBas = kur.indexOf("[5/9] Yeni surum yerlestiriliyor");
check("iki adım da bulundu ve sıralı", dortBas > 0 && besBas > dortBas);
const araKomut = (dortBas > 0 && besBas > dortBas ? kur.slice(dortBas, besBas) : "")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.length > 0 && !l.startsWith("#"));
check(
  "⭐ pm2 delete ile taşıma arasında `Start-Sleep` var (yarışı daraltır)",
  araKomut.some((l) => /^Start-Sleep/.test(l)),
  araKomut.find((l) => /Start-Sleep/.test(l)) ?? "YOK",
);

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
