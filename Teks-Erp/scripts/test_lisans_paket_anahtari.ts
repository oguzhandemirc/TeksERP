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
//      parola tekrarı uyuşmaz · zayıf parola · stdin boş · depo içine üretim anahtarı · hazırlık/üretim karışması
//      (parolalı dosyada hazırlık kid'i · parolasız dosyada üretim kid'i · parolalı dosyada düz özel yarı)
//   §3 hazırlık akışı DEĞİŞMEDİ: kid'siz `anahtar-uret` parolasız dosya yazar, imza parola sormaz
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
import { generatePackageKey, writePackageKey } from "./lib/butunluk-imza";
import { CAPA_DOSYALARI, capaDurumuOku } from "./lib/guven-capasi";
import { main as capaEkle } from "./guven-capasi-ekle";

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

interface Kosum {
  readonly kod: number | null;
  readonly cikti: string;
  readonly hata: string;
}

/** Gerçek CLI; stdin boru (TTY değil) → parola stdin satırlarından. HOME geçici dizin. */
function cli(argv: readonly string[], input = ""): Kosum {
  const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/build-korumali-imza.ts", ...argv], {
    cwd: TEKS,
    input,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, HOME: path.join(TEMP, "ev") },
  });
  return { kod: r.status, cikti: r.stdout ?? "", hata: r.stderr ?? "" };
}

let sayac = 0;
function dizin(ad: string): string {
  const d = path.join(TEMP, `${ad}-${sayac++}`);
  mkdirSync(d, { recursive: true });
  return d;
}

/** Küçük paket kökü: dist/ + kökte package.json (imzalı kapsam). */
function paket(): string {
  const kok = dizin("paket");
  mkdirSync(path.join(kok, "dist"));
  writeFileSync(path.join(kok, "dist", "a.js"), "console.log('a');\n");
  writeFileSync(path.join(kok, "package.json"), '{"name":"p"}\n');
  return kok;
}

const imzala = (kok: string, anahtar: string, input: string): Kosum =>
  cli(["imzala", `--kok=${kok}`, `--anahtar=${anahtar}`, "--surum=2.12.1", "--derleme-tarihi=2026-09-30T00:00:00.000Z"], input);

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
    const paketler = capaDurumuOku(kopya).paketler;
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
  karisma("parolalı dosyada hazırlık kid'i", (k) => ({ ...k, kid: "paket-hazirlik" }), /yalnız üretim PAKET kid'i/);
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
function bolum3(): void {
  console.log("\n§3 hazırlık akışı değişmedi");
  const r = cli(["anahtar-uret"]);
  const dosya = path.join(TEMP, "ev", ".tekserp", "satici-hazirlik", "paket-hazirlik.paket.json");
  const k = existsSync(dosya) ? (JSON.parse(readFileSync(dosya, "utf8")) as Record<string, unknown>) : {};
  check("§3a kid'siz anahtar-uret: çıkış 0, varsayılan hazırlık dizini, sürüm 1 parolasız (stdin okunmadı)", r.kod === 0 && k.surum === 1 && typeof k.d === "string" && k.kid === "paket-hazirlik", `çıkış ${r.kod} ${r.hata.trim().slice(0, 60)}`);
  if (!existsSync(dosya)) return;
  const kok = paket();
  const imza = imzala(kok, dosya, "");
  check("§3b hazırlık anahtarıyla imza parola SORMAZ (stdin boş): çıkış 0, butunluk.jws yazıldı", imza.kod === 0 && existsSync(path.join(kok, INTEGRITY_FILE)), `çıkış ${imza.kod} ${imza.hata.trim().slice(0, 60)}`);
}

async function main(): Promise<void> {
  try {
    bolum0();
    await bolum1();
    bolum2();
    bolum3();
  } finally {
    rmSync(TEMP, { recursive: true, force: true });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
