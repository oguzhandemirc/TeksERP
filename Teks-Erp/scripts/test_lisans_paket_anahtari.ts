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
// ⭐ KALICI SONDA ✓K: §0c tek-uygulama tarayıcısı sentetik kripto satırını yakalar; §2 ret dalları her koşumda.
// Koşum: node ../scripts/agir-is.mjs -- npx tsx scripts/test_lisans_paket_anahtari.ts
// =============================================================================
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
import { DAY_MS, PackageRevocationSchema, TYP, msToIso, parseJws, signDocument } from "../src/lib/license/protocol";
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
function sertifikaDosyasi(x: string, ek: { bitis?: string; imzalayan?: typeof ZF.kok } = {}): string {
  const konu = { ...anahtarUret(PKT_KID), kid: PKT_KID, x };
  const yuk = sertifikaYuku(ZF, konu, "PAKET", ek.bitis ? { bitis: ek.bitis } : {});
  const f = path.join(dizin("sertifika"), "s.json");
  writeFileSync(f, `${JSON.stringify({ sertifika: sertifikaBas(ek.imzalayan ?? ZF.kok, yuk) })}\n`);
  return f;
}

function iptalDosyasi(imzalayan: typeof ZF.kok): string {
  const belge = signDocument({
    typ: TYP.PAKET_IPTAL,
    schema: PackageRevocationSchema,
    payload: { v: 1, iptalId: "00000000-0000-4000-8000-000000000001", sira: 3, verilis: msToIso(ZF.simdi - DAY_MS), iptaller: [] },
    key: imzalayan,
  });
  const f = path.join(dizin("iptal"), "iptal.json");
  writeFileSync(f, `${JSON.stringify({ v: 1, tur: "tekserp-paketiptal-belgesi", sira: 3, belge })}\n`);
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

async function main(): Promise<void> {
  try {
    bolum0();
    await bolum1();
    bolum2();
    bolum3();
    bolum4();
    await bolum5();
    await bolum6();
  } finally {
    rmSync(TEMP, { recursive: true, force: true });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
