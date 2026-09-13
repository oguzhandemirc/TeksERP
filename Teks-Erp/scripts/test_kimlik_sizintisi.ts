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
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
 *
 * ⚠️ KAPSAM ÇIKTIDA DA DURUR ve ÇIKTI BU SABİTLERDEN TÜRER: sınır yalnız kaynakta
 *   yaşarsa altı ay sonra GENİŞLEMİŞ sanılır; elle yazılmış bir çıktı cümlesi ise
 *   sabit değişince BAYATLAR (2026-09-14'te ortak ağaçta tam böyle bir kopya
 *   bulundu — çıktıda "src,scripts · .ts/.tsx/.mjs" yazıyor, docs/ ve .md'yi
 *   sessizce düşürüyordu). `--sonda`: uzantı kümesinden `.md` düşürülünce hem
 *   çıktı satırı değişir hem geçici dizindeki bilinen `.md` satırı KAÇAR.
 */
const TARANAN_UZANTILAR: readonly string[] = ["ts", "tsx", "mjs", "md"];
const ATLANAN_DIZINLER: readonly string[] = ["node_modules", "dist", "out", ".git"];
/** Tarama kökleri — backend köküne göreli; repo kökü `..` ile. */
const TARANAN_KOKLER: readonly string[] = ["src", "scripts", "docs", "../docs"];

function uzantiDeseni(uzantilar: readonly string[]): RegExp {
  return new RegExp(`\\.(${uzantilar.join("|")})$`);
}
function dosyalar(d: string, desen: RegExp, out: string[] = []): string[] {
  for (const n of readdirSync(d)) {
    if (ATLANAN_DIZINLER.includes(n)) continue;
    const p = join(d, n);
    if (statSync(p).isDirectory()) dosyalar(p, desen, out);
    else if (desen.test(p)) out.push(p);
  }
  return out;
}

/** Kapsam cümlesi — SABİTLERDEN türer, elle yazılmaz (bayatlayamaz). */
function kapsamBeyani(kokler: readonly string[], uzantilar: readonly string[]): string {
  return `KAPSAM: ${kokler.map((k) => k.replace(/^\.\.\//, "<repo>/")).join(" · ")} · .${uzantilar.join("/.")} · atlanan dizin ${ATLANAN_DIZINLER.join("/")} · ARANAN TEK DİZGE: fabrika DB adı`;
}

/** Bir kök kümesini bir uzantı kümesiyle tarar; muaf olmayan siteleri döner. */
function tara(kokler: readonly string[], uzantilar: readonly string[], tabanKok: string): { taranan: number; bulgular: string[]; muafBulunan: Set<string> } {
  const desen = uzantiDeseni(uzantilar);
  const taranan = kokler.flatMap((k) => dosyalar(join(tabanKok, k), desen));
  const bulgular: string[] = [];
  const muafBulunan = new Set<string>();
  for (const f of taranan) {
    const rel = relative(tabanKok, f).replace(/\\/g, "/");
    const src = readFileSync(f, "utf8");
    if (!src.includes(FABRIKA_DB)) continue;
    if (rel in MUAFLAR) {
      muafBulunan.add(rel);
      continue;
    }
    const satir = src.split("\n").findIndex((s) => s.includes(FABRIKA_DB)) + 1;
    bulgular.push(`${rel}:${satir}`);
  }
  return { taranan: taranan.length, bulgular, muafBulunan };
}

function main(): void {
  console.log("=== Kimlik sızıntısı bekçisi ===\n");

  console.log(kapsamBeyani(TARANAN_KOKLER, TARANAN_UZANTILAR));
  console.log(
    "        DIŞARIDA (bilerek, 'temiz' değil 'ölçülmedi'): müşteri/profil anahtarı (bayrak değeri, tasarımın kendisi) ·\n" +
      "        barkod · çuval no · kullanıcı adı · özel LAN IP'si (RFC1918) · e-posta · alan adı · .json/.sh/.ps1/.yml/.env*\n",
  );
  const { taranan, bulgular, muafBulunan } = tara(TARANAN_KOKLER, TARANAN_UZANTILAR, KOK);
  // KÖRLÜK ZEMİNİ: tarama boşa düşerse "sızıntı yok" ile "hiçbir şeye bakılmadı"
  // aynı yeşile çıkar.
  check("§0a körlük zemini: dosyalar tarandı", taranan > 400, `${taranan} dosya`);

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

  // ── SONDA (--sonda): kapsam beyanı sabitten türüyor mu, .md düşünce bulgu kaçıyor mu ──
  if (process.argv.includes("--sonda")) {
    const dir = mkdtempSync(join(tmpdir(), "kimlik-sonda-"));
    try {
      // Fikstür yolu repo belge yoluna BENZEMEZ (`sonda-belge/`): `check-docs.mjs`in
      // kod→belge çapa tarayıcısı `docs/x.md` dizgisini belge atfı sayar ve "MEVCUT DEĞİL" der.
      const SONDA_DIZIN = "sonda-belge";
      const SONDA_MD = "sonda-not.md";
      mkdirSync(join(dir, SONDA_DIZIN));
      writeFileSync(join(dir, SONDA_DIZIN, SONDA_MD), `Ölçüm (${FABRIKA_DB}, sonda)\n`);
      writeFileSync(join(dir, SONDA_DIZIN, "sonda-kod.ts"), "export const x = 1;\n");
      const tam = tara([SONDA_DIZIN], TARANAN_UZANTILAR, dir);
      check("§S1 sonda ön koşul: tam kapsamda .md satırı BULUNUR", tam.bulgular.length === 1 && tam.bulgular[0]!.startsWith(`${SONDA_DIZIN}/${SONDA_MD}`), tam.bulgular.join(" · ") || "∅");
      const mdSiz = TARANAN_UZANTILAR.filter((u) => u !== "md");
      const dar = tara([SONDA_DIZIN], mdSiz, dir);
      check("§S2 sonda: uzantı kümesinden .md düşünce aynı satır KAÇAR", dar.bulgular.length === 0, `${dar.bulgular.length} bulgu`);
      const b1 = kapsamBeyani(TARANAN_KOKLER, TARANAN_UZANTILAR);
      const b2 = kapsamBeyani(TARANAN_KOKLER, mdSiz);
      check("§S3 sonda: kapsam beyanı sabitten türüyor — .md düşünce çıktı satırı DEĞİŞİR ve .md'yi söylemez", b1 !== b2 && b1.includes(".md") && !b2.includes(".md"), b2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } else {
    console.log("\n(sondalar KAPALI — npx tsx scripts/test_kimlik_sizintisi.ts --sonda)");
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
