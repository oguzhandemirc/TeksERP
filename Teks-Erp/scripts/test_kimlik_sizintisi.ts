// =============================================================================
// BEKÇİ — KİMLİK SIZINTISI: fabrika DB adı koda SABİTLENMEZ
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts kimlik_sizintisi
//
// ⭐ NEDEN VAR (2026-09-13): kök CLAUDE.md zaten diyordu — *"DB adı PROFİL
//    değeridir — koda/dokümana sabitleme"*. Kural BEYAN EDİLMİŞTİ, ölçülmüyordu:
//    ağaçta **on site** çıktı (6e dördünü buldu, tarama altı tane daha).
//
// ⚠️ Ve sınıfı öğretici: bu satırların neredeyse hepsi *"ölçümü yazarken
//    KAYNAĞINI da yaz"* disiplininin ürünüydü — `Ölçüm (tekserp_fabrika_dev,
//    2026-09-12): 69 aday…` biçiminde. Yani **doğru bir refleksin yanlış granülariteyle**
//    uygulanması. Panzehir adı SİLMEK değil, SINIFIYLA ADLANDIRMAK:
//    *"fabrikanın canlı yedeğinde"*. Ölçüm aynı derecede doğrulanabilir kalır,
//    kimlik gider.
//
// ⚠️ VE BU DOSYA KENDİNİ YAKALADI (ilk koşum): başlıktaki ÖRNEK satır gerçek adı
//    taşıyordu. Üçüncü kez aynı ders — bir tarayıcının ilk kurbanı KENDİ
//    BELGESİDİR. Örnek artık adı yazmıyor; adın tek geçtiği yer aşağıdaki sabit
//    ve dosya, o sabit yüzünden kendi muaf listesinde.
//
// ⚠️ NEDEN MANDAL: bugün üç meşru site var, yarın dördüncüsü SESSİZCE eklenir.
//    Kural bir kapıya bağlanmadıkça bir temennidir (bugün beşinci kez).
//
// ⚠️ MEŞRU SİTELER ADIYLA MUAF — ve gerekçesi tek cümlede: adın KENDİSİ orada
//    konudur (güvenli-ad listesi ve o listeyi ölçen sondalar). Muafiyet listesi
//    İKİ YÖNLÜ denetlenir: ölü muaf da kırmızı verir, yoksa liste sessizce şişer.
//
// ⚠️ KAPSAM BEYANI — bu bekçi YALNIZ fabrika DB adını arar. Ölçtüğüm ama BURAYA
//    BAĞLAMADIĞIM sınıflar: özel LAN IP'leri (RFC1918, tek başına kimlik taşımaz
//    ve ağaçta 12 fixture'da geçiyor — değiştirmek kazançsız gürültü olurdu) ·
//    e-posta (hepsi `ornek.com`) · alan adları (ürünün KENDİ markası). Bunları
//    "temiz" diye değil, "kapsam dışı" diye kaydediyorum.
// =============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const KOK = join(__dirname, "..");

/** Fabrikanın canlı yedeğinin adı — tek yerde, muafların ölçülebilmesi için. */
const FABRIKA_DB = "tekserp_fabrika_dev";

/**
 * Adın KENDİSİNİN konu olduğu dosyalar. Muaf = "burada ad bir SIZINTI değil,
 * kapının konusudur" demektir; "burada kurala uymuyoruz" demek DEĞİLDİR.
 */
const MUAFLAR: Record<string, string> = {
  "scripts/lib/bilinen-guvenli-db.ts": "güvenli-ad kümesinin TEK KAYNAĞI — ad burada veridir",
  "scripts/lib/hedef-db-kapisi.ts": "kapının kabul listesi + gerekçesi; ad işlevsel",
  "scripts/test_script_guards.ts": "kapıyı TAM O ADLA sınayan sondalar — ad sondanın girdisi",
  "scripts/test_kimlik_sizintisi.ts": "bu dosyanın kendisi — aradığı adı SABİT olarak taşır (§0b pozitif kontrolü de ona dayanır)",
};

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

/**
 * ⚠️ KAPSAM (DOSYA TÜRÜ) — beyan edilir, çünkü 2026-09-13'te BEYAN EDİLMEMİŞTİ ve
 * bir kör nokta üretti: kapı yalnız `.ts/.tsx/.mjs` tarıyordu, `docs/` HİÇ
 * taranmıyordu — oysa kural (*"repo PUBLIC ⇒ commit mesajında ve BELGEDE sayı
 * serbest, KİMLİK yok"*) belgeleri SAYIYOR, kapı SAYMIYORDU. 6e ölçtü: kodda 8
 * satır (dördü muaf, kapı haklı olarak yeşil) · belgede **23 satır**, hepsi
 * kapsam dışı. Başlıktaki kapsam beyanı SINIF sınırlarını (IP · e-posta · alan
 * adı) sayıyordu, DOSYA TÜRÜ sınırını saymıyordu.
 *
 * TARANAN : `.ts` `.tsx` `.mjs` (kod) + `.md` (belge) — `src/` `scripts/` `docs/`
 * TARANMAYAN: `.json` `.sh` `.ps1` `.yml` `.env*` — ölçüldü (2026-09-13): bugün
 *   hiçbirinde ad yok; ama "yok" ≠ "kapsanıyor". Yarın bir `.yml`e yazılırsa bu
 *   kapı GÖRMEZ. Sınırı genişletmek bu cümleyi geçersiz kılmaz — sınır KALIR.
 */
const TARANAN_UZANTI = /\.(ts|tsx|mjs|md)$/;
function dosyalar(d: string, out: string[] = []): string[] {
  for (const n of readdirSync(d)) {
    if (n === "node_modules" || n === "dist" || n === "out" || n === ".git") continue;
    const p = join(d, n);
    if (statSync(p).isDirectory()) dosyalar(p, out);
    else if (TARANAN_UZANTI.test(p)) out.push(p);
  }
  return out;
}

function main(): void {
  console.log("=== Kimlik sızıntısı bekçisi ===\n");

  const REPO = join(KOK, "..");
  const taranan = [
    ...dosyalar(join(KOK, "src")),
    ...dosyalar(join(KOK, "scripts")),
    ...dosyalar(join(KOK, "docs")),
    ...dosyalar(join(REPO, "docs")),
  ];
  // KÖRLÜK ZEMİNİ: tarama boşa düşerse "sızıntı yok" ile "hiçbir şeye bakılmadı"
  // aynı yeşile çıkar.
  check("§0a körlük zemini: dosyalar tarandı", taranan.length > 400, `${taranan.length} dosya`);

  const bulgular: string[] = [];
  const muafBulunan = new Set<string>();
  for (const f of taranan) {
    const rel = relative(KOK, f).replace(/\\/g, "/");
    const src = readFileSync(f, "utf8");
    if (!src.includes(FABRIKA_DB)) continue;
    if (rel in MUAFLAR) {
      muafBulunan.add(rel);
      continue;
    }
    const satir = src.split("\n").findIndex((s) => s.includes(FABRIKA_DB)) + 1;
    bulgular.push(`${rel}:${satir}`);
  }

  check(
    "§1 ⭐ fabrika DB adı muaf dosyaların DIŞINDA geçmiyor",
    bulgular.length === 0,
    bulgular.length ? `${bulgular.length} site: ${bulgular.slice(0, 5).join(" · ")}` : "temiz",
  );
  console.log(
    `   Panzehir: adı SİLME, SINIFIYLA ADLANDIR — "fabrikanın canlı yedeğinde".\n` +
      `   Ölçüm doğrulanabilir kalır, kimlik gider.`,
  );

  // ⚠️ İKİ YÖNLÜ: ölü muaf da kırmızı. Yoksa liste sessizce şişer ve bir gün
  // "muaf" kelimesi "bakılmadı" anlamına gelir.
  const oluMuaf = Object.keys(MUAFLAR).filter((m) => !muafBulunan.has(m));
  check(
    "§2 ölü muaf YOK (liste bayat değil)",
    oluMuaf.length === 0,
    oluMuaf.length ? `artık adı taşımıyor: ${oluMuaf.join(" · ")}` : `${muafBulunan.size} muaf güncel`,
  );

  // ⭐ POZİTİF KONTROL: yüklem gerçekten arıyor mu? Muaf dosyaların BİRİNDE adın
  // bulunmuş olması, taramanın çalıştığının kanıtıdır — §1'in yeşili tek başına
  // "hiç bakmadım" ile aynı görünürdü.
  check(
    "§0b ⭐ pozitif kontrol: tarayıcı adı GERÇEKTEN buluyor (muaflarda bulundu)",
    muafBulunan.size > 0,
    `${muafBulunan.size} dosyada bulundu`,
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
