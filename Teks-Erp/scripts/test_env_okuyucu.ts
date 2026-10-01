// =============================================================================
// BEKÇİ — `.env` OKUYUCU İKİZİ (Dağıtım v2 D2b): backend'in okuyucusu (dotenv) ↔ güncelleyicinin
// Rust aynası (`native/tekserp-hizmet/src/envfile.rs`)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts env_okuyucu   (DB'SİZ, ağsız)
//             npx tsx scripts/test_env_okuyucu.ts --vektor-yaz  (vektör dosyasını GERÇEK dotenv'den yeniden üretir)
//
// NE ÖLÇER: `<KOK>\yapilandirma\.env`i iki süreç okur — backend (dotenv `config`) ve güncelleyici (Rust).
// İkisi AYNI anahtar/değeri görmeli (kök kural "ayrışan yüzey"); Rust aynası dotenv'i birebir izler,
// içerikten hata üretmez. Ortak vektörler `native/test-vektorleri/env-dosyasi.json` — Rust tarafı
// `tekserp-hizmet/tests/env_dosyasi_vektorleri.rs` (eşlik) + `tekserp-guncelleyici/tests/ayar_env.rs`
// (zorunlu anahtar → `AYAR_EKSIK`).
//   §1 okuyucu ölçümü: backend `.env`i yalnız dotenv ile yükler (`server.ts` `dotenv/config`, `prisma.ts`
//      `dotenv.config`; `src/`de `process.loadEnvFile` · `util.parseEnv` · `--env-file` YOK; bağımlılıkta
//      başka env okuyucusu YOK) · kurulu dotenv = kilit dosyası = vektör dosyasının `okuyucu`su
//   §2 ⭐ vektör dosyası = `--vektor-yaz` çıktısı BAYT-EŞİT (her kaydın beklenen haritası BUGÜNKÜ gerçek
//      okuyucudan — `config` + geçici dosya; elle düzenlenmiş ya da bayat dosya kırmızı) · adlar tekil ·
//      kapsam (Windows yolu çift tırnakta · tırnaksız `#` · `ANAHTAR: değer` · geçersiz satır · geçersiz
//      UTF-8 · U+2028 · tekrar)
//   §3 ⭐ zorunlu anahtar: dosyanın `zorunlu`su = TS listesi = Rust `REQUIRED_BACKEND_KEYS` (kaynaktan) ·
//      `guncelleyici: AYAR_EKSIK` iddiası ⇔ gerçek okuyucu zorunlu anahtarı VERMİYOR (yok ya da boş) ·
//      en az bir AYAR_EKSIK kaydında anahtar ADI metinde geçtiği hâlde okuyucu onu sessizce atlıyor
//      (sessiz atlama bir zorunlu ayarı gizleyemesin — kayıt kırmızıya düşmeli)
//   §4 Rust tarafı bağlı: iki Rust testi vektör dosyasını ve doğru giriş noktasını okuyor
//   §5 ⭐ KALICI SONDA ✓K: bayatlık karşılaştırıcısı mutasyonlu beklenende ISIRIR, eşitte susar ·
//      zorunlu öncül denetimi yanlış iddiada ISIRIR
//
// NEGATİF SONDA — dosya DIŞI mutasyonlar (bir kezlik, ✓B; sayılar commit mesajında):
//   bkz. Teks-Erp/docs/BEKCI-HARITASI.md `## surum-deploy` satırı (test_env_okuyucu).
// =============================================================================
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const TEKS = path.resolve(__dirname, "..");
const NATIVE = path.join(TEKS, "native");
const DOSYA = path.join(NATIVE, "test-vektorleri", "env-dosyasi.json");
const BICIM = 1;
/** Güncelleyicinin zorunlu anahtarları — Rust `settings::REQUIRED_BACKEND_KEYS` ile AYNI (§3a ölçer). */
const ZORUNLU: readonly string[] = ["DATABASE_URL"];
type Sonuc = "TAMAM" | "AYAR_EKSIK" | "AYAR_BICIMSIZ";

interface Girdi {
  readonly ad: string;
  readonly girdi: Buffer;
  /** Güncelleyicinin bu dosyayla vereceği sonuç (Rust `ayar_env.rs` ölçer; AYAR_EKSIK öncülünü §3 ölçer). */
  readonly guncelleyici?: Sonuc;
}
interface Kayit {
  vektor: { ad: string; metin?: string; baytHex?: string };
  beklenen: Record<string, string>;
  guncelleyici?: Sonuc;
}
interface Dosya {
  bicim: number;
  not: string;
  okuyucu: string;
  zorunlu: string[];
  kayitlar: Kayit[];
}

/** Metin + ham bayt parçalarından girdi (geçersiz UTF-8 yalnız böyle yazılır). */
function bayt(...parcalar: Array<string | number[]>): Buffer {
  return Buffer.concat(parcalar.map((p) => (typeof p === "string" ? Buffer.from(p, "utf8") : Buffer.from(p))));
}
const m = (ad: string, metin: string, guncelleyici?: Sonuc): Girdi => ({ ad, girdi: bayt(metin), guncelleyici });

const URL = "postgresql://tekserp:p%40ss@127.0.0.1:5432/tekserp?schema=public";
const GERCEKCI =
  "# TeksERP — yapilandirma\\.env\r\n" +
  "PORT=4000\r\n" +
  `DATABASE_URL="${URL}"\r\n` +
  "JWT_SECRET=gizli-jwt # satır sonu yorumu\r\n" +
  'PG_BIN_DIR="C:\\TeksERP\\pgsql\\bin"\r\n' +
  "LICENSE_DIR=C:\\TeksERP\\lisans\r\n" +
  "BACKUP_PG_USER=tekserp_bakim\r\n" +
  "BACKUP_PG_PASSWORD='p#ss w0rd'\r\n" +
  "export APP_ENV=production\r\n";

/** Girdi listesi — sıra = dosyadaki sıra. Yeni kural sınıfı yeni kayıtla gelir, beklenen ELLE yazılmaz. */
const GIRDILER: readonly Girdi[] = [
  m("temel: ANAHTAR=DEĞER", "PORT=4000\nHOST=0.0.0.0\n"),
  m("boş dosya", ""),
  m("yalnız yorum ve boş satır", "# yorum\n\n   \n\t# girintili yorum\n"),
  m("CRLF satır sonu", "A=1\r\nB=2\r\n"),
  m("yalnız CR satır sonu", "A=1\rB=2\r"),
  m("BOM dosya başında boşluktur", "\uFEFFA=1\n"),
  m("BOM + yorum: ilk satır yorum kalır", "\uFEFF# A=1\nB=2\n"),
  m("export öneki (boşluk ya da sekme)", "export A=1\nexport\tB=2\n"),
  m("export anahtarın kendisi olabilir", "export = 2\n"),
  m("tek başına export sonraki satıra bağlanır", "export\nKEY=v\n"),
  m("anahtarda nokta, tire, baştaki rakam", "a.b=1\nx-y=2\n1ABC=3\n"),
  m("ayırıcı çevresinde boşluk", "A = 1\nB =2\nC= 3\n"),
  m("iki nokta + boşluk ayırıcı", "K: v\nURL: postgres://u@h/db\n"),
  m("iki nokta boşluksuz: satır sessizce atlanır", "K:v\nL=1\n"),
  m("iki nokta + satır sonu: değer sonraki satırdan", "K:\nvalue\n"),
  m("anahtar ile = arasında satır sonu", "KEY\n=value\n"),
  m("boş değer", "A=\nB=\n"),
  m("boş değerden sonra tırnaklı satır: değer o satırdan", "KEY=\n'value'\n"),
  m("tırnaksız değerde # yorumu keser (boşluksuz da)", "P=abc#def\nQ=abc #def\nR=#hepsi\n"),
  m("tırnaksız değerin kenar boşluğu atılır, içi kalır", "U= iki  kelime \t\n"),
  m("tırnaksız değerde = karakteri", "W=a=b=c\n"),
  m("tek tırnak: # ve kaçış düz kalır", "A='a # b'\nB='x\\ny'\n"),
  m("çift tırnakta # korunur", 'A="abc#def"\nB="x # y"\n'),
  m("çift tırnak: yalnız \\n ve \\r açılır", 'A="x\\ny\\rz"\nB="a\\tb"\nC="a\\\\b"\n'),
  m("çift tırnak: çift ters bölüden sonra n yine açılır", 'A="x\\\\ny"\n'),
  m("çift tırnakta Windows yolu hata DEĞİL", 'PG_BIN_DIR="C:\\TeksERP\\pgsql\\bin"\nYOL="C:\\new\\yol"\n'),
  m("tek tırnakta Windows yolu düz", "YOL='C:\\new\\yol'\n"),
  m("tırnaksız Windows yolu düz", "LICENSE_DIR=C:\\TeksERP\\lisans\n"),
  m("ters tırnak", "A=`x y`\n"),
  m("tırnak içi boşluk korunur", 'V="  ic  "\n'),
  m("tırnaktan sonra yorum", "A=\"x\" # yorum\nB='y'#z\n"),
  m("tırnaktan sonra çöp: tırnaksız okunur", 'K="abc" junk\n'),
  m("kapanmayan tırnak: tırnaksız okunur", 'K="abc\nO="x"\n'),
  m("çok satırlı çift tırnak", 'COK="satir1\nsatir2"\nSON=1\n'),
  m("çok satırlı ters tırnak, içinde çift tırnak", 'K=`a\n"b"\nc`\n'),
  m("kaçışlı tırnak gövdede kalır", 'T="a\\"b"\nS=\'a\\\'b\'\n'),
  m("yalnız açılış tırnağı", "K=\"\nL='\n"),
  m("tekrar eden anahtar: sonuncusu geçerli", "A=1\nB=2\nA=3\n"),
  m("büyük/küçük harf ayrı anahtar", "Port=1\nPORT=2\n"),
  m("geçersiz satırlar sessizce atlanır", "bu bir satir\n=deger\n\"A\"=1\nB=2\n"),
  m("__proto__ atanmaz, constructor atanır", "__proto__=x\nconstructor=y\n"),
  m("U+2028 satır sonudur (^ ve $)", "K=\"a\"\u2028junk\nX=1\u2028Y=2\nbozuk\u2028Z=3\n"),
  m("U+2028'den sonraki tırnak çifti de soyulur", "K=x\u2028'y'\n"),
  m("U+0085 boşluk DEĞİL", "A=1\u0085\nB=\u0085x\n"),
  m("NBSP ve BOM değer kenarından atılır", "A=\u00A0x\u00A0\nB=y\uFEFF\n"),
  {
    ad: "geçersiz UTF-8 U+FFFD olur (Node çözücüsü)",
    girdi: bayt("A=", [0xff], "B\nB=", [0xc3], "\nC=", [0xe2, 0x82], "\nD=", [0xed, 0xa0, 0x80], "\nE=", [0xf0, 0x9f, 0x98], "\nF=", [0xc0, 0xaf], "\nG=", [0xf4, 0x90, 0x80, 0x80], "\n"),
  },
  { ad: "geçersiz UTF-8 anahtarı bozar: satır atlanır", girdi: bayt("A", [0xff], "=1\nB=2\n") },
  { ad: "UTF-8 BOM baytları + CRLF", girdi: bayt([0xef, 0xbb, 0xbf], "A=1\r\nB=\"x\"\r\n") },
  m("gerçekçi yapilandirma\\.env", GERCEKCI, "TAMAM"),
  // Güncelleyicinin zorunlu anahtarı (DATABASE_URL): sessiz atlama onu GİZLEYEMEZ.
  m("zorunlu: geçerli DATABASE_URL", `DATABASE_URL="${URL}"\n`, "TAMAM"),
  m("zorunlu: = yerine boşluk — satır sessizce atlanır", "DATABASE_URL postgresql://u:p@h:5432/db\nPORT=4000\n", "AYAR_EKSIK"),
  m("zorunlu: iki nokta boşluksuz — satır sessizce atlanır", "DATABASE_URL:postgresql://u:p@h:5432/db\n", "AYAR_EKSIK"),
  m("zorunlu: tireli ad başka anahtardır", "DATABASE-URL=postgresql://u:p@h:5432/db\n", "AYAR_EKSIK"),
  m("zorunlu: yoruma alınmış", "# DATABASE_URL=postgresql://u:p@h:5432/db\n", "AYAR_EKSIK"),
  m("zorunlu: boş değer", "DATABASE_URL=\n", "AYAR_EKSIK"),
  m("zorunlu: boş tırnak", 'DATABASE_URL=""\n', "AYAR_EKSIK"),
  m("zorunlu: tekrarda sonuncusu boş", "DATABASE_URL=postgresql://u:p@h:5432/db\nDATABASE_URL=\n", "AYAR_EKSIK"),
  m("zorunlu: dosyada hiç yok", "PORT=4000\n", "AYAR_EKSIK"),
  m("zorunlu: iki nokta + boşluk biçimi geçerli", "DATABASE_URL: postgresql://u:p@h:5432/db\n", "TAMAM"),
  m("zorunlu: çift tırnaklı adres + satır sonu yorumu", 'DATABASE_URL="postgresql://u:p%23ss@h:5432/db" # yorum\n', "TAMAM"),
  m("zorunlu: çift tırnakta kodlanmamış # — adres çözülemez", 'DATABASE_URL="postgresql://u:pa#ss@h:5432/db"\n', "AYAR_BICIMSIZ"),
  m("zorunlu: tırnaksız # parolayı keser — adres çözülemez", "DATABASE_URL=postgresql://u:pa#ss@h:5432/db\n", "AYAR_BICIMSIZ"),
  m("zorunlu: PORT sayı değil", "DATABASE_URL=postgresql://u:p@h:5432/db\nPORT=abc\n", "AYAR_BICIMSIZ"),
];

function dotenvSurumu(): string {
  const p = JSON.parse(readFileSync(path.join(TEKS, "node_modules", "dotenv", "package.json"), "utf8")) as { version: string };
  return p.version;
}

/** Backend'in GERÇEK okuyucusu: `config({path})` — dosya okuma (utf8) + parse + populate, boş hedefe. */
function okuyucu(girdi: Buffer, dizin: string, sira: number): Record<string, string> {
  const yol = path.join(dizin, `${sira}.env`);
  writeFileSync(yol, girdi);
  const hedef: Record<string, string> = {};
  const r = dotenv.config({ path: yol, processEnv: hedef, quiet: true });
  if (r.error) throw r.error;
  return Object.fromEntries(Object.keys(hedef).sort().map((k) => [k, hedef[k]]));
}

function kayitlariKur(): Kayit[] {
  const dizin = mkdtempSync(path.join(os.tmpdir(), "env-okuyucu-"));
  try {
    return GIRDILER.map((g, i) => {
      const metin = g.girdi.toString("utf8");
      const metinMi = Buffer.from(metin, "utf8").equals(g.girdi);
      const vektor = metinMi ? { ad: g.ad, metin } : { ad: g.ad, baytHex: g.girdi.toString("hex") };
      const k: Kayit = { vektor, beklenen: okuyucu(g.girdi, dizin, i) };
      if (g.guncelleyici) k.guncelleyici = g.guncelleyici;
      return k;
    });
  } finally {
    rmSync(dizin, { recursive: true, force: true });
  }
}

/** Tek satır kayıt, yalnız ASCII (görünmez karakter repoya ham girmez; JSON kaçışı iki tarafta aynı çözülür). */
function vektorMetni(kayitlar: readonly Kayit[], surum: string): string {
  const ascii = (s: string): string => s.replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  const bas = JSON.stringify({
    bicim: BICIM,
    not: "Üreten: Teks-Erp/scripts/test_env_okuyucu.ts --vektor-yaz (backend'in gerçek okuyucusu, dotenv config). Elle düzenlenmez.",
    okuyucu: `dotenv@${surum}`,
    zorunlu: ZORUNLU,
  });
  return ascii(`${bas.slice(0, -1)},"kayitlar":[\n${kayitlar.map((k) => JSON.stringify(k)).join(",\n")}\n]}\n`);
}

function girdiOf(k: Kayit): Buffer {
  return k.vektor.baytHex !== undefined ? Buffer.from(k.vektor.baytHex, "hex") : Buffer.from(k.vektor.metin ?? "", "utf8");
}

/** Beklenen haritası taze olandan farklı kayıtların adları (sıra sözleşme dışı). */
function bayatlar(dosya: readonly Kayit[], taze: readonly Kayit[]): string[] {
  const tazeAd = new Map(taze.map((k) => [k.vektor.ad, k]));
  const esit = (a: Record<string, string>, b: Record<string, string>): boolean => {
    const ka = Object.keys(a).sort();
    return JSON.stringify(ka) === JSON.stringify(Object.keys(b).sort()) && ka.every((x) => a[x] === b[x]);
  };
  return dosya.filter((k) => {
    const t = tazeAd.get(k.vektor.ad);
    return !t || !esit(k.beklenen, t.beklenen) || !girdiOf(k).equals(girdiOf(t));
  }).map((k) => k.vektor.ad);
}

/** `AYAR_EKSIK` iddiası ⇔ okuyucu zorunlu anahtarlardan birini vermiyor (yok ya da boş). */
function oncelIhlalleri(kayitlar: readonly Kayit[], zorunlu: readonly string[]): string[] {
  return kayitlar
    .filter((k) => k.guncelleyici !== undefined)
    .filter((k) => {
      const eksik = zorunlu.some((z) => !k.beklenen[z]);
      return eksik !== (k.guncelleyici === "AYAR_EKSIK");
    })
    .map((k) => k.vektor.ad);
}

function tsDosyalari(dizin: string): string[] {
  return readdirSync(dizin).flatMap((ad) => {
    const p = path.join(dizin, ad);
    return statSync(p).isDirectory() ? tsDosyalari(p) : ad.endsWith(".ts") ? [p] : [];
  });
}

function bolum1(): void {
  console.log("\n§1 — backend'in okuyucusu");
  const server = readFileSync(path.join(TEKS, "src", "server.ts"), "utf8");
  const prisma = readFileSync(path.join(TEKS, "src", "lib", "prisma.ts"), "utf8");
  check("§1a server.ts .env'i dotenv/config ile yükler", /^import "dotenv\/config";/m.test(server));
  check("§1b prisma.ts dotenv.config ile yükler", /\bdotenv\.config\(/.test(prisma));
  const baska = tsDosyalari(path.join(TEKS, "src")).filter((f) => /\bloadEnvFile\s*\(|\bparseEnv\s*\(|--env-file/.test(readFileSync(f, "utf8")));
  check("§1c src/'de ikinci .env okuyucusu yok (loadEnvFile · parseEnv · --env-file)", baska.length === 0, baska.map((f) => path.relative(TEKS, f)).join(", "));
  const pkg = JSON.parse(readFileSync(path.join(TEKS, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const envBagimlilik = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((d) => /env/i.test(d) && d !== "dotenv");
  check("§1d bağımlılıkta dotenv'den başka env okuyucusu yok (genişletme/şifreleme anlamı değiştirir)", envBagimlilik.length === 0, envBagimlilik.join(", "));
  const kilit = JSON.parse(readFileSync(path.join(TEKS, "package-lock.json"), "utf8")) as { packages: Record<string, { version?: string }> };
  const kilitSurum = kilit.packages["node_modules/dotenv"]?.version;
  check("§1e kurulu dotenv = kilit dosyası (pakete giren sürüm)", kilitSurum === dotenvSurumu(), `${dotenvSurumu()} · kilit ${kilitSurum}`);
}

function bolum2(d: Dosya | null, taze: readonly Kayit[]): void {
  console.log("\n§2 — vektör dosyası (native/test-vektorleri/env-dosyasi.json)");
  check("§2a dosya var, biçim, okuyucu = kurulu dotenv", d !== null && d.bicim === BICIM && d.okuyucu === `dotenv@${dotenvSurumu()}`, d ? `${d.okuyucu} · ${d.kayitlar.length} kayıt` : "yok — --vektor-yaz");
  const metin = existsSync(DOSYA) ? readFileSync(DOSYA, "utf8") : "";
  const bayat = d ? bayatlar(d.kayitlar, taze) : [];
  const eksik = taze.filter((t) => !d?.kayitlar.some((k) => k.vektor.ad === t.vektor.ad)).map((t) => t.vektor.ad);
  const esit = metin === vektorMetni(taze, dotenvSurumu());
  const neden = [...bayat.map((a) => `bayat: ${a}`), ...eksik.map((a) => `eksik: ${a}`)].slice(0, 6).join(" · ");
  check(
    "§2b ⭐ dosya = --vektor-yaz çıktısı BAYT-EŞİT (beklenenler bugünkü gerçek okuyucudan)",
    esit,
    esit ? "temiz" : neden || (metin ? "fark başlıkta, sırada ya da guncelleyici alanında — --vektor-yaz" : "dosya yok — --vektor-yaz"),
  );
  const adlar = GIRDILER.map((g) => g.ad);
  check("§2c kayıt adları tekil (Rust testi adla raporlar)", new Set(adlar).size === adlar.length);
  const metinler = GIRDILER.map((g) => g.girdi.toString("utf8"));
  const kapsam: Array<[string, (s: string) => boolean]> = [
    ["Windows yolu çift tırnakta", (s) => /="[A-Za-z]:\\/.test(s)],
    ["tırnaksız değerde #", (s) => /^\w+=[^"'`\s#][^#\n]*#/m.test(s)],
    ["ANAHTAR: değer", (s) => /^\w+: \S/m.test(s)],
    ["geçersiz satır", (s) => /^[^#=\n:]+$/m.test(s.replace(/\r/g, "")) && /=/.test(s)],
    ["U+2028", (s) => s.includes("\u2028")],
    ["tekrar", (s) => /^(\w+)=.*\n(?:.*\n)*\1=/m.test(s)],
  ];
  const yok = kapsam.filter(([, f]) => !metinler.some(f)).map(([ad]) => ad);
  const bozukUtf8 = GIRDILER.some((g) => !Buffer.from(g.girdi.toString("utf8"), "utf8").equals(g.girdi));
  check("§2d kapsam: D6'nın ölçtüğü ayrışma sınıflarının her biri en az bir kayıtta + geçersiz UTF-8", yok.length === 0 && bozukUtf8, yok.join(", ") || "6 sınıf + bayt");
}

function bolum3(d: Dosya | null, taze: readonly Kayit[]): void {
  console.log("\n§3 — güncelleyicinin zorunlu anahtarı (sessiz atlama onu gizleyemez)");
  const rust = readFileSync(path.join(NATIVE, "tekserp-guncelleyici", "src", "settings.rs"), "utf8");
  const r = /pub const REQUIRED_BACKEND_KEYS: \[&str; \d+\] = \[([^\]]*)\];/.exec(rust);
  const rustListe = r ? [...r[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : null;
  check(
    "§3a zorunlu liste: TS = dosya başlığı = Rust REQUIRED_BACKEND_KEYS",
    JSON.stringify(rustListe) === JSON.stringify(ZORUNLU) && JSON.stringify(d?.zorunlu) === JSON.stringify(ZORUNLU),
    `rust ${JSON.stringify(rustListe)} · dosya ${JSON.stringify(d?.zorunlu)}`,
  );
  const ihlal = oncelIhlalleri(taze, ZORUNLU);
  check("§3b ⭐ AYAR_EKSIK iddiası ⇔ gerçek okuyucu zorunlu anahtarı vermiyor", ihlal.length === 0, ihlal.join(" · ") || `${taze.filter((k) => k.guncelleyici).length} kayıt`);
  const sessiz = taze.filter((k) => k.guncelleyici === "AYAR_EKSIK" && ZORUNLU.some((z) => girdiOf(k).toString("utf8").includes(z) && !(z in k.beklenen)));
  const tamam = taze.filter((k) => k.guncelleyici === "TAMAM").length;
  check("§3c kapsam: ad metinde geçtiği hâlde okuyucunun ATLADIĞI satır ≥ 2 kayıt · TAMAM ≥ 1", sessiz.length >= 2 && tamam >= 1, `${sessiz.length} sessiz atlama · ${tamam} TAMAM`);
}

function bolum4(): void {
  console.log("\n§4 — Rust tarafı aynı dosyayı okuyor");
  const es = path.join(NATIVE, "tekserp-hizmet", "tests", "env_dosyasi_vektorleri.rs");
  const ay = path.join(NATIVE, "tekserp-guncelleyici", "tests", "ayar_env.rs");
  const oku = (p: string): string => (existsSync(p) ? readFileSync(p, "utf8") : "");
  check("§4a tekserp-hizmet/tests/env_dosyasi_vektorleri.rs vektörleri envfile::parse_bytes'tan geçirir", /env-dosyasi\.json/.test(oku(es)) && /envfile::parse_bytes\(/.test(oku(es)));
  check("§4b tekserp-guncelleyici/tests/ayar_env.rs vektörleri backend_env_from_bytes'tan geçirir", /env-dosyasi\.json/.test(oku(ay)) && /backend_env_from_bytes\(/.test(oku(ay)));
}

function bolum5(taze: readonly Kayit[]): void {
  console.log("\n§5 — ✓K kalıcı sondalar (karşılaştırıcılar sentetik girdide)");
  const ornek = taze.slice(0, 3);
  check("§5a bayatlık denetimi özdeş kayıtta SUSAR", bayatlar(ornek, taze).length === 0);
  const bozuk = ornek.map((k, i) => (i === 0 ? { ...k, beklenen: { ...k.beklenen, PORT: "4001" } } : k));
  check("§5b bayatlık denetimi mutasyonlu beklenende ISIRIR", bayatlar(bozuk, taze).length === 1);
  const yanlis = taze.filter((k) => k.guncelleyici === "TAMAM").slice(0, 1).map((k) => ({ ...k, guncelleyici: "AYAR_EKSIK" as const }));
  check("§5c öncül denetimi zorunlu anahtarı VERİLMİŞ kayıtta AYAR_EKSIK iddiasını ISIRIR", yanlis.length === 1 && oncelIhlalleri(yanlis, ZORUNLU).length === 1);
}

function main(): void {
  const taze = kayitlariKur();
  if (process.argv.includes("--vektor-yaz")) {
    writeFileSync(DOSYA, vektorMetni(taze, dotenvSurumu()));
    console.log(`✓ ${path.relative(TEKS, DOSYA)} — ${taze.length} kayıt (dotenv@${dotenvSurumu()})`);
    return;
  }
  const d = existsSync(DOSYA) ? (JSON.parse(readFileSync(DOSYA, "utf8")) as Dosya) : null;
  bolum1();
  bolum2(d, taze);
  bolum3(d, taze);
  bolum4();
  bolum5(taze);
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
