// =============================================================================
// SATICI YEDEK DÖNGÜSÜ (Bölge 7 B8; DB'siz). `deploy/satici/yedek-dongusu.sh tek` GERÇEK şifreleme aracıyla
// (Teks-Erp/scripts/yedek-sifrele.ts, tsx sarmalayıcı) ve sahte pg_dump/pg_restore ile geçici dizinlerde koşar:
//   §1 katman alıcısı varken: çıkış 0; DB dökümü tek katman, anahtar arşivi `anahtarlar_<damga>.tar.tkenc.tkenc`;
//      yarım/düz dosya kalmaz; anahtar dosyalarının düz baytı yedek dizininde YOK
//   §2 çift katman: dış alıcının (Mac) özel yarısı dış katmanı açar ama İÇ katmanı AÇAMAZ (yanlış anahtar, çıkış 2);
//      iç katman yalnız katman anahtarı + yedek parolasıyla açılır ve arşiv anahtar dizinini bayt-eşit taşır;
//      dış katman alıcıları olağan alıcılar, iç katmanınki yalnız katman alıcısı
//   §3 katman alıcısı yokken: DB dökümü ALINIR, anahtar arşivi ALINMAZ, çıkış ≠ 0 ve günlükte HATA satırı (fail-closed)
//   §4 parola hijyeni: yedek parolası betik argv'sine/çıktısına ve yedek dizinine girmez
// NEGATİF SONDA (dosya DIŞI, geri alındı): N1 iç katman adımı sökülür (tar doğrudan dış alıcılara) → §2a–§2d ❌ ·
//   N2 katman `durum` denetimi sökülür → §3b ❌ (araç boş dizinde yine düşer; günlükteki neden satırı kaybolur)
// Koşum: npx tsx scripts/test_yedek_dongusu.ts
// =============================================================================
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let kirmizi = 0;
function kontrol(ad: string, ok: boolean, ayrinti = ""): void {
  if (!ok) kirmizi++;
  console.log(`${ok ? "✅" : "❌"} ${ad}${ayrinti ? ` — ${ayrinti}` : ""}`);
}

const KOK = path.resolve(__dirname, "..", "..", "..");
const BETIK = path.join(KOK, "deploy", "satici", "yedek-dongusu.sh");
const ARAC_TS = path.join(KOK, "Teks-Erp", "scripts", "yedek-sifrele.ts");
const TSX = require.resolve("tsx");
// Sır değeri değil: yalnız bu bekçinin geçici anahtarını saran sınama parolası.
const PAROLA = "bekci-yedek-parolasi-2026";
const ISARET = "ANAHTAR-DUZ-ISARETI-7f3a";

const tmp = mkdtempSync(path.join(os.tmpdir(), "satici-yedek-"));
const d = (ad: string) => path.join(tmp, ad);

function arac(args: string[], girdi?: string): { kod: number; cikti: string } {
  const r = spawnSync(process.execPath, ["--import", TSX, ARAC_TS, ...args], { encoding: "utf8", input: girdi, timeout: 60_000 });
  return { kod: r.status ?? -1, cikti: `${r.stdout}${r.stderr}` };
}

function hazirla(): void {
  for (const x of ["alici", "alici/anahtar-katmani", "ozel", "anahtarlar", "bin"]) mkdirSync(d(x), { recursive: true });
  for (const ad of ["satici-uretim-mac", "satici-uretim-kurtarma"]) {
    const r = arac(["anahtar-uret", "--ad", ad, "--dizin", d("alici"), "--ozel-cikti", d(`ozel/${ad}.txt`)]);
    if (r.kod !== 0) throw new Error(`anahtar-uret ${ad}: ${r.cikti}`);
  }
  const k = arac(["anahtar-uret", "--ad", "anahtar-katmani", "--dizin", d("ozel"), "--parolali", "--parola-stdin"], `${PAROLA}\n`);
  if (k.kod !== 0) throw new Error(`katman anahtarı: ${k.cikti}`);
  // VDS'e yalnız AÇIK yarı gider; sarılı özel yarı Mac/USB'de kalır.
  writeFileSync(d("alici/anahtar-katmani/anahtar-katmani.tkpub"), readFileSync(d("ozel/anahtar-katmani.tkpub")));
  writeFileSync(d("anahtarlar/alt.json"), `{"subKeyPrivate":"${ISARET}-alt"}`);
  writeFileSync(d("anahtarlar/kod.pepper"), `${ISARET}-pepper`);
  writeFileSync(d("anahtarlar/portal-totp.key"), `${ISARET}-totp`);
  writeFileSync(d("db-parola"), "sahte-db\n");
  writeFileSync(d("bin/pg_dump"), '#!/bin/sh\nwhile [ $# -gt 0 ]; do [ "$1" = -f ] && { shift; echo PGDMP-SAHTE > "$1"; }; shift; done\n');
  writeFileSync(d("bin/pg_restore"), "#!/bin/sh\nexit 0\n");
  writeFileSync(d("arac.cjs"), `const r=require("child_process").spawnSync(process.execPath,["--import",${JSON.stringify(TSX)},${JSON.stringify(ARAC_TS)},...process.argv.slice(2)],{stdio:"inherit"});process.exit(r.status===null?1:r.status);\n`);
  chmodSync(d("bin/pg_dump"), 0o755);
  chmodSync(d("bin/pg_restore"), 0o755);
}

function tur(yedek: string): { kod: number; cikti: string; argv: string } {
  mkdirSync(yedek, { recursive: true });
  const env = { ...process.env, PATH: `${d("bin")}${path.delimiter}${process.env.PATH}`, YEDEK_KOK: yedek, YEDEK_ALICI_KOK: d("alici"), YEDEK_ANAHTAR_KOK: d("anahtarlar"), YEDEK_ARAC: d("arac.cjs"), DB_PAROLA_DOSYASI: d("db-parola") };
  const r = spawnSync("sh", [BETIK, "tek"], { encoding: "utf8", env, timeout: 180_000 });
  return { kod: r.status ?? -1, cikti: `${r.stdout}${r.stderr}`, argv: [BETIK, "tek"].join(" ") };
}

function dizindeIsaret(dizin: string): string[] {
  return readdirSync(dizin).filter((f) => readFileSync(path.join(dizin, f)).includes(ISARET));
}

function main(): void {
  try {
    hazirla();
    console.log("§1 katman alıcısı var");
    const y1 = d("yedek1");
    const t1 = tur(y1);
    const dosyalar = readdirSync(y1).sort();
    const dump = dosyalar.find((f) => /^satici_\d{8}_\d{6}\.dump\.tkenc$/.test(f));
    const arsiv = dosyalar.find((f) => /^anahtarlar_\d{8}_\d{6}\.tar\.tkenc\.tkenc$/.test(f));
    kontrol("§1a çıkış 0; DB dökümü + çift uzantılı anahtar arşivi", t1.kod === 0 && !!dump && !!arsiv, `${t1.kod} · ${dosyalar.join(",")} · ${t1.cikti.trim().split("\n").pop() ?? ""}`);
    kontrol("§1b başka dosya yok (yarım/düz/tek katman arşiv kalmadı)", dosyalar.length === 2, dosyalar.join(","));
    const sizan = dizindeIsaret(y1);
    kontrol("§1c anahtar dosyalarının düz baytı yedek dizininde YOK", sizan.length === 0, sizan.join(","));
    if (!arsiv) return;

    console.log("§2 çift katman");
    const ara = d("ara.tkenc");
    const dis = arac(["coz", "--girdi", path.join(y1, arsiv), "--cikti", ara, "--anahtar", d("ozel/satici-uretim-mac.txt")]);
    const icMac = arac(["coz", "--girdi", ara, "--cikti", d("mac-deneme.tar"), "--anahtar", d("ozel/satici-uretim-mac.txt")]);
    const icKurt = arac(["coz", "--girdi", ara, "--cikti", d("kurt-deneme.tar"), "--anahtar", d("ozel/satici-uretim-kurtarma.txt")]);
    kontrol("§2a dış alıcı dış katmanı açar; iç katmanı NE Mac NE kurtarma anahtarı açar (çıkış 2)", dis.kod === 0 && icMac.kod === 2 && icKurt.kod === 2 && !existsSync(d("mac-deneme.tar")), `dış ${dis.kod} · iç(mac) ${icMac.kod} · iç(kurtarma) ${icKurt.kod}`);
    const tarYol = d("anahtarlar.tar");
    const ic = arac(["coz", "--girdi", ara, "--cikti", tarYol, "--anahtar", d("ozel/anahtar-katmani.tkkey"), "--parola-stdin"], `${PAROLA}\n`);
    const acik = d("acik");
    mkdirSync(acik);
    const tx = ic.kod === 0 ? spawnSync("tar", ["-C", acik, "-xf", tarYol]).status : -1;
    const esit = ["alt.json", "kod.pepper", "portal-totp.key"].every((f) => existsSync(path.join(acik, f)) && readFileSync(path.join(acik, f)).equals(readFileSync(d(`anahtarlar/${f}`))));
    kontrol("§2b iç katman katman anahtarı + yedek parolasıyla açılır; arşiv anahtar dizinini bayt-eşit taşır", ic.kod === 0 && tx === 0 && esit, `iç ${ic.kod} · tar ${tx} · eşit ${esit}`);
    const yanlis = arac(["coz", "--girdi", ara, "--cikti", d("yanlis.tar"), "--anahtar", d("ozel/anahtar-katmani.tkkey"), "--parola-stdin"], "yanlis-parola-1234\n");
    kontrol("§2c yanlış yedek parolası iç katmanı açmaz (çıkış 2)", yanlis.kod === 2, `${yanlis.kod}`);
    const disAl = arac(["dogrula", "--girdi", path.join(y1, arsiv)]).cikti;
    const icAl = arac(["dogrula", "--girdi", ara]).cikti;
    kontrol("§2d dış katman alıcıları olağan iki alıcı; iç katmanınki yalnız anahtar-katmani", /satici-uretim-mac/.test(disAl) && /satici-uretim-kurtarma/.test(disAl) && !/anahtar-katmani/.test(disAl) && /anahtar-katmani/.test(icAl) && !/satici-uretim/.test(icAl), `${disAl.split("\n")[1]?.trim() ?? ""} | ${icAl.split("\n")[1]?.trim() ?? ""}`);

    console.log("§3 katman alıcısı yok");
    rmSync(d("alici/anahtar-katmani/anahtar-katmani.tkpub"));
    const y3 = d("yedek3");
    const t3 = tur(y3);
    const d3 = readdirSync(y3);
    kontrol("§3a DB dökümü alındı, anahtar arşivi ALINMADI (tek katman da yok)", d3.some((f) => /\.dump\.tkenc$/.test(f)) && !d3.some((f) => f.startsWith("anahtarlar_")) && !d3.some((f) => f.endsWith(".part")), d3.join(","));
    kontrol("§3b tur çıkışı ≠ 0 ve günlükte katman HATA satırı", t3.kod !== 0 && /HATA: anahtar katmanı alıcısı yok/.test(t3.cikti), `${t3.kod}`);
    kontrol("§3c anahtar dosyalarının düz baytı yedek dizininde YOK", dizindeIsaret(y3).length === 0);

    console.log("§4 parola hijyeni");
    const hepsi = [t1.argv, t1.cikti, t3.cikti].join("\n");
    const dizinler = [y1, y3].flatMap((y) => readdirSync(y).map((f) => path.join(y, f)));
    kontrol("§4a yedek parolası betik argv'sinde, çıktısında ve yedek dosyalarında yok", !hepsi.includes(PAROLA) && !dizinler.some((f) => readFileSync(f).includes(PAROLA)));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main();
console.log(kirmizi === 0 ? "\nSONUÇ: YEŞİL" : `\nSONUÇ: ${kirmizi} KIRMIZI`);
process.exit(kirmizi === 0 ? 0 : 1);
