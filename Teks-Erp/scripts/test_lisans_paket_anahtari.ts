// =============================================================================
// BEKÇİ — üretim PAKET anahtarı: parolalı üretim + parolalı imza (`build-korumali-imza.ts`)
// =============================================================================
// DB'siz, ağsız. Her şey GEÇİCİ dizinde; HOME geçici dizine çevrilir (~/.tekserp'e yazılmaz), gerçek çapaya
// dokunulmaz (çapa denemesi geçici KOPYADA, `guven-capasi-ekle.ts` ile). NE ÖLÇER:
//   §0 tek kaynak — sarma yalnız `protocol/anahtar-sarma.ts`te (satıcı key-files + imza aracı oradan kullanır,
//      ikinci kripto uygulaması yok); `scripts/lib/cli-girdi.ts` satıcınınkiyle BAYT-EŞİT
//   §1 uçtan uca (gerçek CLI, stdin parolası): üretim kid'iyle `anahtar-uret` → parolalı dosya (0600, sürüm 2,
//      düz özel yarı yok, `--json` tek satır) → `imzala` → anahtar geçici çapa kopyasına eklenince bütünlük
//      GEÇERLİ, gerçek çapada değil
//   §2 RET (her biri taze dizinde, iz bırakmaz): argv'de parola · yanlış parola · var olanın üstüne yazma ·
//      parola tekrarı uyuşmaz · zayıf parola · stdin boş · depo içine üretim anahtarı · test/üretim karışması
//      (parolalı dosyada üretim dışı kid · parolasız dosyada üretim kid'i · parolalı dosyada düz özel yarı)
//   §3 hazırlık akışı KALKTI: kid'siz `anahtar-uret` ve eski `paket-hazirlik` kid'i RED, dosya yazılmaz
//   §4 (G3) anahtar AİLESİ = derlemenin çapa kipi (`dist/server-kunye.json` `guvenCapasi`, tek kip uretim): üretim
//      çapalı pakete üretim dışı (test) anahtar · eski hazırlık çapalı künye → parola SORULMADAN RED, imza yok;
//      üretim + üretim anahtarı imzalar
//   §5 (G22/ALT-9) CI KÖKENİ: üretim anahtarıyla imza `--ci-kosu` ister; koşu `korumali-paket.yml` · başarılı · `main`
//      · commit = yapıtın künyesi değilse ya da okunamazsa parola sorulmadan RED (sahte `gh` PATH'te, ağ yok);
//      KAÇIŞ (kullanıcı kararı 2026-10-01) `--ci-atla="<cümle>"`: boş/kısa/kalıp dışı · `--ci-kosu` ile birlikte ·
//      üretim dışı (test) anahtarda → RED; geçerli cümle + saat + makine + HEAD imzalı yüke (`ciKokeni`) girer, imza GEÇERLİ;
//      koşulu imzada koşu kaydı (`ciKokeni.kip = "kosu"`) yüke girer
//   §6–§7 (D5) kök sertifikalı pkt-* anahtar: sertifika-ekle, çift/zincir-yalnız imza, dağıtım iptali, bildirimin iki takımı
//   §8 (D6/D8) yıllık tören araçları: `yeniden-imzala` (yeni zip + surum-zincir-<kid>.json; eski imza/liste bayt-aynı, yayındaki
//      zip dokunulmaz; tutmayan zip · paket-* imzacı · aynı imzacı · iptalli tek imza → RED; eski takım bildirimiyle iptal
//      pakete girer) · `pg-yeniden-imzala` (yük aynen, `pg-zincir-<kid>.json`) · D8 dizin kipi (`--surum-dizini`/`--pg-dizini`:
//      kid'siz + kid'li yan yana, iptalli elenir; hepsi geçersizse eski takım; o da yoksa RED) · Docker künyesi pkt-* ile
//      zincirli · `anahtar-ac` (yanlış parola RED)
// ⭐ KALICI SONDA ✓K: §0c tek-uygulama tarayıcısı sentetik kripto satırını yakalar; §2 ret dalları her koşumda.
// Koşum: node ../scripts/agir-is.mjs -- npx tsx scripts/test_lisans_paket_anahtari.ts
// =============================================================================
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LICENSE_CLASSES } from "../src/lib/license/protocol";
import { PACKAGE_PUBLIC_KEYS, verifyIntegrity } from "../src/lib/license/integrity";
import { INTEGRITY_FILE } from "../src/lib/license/integrity-scope";
import { INTEGRITY_LIST_FILE } from "../src/lib/license/integrity-list";
import { generatePackageKey, packageKeyInfo, writePackageKey } from "./lib/butunluk-imza";
import { CAPA_DOSYALARI, capaDurumuOku } from "./lib/guven-capasi";
import { main as capaEkle } from "./guven-capasi-ekle";
import { ciKokeniHukmu } from "./lib/ci-kokeni";
import { DAY_MS, PackageRevocationSchema, TYP, msToIso, parseJws, readReleasePointer, signDocument, verifyPgPackageManifest, verifyReleaseManifest } from "../src/lib/license/protocol";
import { CHAINED_INTEGRITY_FILE, PACKAGE_REVOCATION_FILE } from "../src/lib/license/protocol/paket-zinciri";
import { anahtarUret, fiksturKur, sertifikaBas, sertifikaYuku } from "./lib/lisans-fikstur";
import { git } from "./lib/git";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const TEKS = path.resolve(__dirname, "..");
const DEPO = path.resolve(TEKS, "..");
const TEMP = mkdtempSync(path.join(os.tmpdir(), "lisans-paket-anahtari-"));
const PAROLA = "bekci-paket-parolasi-2026";
const KID = "paket-2099";
/** Yapıtın künyesindeki (CI'daki derleme) commit'i ve sahte `gh`nin döndürdüğü uyan koşu (§5). */
const KUNYE_COMMIT = "0123456789abcdef0123456789abcdef01234567";
const UYAN_KOSU = { id: 4242, head_sha: KUNYE_COMMIT, head_branch: "main", path: ".github/workflows/korumali-paket.yml", name: "Korumalı paket (.jsc)", status: "completed", conclusion: "success" };
const SAHTE_BIN = path.join(TEMP, "bin");
mkdirSync(SAHTE_BIN, { recursive: true });
writeFileSync(path.join(SAHTE_BIN, "gh"), `#!/bin/sh\nif [ -n "$SAHTE_GH_HATA" ]; then echo "gh: HTTP 404" >&2; exit 1; fi\nprintf '%s' "$SAHTE_GH_KOSU"\n`, { mode: 0o755 });

interface Kosum {
  readonly kod: number | null;
  readonly cikti: string;
  readonly hata: string;
}

/** Gerçek CLI; stdin boru (TTY değil) → parola stdin satırlarından. HOME geçici dizin; `gh` sahte (ağ yok). */
function cli(argv: readonly string[], input = "", ortam: Record<string, string> = {}): Kosum {
  const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/build-korumali-imza.ts", ...argv], {
    cwd: TEKS,
    input,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, HOME: path.join(TEMP, "ev"), PATH: `${SAHTE_BIN}${path.delimiter}${process.env.PATH ?? ""}`, SAHTE_GH_KOSU: JSON.stringify(UYAN_KOSU), ...ortam },
  });
  return { kod: r.status, cikti: r.stdout ?? "", hata: r.stderr ?? "" };
}

let sayac = 0;
function dizin(ad: string): string {
  const d = path.join(TEMP, `${ad}-${sayac++}`);
  mkdirSync(d, { recursive: true });
  return d;
}

/** Küçük paket kökü: dist/ + kökte package.json (imzalı kapsam) + CI derlemesinin künyesi (commit). */
function paket(): string {
  const kok = dizin("paket");
  mkdirSync(path.join(kok, "dist"));
  writeFileSync(path.join(kok, "dist", "a.js"), "console.log('a');\n");
  writeFileSync(path.join(kok, "dist", "server-kunye.json"), `${JSON.stringify({ commit: KUNYE_COMMIT })}\n`);
  writeFileSync(path.join(kok, "package.json"), '{"name":"p"}\n');
  return kok;
}

/** İmza — CI kökeni (§5) varsayılan olarak UYAN koşuyla verilir; `ek`/`ortam` sondalar içindir. */
const imzala = (kok: string, anahtar: string, input: string, ek: readonly string[] = ["--ci-kosu=4242"], ortam: Record<string, string> = {}): Kosum =>
  cli(["imzala", `--kok=${kok}`, `--anahtar=${anahtar}`, "--surum=2.12.1", "--derleme-tarihi=2026-09-30T00:00:00.000Z", ...ek], input, ortam);

/** Parolalı üretim anahtarı (gerçek CLI). */
function uretimAnahtari(kid = KID): { dosya: string; kosum: Kosum } {
  const d = dizin("anahtar");
  const kosum = cli(["anahtar-uret", `--kid=${kid}`, `--dizin=${d}`, "--json"], `${PAROLA}\n${PAROLA}\n`);
  return { dosya: path.join(d, `${kid}.paket.json`), kosum };
}

// ── §0 ───────────────────────────────────────────────────────────────────────
const KRIPTO_SATIRI = /createCipheriv|createDecipheriv|\bscrypt(?:Sync)?\s*\(|promisify\(\s*crypto\.scrypt/;

/** Sarmayı KENDİSİ yapan dosyalar (tek uygulama protokoldedir). */
function ikinciUygulamalar(dosyalar: Readonly<Record<string, string>>): string[] {
  return Object.entries(dosyalar)
    .filter(([, metin]) => metin.split("\n").some((satir) => !/^\s*(\/\/|\*)/.test(satir) && KRIPTO_SATIRI.test(satir)))
    .map(([ad]) => ad);
}

function bolum0(): void {
  console.log("\n§0 tek kaynak");
  const kaynak = readFileSync(path.join(DEPO, "satici/sunucu/scripts/lib/cli-girdi.ts"));
  const ayna = readFileSync(path.join(TEKS, "scripts/lib/cli-girdi.ts"));
  check("§0a scripts/lib/cli-girdi.ts satıcının cli-girdi.ts'iyle BAYT-EŞİT", kaynak.length > 1000 && kaynak.equals(ayna), `${kaynak.length} bayt`);
  const oku = (p: string): string => readFileSync(path.join(DEPO, p), "utf8");
  const kullananlar = {
    "satici/sunucu/src/keys/key-files.ts": oku("satici/sunucu/src/keys/key-files.ts"),
    "Teks-Erp/scripts/lib/butunluk-imza.ts": oku("Teks-Erp/scripts/lib/butunluk-imza.ts"),
    "Teks-Erp/scripts/build-korumali-imza.ts": oku("Teks-Erp/scripts/build-korumali-imza.ts"),
  };
  const ikinci = ikinciUygulamalar(kullananlar);
  const tekKaynak = oku("Teks-Erp/src/lib/license/protocol/anahtar-sarma.ts");
  check(
    "§0b ⭐ sarma TEK uygulama: satıcı key-files + imza aracı protokolden kullanır, kendileri şifrelemez",
    ikinci.length === 0 &&
      KRIPTO_SATIRI.test(tekKaynak) &&
      /from "\.\.\/lisans-protokol\/anahtar-sarma"/.test(kullananlar["satici/sunucu/src/keys/key-files.ts"]) &&
      /from "\.\.\/\.\.\/src\/lib\/license\/protocol\/anahtar-sarma"/.test(kullananlar["Teks-Erp/scripts/lib/butunluk-imza.ts"]),
    ikinci.join(", ") || "temiz",
  );
  const sahte = ikinciUygulamalar({ a: "const c = crypto.createCipheriv('aes-256-gcm', k, iv);", b: "// createCipheriv yorumda sayılmaz", c: "const k = await scryptAsync(p, s, 32, o);" });
  check("§0c ✓K tarayıcı kod satırındaki şifrelemeyi yakalar, yorumu saymaz", sahte.join() === "a", sahte.join(","));
}

// ── §1 ───────────────────────────────────────────────────────────────────────
async function bolum1(): Promise<void> {
  console.log("\n§1 uçtan uca: üret → imzala → geçici çapada doğrula");
  const { dosya, kosum } = uretimAnahtari();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(kosum.cikti.trim()) as Record<string, unknown>;
  } catch {
    json = {};
  }
  check("§1a anahtar-uret (üretim kid'i, stdin'de iki satır): çıkış 0, --json tek satır {v, kid, x, dosya, parolali}", kosum.kod === 0 && kosum.cikti.trim().split("\n").length === 1 && json.v === 1 && json.kid === KID && json.dosya === dosya && json.parolali === true, `çıkış ${kosum.kod} ${kosum.hata.trim().slice(0, 80)}`);
  if (!existsSync(dosya)) return;
  const metin = readFileSync(dosya, "utf8");
  const k = JSON.parse(metin) as Record<string, unknown>;
  const kip = statSync(dosya).mode & 0o777;
  check(
    "§1b dosya 0600, sürüm 2, alanlar tam (düz özel yarı `d` YOK), sınıflar = LICENSE_CLASSES, sarılı yarı 32 bayt, parola dosyada yok",
    kip === 0o600 &&
      k.surum === 2 &&
      !("d" in k) &&
      Object.keys(k).join() === "tur,surum,kid,siniflar,x,kdf,iv,sifreli,etiket,olusturma" &&
      JSON.stringify(k.siniflar) === JSON.stringify(LICENSE_CLASSES) &&
      Buffer.from(String(k.sifreli), "base64url").length === 32 &&
      k.x === json.x &&
      !metin.includes(PAROLA),
    `mod ${kip.toString(8)}`,
  );
  const kok = paket();
  const imza = imzala(kok, dosya, `${PAROLA}\n`);
  const jws = existsSync(path.join(kok, INTEGRITY_FILE)) ? readFileSync(path.join(kok, INTEGRITY_FILE), "utf8").trim() : "";
  const kid = jws ? (JSON.parse(Buffer.from(jws.split(".")[0] ?? "", "base64url").toString("utf8")) as { kid?: string }).kid : null;
  check("§1c imzala parolalı anahtarla (parola stdin): çıkış 0, butunluk.jws kid = üretim kid'i", imza.kod === 0 && kid === KID, `çıkış ${imza.kod} ${imza.hata.trim().slice(0, 80)}`);
  if (jws) await bolum1Capa(dosya, kok, jws);
}

async function bolum1Capa(dosya: string, kok: string, jws: string): Promise<void> {
  {
    const kopya = dizin("capa-kopyasi");
    const tum = [CAPA_DOSYALARI.kokTs, ...CAPA_DOSYALARI.kokAynalari, CAPA_DOSYALARI.paketTs, CAPA_DOSYALARI.anchorRs];
    const gercekOnce = tum.map((y) => readFileSync(path.join(DEPO, y), "utf8")).join("\u0000");
    for (const y of tum) {
      mkdirSync(path.dirname(path.join(kopya, y)), { recursive: true });
      copyFileSync(path.join(DEPO, y), path.join(kopya, y));
    }
    const log = console.log;
    const err = console.error;
    console.log = () => undefined;
    console.error = () => undefined;
    let ekle: number;
    try {
      ekle = capaEkle(["paket", `--dosya=${dosya}`, `--kok=${kopya}`, "--yaz"]);
    } finally {
      console.log = log;
      console.error = err;
    }
    // Üretim kid'i (paket-<yıl>) ÜRETİM listesine girer; bu derlemenin (geliştirme = üretim kipi) PAKET çapası odur.
    const paketler = capaDurumuOku(kopya).paketler.uretim;
    const x = (JSON.parse(readFileSync(dosya, "utf8")) as { x: string }).x;
    const kopyada = await verifyIntegrity(jws, kok, paketler);
    const gercekte = await verifyIntegrity(jws, kok, PACKAGE_PUBLIC_KEYS);
    check(
      "§1d ⭐ anahtar geçici çapa KOPYASINA eklenince (guven-capasi-ekle --dosya) bütünlük GEÇERLİ; gerçek çapada GEÇERLİ DEĞİL",
      ekle === 0 && paketler.some((p) => p.kid === KID && p.x === x) && kopyada.durum === "GECERLI" && gercekte.durum !== "GECERLI",
      `ekle ${ekle} · kopya ${kopyada.durum} · gerçek ${gercekte.durum} ${gercekte.kod ?? ""}`,
    );
    const gercekSonra = tum.map((y) => readFileSync(path.join(DEPO, y), "utf8")).join("\u0000");
    rmSync(kopya, { recursive: true, force: true });
    check("§1e geri al: gerçek çapa dosyalarına dokunulmadı, kopya silindi", gercekOnce === gercekSonra && !existsSync(kopya));
  }
}

// ── §2 ───────────────────────────────────────────────────────────────────────
function bolum2(): void {
  console.log("\n§2 ret dalları — ✓K");
  {
    const d = dizin("argv");
    const r = cli(["anahtar-uret", `--kid=${KID}`, `--dizin=${d}`, `--parola=${PAROLA}`], `${PAROLA}\n${PAROLA}\n`);
    const r2 = cli(["imzala", `--kok=${paket()}`, `--anahtar=${path.join(d, "yok.json")}`, "--surum=1.0.0", `--password=${PAROLA}`]);
    check(
      "§2a argv'de parola (--parola · --password) → çıkış 2, açıklayıcı hata, hata metninde parola yok, dosya yazılmadı",
      r.kod === 2 && r2.kod === 2 && /argümandan ALINMAZ/.test(r.hata) && !r.hata.includes(PAROLA) && !existsSync(path.join(d, `${KID}.paket.json`)),
      `çıkış ${r.kod}/${r2.kod}`,
    );
  }
  const { dosya } = uretimAnahtari();
  {
    const kok = paket();
    const r = imzala(kok, dosya, "yanlis-parola-12345\n");
    check("§2b yanlış parola → çıkış 1, imza YOK (liste de yok)", r.kod === 1 && /Parola hatalı/.test(r.hata) && !existsSync(path.join(kok, INTEGRITY_FILE)) && !existsSync(path.join(kok, INTEGRITY_LIST_FILE)), `çıkış ${r.kod} ${r.hata.trim().slice(0, 60)}`);
  }
  {
    const once = existsSync(dosya) ? readFileSync(dosya) : Buffer.alloc(0);
    const r = cli(["anahtar-uret", `--kid=${KID}`, `--dizin=${path.dirname(dosya)}`], `${PAROLA}\n${PAROLA}\n`);
    check("§2c var olanın üstüne yazma → çıkış 1, dosya aynı bayt", r.kod === 1 && /zaten var/.test(r.hata) && once.length > 0 && readFileSync(dosya).equals(once), `çıkış ${r.kod}`);
  }
  const yok = (ad: string, input: string, beklenen: RegExp, kod: number): void => {
    const d = dizin(ad);
    const r = cli(["anahtar-uret", `--kid=${KID}`, `--dizin=${d}`], input);
    check(`§2 ${ad} → çıkış ${kod}, dosya yok`, r.kod === kod && beklenen.test(r.hata) && !existsSync(path.join(d, `${KID}.paket.json`)), `çıkış ${r.kod} ${r.hata.trim().slice(0, 60)}`);
  };
  yok("parola tekrarı uyuşmaz", `${PAROLA}\n${PAROLA}x\n`, /eşleşmedi/, 1);
  yok("zayıf parola (11 karakter)", "kisa-parola\nkisa-parola\n", /en az 12/, 1);
  yok("stdin boş (parola yok)", "", /Parola bekleniyordu/, 2);
  {
    const d = path.join(DEPO, `.paket-anahtari-deneme-${randomBytes(4).toString("hex")}`);
    const r = cli(["anahtar-uret", `--kid=${KID}`, `--dizin=${d}`], `${PAROLA}\n${PAROLA}\n`);
    const var_ = existsSync(d);
    if (var_) rmSync(d, { recursive: true, force: true });
    check("§2d üretim anahtarı depo İÇİNE yazılmaz → çıkış 1, dizin açılmadı", r.kod === 1 && /depo içine yazılmaz/.test(r.hata) && !var_, `çıkış ${r.kod}`);
  }
  if (!existsSync(dosya)) return;
  const karisma = (ad: string, degis: (k: Record<string, unknown>) => Record<string, unknown>, beklenen: RegExp): void => {
    const d = dizin(ad);
    const f = path.join(d, "anahtar.paket.json");
    writeFileSync(f, `${JSON.stringify(degis(JSON.parse(readFileSync(dosya, "utf8")) as Record<string, unknown>))}\n`, { mode: 0o600 });
    const kok = paket();
    const r = imzala(kok, f, `${PAROLA}\n`);
    check(`§2e ${ad} → çıkış 1, imza YOK`, r.kod === 1 && beklenen.test(r.hata) && !existsSync(path.join(kok, INTEGRITY_FILE)), `çıkış ${r.kod} ${r.hata.trim().slice(0, 70)}`);
  };
  karisma("parolalı dosyada üretim dışı kid (eski paket-hazirlik)", (k) => ({ ...k, kid: "paket-hazirlik" }), /yalnız üretim PAKET kid'i/);
  karisma("parolalı dosyada düz özel yarı alanı", (k) => ({ ...k, d: "AAAA" }), /biçimsiz/);
  {
    const d = dizin("duz-uretim");
    const f = writePackageKey(d, generatePackageKey(KID, ["TEST"]));
    const kok = paket();
    const r = imzala(kok, f, "");
    check("§2e parolasız dosyada üretim kid'i → çıkış 1, imza YOK", r.kod === 1 && /parolasız dosyada olamaz/.test(r.hata) && !existsSync(path.join(kok, INTEGRITY_FILE)), `çıkış ${r.kod} ${r.hata.trim().slice(0, 70)}`);
  }
}

// ── §3 ───────────────────────────────────────────────────────────────────────
/** Parolasız TEST anahtarı (üretim dışı aile) — yalnız bekçinin; CLI artık parolasız anahtar üretmez. */
function testAnahtari(): string {
  return writePackageKey(dizin("test-anahtar"), generatePackageKey("paket-test", ["TEST", "DEMO"]));
}

function bolum3(): void {
  console.log("\n§3 hazırlık akışı kalktı");
  const eskiDizin = path.join(TEMP, "ev", ".tekserp", "satici-hazirlik");
  const r = cli(["anahtar-uret"]);
  check("§3a ⭐ kid'siz anahtar-uret → çıkış 1 (kid zorunlu), varsayılan hazırlık dizini YAZILMADI", r.kod === 1 && /--kid=paket-<yıl>/.test(r.hata) && !existsSync(eskiDizin), `çıkış ${r.kod} ${r.hata.trim().slice(0, 80)}`);
  const r2 = cli(["anahtar-uret", "--kid=paket-hazirlik"]);
  check("§3b ⭐ --kid=paket-hazirlik → çıkış 1 (yalnız üretim ailesi), dosya YOK", r2.kod === 1 && /kid biçimi/.test(r2.hata) && !existsSync(eskiDizin), `çıkış ${r2.kod} ${r2.hata.trim().slice(0, 80)}`);
}

// ── §4 ───────────────────────────────────────────────────────────────────────
/** Künyeli paket kökü: build-korumali'nin yazdığı `dist/server-kunye.json` (çapa kipiyle). */
function kunyeliPaket(kip: string): string {
  const kok = paket();
  writeFileSync(path.join(kok, "dist", "server-kunye.json"), `${JSON.stringify({ zaman: "2026-10-01T00:00:00.000Z", guvenCapasi: kip, commit: KUNYE_COMMIT })}\n`);
  return kok;
}

function bolum4(): void {
  console.log("\n§4 anahtar ailesi = derlemenin çapa kipi (G3, tek kip)");
  const test = testAnahtari();
  const { dosya: uretim } = uretimAnahtari("paket-2098");
  if (!existsSync(test) || !existsSync(uretim)) {
    check("§4 körlük zemini: iki aile anahtarı üretildi", false, `${existsSync(test)} · ${existsSync(uretim)}`);
    return;
  }
  const k1 = kunyeliPaket("uretim");
  const r1 = imzala(k1, test, "");
  check("§4a ⭐ üretim çapalı pakete TEST (üretim dışı) anahtar → çıkış 1, imza YOK", r1.kod === 1 && /anahtar ailesi/.test(r1.hata) && !existsSync(path.join(k1, INTEGRITY_FILE)), `çıkış ${r1.kod} ${r1.hata.trim().slice(0, 90)}`);
  const k2 = kunyeliPaket("hazirlik");
  const r2 = imzala(k2, uretim, "");
  check(
    "§4b ⭐ eski hazırlık çapalı künye + ÜRETİM anahtarı → parola SORULMADAN çıkış 1 (stdin boş), imza YOK",
    r2.kod === 1 && /anahtar ailesi/.test(r2.hata) && /hazırlık kipi kalktı/.test(r2.hata) && !/parola/i.test(r2.hata) && !existsSync(path.join(k2, INTEGRITY_FILE)),
    `çıkış ${r2.kod} ${r2.hata.trim().slice(0, 90)}`,
  );
  const k4 = kunyeliPaket("hazirlik");
  const r4 = imzala(k4, test, "");
  check("§4b' eski hazırlık çapalı künye + TEST anahtarı → çıkış 1, imza YOK (eski uyan aile artık imzalamaz)", r4.kod === 1 && /hazırlık kipi kalktı/.test(r4.hata) && !existsSync(path.join(k4, INTEGRITY_FILE)), `çıkış ${r4.kod} ${r4.hata.trim().slice(0, 90)}`);
  const k3 = kunyeliPaket("uretim");
  const r3 = imzala(k3, uretim, `${PAROLA}\n`);
  check("§4c karşı kontrol: üretim çapası + üretim anahtarı (parolayla) imzalar", r3.kod === 0 && existsSync(path.join(k3, INTEGRITY_FILE)), `üretim ${r3.kod} ${r3.hata.trim().slice(0, 50)}`);
}

// ── §5 ───────────────────────────────────────────────────────────────────────
async function bolum5(): Promise<void> {
  console.log("\n§5 CI kökeni (G22/ALT-9) — ✓K");
  const kip = (o: Partial<typeof UYAN_KOSU>, uretim = true, paketCommit: string | null = KUNYE_COMMIT.slice(0, 8)) =>
    ciKokeniHukmu({ kosu: { ...UYAN_KOSU, ...o }, kunyeCommit: KUNYE_COMMIT, paketCommit, uretim }).sonuc;
  check("§5a pozitif: korumali-paket.yml · başarılı · main · commit = künye = PAKET.json → uyumlu", kip({}) === "uyumlu");
  const sondalar: Array<[string, Partial<typeof UYAN_KOSU>, boolean, string | null]> = [
    ["başka iş akışı (ci.yml)", { path: ".github/workflows/ci.yml" }, true, KUNYE_COMMIT.slice(0, 8)],
    ["iş akışı adı farklı", { name: "Korumali" }, true, KUNYE_COMMIT.slice(0, 8)],
    ["koşu başarısız", { conclusion: "failure" }, true, KUNYE_COMMIT.slice(0, 8)],
    ["koşu bitmemiş", { status: "in_progress" }, true, KUNYE_COMMIT.slice(0, 8)],
    ["üretim imzası feature dalının yapıtına", { head_branch: "dagitim/w2-taban" }, true, KUNYE_COMMIT.slice(0, 8)],
    ["koşunun commit'i yapıtınki değil", { head_sha: "f".repeat(40) }, true, KUNYE_COMMIT.slice(0, 8)],
    ["paket başka commit'te birleştirilmiş", {}, true, "deadbeef"],
  ];
  for (const [ad, o, uretim, pc] of sondalar) check(`§5b ⭐ ${ad} → ihlal`, kip(o, uretim, pc) === "ihlal");
  check("§5c üretim dışı (test) anahtarda dal serbest (feature dalı yapıtı imzalanabilir)", kip({ head_branch: "dagitim/w2-taban" }, false) === "uyumlu");
  check("§5d künyede commit yok → ÖLÇÜLEMEDİ", ciKokeniHukmu({ kosu: UYAN_KOSU, kunyeCommit: undefined, paketCommit: null, uretim: true }).sonuc === "olculemedi");

  // CLI — kapı parola sorulmadan ÖNCE durur (stdin'deki parola okunmaz, imza yazılmaz).
  const { dosya } = uretimAnahtari("paket-2097");
  if (!existsSync(dosya)) {
    check("§5 körlük zemini: üretim anahtarı üretildi", false);
    return;
  }
  const red = (ad: string, ek: readonly string[], ortam: Record<string, string>, desen: RegExp): void => {
    const kok = paket();
    const r = imzala(kok, dosya, `${PAROLA}\n`, ek, ortam);
    check(`§5e ⭐ ${ad} → çıkış 1, imza YOK`, r.kod === 1 && desen.test(r.hata) && !existsSync(path.join(kok, INTEGRITY_FILE)), `çıkış ${r.kod} ${r.hata.trim().slice(0, 120)}`);
  };
  red("üretim anahtarı, --ci-kosu YOK", [], {}, /CI kökeni ister/);
  red("koşu feature dalından", ["--ci-kosu=4242"], { SAHTE_GH_KOSU: JSON.stringify({ ...UYAN_KOSU, head_branch: "feature/x" }) }, /TUTMUYOR[\s\S]*main/);
  red("koşu başka commit'ten", ["--ci-kosu=4242"], { SAHTE_GH_KOSU: JSON.stringify({ ...UYAN_KOSU, head_sha: "e".repeat(40) }) }, /TUTMUYOR/);
  red("koşu okunamıyor (gh hata)", ["--ci-kosu=4242"], { SAHTE_GH_HATA: "1" }, /ÖLÇÜLEMEDİ/);
  red("--ci-kosu biçimsiz", ["--ci-kosu=12;id"], {}, /biçimsiz/);
  const testKey = testAnahtari();
  if (existsSync(testKey)) {
    const kok = paket();
    const r = imzala(kok, testKey, "", []);
    check("§5f üretim dışı (test) anahtar --ci-kosu'suz (künyesiz paket): UYARI basar, imzalar", r.kod === 0 && /CI kökeni ÖLÇÜLMEDİ/.test(r.hata) && existsSync(path.join(kok, INTEGRITY_FILE)), `çıkış ${r.kod} ${r.hata.trim().slice(0, 80)}`);
    const kok2 = paket();
    const r2 = imzala(kok2, testKey, "", ["--ci-atla=CI kırık ama kullanıcı imzalamamı istedi"]);
    check("§5g ⭐ üretim dışı (test) anahtarda --ci-atla → çıkış 1, imza YOK (kaçış gerekmez)", r2.kod === 1 && /kaçış gerekmez/.test(r2.hata) && !existsSync(path.join(kok2, INTEGRITY_FILE)), `çıkış ${r2.kod} ${r2.hata.trim().slice(0, 120)}`);
  }
  await bolum5Kacis(dosya);
}

/** İmzalı yük (`butunluk.jws` orta parça) — `ciKokeni` ek anahtarı buradan okunur. */
function imzaliYuk(kok: string): Record<string, unknown> {
  const jws = readFileSync(path.join(kok, INTEGRITY_FILE), "utf8").trim();
  return JSON.parse(Buffer.from(jws.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
}

/** G22 — CI kaçışı yalnız kullanıcının cümlesiyle; kayıt imzalı yükte. */
async function bolum5Kacis(dosya: string): Promise<void> {
  const CUMLE = "CI koşusu kırık,   kullanıcı onayladı: imzala";
  const red = (ad: string, ek: readonly string[], desen: RegExp): void => {
    const kok = paket();
    const r = imzala(kok, dosya, `${PAROLA}\n`, ek);
    check(`§5h ⭐ ${ad} → çıkış 1, imza YOK`, r.kod === 1 && desen.test(r.hata) && !existsSync(path.join(kok, INTEGRITY_FILE)), `çıkış ${r.kod} ${r.hata.trim().slice(0, 140)}`);
  };
  red("--ci-atla= boş", ["--ci-atla="], /CI KAÇIŞI REDDEDİLDİ[\s\S]*BOŞ/);
  red("--ci-atla çıplak (değersiz)", ["--ci-atla"], /CI KAÇIŞI REDDEDİLDİ[\s\S]*BOŞ/);
  red("--ci-atla kısa cümle", ["--ci-atla=acil imzala"], /CI KAÇIŞI REDDEDİLDİ[\s\S]*KISA/);
  red("--ci-atla yer tutucu kopyalandı", ["--ci-atla=<kullanıcının onay cümlesi>"], /CI KAÇIŞI REDDEDİLDİ[\s\S]*KALIP DIŞI/);
  red("--ci-atla tekrarlanan kelime", ["--ci-atla=imzala imzala imzala imzala"], /CI KAÇIŞI REDDEDİLDİ[\s\S]*KALIP DIŞI/);
  red("--ci-atla bayrak gibi (yutulmuş argüman)", ["--ci-atla=--kurulum=x yanlışlıkla cümleye yapışan argüman"], /CI KAÇIŞI REDDEDİLDİ[\s\S]*KALIP DIŞI/);
  red("--ci-atla + --ci-kosu birlikte", [`--ci-atla=${CUMLE}`, "--ci-kosu=4242"], /CI KAÇIŞI REDDEDİLDİ[\s\S]*birlikte/);

  const kok = paket();
  const r = imzala(kok, dosya, `${PAROLA}\n`, [`--ci-atla=${CUMLE}`]);
  const k = existsSync(path.join(kok, INTEGRITY_FILE)) ? (imzaliYuk(kok).ciKokeni as Record<string, unknown> | undefined) : undefined;
  const head = git(["-C", DEPO, "rev-parse", "HEAD"]).trim();
  check(
    "§5i ⭐ geçerli cümle + üretim anahtarı + parola → imzalar; yük ciKokeni = {atlandi · cümle (tekilleşmiş) · ofsetli ISO saat · makine · HEAD}; UYARI basıldı",
    r.kod === 0 && k?.kip === "atlandi" && k.cumle === "CI koşusu kırık, kullanıcı onayladı: imzala" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(String(k.saat)) && k.makine === (os.hostname().split(".")[0] || "?") &&
      /^[0-9a-f]{40}$/.test(head) && k.head === head && /CI KAÇIŞI/.test(r.hata),
    `çıkış ${r.kod} ${r.hata.trim().slice(0, 120)} · ${JSON.stringify(k)}`,
  );
  if (existsSync(path.join(kok, INTEGRITY_FILE))) {
    const info = packageKeyInfo(dosya);
    const v = await verifyIntegrity(readFileSync(path.join(kok, INTEGRITY_FILE), "utf8").trim(), kok, [{ kid: info.kid, x: info.x }]);
    check("§5j ek anahtar (ciKokeni) imzayı bozmaz: bütünlük GEÇERLİ", v.durum === "GECERLI", `${v.durum} ${v.kod ?? ""}`);
  }
  const kok2 = paket();
  const r2 = imzala(kok2, dosya, `${PAROLA}\n`);
  const k2 = existsSync(path.join(kok2, INTEGRITY_FILE)) ? (imzaliYuk(kok2).ciKokeni as Record<string, unknown> | undefined) : undefined;
  check("§5k koşulu imza: yük ciKokeni = {kosu · 4242 · main · künye commit'i}", r2.kod === 0 && k2?.kip === "kosu" && k2.kosu === 4242 && k2.dal === "main" && k2.commit === KUNYE_COMMIT, JSON.stringify(k2));
}


// ── §6 ───────────────────────────────────────────────────────────────────────
// D5: kök sertifikalı `pkt-<yıl>-<n>` anahtarı — sertifika-ekle, çift imza, zincir-yalnız, dağıtım iptali, tazelik.
const ZF = fiksturKur(Date.now());
const YABANCI = fiksturKur(Date.now());
const PKT_KID = "pkt-2099-1";

function kokCapaDosyasi(): string {
  const d = dizin("kok-capa");
  const f = path.join(d, "kokler.json");
  writeFileSync(f, `${JSON.stringify(ZF.kokler)}\n`);
  return f;
}

/** `x`i verilen PAKET sertifikası (dosya), `imzalayan` kökün. */
function sertifikaDosyasi(x: string, ek: { bitis?: string; imzalayan?: typeof ZF.kok; kid?: string } = {}): string {
  const kid = ek.kid ?? PKT_KID;
  const konu = { ...anahtarUret(kid), kid, x };
  const yuk = sertifikaYuku(ZF, konu, "PAKET", ek.bitis ? { bitis: ek.bitis } : {});
  const f = path.join(dizin("sertifika"), "s.json");
  writeFileSync(f, `${JSON.stringify({ sertifika: sertifikaBas(ek.imzalayan ?? ZF.kok, yuk) })}\n`);
  return f;
}

function iptalDosyasi(imzalayan: typeof ZF.kok, iptaller: { kid: string; sertifikaId: string }[] = [], sira = 3): string {
  const belge = signDocument({
    typ: TYP.PAKET_IPTAL,
    schema: PackageRevocationSchema,
    payload: { v: 1, iptalId: `00000000-0000-4000-8000-00000000000${sira}`, sira, verilis: msToIso(ZF.simdi - DAY_MS), iptaller: iptaller.map((e) => ({ ...e, tarih: msToIso(ZF.simdi - DAY_MS), neden: "bekçi" })) },
    key: imzalayan,
  });
  const f = path.join(dizin("iptal"), "iptal.json");
  writeFileSync(f, `${JSON.stringify({ v: 1, tur: "tekserp-paketiptal-belgesi", sira, belge })}\n`);
  return f;
}

const paketIdOf = (f: string): unknown => {
  const p = parseJws(readFileSync(f, "utf8").trim());
  return p.ok ? (p.value.payload as Record<string, unknown>).paketId : null;
};

async function bolum6(): Promise<void> {
  console.log("\n§6 kök sertifikalı PAKET anahtarı (pkt-<yıl>-<n>)");
  const paketDosya = uretimAnahtari().dosya;
  const capa = kokCapaDosyasi();
  const kd = dizin("pkt-anahtar");
  const u = cli(["anahtar-uret", `--kid=${PKT_KID}`, `--dizin=${kd}`], `${PAROLA}\n${PAROLA}\n`);
  const pkt = path.join(kd, `${PKT_KID}.paket.json`);
  const info = existsSync(pkt) ? packageKeyInfo(pkt) : null;
  check("§6a ⭐ anahtar-uret pkt-2099-1 → parolalı dosya; çapaya EKLENMEZ, sertifika-ekle yönlendirmesi", u.kod === 0 && info?.parolali === true && /çapaya EKLENMEZ/.test(u.cikti) && /sertifika-ekle/.test(u.cikti), `çıkış ${u.kod} ${u.hata.trim().slice(0, 80)}`);
  if (!info) return;
  const sertYolu = path.join(kd, `${PKT_KID}.sertifika.json`);

  const baska = cli(["sertifika-ekle", `--anahtar=${pkt}`, `--sertifika=${sertifikaDosyasi(anahtarUret("z").x)}`, `--kok-capa=${capa}`]);
  check("§6b ⭐ sertifika-ekle: x uyuşmuyor → RED, sertifika dosyası YOK", baska.kod === 1 && /x\)/.test(baska.hata) && !existsSync(sertYolu), `çıkış ${baska.kod} ${baska.hata.trim().slice(0, 100)}`);
  const nesneCapa = path.join(dizin("kok-capa-nesne"), "kok.json");
  writeFileSync(nesneCapa, `${JSON.stringify(ZF.kokler[0])}\n`);
  const nesne = cli(["sertifika-ekle", `--anahtar=${pkt}`, `--sertifika=${sertifikaDosyasi(info.x)}`, `--kok-capa=${nesneCapa}`]);
  check("§6b2 test kök çapası dizi değil (tek kök nesnesi) → anlaşılır RED (çökme değil), sertifika dosyası YOK",
    nesne.kod === 1 && /bir dizi/.test(nesne.hata) && !/is not iterable/.test(nesne.hata) && !existsSync(sertYolu), `çıkış ${nesne.kod} ${nesne.hata.trim().slice(0, 120)}`);
  const yabanci = cli(["sertifika-ekle", `--anahtar=${pkt}`, `--sertifika=${sertifikaDosyasi(info.x, { imzalayan: YABANCI.kok })}`, `--kok-capa=${capa}`]);
  check("§6c ⭐ sertifika-ekle: çapada olmayan kökün sertifikası → RED", yabanci.kod === 1 && /doğrulanamadı/.test(yabanci.hata) && !existsSync(sertYolu), `çıkış ${yabanci.kod} ${yabanci.hata.trim().slice(0, 100)}`);
  const sert = sertifikaDosyasi(info.x);
  const ekle = cli(["sertifika-ekle", `--anahtar=${pkt}`, `--sertifika=${sert}`, `--kok-capa=${capa}`]);
  const mod = existsSync(sertYolu) ? statSync(sertYolu).mode & 0o777 : -1;
  check("§6d ⭐ sertifika-ekle: parola SORULMADAN (stdin boş) yanına 0600 <kid>.sertifika.json", ekle.kod === 0 && mod === 0o600, `çıkış ${ekle.kod} mod ${mod.toString(8)} ${ekle.hata.trim().slice(0, 80)}`);
  const tekrar = cli(["sertifika-ekle", `--anahtar=${pkt}`, `--sertifika=${sert}`, `--kok-capa=${capa}`]);
  check("§6e sertifika-ekle tekrar → idempotent (zaten ekli)", tekrar.kod === 0 && /zaten ekli/.test(tekrar.cikti), `çıkış ${tekrar.kod}`);

  const iki = `${PAROLA}\n${PAROLA}\n`;
  const kok = paket();
  const cift = imzala(kok, paketDosya, iki, ["--ci-kosu=4242", `--zincir-anahtar=${pkt}`, `--kok-capa=${capa}`]);
  const a = path.join(kok, INTEGRITY_FILE);
  const z = path.join(kok, CHAINED_INTEGRITY_FILE);
  const ciftOk = cift.kod === 0 && existsSync(a) && existsSync(z) && paketIdOf(a) !== null && paketIdOf(a) === paketIdOf(z);
  check("§6f ⭐ çift imza (--zincir-anahtar): butunluk.jws + butunluk-zincir.jws, AYNI paketId", ciftOk, `çıkış ${cift.kod} ${cift.hata.trim().slice(0, 120)}`);
  if (ciftOk) {
    const v = await verifyIntegrity(readFileSync(z, "utf8").trim(), kok, [], { roots: ZF.kokler, mode: "KABUL", nowMs: Date.now() });
    check("§6g zincirli imza fikstür köküyle GECERLI", v.durum === "GECERLI", `${v.durum} ${v.kod ?? ""}`);
  }

  const kok2 = paket();
  const yalniz = imzala(kok2, pkt, `${PAROLA}\n`, ["--ci-kosu=4242", `--kok-capa=${capa}`, `--paket-iptal=${iptalDosyasi(ZF.kok)}`]);
  check("§6h ⭐ zincir-yalnız (--anahtar=pkt-*) + --paket-iptal: yalnız butunluk-zincir.jws + paket-iptal.jws",
    yalniz.kod === 0 && !existsSync(path.join(kok2, INTEGRITY_FILE)) && existsSync(path.join(kok2, CHAINED_INTEGRITY_FILE)) && existsSync(path.join(kok2, PACKAGE_REVOCATION_FILE)),
    `çıkış ${yalniz.kod} ${yalniz.hata.trim().slice(0, 120)}`);

  const kok3 = paket();
  const kotuIptal = imzala(kok3, pkt, `${PAROLA}\n`, ["--ci-kosu=4242", `--kok-capa=${capa}`, `--paket-iptal=${iptalDosyasi(YABANCI.kok)}`]);
  check("§6i ⭐ yabancı kökün iptal belgesi → RED, parola sorulmadan, iz yok", kotuIptal.kod === 1 && /iptali kökle doğrulanamadı/.test(kotuIptal.hata) && !/parola/i.test(kotuIptal.hata) && !existsSync(path.join(kok3, INTEGRITY_LIST_FILE)), `çıkış ${kotuIptal.kod} ${kotuIptal.hata.trim().slice(0, 100)}`);
  const iptalZincirsiz = imzala(paket(), paketDosya, "", ["--ci-kosu=4242", `--paket-iptal=${iptalDosyasi(ZF.kok)}`]);
  check("§6j --paket-iptal zincirsiz pakette → RED", iptalZincirsiz.kod === 1 && /yalnız zincirli/.test(iptalZincirsiz.hata), `çıkış ${iptalZincirsiz.kod}`);
  const kok4 = paket();
  const capasiz = imzala(kok4, pkt, `${PAROLA}\n`, ["--ci-kosu=4242"], { TEKSERP_TEST_KOK_CAPASI: "" });
  check("§6k ⭐ fikstür sertifikası üretim kökleriyle → öz-denetim RED, yazılan dosya silindi", capasiz.kod === 1 && !existsSync(path.join(kok4, CHAINED_INTEGRITY_FILE)) && !existsSync(path.join(kok4, INTEGRITY_LIST_FILE)), `çıkış ${capasiz.kod} ${capasiz.hata.trim().slice(0, 100)}`);

  // Tazelik: bitişe < 30 gün kalmış sertifika — ayrı anahtar dizini.
  const kd2 = dizin("pkt-bayat");
  cli(["anahtar-uret", `--kid=${PKT_KID}`, `--dizin=${kd2}`, "--json"], `${PAROLA}\n${PAROLA}\n`);
  const pkt2 = path.join(kd2, `${PKT_KID}.paket.json`);
  const bayat = cli(["sertifika-ekle", `--anahtar=${pkt2}`, `--sertifika=${sertifikaDosyasi(packageKeyInfo(pkt2).x, { bitis: msToIso(Date.now() + 10 * DAY_MS) })}`, `--kok-capa=${capa}`]);
  const kok5 = paket();
  const tazelik = imzala(kok5, pkt2, "", ["--ci-kosu=4242", `--kok-capa=${capa}`]);
  check("§6l ⭐ sertifikanın bitişine < 30 gün → parola SORULMADAN RED, imza yok", bayat.kod === 0 && tazelik.kod === 1 && /bitişine/.test(tazelik.hata) && !existsSync(path.join(kok5, INTEGRITY_LIST_FILE)), `çıkış ${tazelik.kod} ${tazelik.hata.trim().slice(0, 100)}`);

  // zip: dosya sayısı yazılan dosya kadar artar, iki kid PAKET.json'da.
  const zk = paket();
  writeFileSync(path.join(zk, "PAKET.json"), `${JSON.stringify({ korumali: true, uygulamaSurumu: "2.12.1", dosyaSayisi: 4, commit: KUNYE_COMMIT, backendKanal: null })}\n`);
  writeFileSync(path.join(zk, "dist", "server-kunye.json"), `${JSON.stringify({ commit: KUNYE_COMMIT, zaman: "2026-10-01T00:00:00.000Z" })}\n`);
  const zip = path.join(dizin("zip"), "p.zip");
  spawnSync("zip", ["-q", "-r", "-X", zip, "."], { cwd: zk });
  const zr = cli(["zip", `--zip=${zip}`, `--anahtar=${paketDosya}`, `--zincir-anahtar=${pkt}`, `--kok-capa=${capa}`, "--ci-kosu=4242"], iki);
  const acik = dizin("zip-acik");
  spawnSync("unzip", ["-q", zip, "-d", acik]);
  const pj = existsSync(path.join(acik, "PAKET.json")) ? (JSON.parse(readFileSync(path.join(acik, "PAKET.json"), "utf8")) as Record<string, unknown>) : {};
  check("§6m ⭐ zip çift imza: iki imza dosyası + liste, dosyaSayisi +3, butunlukKid paket-2099 · butunlukZincirKid pkt-2099-1",
    zr.kod === 0 && existsSync(path.join(acik, INTEGRITY_FILE)) && existsSync(path.join(acik, CHAINED_INTEGRITY_FILE)) && pj.dosyaSayisi === 7 && pj.butunlukKid === KID && pj.butunlukZincirKid === PKT_KID,
    `çıkış ${zr.kod} sayı ${String(pj.dosyaSayisi)} ${zr.hata.trim().slice(0, 100)}`);
}


// ── §7 ───────────────────────────────────────────────────────────────────────
// D5: `backend-bildirim.ts` iki takım — çift/zincir-yalnız paket, surum.json + surum-zincir.json, pg.json + pg-zincir.json.
function bildirimCli(argv: readonly string[], input = "", ortam: Record<string, string> = {}): Kosum {
  const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/backend-bildirim.ts", ...argv], {
    cwd: TEKS,
    input,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, HOME: path.join(TEMP, "ev"), TEKSERP_TEST_KOK_CAPASI: "", ...ortam },
  });
  return { kod: r.status, cikti: r.stdout ?? "", hata: r.stderr ?? "" };
}

/** Ortak (backendKanal null) korumalı paket zip'i — bildirimin okuduğu künye alanlarıyla. */
function ortakZip(ad: string): string {
  const k = paket();
  writeFileSync(path.join(k, "dist", "server-kunye.json"), `${JSON.stringify({ commit: KUNYE_COMMIT, zaman: "2026-10-01T00:00:00.000Z" })}\n`);
  writeFileSync(path.join(k, "PAKET.json"), `${JSON.stringify({ korumali: true, korumaHedef: "win-x64", uygulamaSurumu: "2.12.1", dosyaSayisi: 4, commit: KUNYE_COMMIT, backendKanal: null, runtimeNodeSurumu: "22.11.0", migrationSayisi: 1 })}\n`);
  const zip = path.join(dizin("ozip"), `${ad}.zip`);
  spawnSync("zip", ["-q", "-r", "-X", zip, "."], { cwd: k });
  return zip;
}

const isaretciYuku = (f: string): Record<string, unknown> => {
  const r = readReleasePointer(readFileSync(f, "utf8"));
  const p = r.ok ? parseJws(r.value) : null;
  return p?.ok ? (p.value.payload as Record<string, unknown>) : {};
};

async function bolum7(): Promise<void> {
  console.log("\n§7 backend-bildirim iki takım");
  const capa = kokCapaDosyasi();
  const eski = uretimAnahtari().dosya;
  const kd = dizin("pkt7");
  cli(["anahtar-uret", `--kid=${PKT_KID}`, `--dizin=${kd}`, "--json"], `${PAROLA}\n${PAROLA}\n`);
  const pkt = path.join(kd, `${PKT_KID}.paket.json`);
  cli(["sertifika-ekle", `--anahtar=${pkt}`, `--sertifika=${sertifikaDosyasi(packageKeyInfo(pkt).x)}`, `--kok-capa=${capa}`]);
  const paketCapa = path.join(dizin("pcapa"), "c.json");
  const ek = packageKeyInfo(eski);
  writeFileSync(paketCapa, JSON.stringify([{ kid: ek.kid, x: ek.x }]));
  const ozet = path.join(dizin("ozet"), "o.txt");
  writeFileSync(ozet, "bekçi sürümü\n");
  const ortak = (komut: string, zip: string, cikti: string, ekArg: readonly string[] = []) =>
    [komut, "--ortak", `--zip=${zip}`, "--kanal=test", "--guven-capasi=uretim", "--pg-cizgi=16", "--pg-en-az=16.9", `--ozet-dosyasi=${ozet}`, `--cikti=${cikti}`, `--kok-capa=${capa}`, ...ekArg];
  const env = { TEKSERP_TEST_PAKET_CAPASI: paketCapa };

  const cift = ortakZip("cift");
  cli(["zip", `--zip=${cift}`, `--anahtar=${eski}`, `--zincir-anahtar=${pkt}`, `--kok-capa=${capa}`, "--ci-kosu=4242"], `${PAROLA}\n${PAROLA}\n`);
  const c1 = dizin("b-cift");
  const im = bildirimCli(ortak("imzala", cift, c1, [`--anahtar=${eski}`, `--zincir-anahtar=${pkt}`]), `${PAROLA}\n${PAROLA}\n`, env);
  const s1 = existsSync(path.join(c1, "sonuc.json")) ? (JSON.parse(readFileSync(path.join(c1, "sonuc.json"), "utf8")) as Record<string, unknown>) : {};
  const a = existsSync(path.join(c1, "surum.json")) ? isaretciYuku(path.join(c1, "surum.json")) : {};
  const z = existsSync(path.join(c1, "surum-zincir.json")) ? isaretciYuku(path.join(c1, "surum-zincir.json")) : {};
  check("§7a ⭐ imzala --zincir-anahtar: surum.json (paket-2099) + surum-zincir.json (pkt-2099-1), aynı yayinZamani, takım cift",
    im.kod === 0 && s1.takim === "cift" && a.paketImzaKid === KID && z.paketImzaKid === PKT_KID && a.yayinZamani === z.yayinZamani && typeof a.yayinZamani === "string",
    `çıkış ${im.kod} ${im.hata.trim().slice(-160)}`);
  if (existsSync(path.join(c1, "surum-zincir.json"))) {
    const r = readReleasePointer(readFileSync(path.join(c1, "surum-zincir.json"), "utf8"));
    const v = r.ok ? verifyReleaseManifest(r.value, { keys: [], kanal: "test", zincir: { roots: ZF.kokler, mode: "YERLESIK" } }) : null;
    check("§7b surum-zincir.json kökle (YERLEŞİK) doğrulanır", v?.ok === true, v && !v.ok ? v.code : "işaretçi okunamadı");
  }

  const yalniz = ortakZip("yalniz");
  cli(["zip", `--zip=${yalniz}`, `--anahtar=${pkt}`, `--kok-capa=${capa}`, "--ci-kosu=4242"], `${PAROLA}\n`);
  const c2 = dizin("b-yalniz");
  const dg = bildirimCli(ortak("dogrula", yalniz, c2), "", env);
  const s2 = existsSync(path.join(c2, "sonuc.json")) ? (JSON.parse(readFileSync(path.join(c2, "sonuc.json"), "utf8")) as Record<string, unknown>) : {};
  check("§7c ⭐ zincir-yalnız paket dogrula → GEÇERLİ, takım zincir", dg.kod === 0 && s2.takim === "zincir", `çıkış ${dg.kod} ${dg.hata.trim().slice(-160)}`);
  const yanlis = bildirimCli(ortak("imzala", yalniz, dizin("b-yanlis"), [`--anahtar=${eski}`]), "", env);
  check("§7d zincir-yalnız pakete paket-* anahtarıyla bildirim → RED (imzalayan YOK), parola sorulmadan", yanlis.kod === 2 && /imzalayanı YOK/.test(yanlis.hata), `çıkış ${yanlis.kod} ${yanlis.hata.trim().slice(-120)}`);
  const kapsiz = bildirimCli(["dogrula", `--zip=${yalniz}`, "--kanal=x", "--kanal-turu=uretim", "--guven-capasi=uretim", "--pg-cizgi=16", "--pg-en-az=16.9", `--ozet-dosyasi=${ozet}`, `--cikti=${dizin("b-uretim")}`, `--kok-capa=${capa}`]);
  check("§7e ⭐ üretim kanalında test kök çapası → RED", kapsiz.kod !== 0 && /yalnız bekçi içindir/.test(kapsiz.hata), `çıkış ${kapsiz.kod} ${kapsiz.hata.trim().slice(-120)}`);

  // İki imza dosyası FARKLI paketin (farklı paketId) → DUR.
  const k1 = dizin("karisik");
  spawnSync("unzip", ["-q", cift, "-d", k1]);
  const k2 = dizin("karisik2");
  spawnSync("unzip", ["-q", yalniz, "-d", k2]);
  copyFileSync(path.join(k2, CHAINED_INTEGRITY_FILE), path.join(k1, CHAINED_INTEGRITY_FILE));
  const karisik = path.join(dizin("kzip"), "k.zip");
  spawnSync("zip", ["-q", "-r", "-X", karisik, "."], { cwd: k1 });
  const kr = bildirimCli(ortak("dogrula", karisik, dizin("b-karisik")), "", env);
  check("§7f ⭐ iki imza dosyası farklı paketId → DUR", kr.kod === 2 && /aynı paketi anlatmıyor/.test(kr.hata), `çıkış ${kr.kod} ${kr.hata.trim().slice(-120)}`);

  // PG künyesi iki takım.
  const pgk = dizin("pgk");
  mkdirSync(path.join(pgk, "bin"));
  writeFileSync(path.join(pgk, "bin", "icuuc67.dll"), "icu");
  writeFileSync(path.join(pgk, "TEKSERP-ICERIK.sha256"), "abc  bin/icuuc67.dll\n");
  const pgZip = path.join(dizin("pgzip"), "pg.zip");
  spawnSync("zip", ["-q", "-r", "-X", pgZip, "."], { cwd: pgk });
  const c3 = dizin("pg-cikti");
  const pg = bildirimCli(["pg-imzala", `--zip=${pgZip}`, `--anahtar=${eski}`, `--zincir-anahtar=${pkt}`, `--kok-capa=${capa}`, `--cikti=${c3}`], `${PAROLA}\n${PAROLA}\n`);
  const pgz = path.join(c3, "pg-zincir.json");
  const pr = existsSync(pgz) ? readReleasePointer(readFileSync(pgz, "utf8")) : null;
  const pv = pr?.ok ? verifyPgPackageManifest(pr.value, { keys: [], zincir: { roots: ZF.kokler, mode: "YERLESIK" } }) : null;
  check("§7g ⭐ pg-imzala --zincir-anahtar: pg.json + pg-zincir.json (kökle doğrulanır)", pg.kod === 0 && existsSync(path.join(c3, "pg.json")) && pv?.ok === true, `çıkış ${pg.kod} ${pg.hata.trim().slice(-140)}`);
  const pd = bildirimCli(["pg-dogrula", `--kunye=${pgz}`, `--zip=${pgZip}`, "--guven-capasi=uretim", `--kok-capa=${capa}`, `--cikti=${dizin("pgd")}`], "", env);
  check("§7h pg-dogrula pg-zincir.json'u kabul eder", pd.kod === 0, `çıkış ${pd.kod} ${pd.hata.trim().slice(-120)}`);
}

// ── §8 ───────────────────────────────────────────────────────────────────────
// D6: yıllık törenin yeniden imzası (`backend-bildirim.ts yeniden-imzala` · `pg-yeniden-imzala`), Docker künyesi
// zincirde (`belge --anahtar=pkt-*`), yedek ölçümü (`anahtar-ac`).
const PKT2_KID = "pkt-2099-2";
const PKT3_KID = "pkt-2099-3";
const jsonOku = (f: string): Record<string, unknown> => (existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>) : {});
const sertifikaIdOf = (f: string): string => {
  const p = parseJws(String(jsonOku(f).sertifika));
  return p.ok ? String((p.value.payload as Record<string, unknown>).sertifikaId) : "";
};
const shaOf = (f: string): string => createHash("sha256").update(readFileSync(f)).digest("hex");

async function bolum8(): Promise<void> {
  console.log("\n§8 yıllık tören: yeniden imza · Docker künyesi zincirde · anahtar-ac");
  const capa = kokCapaDosyasi();
  const eski = uretimAnahtari().dosya;
  const pktAnahtar = (kid: string): string => {
    const kd = dizin(`pkt8-${kid}`);
    cli(["anahtar-uret", `--kid=${kid}`, `--dizin=${kd}`, "--json"], `${PAROLA}\n${PAROLA}\n`);
    const f = path.join(kd, `${kid}.paket.json`);
    cli(["sertifika-ekle", `--anahtar=${f}`, `--sertifika=${sertifikaDosyasi(packageKeyInfo(f).x, { kid })}`, `--kok-capa=${capa}`]);
    return f;
  };
  const pkt1 = pktAnahtar(PKT_KID);
  const pkt2 = pktAnahtar(PKT2_KID);
  const paketCapa = path.join(dizin("pcapa8"), "c.json");
  const ek = packageKeyInfo(eski);
  writeFileSync(paketCapa, JSON.stringify([{ kid: ek.kid, x: ek.x }]));
  const env = { TEKSERP_TEST_PAKET_CAPASI: paketCapa };
  const ozet = path.join(dizin("ozet8"), "o.txt");
  writeFileSync(ozet, "bekçi sürümü\n");
  const bildir = (zip: string, cikti: string, anahtarlar: readonly string[]) =>
    bildirimCli(["imzala", "--ortak", `--zip=${zip}`, "--kanal=test", "--guven-capasi=uretim", "--pg-cizgi=16", "--pg-en-az=16.9", `--ozet-dosyasi=${ozet}`, `--cikti=${cikti}`, `--kok-capa=${capa}`, ...anahtarlar], `${PAROLA}\n${PAROLA}\n`, env);
  const yeniden = (kunye: string, zip: string, cikti: string, ekArg: readonly string[] = [], anahtar = pkt2, input = `${PAROLA}\n`) =>
    bildirimCli(["yeniden-imzala", `--surum-kunye=${kunye}`, `--zip=${zip}`, `--anahtar=${anahtar}`, `--kok-capa=${capa}`, `--cikti=${cikti}`, "--kanal=test", ...ekArg], input, env);

  const cift = ortakZip("cift8");
  cli(["zip", `--zip=${cift}`, `--anahtar=${eski}`, `--zincir-anahtar=${pkt1}`, `--kok-capa=${capa}`, "--ci-kosu=4242"], `${PAROLA}\n${PAROLA}\n`);
  const c1 = dizin("y-cift");
  bildir(cift, c1, [`--anahtar=${eski}`, `--zincir-anahtar=${pkt1}`]);
  const ciftSha = shaOf(cift);
  const c8 = dizin("y-out");
  const y = yeniden(path.join(c1, "surum-zincir.json"), cift, c8);
  const yeniZip = path.join(c8, `cift8-${PKT2_KID}.zip`);
  const eskiYuk = isaretciYuku(path.join(c1, "surum-zincir.json"));
  const yeniAdi = `surum-zincir-${PKT2_KID}.json`;
  const yeniYuk = existsSync(path.join(c8, yeniAdi)) ? isaretciYuku(path.join(c8, yeniAdi)) : {};
  const yp = yeniYuk.paket as Record<string, unknown> | undefined;
  const ep = eskiYuk.paket as Record<string, unknown> | undefined;
  check("§8a ⭐ yeniden-imzala: <ad>-pkt-2099-2.zip + surum-zincir-pkt-2099-2.json (kid'siz ad YAZILMAZ); imzacı pkt-2099-2, sürüm · paketId · yayinZamani · özet AYNI",
    y.kod === 0 && existsSync(yeniZip) && !existsSync(path.join(c8, "surum-zincir.json")) && yeniYuk.paketImzaKid === PKT2_KID && yeniYuk.surum === eskiYuk.surum && yp?.paketId === ep?.paketId && yeniYuk.yayinZamani === eskiYuk.yayinZamani
      && JSON.stringify(yeniYuk.notlar) === JSON.stringify(eskiYuk.notlar) && yp?.ad === path.basename(yeniZip) && yp?.sha256 === (existsSync(yeniZip) ? shaOf(yeniZip) : ""),
    `çıkış ${y.kod} ${y.hata.trim().slice(-200)}`);
  if (existsSync(path.join(c8, yeniAdi))) {
    const r = readReleasePointer(readFileSync(path.join(c8, yeniAdi), "utf8"));
    const v = r.ok ? verifyReleaseManifest(r.value, { keys: [], kanal: "test", zincir: { roots: ZF.kokler, mode: "KABUL", nowMs: Date.now() } }) : null;
    check("§8b yeni surum-zincir-<kid>.json kökle KABUL kipinde doğrulanır", v?.ok === true, v ? (v.ok ? "" : v.code) : "işaretçi okunamadı");
  }
  const a0 = dizin("y-a0");
  spawnSync("unzip", ["-q", cift, "-d", a0]);
  const a1 = dizin("y-a1");
  spawnSync("unzip", ["-q", yeniZip, "-d", a1]);
  const z1 = path.join(a1, CHAINED_INTEGRITY_FILE);
  const zv = existsSync(z1) ? await verifyIntegrity(readFileSync(z1, "utf8").trim(), a1, [], { roots: ZF.kokler, mode: "KABUL", nowMs: Date.now() }) : null;
  const zk = existsSync(z1) ? parseJws(readFileSync(z1, "utf8").trim()) : null;
  const pj0 = jsonOku(path.join(a0, "PAKET.json"));
  const pj1 = jsonOku(path.join(a1, "PAKET.json"));
  check("§8c ⭐ yeni zip: butunluk.jws + liste BAYT-AYNI, butunluk-zincir.jws pkt-2099-2 ile GECERLI (KABUL), PAKET.json zincir kid'i yeni, dosyaSayisi aynı",
    existsSync(z1) && readFileSync(path.join(a0, INTEGRITY_FILE), "utf8") === readFileSync(path.join(a1, INTEGRITY_FILE), "utf8")
      && readFileSync(path.join(a0, INTEGRITY_LIST_FILE), "utf8") === readFileSync(path.join(a1, INTEGRITY_LIST_FILE), "utf8")
      && zv?.durum === "GECERLI" && zk?.ok === true && zk.value.header.kid === PKT2_KID && pj1.butunlukZincirKid === PKT2_KID && pj1.dosyaSayisi === pj0.dosyaSayisi,
    `${zv?.durum ?? "yok"} ${zv?.kod ?? ""} sayı ${String(pj0.dosyaSayisi)}→${String(pj1.dosyaSayisi)}`);
  check("§8d yayındaki zip'e DOKUNULMADI (özet aynı)", shaOf(cift) === ciftSha);

  const yalniz = ortakZip("yalniz8");
  cli(["zip", `--zip=${yalniz}`, `--anahtar=${pkt1}`, `--kok-capa=${capa}`, "--ci-kosu=4242"], `${PAROLA}\n`);
  const c2 = dizin("y-yalniz");
  bildir(yalniz, c2, [`--anahtar=${pkt1}`]);
  const c9 = dizin("y-tutmuyor");
  const tutmuyor = yeniden(path.join(c1, "surum-zincir.json"), yalniz, c9);
  check("§8e ⭐ zip bildirimle tutmuyor → RED, parola sorulmadan, çıktı YOK", tutmuyor.kod === 2 && /TUTMUYOR/.test(tutmuyor.hata) && readdirSync(c9).length === 0, `çıkış ${tutmuyor.kod} ${tutmuyor.hata.trim().slice(-120)}`);
  const pktDegil = yeniden(path.join(c1, "surum-zincir.json"), cift, dizin("y-pkt-degil"), [], eski, "");
  check("§8f ⭐ yeni imzacı paket-* (gömülü çapalı) → RED, parola sorulmadan", pktDegil.kod === 2 && /yalnız kök sertifikalı pkt-\*/.test(pktDegil.hata), `çıkış ${pktDegil.kod} ${pktDegil.hata.trim().slice(-120)}`);
  const ayni = yeniden(path.join(c2, "surum-zincir.json"), yalniz, dizin("y-ayni"), [], pkt1, "");
  check("§8g aynı anahtarla yeniden imza → RED (zaten imzalı)", ayni.kod === 2 && /zaten pkt-2099-1/.test(ayni.hata), `çıkış ${ayni.kod} ${ayni.hata.trim().slice(-120)}`);

  const iptal = iptalDosyasi(ZF.kok, [{ kid: PKT_KID, sertifikaId: sertifikaIdOf(path.join(path.dirname(pkt1), `${PKT_KID}.sertifika.json`)) }], 4);
  const c10 = dizin("y-iptalli");
  const iptalli = yeniden(path.join(c2, "surum-zincir.json"), yalniz, c10, [`--paket-iptal=${iptal}`], pkt2, "");
  check("§8h ⭐ zincir-yalnız sürüm + imzacısı İPTALLİ → DUR (köken kanıtlanamaz), çıktı YOK", iptalli.kod === 2 && /İPTALLİ/.test(iptalli.hata) && readdirSync(c10).length === 0, `çıkış ${iptalli.kod} ${iptalli.hata.trim().slice(-140)}`);
  const c11 = dizin("y-eski-takim");
  const eskiTakim = yeniden(path.join(c1, "surum.json"), cift, c11, [`--paket-iptal=${iptal}`]);
  const a2 = dizin("y-a2");
  spawnSync("unzip", ["-q", path.join(c11, `cift8-${PKT2_KID}.zip`), "-d", a2]);
  const pj2 = jsonOku(path.join(a2, "PAKET.json"));
  const ip = existsSync(path.join(a2, PACKAGE_REVOCATION_FILE)) ? parseJws(readFileSync(path.join(a2, PACKAGE_REVOCATION_FILE), "utf8").trim()) : null;
  check("§8i ⭐ çift sürüm, eski takım bildirimiyle + iptal → GEÇER: pakete paket-iptal.jws (sıra 4) girer, dosyaSayisi +1",
    eskiTakim.kod === 0 && ip?.ok === true && (ip.value.payload as Record<string, unknown>).sira === 4 && pj2.dosyaSayisi === Number(pj0.dosyaSayisi) + 1,
    `çıkış ${eskiTakim.kod} ${eskiTakim.hata.trim().slice(-160)}`);

  const pgk = dizin("pgk8");
  mkdirSync(path.join(pgk, "bin"));
  writeFileSync(path.join(pgk, "bin", "icuuc67.dll"), "icu");
  writeFileSync(path.join(pgk, "TEKSERP-ICERIK.sha256"), "abc  bin/icuuc67.dll\n");
  const pgZip = path.join(dizin("pgzip8"), "pg.zip");
  spawnSync("zip", ["-q", "-r", "-X", pgZip, "."], { cwd: pgk });
  const c3 = dizin("pg8");
  bildirimCli(["pg-imzala", `--zip=${pgZip}`, `--anahtar=${eski}`, `--zincir-anahtar=${pkt1}`, `--kok-capa=${capa}`, `--cikti=${c3}`], `${PAROLA}\n${PAROLA}\n`);
  const c12 = dizin("pg8-y");
  const pgy = bildirimCli(["pg-yeniden-imzala", `--kunye=${path.join(c3, "pg-zincir.json")}`, `--zip=${pgZip}`, `--anahtar=${pkt2}`, `--kok-capa=${capa}`, `--cikti=${c12}`], `${PAROLA}\n`, env);
  const pgYeniAdi = `pg-zincir-${PKT2_KID}.json`;
  const pr = existsSync(path.join(c12, pgYeniAdi)) ? readReleasePointer(readFileSync(path.join(c12, pgYeniAdi), "utf8")) : null;
  const pv = pr?.ok ? verifyPgPackageManifest(pr.value, { keys: [], zincir: { roots: ZF.kokler, mode: "KABUL", nowMs: Date.now() } }) : null;
  const pgEski = readReleasePointer(readFileSync(path.join(c3, "pg-zincir.json"), "utf8"));
  const pe = pgEski.ok ? verifyPgPackageManifest(pgEski.value, { keys: [], zincir: { roots: ZF.kokler, mode: "YERLESIK" } }) : null;
  const pgYeniKid = pr?.ok ? (parseJws(pr.value).ok ? (parseJws(pr.value) as { value: { header: { kid: string } } }).value.header.kid : "") : "";
  check("§8j ⭐ pg-yeniden-imzala: pg-zincir-pkt-2099-2.json pkt-2099-2 ile KABUL, künye yükü AYNEN", pgy.kod === 0 && !existsSync(path.join(c12, "pg-zincir.json")) && pv?.ok === true && pe?.ok === true && JSON.stringify(pv.value) === JSON.stringify(pe.value) && pgYeniKid === PKT2_KID,
    `çıkış ${pgy.kod} ${pgy.hata.trim().slice(-140)}`);

  // D8 dizin kipi: ikinci yıl — yayın dizininde eski takım + kid'siz (pkt-2099-1) + kid'li (pkt-2099-2) yan yana.
  const pkt3 = pktAnahtar(PKT3_KID);
  const yd = dizin("y-yayin8");
  for (const [k, a] of [[c1, "surum.json"], [c1, "surum-zincir.json"], [c8, yeniAdi]] as const) copyFileSync(path.join(k, a), path.join(yd, a));
  copyFileSync(cift, path.join(yd, path.basename(cift)));
  copyFileSync(yeniZip, path.join(yd, path.basename(yeniZip)));
  const yenidenDizin = (cikti: string, ekArg: readonly string[], d = yd) =>
    bildirimCli(["yeniden-imzala", `--surum-dizini=${d}`, `--anahtar=${pkt3}`, `--kok-capa=${capa}`, `--cikti=${cikti}`, "--kanal=test", ...ekArg], `${PAROLA}\n`, env);
  const c13 = dizin("y-dizin");
  const dz = yenidenDizin(c13, [`--paket-iptal=${iptal}`]);
  const dzSonuc = existsSync(path.join(c13, "sonuc.json")) ? jsonOku(path.join(c13, "sonuc.json")) : {};
  check("§8n ⭐ D8 dizin kipi: iptalli kid'siz elenir, kid'li pkt-2099-2 girdi olur → surum-zincir-pkt-2099-3.json + cift8-pkt-2099-3.zip",
    dz.kod === 0 && dzSonuc.girdi === yeniAdi && existsSync(path.join(c13, `surum-zincir-${PKT3_KID}.json`)) && existsSync(path.join(c13, `cift8-${PKT3_KID}.zip`)) && /elendi surum-zincir\.json: PAKET_SERTIFIKA_IPTAL/.test(dz.hata),
    `çıkış ${dz.kod} girdi ${String(dzSonuc.girdi)} ${dz.hata.trim().slice(-160)}`);
  const ikisi = iptalDosyasi(ZF.kok, [PKT_KID, PKT2_KID].map((kid) => ({ kid, sertifikaId: sertifikaIdOf(path.join(path.dirname(kid === PKT_KID ? pkt1 : pkt2), `${kid}.sertifika.json`)) })), 5);
  const c14 = dizin("y-dizin-eski");
  const dzEski = yenidenDizin(c14, [`--paket-iptal=${ikisi}`]);
  const dzEskiSonuc = existsSync(path.join(c14, "sonuc.json")) ? jsonOku(path.join(c14, "sonuc.json")) : {};
  check("§8o ⭐ D8 dizin kipi: zincirli adayların hepsi iptalli → eski takım (surum.json) girdi olur, elenenler ekrana",
    dzEski.kod === 0 && dzEskiSonuc.girdi === "surum.json" && /zincirli adaylar geçersiz/.test(dzEski.hata) && /eski takım: surum\.json/.test(dzEski.hata),
    `çıkış ${dzEski.kod} girdi ${String(dzEskiSonuc.girdi)} ${dzEski.hata.trim().slice(-160)}`);
  const yd2 = dizin("y-yayin8-yalniz");
  copyFileSync(path.join(c2, "surum-zincir.json"), path.join(yd2, "surum-zincir.json"));
  copyFileSync(yalniz, path.join(yd2, path.basename(yalniz)));
  const c15 = dizin("y-dizin-yok");
  const dzYok = yenidenDizin(c15, [`--paket-iptal=${iptal}`], yd2);
  check("§8p ⭐ D8 dizin kipi: tek zincirli aday iptalli ve eski takım yok → RED, çıktı YOK", dzYok.kod === 2 && /eski surum\.json de yok/.test(dzYok.hata) && readdirSync(c15).length === 0,
    `çıkış ${dzYok.kod} ${dzYok.hata.trim().slice(-140)}`);
  const pd8 = dizin("pg8-yayin");
  for (const [k, a] of [[c3, "pg.json"], [c3, "pg-zincir.json"], [c12, pgYeniAdi]] as const) copyFileSync(path.join(k, a), path.join(pd8, a));
  const c16 = dizin("pg8-dizin");
  const pgDz = bildirimCli(["pg-yeniden-imzala", `--pg-dizini=${pd8}`, `--anahtar=${pkt3}`, `--kok-capa=${capa}`, `--cikti=${c16}`, `--paket-iptal=${iptal}`], `${PAROLA}\n`, env);
  const pgDzSonuc = existsSync(path.join(c16, "sonuc.json")) ? jsonOku(path.join(c16, "sonuc.json")) : {};
  check("§8q ⭐ D8 pg dizin kipi: iptalli kid'siz elenir, girdi pg-zincir-pkt-2099-2.json → pg-zincir-pkt-2099-3.json",
    pgDz.kod === 0 && pgDzSonuc.girdi === pgYeniAdi && existsSync(path.join(c16, `pg-zincir-${PKT3_KID}.json`)), `çıkış ${pgDz.kod} ${pgDz.hata.trim().slice(-140)}`);
  // D8 kurulum arşivi (pg-dogrula / ortak-dogrula --pg-kunye): kid'li ad seçim kuralından geçer, ad kid'i = imzalayan.
  const pgDogrulaAd = (kunye: string) => bildirimCli(["pg-dogrula", `--kunye=${kunye}`, `--zip=${pgZip}`, "--guven-capasi=uretim", `--kok-capa=${capa}`, `--cikti=${dizin("pg8-dogrula")}`], "", env);
  const pgdK = pgDogrulaAd(path.join(c12, pgYeniAdi));
  const pgYanlisAd = path.join(dizin("pg8-yanlis"), `pg-zincir-${PKT3_KID}.json`);
  copyFileSync(path.join(c12, pgYeniAdi), pgYanlisAd);
  const pgdY = pgDogrulaAd(pgYanlisAd);
  check("§8r ⭐ D8 pg-dogrula: pg-zincir-pkt-2099-2.json KABUL · aynı belge pg-zincir-pkt-2099-3.json adıyla → RED (JWS_KID)",
    pgdK.kod === 0 && pgdY.kod !== 0 && /JWS_KID/.test(pgdY.hata), `çıkış ${pgdK.kod}/${pgdY.kod} ${pgdK.hata.trim().slice(-100)} | ${pgdY.hata.trim().slice(-120)}`);

  const dk = dizin("docker8");
  for (const f of ["t.tar.gz", "docker-compose.yml", ".env.ornek"]) writeFileSync(path.join(dk, f), `${f}\n`);
  const belge = path.join(dk, "PAKET-DOCKER.json");
  writeFileSync(belge, `${JSON.stringify({ v: 1, paketId: "00000000-0000-4000-8000-0000000000dd", urun: "backend-docker", surum: "2.12.1", derlemeTarihi: "2026-10-01T00:00:00.000Z", musteri: null, kapsam: { dizinler: [], dosyalar: ["t.tar.gz", "docker-compose.yml", ".env.ornek"] } }, null, 2)}\n`);
  const bz = cli(["belge", `--belge=${belge}`, `--anahtar=${pkt2}`, `--kok-capa=${capa}`], `${PAROLA}\n`);
  const bj = existsSync(`${belge}.jws`) ? readFileSync(`${belge}.jws`, "utf8").trim() : "";
  const bv = bj ? await verifyIntegrity(bj, dk, [], { roots: ZF.kokler, mode: "KABUL", nowMs: Date.now() }) : null;
  check("§8k ⭐ Docker teslim künyesi pkt-* ile ZİNCİRLİ imzalanır (kök çapasıyla KABUL GECERLI)", bz.kod === 0 && bv?.durum === "GECERLI", `çıkış ${bz.kod} ${bv?.durum ?? ""} ${bz.hata.trim().slice(-120)}`);
  const dk2 = dizin("docker8b");
  for (const f of ["t.tar.gz", "docker-compose.yml", ".env.ornek"]) writeFileSync(path.join(dk2, f), `${f}\n`);
  copyFileSync(belge, path.join(dk2, "PAKET-DOCKER.json"));
  const yabanciKok = path.join(dizin("ycapa8"), "k.json");
  writeFileSync(yabanciKok, `${JSON.stringify(YABANCI.kokler)}\n`);
  const bzY = cli(["belge", `--belge=${path.join(dk2, "PAKET-DOCKER.json")}`, `--anahtar=${pkt2}`, `--kok-capa=${yabanciKok}`], `${PAROLA}\n`);
  check("§8l Docker künyesi: sertifikayı tanımayan kök çapası → öz-denetim RED, .jws YOK", bzY.kod === 1 && !existsSync(path.join(dk2, "PAKET-DOCKER.json.jws")), `çıkış ${bzY.kod} ${bzY.hata.trim().slice(-120)}`);

  const ac = cli(["anahtar-ac", `--anahtar=${pkt2}`, "--json"], `${PAROLA}\n`);
  const acY = cli(["anahtar-ac", `--anahtar=${pkt2}`, "--json"], "yanlis-parola-bekci-99\n");
  const aj = ac.kod === 0 ? (JSON.parse(ac.cikti.trim().split("\n").pop() ?? "{}") as Record<string, unknown>) : {};
  check("§8m anahtar-ac: doğru parola → kid + x (dosyanınki) · ⭐ yanlış parola → RED", aj.kid === PKT2_KID && aj.x === packageKeyInfo(pkt2).x && acY.kod !== 0 && !/"x"/.test(acY.cikti), `çıkış ${ac.kod}/${acY.kod}`);
}

async function main(): Promise<void> {
  try {
    bolum0();
    await bolum1();
    bolum2();
    bolum3();
    bolum4();
    await bolum5();
    await bolum6();
    await bolum7();
    await bolum8();
  } finally {
    rmSync(TEMP, { recursive: true, force: true });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
