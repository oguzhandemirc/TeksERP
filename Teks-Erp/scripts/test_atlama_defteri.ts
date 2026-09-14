// =============================================================================
// BEKÇİ — ATLAMA DEFTERİ: "bilinmiyor" bir sayıya KARIŞMAZ
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts atlama_defteri
//
// ⭐ NEDEN VAR: `atla()` 8 dosyada kopyaydı, 4 farklı biçimde basıyordu ve
//    8'inden yalnız 1'i `TEKSERP_STRICT`e uyuyordu (ölçüldü 2026-09-13).
//    Ortak alet bunu birleştirir — ama asıl koruduğu şey şu tek cümle:
//
//    ⚠️ **Sayılamayan atlama, sayılan atlamaya KARIŞMAZ.** `N atlandı` sessizce
//       N'i BİLDİĞİMİZİ iddia eder. Erken `return`de bilmiyoruz; oraya 0 yazmak
//       ya da bilinmeyeni toplama katmak aynı yalanın küçük puntolusudur.
//
// ⚠️ BU BEKÇİ DB'YE DOKUNMAZ — saf aletin sözleşmesini ölçer.
// =============================================================================
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { BILINMEYEN_BEYAN, atlamaDefteri, strictMi } from "./lib/atlama";

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

/** Alet konuşkandır; sözleşmeyi ölçerken çıktısı sınavı boğmasın. */
function sessiz<T>(fn: () => T): T {
  const eski = console.log;
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = eski;
  }
}

function sayma(): void {
  console.log("\n§1 — sayılabilen atlama");
  const d = sessiz(() => {
    const x = atlamaDefteri(() => {});
    x.atla("a", "sebep");
    x.atla("b", "sebep", 4);
    return x;
  });
  check("§1a varsayılan adet 1, toplanır", d.sayi === 5, `${d.sayi} (1 + 4)`);
  check("§1b özet eki sayıyı taşır", d.ozetEki() === ", 5 atlandı", d.ozetEki());
  check("§1c bilinmeyen yokken beyan da yok", !d.bilinmeyenVar && !d.ozetEki().includes(BILINMEYEN_BEYAN));
  const bos = sessiz(() => atlamaDefteri(() => {}));
  check("§1d hiç atlama yoksa ek BOŞ (sessiz `, 0 atlandı` basmaz)", bos.ozetEki() === "", `"${bos.ozetEki()}"`);
}

function bilinmeyen(): void {
  console.log("\n§2 — ⭐ BİLİNMEYEN bir sayıya KARIŞMAZ");
  const d = sessiz(() => {
    const x = atlamaDefteri(() => {});
    x.atla("sayılan", "sebep", 3);
    x.atla("erken return", "DATABASE_URL yok", "?");
    return x;
  });
  check("§2a ⭐ bilinmeyen TOPLAMA GİRMEZ", d.sayi === 3, `${d.sayi} — yalnız sayılabilen`);
  check("§2b bilinmeyen bayrağı kalkar", d.bilinmeyenVar);
  const ek = d.ozetEki();
  check("§2c ⭐ ikisi AYRI beyan", ek === `, 3 atlandı, ${BILINMEYEN_BEYAN}`, ek);
  // Bu, bekçinin asıl yüklemidir: bilinmeyen bir SAYI gibi görünmemeli, yoksa
  // koşucunun regex'i onu toplar ve "bilinmiyor" sessizce bir sayıya dönüşür.
  check(
    "§2d ⭐ bilinmeyen beyanı SAYI İÇERMEZ (koşucunun regex'i onu toplayamaz)",
    !/\d/.test(BILINMEYEN_BEYAN),
    BILINMEYEN_BEYAN,
  );
  const yalniz = sessiz(() => {
    const x = atlamaDefteri(() => {});
    x.atla("yalnız bilinmeyen", "sebep", "?");
    return x;
  });
  check("§2e yalnız bilinmeyen varken sayı beyanı YOK", yalniz.ozetEki() === `, ${BILINMEYEN_BEYAN}`, yalniz.ozetEki());
}

function strict(): void {
  console.log("\n§3 — STRICT altında atlama KIRMIZIDIR");
  const eski = process.env.TEKSERP_STRICT;
  try {
    process.env.TEKSERP_STRICT = "1";
    const kirmizilar: string[] = [];
    const d = sessiz(() => {
      const x = atlamaDefteri((m) => kirmizilar.push(m));
      x.atla("bölüm", "sunucu yok", 7);
      x.atla("erken return", "DATABASE_URL yok", "?");
      return x;
    });
    check("§3a strict'te çağıran kırmızıya çevrilir", kirmizilar.length === 2, `${kirmizilar.length} çağrı`);
    check("§3b ⭐ strict'te atlama SAYILMAZ (arıza olur, kapsam kaybı değil)", d.sayi === 0, `${d.sayi}`);
    check("§3c strict'te bilinmeyen de beyan edilmez", !d.bilinmeyenVar && d.ozetEki() === "");
  } finally {
    if (eski === undefined) delete process.env.TEKSERP_STRICT;
    else process.env.TEKSERP_STRICT = eski;
  }
  check("§3d strict bayrağı geri yüklendi", strictMi() === (eski === "1"));
}

function tekEv(): void {
  console.log("\n§4 — strict anahtarının EVİ tek");
  const KOK = join(__dirname, "..");
  const http = readFileSync(join(KOK, "scripts", "lib", "http-bekci-kapisi.ts"), "utf8");
  // İkinci bir tanım, iki koşumun iki farklı şey iddia etmesi demektir.
  check(
    "§4a ⭐ http-bekci-kapisi strict'i TANIMLAMAZ, ithal eder",
    !/export function strictMi/.test(http) && /from "\.\/atlama"/.test(http),
  );
  const kendi = readFileSync(join(KOK, "scripts", "lib", "atlama.ts"), "utf8");
  check("§4b tek tanım atlama.ts'te", /export function strictMi/.test(kendi));
  // KÖRLÜK ZEMİNİ: dosya adı değişirse yukarıdaki iki yüklem VAKUMEN yeşil olurdu.
  check("§4z körlük zemini: iki kaynak da okundu", http.length > 500 && kendi.length > 500);
  // API ŞEKLİYLE fail-closed: `kirmiziyaCevir` isteğe bağlı olsaydı bir bekçi
  // "KIRMIZI" basıp exit 0 dönebilirdi (*basılmayan dalın yeşili*).
  check(
    "§4c ⭐ kirmiziyaCevir ZORUNLU parametre (isteğe bağlı olsaydı strict sessizce yutulurdu)",
    /kirmiziyaCevir: \(mesaj: string\) => void\)/.test(kendi),
  );
}

/**
 * Bir bekçi kaynağı YEREL atlama sayacı mı tutuyor? SAF — girdi metin, çıktı karar.
 *
 * ⚠️ Ölçüt "yerel `atla()` tanımı VAR MI" DEĞİLDİR: ince bir sarmalayıcı meşrudur ve
 * çağrı yerlerini değiştirmemek için tercih edilir. Ölçüt ŞUDUR: dosya `Sonuç:`
 * satırında BİR ATLAMA BEYAN EDİYORSA ortak defteri ithal etmelidir. Kopya defter
 * `"?"` (sayılamayan) sınıfını temsil edemez ve sayıyı elle düzeltmeye zorlar.
 */
export function yerelKopyaMi(kaynak: string): { beyanEdiyor: boolean; ithalEdiyor: boolean; kopya: boolean } {
  const ozet = /=== Sonuç:[^\n]*/.exec(kaynak)?.[0] ?? "";
  // Beyan iki biçimde görünür: şablon içinde `atlandı` metni ya da `ozetEki()` çağrısı.
  const beyanEdiyor = /atlandı/.test(ozet) || /ozetEki\(\)/.test(ozet);
  const ithalEdiyor = /from "\.\/lib\/atlama"/.test(kaynak);
  return { beyanEdiyor, ithalEdiyor, kopya: beyanEdiyor && !ithalEdiyor };
}

/** Beyanlı muafiyet — BOŞ DOĞAR. Yeni satır gerekçesiyle yazılır. */
const KOPYA_MUAF: Record<string, string> = {};

function tekAltyapi(): void {
  const KOK = join(__dirname, "..");
  const dosyalar = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "scripts"], {
    cwd: KOK,
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter((f) => /^scripts\/test_[a-z0-9_]+\.ts$/.test(f));
  check("§5z körlük zemini: bekçi kümesi dolu", dosyalar.length > 50, `${dosyalar.length} bekçi`);

  const kopyalar: string[] = [];
  let beyanEden = 0;
  for (const f of dosyalar) {
    if (basename(f) === basename(__filename).replace(/\.js$/, ".ts")) continue;
    const k = yerelKopyaMi(readFileSync(join(KOK, f), "utf8"));
    if (k.beyanEdiyor) beyanEden++;
    if (k.kopya && !(f in KOPYA_MUAF)) kopyalar.push(f);
  }
  check(
    "§5 ⭐ atlama BEYAN eden her bekçi ORTAK defteri kullanıyor (yerel kopya YOK)",
    kopyalar.length === 0,
    kopyalar.length
      ? `YEREL KOPYA: ${kopyalar.join(", ")} — kopya \`"?"\` sınıfını temsil edemez ve sayıyı elle düzeltmeye zorlar`
      : `${beyanEden} bekçi atlama beyan ediyor, hepsi lib/atlama üzerinden`,
  );
  const oluMuaf = Object.keys(KOPYA_MUAF).filter((f) => !dosyalar.includes(f));
  check("§5b muafiyet listesinde ölü satır yok", oluMuaf.length === 0, oluMuaf.join(", "));

  // ⭐ SONDALAR — kural sentetik kaynakla ısırıyor mu (kontrol grubu).
  const ozetli = (govde: string) => `console.log(\`\\n=== Sonuç: \${pass} geçti${govde}\`);`;
  check(
    "§5c ⭐ beyan VAR + ithal YOK → KOPYA",
    yerelKopyaMi(ozetli(", ${atlanan} atlandı ===")).kopya,
  );
  check(
    "§5d ⭐ beyan VAR + ithal VAR → kopya DEĞİL",
    yerelKopyaMi(`import { atlamaDefteri } from "./lib/atlama";\n` + ozetli(", ${atlanan} atlandı ===")).kopya === false,
  );
  check(
    "§5e ⭐ `ozetEki()` de bir BEYANDIR (metinde 'atlandı' geçmese bile)",
    yerelKopyaMi(ozetli("${ATLAMA.ozetEki()} ===")).beyanEdiyor,
  );
  check(
    "§5f hiç atlama beyan etmeyen bekçi kapsam DIŞI (yanlış pozitif sondası)",
    yerelKopyaMi(ozetli(", ${fail} başarısız ===")).kopya === false,
  );
}

function main(): void {
  console.log("=== Atlama defteri ===");
  sayma();
  bilinmeyen();
  strict();
  tekEv();
  tekAltyapi();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
