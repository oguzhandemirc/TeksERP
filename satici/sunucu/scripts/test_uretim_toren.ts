// =============================================================================
// ÜRETİM SATICISI ANAHTAR TÖRENİ (deploy/satici/uretim-toren.mjs) — geçici dizinde uçtan uca, DB'siz.
//   §1 tören: kök (bütün sınıflar) · ALT · İNDİRME köke karşı geçerli (KeyStore) · üç sunucu sırrı · PAKET adımı
//      (saplama PAKET aracı: törenin stdin'inde KALAN satırları alır, kök parolasını ALMAZ) · modül anahtarı · iki yedek
//      alıcısı sınama dosyasını ve kurtarma arşivini açar (kurtarma anahtarı KÖK parolasıyla) · izinler 700/600 ·
//      künye/BENIOKU/ekran çıktısında sır YOK · `~/.tekserp`e dokunulmaz · parola hiçbir sürecin argv/env'inde görünmez ·
//      `dogrula` izin bozulmasını yakalar
//   §2 usb-kopyala: yalnız künyedeki şifreli/açık küme, özetler aynı, düz sır USB'ye GİRMEZ, hiçbir şey üretmez,
//      aynı USB'ye ikinci kez yazmaz, künyeyle uyuşmayan kaynağı kopyalamaz
//   §3 RED (hedefe hiçbir şey yazılmadan): hedef VAR · argv'de parola · ortamdaki parola kullanılmaz · zayıf ·
//      eşleşmeyen · yarım kalıntı · tanınmayan bayrak · PAKET aracı parolasız dosya üretirse · ortada düşen adım ·
//      TOCTOU: yolda sembolik bağ · parola beklerken yarım yola konan bağ · parola beklerken doğan BOŞ hedef dizini
//      (ezilmez) · grup/başkalarına açık üst dizin
//   §4 GERÇEK PAKET aracı (varsayılan PAKET_KOMUTU): tören onunla uçtan uca; araç ön yoklamada çökerse KIRMIZI
//      (atlama yok — eksik modül/önkoşul da çökmedir, "atlandı" gerçek bir kırılmayı örter)
//   §6 DÖNEM TÖRENİ (`donem`, G4 §2.4): yeni ALT · ara imzacı · İNDİRME (395 gün = yıllık + 30 örtüşme; ekranda sonraki tören = en erken bitiş − 30) + iptal belgesi (ilk dönem sıra 1,
//      `--iptal` ile sıra + 1 ve önceki satırlar) + kuyruktaki HAK'ların kök imzası → KÖKSÜZ VDS paketi (künye + SHA256SUMS,
//      700/600); paketin anahtarları köke karşı geçerli; ara parolası kökünkinden ayrı; ilk tören dizini dokunulmaz;
//      RED (paket yazılmadan): ara = kök parolası · yanlış kök parolası · eşleşmeyen ara · bilinmeyen/kök --iptal ·
//      biçimsiz kuyruk · argv'de parola
//   §7 TEK KİP: hazırlık kökü doğmaz — `kok-uret --kid=hazirlik-<yıl>-1` biçim düzeyinde RED, dizine dosya yazılmaz ·
//      ⭐ dönem töreni `hazirlik-*` kök dosyasıyla parola sorulmadan RED (dönem dizini doğmaz) · eski `--karsi-dizin` RED
//   §1o' · §6k' CF Worker İNDİRME satırı (L2-8): künyedeki tek satır JSON = sertifikanın kid · x · penceresi + güncelleme
//      grupları (`deploy/dagitim.json`), liste adı `CF_WORKER_LISTESI` = `uretim`; Worker'ın `ayarCoz`u satırı kabul eder · §1o'' · §6k''
//      "Sonraki adımlar"da CF Worker adımı VDS'e kurmadan ÖNCE (satıcı yeni İNDİRME'yi yüklendiği dakika basar)
//   §5 KAYNAK (parola sorulmadan RED): kirli ağaç (izlenen değişiklik · izlenmeyen dosya) · HEAD origin/main'de değil ·
//      etiket başka commit'i gösteriyor · npm ls hatalı; origin/main'deki HEAD etiketsiz GEÇER; künye tam sha + kilit özetleri
//   Tören her koşumda TEMİZ bir kopyadan koşar (çalışma ağacının izlenen + izlenmeyen dosyaları → geçici git deposu,
//   yerel `toren-sonda` etiketi; node_modules kopya — npm ls bağlı node_modules'ü "extraneous" sayar).
// ⭐ KALICI SONDA ✓K5 (her koşumda): süreç yüzeyi okuyucusu KÖR DEĞİL — parolayı argv'de ve env'de taşıyan kukla
//    süreçlerde BULUR (§0a · §0b) · temiz + etiketli kopyada tören GEÇER (§0c · §1q — kaynak kapısı kör RED değil) ·
//    origin/main'deki HEAD etiketsiz geçer (§5e) · araya giren bağ/dizin sondası gerçekten ARAYA girer (§3k · §3l).
// Koşum: node ../../scripts/agir-is.mjs -- npx tsx scripts/test_uretim_toren.ts   (DB GEREKMEZ; Teks-Erp npm ci ister)
// =============================================================================
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { LICENSE_CLASSES, parseModuleKeyFile } from "../src/lisans-protokol";
import { KeyFileError, passwordBuffer, readWrappedKeyFile, unwrapPrivateKey } from "../src/keys/key-files";
import { KeyStore } from "../src/keys/key-store";
import { loadServerSecrets } from "../src/keys/server-secrets";
import { SATICI_KOKU, kontrol, sonuc } from "./lib/test-ortam";

const REPO = path.resolve(SATICI_KOKU, "..", "..");
const TEKS = path.join(REPO, "Teks-Erp");
/** Törenin temiz kopyası (§0b kurar): tören kendi deposunun temizliğini ve etiketini ölçer. */
let KLON = "";
let TOREN = "";
const ETIKET = "toren-sonda";
const ET = `--etiket=${ETIKET}`;
/** Kopyaya giren yollar: törenin koşturduğu araçlar + onların kaynakları (kök `scripts/lib`: PAKET aracı oradan import eder). */
const KLON_YOLLARI = [".gitignore", "deploy/satici", "deploy/kanallar.json", "deploy/dagitim.json", "scripts/lib", "satici/sunucu", "Teks-Erp/src", "Teks-Erp/scripts", "Teks-Erp/package.json", "Teks-Erp/package-lock.json", "Teks-Erp/tsconfig.json"];
const gitK = (args: string[]) => spawnSync("git", ["-C", KLON, "-c", "user.name=bekci", "-c", "user.email=bekci@ornek.test", ...args], { encoding: "utf8" });

/**
 * Çalışma ağacının (izlenen + izlenmeyen, yok sayılmayan) dosyaları → geçici git deposu, tek commit + yerel etiket.
 * node_modules KOPYALANIR (APFS/reflink): bağlı node_modules'ü npm ls "extraneous" sayar, tören npm ls ister.
 */
function klonKur(tmp: string): void {
  KLON = path.join(tmp, "klon");
  const dosyalar = execFileSync("git", ["-C", REPO, "ls-files", "-z", "-co", "--exclude-standard", "--", ...KLON_YOLLARI], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean);
  for (const f of dosyalar) {
    const kaynak = path.join(REPO, f);
    if (!existsSync(kaynak) || lstatSync(kaynak).isDirectory()) continue;
    mkdirSync(path.dirname(path.join(KLON, f)), { recursive: true });
    cpSync(kaynak, path.join(KLON, f), { verbatimSymlinks: true });
  }
  for (const nm of ["satici/sunucu/node_modules", "Teks-Erp/node_modules"]) {
    const r = spawnSync("cp", process.platform === "darwin" ? ["-Rc", path.join(REPO, nm), path.join(KLON, nm)] : ["-R", "--reflink=auto", path.join(REPO, nm), path.join(KLON, nm)], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`node_modules kopyalanamadı (${nm}): ${r.stderr}`);
  }
  for (const args of [["init", "-q"], ["add", "-A"], ["commit", "-q", "-m", "tören sondası"], ["tag", ETIKET]]) {
    const r = gitK(args);
    if (r.status !== 0) throw new Error(`klon git ${args[0]}: ${r.stderr}`);
  }
  TOREN = path.join(KLON, "deploy", "satici", "uretim-toren.mjs");
}
/** `a` metni `b`den önce geçiyor mu (ikisi de var)? — törenin "Sonraki adımlar" sırası. */
function sonra(metin: string, a: string, b: string): boolean {
  const i = metin.indexOf("Sonraki adımlar");
  const ia = metin.indexOf(a, i);
  const ib = metin.indexOf(b, i);
  return i >= 0 && ia >= 0 && ib >= 0 && ia < ib;
}

/**
 * Künyenin CF Worker satırı Worker'ın İNDİRME listesine olduğu gibi yapıştırılabilir mi: tek satır JSON, alanları
 * künyedeki sertifikayla aynı, kanallar güncelleme grupları (`deploy/dagitim.json`), liste `uretim`, Worker `ayarCoz` kabul eder.
 */
async function workerSatiriOlc(
  satirlar: Record<string, string>,
  ind: { kid: string; x: string; baslangic?: string; bitis?: string },
): Promise<{ ok: boolean; detay: string }> {
  const liste = "uretim";
  const w = (await import(pathToFileURL(path.join(REPO, "deploy/guncelleme-sunucusu/worker/indirme-kapisi.js")).href)) as {
    ayarCoz: (ham: unknown, simdiMs: number) => { ok: boolean; neden?: string };
    VARSAYILAN_AYAR: Record<string, unknown>;
  };
  const kanallar = (JSON.parse(readFileSync(path.join(REPO, "deploy/dagitim.json"), "utf8")) as { gruplar: { kod: string }[] }).gruplar.map((g) => g.kod);
  let satir: Record<string, unknown> | null = null;
  try {
    satir = JSON.parse(satirlar.CF_WORKER_INDIRME ?? "") as Record<string, unknown>;
  } catch {
    return { ok: false, detay: `satır JSON değil: ${satirlar.CF_WORKER_INDIRME}` };
  }
  const beklenen = { kid: ind.kid, x: ind.x, kanallar, baslangic: ind.baslangic, bitis: ind.bitis };
  const ayni = JSON.stringify(satir) === JSON.stringify(beklenen) && !satirlar.CF_WORKER_INDIRME!.includes("\n");
  const cozum = w.ayarCoz({ ...w.VARSAYILAN_AYAR, indirmeListesi: { [liste]: [satir] } }, Date.now());
  return {
    ok: kanallar.length > 0 && satirlar.CF_WORKER_LISTESI === liste && ayni && cozum.ok,
    detay: `liste ${satirlar.CF_WORKER_LISTESI} · kanallar ${kanallar.join(",")} · ${ayni ? "alanlar aynı" : `FARK ${satirlar.CF_WORKER_INDIRME}`} · Worker ${cozum.ok ? "kabul" : cozum.neden}`,
  };
}

const YIL = "2099";
const KOK_PAROLA = `kok-sonda-${randomBytes(9).toString("hex")}`;
const PAKET_PAROLA = `paket-sonda-${randomBytes(9).toString("hex")}`;
const ARA_PAROLA = `ara-sonda-${randomBytes(9).toString("hex")}`;
const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ozet = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/**
 * Saplama PAKET aracı: gerçek aracın sözleşmesi — stdin'den iki satır (yeni + tekrar, ≥ 12, eşit), {dizin}/{kid}.paket.json
 * (0600, üstüne yazmaz) `kid` + `x` taşır, `--json` ile stdout'a tek satır özet. Aldığı parolanın ÖZETİNİ yazar: tören hangi
 * satırı geçirdi ölçülsün.
 */
const SAPLAMA = `import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto";
const a = new Map(process.argv.slice(2).map((x) => { const m = /^--([a-z]+)(?:=(.*))?$/.exec(x); return [m[1], m[2] ?? ""]; }));
const parcalar = []; for await (const p of process.stdin) parcalar.push(p);
const [p1 = "", p2 = ""] = Buffer.concat(parcalar).toString("utf8").split("\\n");
if (p1 !== p2 || [...p1].length < 12) { console.error("✖ saplama: parola eşleşmedi ya da kısa"); process.exit(2); }
if (a.get("kip") === "coker") await import("./yok-olan-modul-sonda.mjs");
const { privateKey } = crypto.generateKeyPairSync("ed25519"); const j = privateKey.export({ format: "jwk" });
const govde = { tur: "tekserp-paket-anahtar", surum: 2, kid: a.get("kid"), x: j.x, sarili: { ad: a.get("kid"), ozet: crypto.createHash("sha256").update(p1, "utf8").digest("hex") } };
if (a.get("kip") === "parolasiz") govde.d = j.d;
const dosya = path.join(a.get("dizin"), a.get("kid") + ".paket.json");
if (a.get("kip") !== "dosyasiz") fs.writeFileSync(dosya, JSON.stringify(govde) + "\\n", { mode: 0o600, flag: "wx" });
const ozetX = a.get("kip") === "yalanci" ? crypto.randomBytes(32).toString("base64url") : j.x;
if (a.has("json")) console.log(JSON.stringify({ v: 1, kid: a.get("kid"), x: ozetX, dosya, parolali: a.get("kip") !== "parolasiz" }));
`;

interface Kosum {
  status: number | null;
  cikti: string;
  parolaGoruldu: boolean;
  yoklama: number;
}

/** Bütün süreçlerin argv + env yüzeyi (Linux /proc; macOS `ps -E`). Yalnız aynı kullanıcının süreçleri okunur. */
function surecYuzeyi(): string {
  if (process.platform === "linux") {
    const parcalar: string[] = [];
    for (const pid of readdirSync("/proc").filter((p) => /^\d+$/.test(p))) {
      for (const f of ["cmdline", "environ"]) {
        try {
          parcalar.push(readFileSync(`/proc/${pid}/${f}`).toString("utf8").replace(/\0/g, " "));
        } catch {
          // başka kullanıcının süreci ya da süreç bitti
        }
      }
    }
    return parcalar.join("\n");
  }
  return execFileSync("ps", ["-A", "-E", "-ww", "-o", "command="], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

/**
 * Töreni gerçek alt süreçte koşar; koşum boyunca süreç yüzeyinde parolayı arar. `araya`: tören parola BEKLERKEN
 * (`[2/` satırı basıldı, stdin açık) koşar — sonra parolalar yazılır (TOCTOU sondası).
 */
async function tore(argv: string[], stdin: string, ekOrtam: Record<string, string> = {}, ev?: string, araya?: (pid: number) => void): Promise<Kosum> {
  const cocuk = spawn(process.execPath, [TOREN, ...argv], {
    cwd: KLON,
    env: { ...process.env, ...(ev ? { HOME: ev } : {}), ...ekOrtam },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let cikti = "";
  cocuk.stdout.on("data", (c: Buffer) => (cikti += c.toString("utf8")));
  cocuk.stderr.on("data", (c: Buffer) => (cikti += c.toString("utf8")));
  if (araya) {
    const son = Date.now() + 60_000;
    while (!/\[2\/\d+\]/.test(cikti) && cocuk.exitCode === null && Date.now() < son) await bekle(20);
    if (/\[2\/\d+\]/.test(cikti)) araya(cocuk.pid!);
  }
  cocuk.stdin.end(stdin);
  let bitti = false;
  let status: number | null = null;
  const kapandi = new Promise<void>((resolve) =>
    cocuk.on("close", (s) => {
      status = s;
      bitti = true;
      resolve();
    }),
  );
  let parolaGoruldu = false;
  let yoklama = 0;
  while (!bitti) {
    const y = surecYuzeyi();
    yoklama++;
    if (y.includes(KOK_PAROLA) || y.includes(PAKET_PAROLA) || y.includes(ARA_PAROLA)) parolaGoruldu = true;
    await Promise.race([kapandi, bekle(60)]);
  }
  await kapandi;
  return { status, cikti, parolaGoruldu, yoklama };
}

const iki = (a: string, b: string) => `${a}\n${a}\n${b}\n${b}\n`;
const dosyaListesi = (kok: string, alt = ""): string[] =>
  readdirSync(path.join(kok, alt), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? dosyaListesi(kok, alt ? `${alt}/${e.name}` : e.name) : [alt ? `${alt}/${e.name}` : e.name]));
const yedek = (argv: string[], input = "") => spawnSync(process.execPath, ["--import", "tsx", "scripts/yedek-sifrele.ts", ...argv], { cwd: TEKS, encoding: "utf8", input, timeout: 60_000 });
const mod = (p: string) => statSync(p).mode & 0o777;

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "uretim-toren-"));
  const ev = path.join(tmp, "ev");
  mkdirSync(ev);
  const saplama = path.join(tmp, "paket-saplama.mjs");
  writeFileSync(saplama, SAPLAMA);
  const paketBayragi = (kip = "normal") => `--paket-komutu=${saplama} --kid={kid} --dizin={dizin} --kip=${kip} --json`;
  const gercekEv = path.join(os.homedir(), ".tekserp", "satici-uretim");
  const gercekEvOnce = existsSync(gercekEv) ? statSync(gercekEv).mtimeMs : null;
  const D = path.join(tmp, "satici-uretim");
  const A = path.join(D, "anahtarlar");
  try {
    console.log("\n§0 ✓K süreç yüzeyi okuyucusu kör değil");
    const sonda = `yuzey-sonda-${randomBytes(8).toString("hex")}`;
    const kuklaArgv = spawn(process.execPath, ["-e", "setTimeout(()=>{},4000)", sonda], { stdio: "ignore" });
    const kuklaEnv = spawn(process.execPath, ["-e", "setTimeout(()=>{},4000)"], { stdio: "ignore", env: { ...process.env, SONDA_PAROLA: sonda } });
    await bekle(400);
    const yuzey = surecYuzeyi();
    kontrol("§0a parolayı argv'de taşıyan süreçte okuyucu BULUR", yuzey.includes(`setTimeout(()=>{},4000) ${sonda}`));
    kontrol("§0b parolayı env'de taşıyan süreçte okuyucu BULUR", yuzey.includes(`SONDA_PAROLA=${sonda}`));
    kuklaArgv.kill();
    kuklaEnv.kill();

    console.log("\n§0b törenin temiz kopyası (izlenen + izlenmeyen dosyalar, yerel etiket, node_modules kopya)");
    klonKur(tmp);
    const klonHead = gitK(["rev-parse", "HEAD"]).stdout.trim();
    kontrol("§0c kopya TEMİZ (git status boş) ve etiket HEAD'i gösteriyor", gitK(["status", "--porcelain", "--untracked-files=all"]).stdout === "" && gitK(["rev-parse", `${ETIKET}^{commit}`]).stdout.trim() === klonHead && /^[0-9a-f]{40}$/.test(klonHead), klonHead.slice(0, 12));

    console.log("\n§1 tören uçtan uca (geçici dizin, stdin parolaları, saplama PAKET aracı)");
    const t = await tore([`--dizin=${D}`, `--yil=${YIL}`, ET, paketBayragi()], iki(KOK_PAROLA, PAKET_PAROLA), {}, ev);
    kontrol("§1a tören çıkış 0, hedef dizin doğdu, yarım dizin kalmadı", t.status === 0 && existsSync(D) && !readdirSync(tmp).some((n) => n.includes(".yarim-")), `${t.status} ${t.status === 0 ? "" : t.cikti.slice(-400)}`);
    if (t.status !== 0) {
      rmSync(tmp, { recursive: true, force: true });
      sonuc();
    }
    const beklenen = [
      "BENIOKU.md",
      "TOREN-KUNYE.json",
      `anahtarlar/alt-${YIL}-1.anahtar.json`,
      "anahtarlar/etkinlestirme-kodu.pepper",
      `anahtarlar/ind-${YIL}.anahtar.json`,
      `anahtarlar/kok-${YIL}-1.kok.json`,
      "anahtarlar/modul-kasasi.key",
      "anahtarlar/portal-totp.key",
      "kurtarma/sirlar.tar.tkenc",
      "modul-anahtarlari/depo.multiEnabled.1.json",
      `paket/paket-${YIL}.paket.json`,
      "yedek-alici/satici-uretim-kurtarma.tkpub",
      "yedek-alici/satici-uretim-mac.tkpub",
      "yedek-ozel/satici-uretim-kurtarma.tkkey",
      "yedek-ozel/satici-uretim-mac.txt",
      "yedek-sinama.txt.tkenc",
    ];
    const gercek = dosyaListesi(D).sort();
    kontrol("§1b dizin düzeni tam olarak beklenen küme (düz sınama/tar kalıntısı yok)", JSON.stringify(gercek) === JSON.stringify(beklenen), gercek.join(" "));
    const kotuIzin = [
      ...["", "anahtarlar", "paket", "modul-anahtarlari", "yedek-alici", "yedek-ozel", "kurtarma"].filter((d) => mod(path.join(D, d)) !== 0o700),
      ...gercek.filter((f) => mod(path.join(D, f)) !== 0o600),
    ];
    kontrol("§1c izinler: dizinler 700, dosyalar 600", kotuIzin.length === 0, kotuIzin.join(" "));
    kontrol("§1d ev dizininin gerçek ~/.tekserp/satici-uretim'ine dokunulmadı; alt süreçler ev dizinine .tekserp yazmadı",
      (existsSync(gercekEv) ? statSync(gercekEv).mtimeMs : null) === gercekEvOnce && !existsSync(path.join(ev, ".tekserp")));

    const k = JSON.parse(readFileSync(path.join(D, "TOREN-KUNYE.json"), "utf8")) as {
      kok: { kid: string; x: string; siniflar: string[] };
      alt: { kid: string; x: string; bitis: string };
      indirme: { kid: string; x: string; baslangic: string; bitis: string };
      paket: { kid: string; x: string };
      modulAnahtarlari: Array<{ modul: string; kid: string }>;
      yedekAlicilari: Array<{ ad: string; parmakIzi: string }>;
      capaSatirlari: Record<string, string>;
      ozetler: Record<string, string>;
      usb: string[];
    };
    const kok = readWrappedKeyFile(path.join(A, `kok-${YIL}-1.kok.json`));
    const kokAcik = await unwrapPrivateKey(kok, passwordBuffer(KOK_PAROLA)).then(
      (raw) => {
        raw.fill(0);
        return true;
      },
      () => false,
    );
    let yanlisKod = "";
    await unwrapPrivateKey(kok, passwordBuffer(PAKET_PAROLA)).catch((e: unknown) => (yanlisKod = e instanceof KeyFileError ? e.kind : "?"));
    kontrol("§1e KÖK: kök parolasıyla açılır, bütün sınıflar, künyeyle aynı açık yarı; paket parolasıyla YANLIS_PAROLA",
      kokAcik && yanlisKod === "YANLIS_PAROLA" && kok.kid === `kok-${YIL}-1` && JSON.stringify([...kok.siniflar].sort()) === JSON.stringify([...LICENSE_CLASSES].sort()) && k.kok.x === kok.x);

    const capa = path.join(tmp, "capa.json");
    writeFileSync(capa, JSON.stringify([{ kid: kok.kid, x: kok.x, classes: kok.siniflar }]));
    const ks = KeyStore.load({ ANAHTAR_DIZINI: A, GUVEN_CAPASI_DOSYASI: capa });
    const alt = ks.leaseKeyFor("URETIM", Date.now());
    const ind = ks.downloadKey(Date.now());
    kontrol("§1f ALT + İNDİRME sertifikaları köke karşı geçerli (KeyStore: uyarı yok, URETIM kira anahtarı + indirme anahtarı)",
      alt?.kid === `alt-${YIL}-1` && ind?.kid === `ind-${YIL}` && ks.warnings.filter((w) => !w.startsWith("Güven çapası DOSYADAN")).length === 0 && alt.x === k.alt.x && ind.x === k.indirme.x,
      ks.warnings.join(" | "));
    let sirlar = true;
    try {
      loadServerSecrets(A);
    } catch {
      sirlar = false;
    }
    kontrol("§1g üç sunucu sırrı salt okunur yükleyiciyle açılır", sirlar);

    const paketJson = JSON.parse(readFileSync(path.join(D, "paket", `paket-${YIL}.paket.json`), "utf8")) as { kid?: string; x?: string; d?: unknown; sarili?: { ozet?: string } };
    kontrol("§1h ⭐ PAKET adımı: araç YALNIZ kalan stdin satırlarını (paket parolası) aldı — kök parolası geçmedi; dosya kid + x taşır, künyeyle aynı",
      paketJson.sarili?.ozet === ozet(PAKET_PAROLA) && paketJson.sarili?.ozet !== ozet(KOK_PAROLA) && paketJson.kid === `paket-${YIL}` && paketJson.x === k.paket.x && paketJson.d === undefined);

    const mk = parseModuleKeyFile(JSON.parse(readFileSync(path.join(D, "modul-anahtarlari", "depo.multiEnabled.1.json"), "utf8")));
    kontrol("§1i modül anahtarı biçimli, kimliği künyede", !!mk && mk.modul === "depo.multiEnabled" && k.modulAnahtarlari[0]?.kid === mk.kid);
    mk?.anahtar.fill(0);

    const sinama = path.join(D, "yedek-sinama.txt.tkenc");
    const macD = yedek(["dogrula", "--girdi", sinama, "--anahtar", path.join(D, "yedek-ozel", "satici-uretim-mac.txt")]);
    const kurD = yedek(["dogrula", "--girdi", sinama, "--anahtar", path.join(D, "yedek-ozel", "satici-uretim-kurtarma.tkkey"), "--parola-stdin"], `${KOK_PAROLA}\n`);
    const kurY = yedek(["dogrula", "--girdi", sinama, "--anahtar", path.join(D, "yedek-ozel", "satici-uretim-kurtarma.tkkey"), "--parola-stdin"], `${PAKET_PAROLA}\n`);
    kontrol("§1j sınama dosyası: Mac anahtarı + kurtarma anahtarı (KÖK parolasıyla) açar; paket parolası açamaz (çıkış 2)",
      macD.status === 0 && kurD.status === 0 && /butunluk TAMAM/.test(macD.stdout + kurD.stdout) && kurY.status === 2, `${macD.status}/${kurD.status}/${kurY.status}`);
    const tarYolu = path.join(tmp, "sirlar.tar");
    const coz = yedek(["coz", "--girdi", path.join(D, "kurtarma", "sirlar.tar.tkenc"), "--cikti", tarYolu, "--anahtar", path.join(D, "yedek-ozel", "satici-uretim-kurtarma.tkkey"), "--parola-stdin"], `${KOK_PAROLA}\n`);
    const tarIcerik = coz.status === 0 ? execFileSync("tar", ["-tf", tarYolu], { encoding: "utf8" }) : "";
    kontrol("§1k kurtarma arşivi kök parolasıyla açılır: anahtarlar + paket + modül anahtarları içinde",
      [`anahtarlar/alt-${YIL}-1.anahtar.json`, "anahtarlar/modul-kasasi.key", `paket/paket-${YIL}.paket.json`, "modul-anahtarlari/depo.multiEnabled.1.json"].every((f) => tarIcerik.includes(f)),
      `${coz.status} ${coz.stderr.trim().slice(0, 100)}`);
    rmSync(tarYolu, { force: true });

    // Sır malzemesi: düz dosyaların içeriği, ALT/İNDİRME özel yarısı, modül anahtarı, yedek özel satırı, parolalar.
    const sirMetinleri = [
      KOK_PAROLA,
      PAKET_PAROLA,
      ...["portal-totp.key", "etkinlestirme-kodu.pepper", "modul-kasasi.key"].map((f) => readFileSync(path.join(A, f), "utf8").trim()),
      (JSON.parse(readFileSync(path.join(A, `alt-${YIL}-1.anahtar.json`), "utf8")) as { d: string }).d,
      (JSON.parse(readFileSync(path.join(A, `ind-${YIL}.anahtar.json`), "utf8")) as { d: string }).d,
      (JSON.parse(readFileSync(path.join(D, "modul-anahtarlari", "depo.multiEnabled.1.json"), "utf8")) as { anahtar: string }).anahtar,
      readFileSync(path.join(D, "yedek-ozel", "satici-uretim-mac.txt"), "utf8").split("\n").find((s) => s.startsWith("tksec1:")) ?? "tksec1-yok",
    ];
    const kunyeMetni = readFileSync(path.join(D, "TOREN-KUNYE.json"), "utf8") + readFileSync(path.join(D, "BENIOKU.md"), "utf8");
    const kunyeSizinti = sirMetinleri.filter((s) => s.length >= 16 && kunyeMetni.includes(s)).length;
    kontrol("§1l künye + BENIOKU sır taşımaz (düz dosya içerikleri · ALT/İND d · modül anahtarı · tksec1 · parolalar)", kunyeSizinti === 0 && sirMetinleri.every((s) => s.length >= 16), `${kunyeSizinti} sızıntı`);
    const ekranSizinti = sirMetinleri.filter((s) => t.cikti.includes(s)).length;
    kontrol("§1m ekran çıktısı sır taşımaz; kid + açık anahtar + parmak izi + sonraki adımı basar",
      ekranSizinti === 0 && [k.kok.x, k.paket.x, k.indirme.x, `kok-${YIL}-1`, `paket-${YIL}`, k.yedekAlicilari[0]!.parmakIzi, "usb-kopyala", "Sonraki adımlar"].every((s) => t.cikti.includes(s)),
      `${ekranSizinti} sızıntı`);
    kontrol("§1n ⭐ parola koşum boyunca HİÇBİR sürecin argv/env'inde görünmedi (tören + alt süreçler)", !t.parolaGoruldu && t.yoklama >= 5, `${t.yoklama} yoklama`);
    const kay = (k as unknown as { kaynak?: { commit?: string; dayanak?: string; kirli?: boolean; kilitler?: Record<string, string>; npmLs?: string } }).kaynak ?? {};
    const kilitOzeti = (f: string) => createHash("sha256").update(readFileSync(path.join(KLON, f))).digest("hex");
    kontrol(
      "§1q künye kaynağı: TAM HEAD sha · dayanak etiket · temiz · iki package-lock özeti (kopyanınkiyle aynı) · npm ls hatasız; ekranda kilit satırları",
      kay.commit === klonHead &&
        kay.dayanak === `etiket:${ETIKET}` &&
        kay.kirli === false &&
        kay.npmLs === "hatasız" &&
        kay.kilitler?.["satici/sunucu/package-lock.json"] === kilitOzeti("satici/sunucu/package-lock.json") &&
        kay.kilitler?.["Teks-Erp/package-lock.json"] === kilitOzeti("Teks-Erp/package-lock.json") &&
        t.cikti.includes(`kaynak : ${klonHead}`) &&
        (t.cikti.match(/kilit {2}: .*package-lock\.json sha256 [0-9a-f]{64}/g) ?? []).length === 2,
      JSON.stringify(kay).slice(0, 160),
    );
    kontrol("§1o künye çapa satırları: kök (bütün sınıflar) · paket · CF Worker İNDİRME",
      k.capaSatirlari.ROOT_PUBLIC_KEYS!.includes(k.kok.x) && k.capaSatirlari.PACKAGE_PUBLIC_KEYS!.includes(`paket-${YIL}`) && k.capaSatirlari.CF_WORKER_INDIRME!.includes(k.indirme.x));
    const w1 = await workerSatiriOlc(k.capaSatirlari, k.indirme);
    kontrol("§1o' ⭐ CF Worker satırı (L2-8): liste `uretim`, kid · x · pencere künyedeki sertifikanın, kanallar = güncelleme grupları (dagitim.json); Worker ayarı onu KABUL eder",
      w1.ok, w1.detay);
    kontrol("§1o'' Sonraki adımlar: CF Worker adımı VDS adımından ÖNCE (satıcı yüklendiği an basar)", sonra(t.cikti, "CF Worker", "VDS: anahtar birimi"));

    const dogru = spawnSync(process.execPath, [TOREN, "dogrula", `--dizin=${D}`], { encoding: "utf8" });
    chmodSync(path.join(A, "portal-totp.key"), 0o644);
    const bozuk = spawnSync(process.execPath, [TOREN, "dogrula", `--dizin=${D}`], { encoding: "utf8" });
    chmodSync(path.join(A, "portal-totp.key"), 0o600);
    kontrol("§1p `dogrula`: temiz dizinde 0; izni gevşetilmiş sırda 1 (dosya adını söyler)", dogru.status === 0 && bozuk.status === 1 && /portal-totp\.key izni 644/.test(bozuk.stdout), `${dogru.status}/${bozuk.status}`);

    console.log("\n§2 usb-kopyala (hiçbir şey üretmez)");
    const usb = path.join(tmp, "usb");
    mkdirSync(usb);
    const oncekiOzet = JSON.stringify(dosyaListesi(D).map((f) => [f, statSync(path.join(D, f)).mtimeMs]));
    const u = spawnSync(process.execPath, [TOREN, "usb-kopyala", `--dizin=${D}`, `--usb=${usb}`], { encoding: "utf8" });
    const U = path.join(usb, "tekserp-satici-uretim");
    const usbDosyalari = existsSync(U) ? dosyaListesi(U).sort() : [];
    kontrol("§2a USB'de TAM OLARAK künyedeki küme (kök · paket · kurtarma anahtarı · alıcılar · kurtarma arşivi · sınama · künye · BENIOKU)",
      u.status === 0 && JSON.stringify(usbDosyalari) === JSON.stringify([...k.usb].sort()), `${u.status} ${usbDosyalari.join(" ")} ${u.stderr.trim().slice(0, 120)}`);
    const esit = usbDosyalari.every((f) => readFileSync(path.join(U, f)).equals(readFileSync(path.join(D, f))));
    kontrol("§2b USB kopyaları kaynakla bayt-eşit", esit && usbDosyalari.length > 0);
    const usbMetni = usbDosyalari.map((f) => readFileSync(path.join(U, f)).toString("latin1")).join("\n");
    const usbSizinti = sirMetinleri.filter((s) => usbMetni.includes(s)).length;
    const duzSir = usbDosyalari.filter((f) => /\.anahtar\.json$|\.key$|\.pepper$|^modul-anahtarlari\/|yedek-ozel\/.*\.txt$/.test(f));
    kontrol("§2c ⭐ USB'ye düz sır GİRMEZ (ALT/İND · sunucu sırları · modül · Mac özel yarısı yok; içerikte sır baytı yok)", usbSizinti === 0 && duzSir.length === 0, `${usbSizinti} · ${duzSir.join(" ")}`);
    const sonrakiOzet = JSON.stringify(dosyaListesi(D).map((f) => [f, statSync(path.join(D, f)).mtimeMs]));
    kontrol("§2d usb-kopyala tören dizininde hiçbir şey üretmez/değiştirmez", oncekiOzet === sonrakiOzet);
    const u2 = spawnSync(process.execPath, [TOREN, "usb-kopyala", `--dizin=${D}`, `--usb=${usb}`], { encoding: "utf8" });
    kontrol("§2e aynı USB'ye ikinci kopya RED (üstüne yazmaz)", u2.status === 2 && /zaten var/.test(u2.stderr));
    const D2 = path.join(tmp, "satici-uretim-kurcali");
    cpSync(D, D2, { recursive: true });
    writeFileSync(path.join(D2, "paket", `paket-${YIL}.paket.json`), "{}\n", { mode: 0o600 });
    const usb2 = path.join(tmp, "usb2");
    mkdirSync(usb2);
    const u3 = spawnSync(process.execPath, [TOREN, "usb-kopyala", `--dizin=${D2}`, `--usb=${usb2}`], { encoding: "utf8" });
    kontrol("§2f künyeyle uyuşmayan kaynak kopyalanmaz (USB'de klasör bile doğmaz)", u3.status === 1 && /künyeyle uyuşmuyor/.test(u3.stderr) && readdirSync(usb2).length === 0, `${u3.status}`);

    console.log("\n§3 RED — hedefe hiçbir şey yazılmadan");
    const H = path.join(tmp, "hedef-yok");
    const temiz = () => !existsSync(H) && !readdirSync(tmp).some((n) => n.startsWith("hedef-yok.yarim-"));
    const var_ = await tore([`--dizin=${D}`, `--yil=${YIL}`, ET, paketBayragi()], iki(KOK_PAROLA, PAKET_PAROLA), {}, ev);
    kontrol("§3a hedef VAR → çıkış 2, dokunulmadı (özetler künyeyle aynı)", var_.status === 2 && /zaten var/.test(var_.cikti) && spawnSync(process.execPath, [TOREN, "dogrula", `--dizin=${D}`]).status === 0);
    const argv = await tore([`--dizin=${H}`, `--kok-parolasi=${KOK_PAROLA}`], "", {}, ev);
    kontrol("§3b argv'de parola → çıkış 2, değer basılmadı", argv.status === 2 && /argümandan ALINMAZ/.test(argv.cikti) && !argv.cikti.includes(KOK_PAROLA) && temiz());
    const env = await tore([`--dizin=${H}`, `--yil=${YIL}`, ET, paketBayragi()], "", { KOK_PAROLASI: KOK_PAROLA, TOREN_PAROLA: KOK_PAROLA, PAKET_PAROLASI: PAKET_PAROLA }, ev);
    kontrol("§3c ortamdaki parola KULLANILMAZ (stdin boşken 'stdin bitti' ile durur)", env.status === 2 && /stdin bitti/.test(env.cikti) && temiz());
    const zayif = await tore([`--dizin=${H}`, `--yil=${YIL}`, ET, paketBayragi()], iki("kisa-parola", PAKET_PAROLA), {}, ev);
    kontrol("§3d zayıf kök parolası (<12) → çıkış 2", zayif.status === 2 && /en az 12/.test(zayif.cikti) && temiz());
    const farkli = await tore([`--dizin=${H}`, `--yil=${YIL}`, ET, paketBayragi()], `${KOK_PAROLA}\n${KOK_PAROLA}x\n${PAKET_PAROLA}\n${PAKET_PAROLA}\n`, {}, ev);
    kontrol("§3e eşleşmeyen tekrar → çıkış 2", farkli.status === 2 && /eşleşmedi/.test(farkli.cikti) && temiz());
    const parolasiz = await tore([`--dizin=${H}`, `--yil=${YIL}`, ET, paketBayragi("parolasiz")], iki(KOK_PAROLA, PAKET_PAROLA), {}, ev);
    const dosyasiz = await tore([`--dizin=${H}`, `--yil=${YIL}`, ET, paketBayragi("dosyasiz")], iki(KOK_PAROLA, PAKET_PAROLA), {}, ev);
    const yalanci = await tore([`--dizin=${H}`, `--yil=${YIL}`, ET, paketBayragi("yalanci")], iki(KOK_PAROLA, PAKET_PAROLA), {}, ev);
    kontrol("§3f PAKET aracı parolasız (ham d) dosya üretir, hiç dosya üretmez ya da --json özeti dosyayla uyuşmazsa → RED, yarım dizin silinir",
      parolasiz.status === 1 && /PAROLASIZ/.test(parolasiz.cikti) && dosyasiz.status === 1 && /beklenen dosyayı üretmedi/.test(dosyasiz.cikti) &&
        yalanci.status === 1 && /özeti dosyayla uyuşmuyor/.test(yalanci.cikti) && temiz(),
      `${parolasiz.status}/${dosyasiz.status}/${yalanci.status}`);
    const coker = await tore([`--dizin=${H}`, `--yil=${YIL}`, ET, paketBayragi("coker")], iki(KOK_PAROLA, PAKET_PAROLA), {}, ev);
    const cokerHata = /PAKET başarısız[^\n]*Cannot find module/.test(coker.cikti);
    kontrol("§3f2 PAKET aracı modül bulamayıp çökerse hata özeti asıl satırı (Cannot find module) gösterir — yalnız son 3 satır (Node.js vX) değil; hedef doğmaz",
      coker.status === 1 && cokerHata && !coker.parolaGoruldu && !existsSync(H), `${coker.status} ${coker.cikti.trim().split("\n").slice(-2).join(" / ").slice(0, 300)}`);
    const kalinti = path.join(tmp, "hedef-yok.yarim-12345");
    mkdirSync(kalinti);
    const yarim = await tore([`--dizin=${H}`, `--yil=${YIL}`, ET, paketBayragi()], iki(KOK_PAROLA, PAKET_PAROLA), {}, ev);
    rmSync(kalinti, { recursive: true });
    kontrol("§3g yarım tören dizini kalıntısı → çıkış 2 (sil ve yeniden başla)", yarim.status === 2 && /Yarım kalmış/.test(yarim.cikti) && !existsSync(H));
    const bilinmez = await tore([`--dizin=${H}`, "--kok-kid=kok-2099-9"], "", {}, ev);
    kontrol("§3h tanınmayan bayrak → çıkış 2", bilinmez.status === 2 && /Tanınmayan argüman/.test(bilinmez.cikti) && temiz());
    const uzun = `depo.${"a".repeat(70)}`;
    const ortada = await tore([`--dizin=${H}`, `--yil=${YIL}`, ET, `--moduller=${uzun}`, paketBayragi()], iki(KOK_PAROLA, PAKET_PAROLA), {}, ev);
    kontrol("§3i ⭐ ortada düşen adım (kök · ALT · İND · sırlar · PAKET üretildikten SONRA modül) → yarım dizin silinir, hedef doğmaz",
      ortada.status === 1 && /\[7\/10\] PAKET/.test(ortada.cikti) && /yarım dizin silindi/.test(ortada.cikti) && temiz() && !ortada.parolaGoruldu, `${ortada.status}`);

    console.log("\n§3 TOCTOU — yol ve araya girenler");
    const gercekUst = path.join(tmp, "gercek-ust");
    mkdirSync(gercekUst, { mode: 0o700 });
    symlinkSync(gercekUst, path.join(tmp, "bagli-ust"));
    const bagli = await tore([`--dizin=${path.join(tmp, "bagli-ust", "satici-uretim")}`, `--yil=${YIL}`, ET, paketBayragi()], iki(KOK_PAROLA, PAKET_PAROLA), {}, ev);
    kontrol("§3j yolda sembolik bağ (üst dizin bağ) → çıkış 2 parola SORULMADAN, bağın hedefine hiçbir şey yazılmadı", bagli.status === 2 && /sembolik bağ/.test(bagli.cikti) && !/\[2\/10\]/.test(bagli.cikti) && readdirSync(gercekUst).length === 0, `${bagli.status} ${bagli.cikti.trim().split("\n").pop()?.slice(0, 120)}`);
    const tuzak = path.join(tmp, "tuzak");
    mkdirSync(tuzak, { mode: 0o700 });
    let bagKondu = "";
    const yarimBag = await tore([`--dizin=${H}`, `--yil=${YIL}`, ET, paketBayragi()], iki(KOK_PAROLA, PAKET_PAROLA), {}, ev, (pid) => {
      bagKondu = `${H}.yarim-${pid}`;
      symlinkSync(tuzak, bagKondu);
    });
    const bagDurdu = bagKondu !== "" && lstatSync(bagKondu).isSymbolicLink();
    kontrol(
      "§3k ⭐ parola beklerken yarım yola konan sembolik bağ → RED (araya giren yol), bağın hedefine hiçbir şey yazılmadı, bağa dokunulmadı, hedef doğmadı",
      bagKondu !== "" && yarimBag.status === 1 && /Araya giren yol/.test(yarimBag.cikti) && readdirSync(tuzak).length === 0 && bagDurdu && !existsSync(H),
      `${yarimBag.status} · bağ ${bagKondu ? "kondu" : "KONAMADI"} · ${yarimBag.cikti.trim().split("\n").slice(-2).join(" / ").slice(0, 160)}`,
    );
    if (bagKondu) rmSync(bagKondu);
    let hedefKondu = false;
    const hedefYarisi = await tore([`--dizin=${H}`, `--yil=${YIL}`, ET, paketBayragi()], iki(KOK_PAROLA, PAKET_PAROLA), {}, ev, () => {
      mkdirSync(H, { mode: 0o700 });
      hedefKondu = true;
    });
    kontrol(
      "§3l ⭐ parola beklerken doğan BOŞ hedef dizini → tören sonunda RED, boş dizin EZİLMEDİ (hâlâ boş), yarım dizin silindi",
      hedefKondu && hedefYarisi.status === 1 && /Hedef tören sürerken doğdu/.test(hedefYarisi.cikti) && existsSync(H) && readdirSync(H).length === 0 && !readdirSync(tmp).some((n) => n.startsWith("hedef-yok.yarim-")),
      `${hedefYarisi.status} · ${hedefYarisi.cikti.trim().split("\n").slice(-2).join(" / ").slice(0, 160)}`,
    );
    rmSync(H, { recursive: true, force: true });
    const acikUst = path.join(tmp, "acik-ust");
    mkdirSync(acikUst);
    chmodSync(acikUst, 0o777);
    const acik = await tore([`--dizin=${path.join(acikUst, "satici-uretim")}`, `--yil=${YIL}`, ET, paketBayragi()], iki(KOK_PAROLA, PAKET_PAROLA), {}, ev);
    kontrol("§3m grup/başkalarına yazılabilir üst dizin → RED, içine hiçbir şey yazılmadı", acik.status === 2 && /grup\/başkaları yazabiliyor/.test(acik.cikti) && readdirSync(acikUst).length === 0, `${acik.status} ${acik.cikti.trim().split("\n").slice(-2).join(" / ").slice(0, 140)}`);

    console.log("\n§4 GERÇEK PAKET aracı (varsayılan PAKET_KOMUTU)");
    const yoklamaDizini = path.join(tmp, "paket-yoklama");
    mkdirSync(yoklamaDizini);
    const yok = spawnSync(process.execPath, ["--import", "tsx", "scripts/build-korumali-imza.ts", "anahtar-uret", `--kid=paket-${YIL}`, `--dizin=${yoklamaDizini}`], {
      cwd: TEKS,
      encoding: "utf8",
      input: `${PAKET_PAROLA}\n${PAKET_PAROLA}\n`,
      env: { ...process.env, HOME: ev },
      timeout: 60_000,
    });
    const yokJson = existsSync(path.join(yoklamaDizini, `paket-${YIL}.paket.json`))
      ? (JSON.parse(readFileSync(path.join(yoklamaDizini, `paket-${YIL}.paket.json`), "utf8")) as { x?: unknown; d?: unknown })
      : null;
    if (yok.status === 0 && typeof yokJson?.x === "string" && yokJson.d === undefined) {
      const G = path.join(tmp, "satici-uretim-gercek");
      const g = await tore([`--dizin=${G}`, `--yil=${YIL}`, ET], iki(KOK_PAROLA, PAKET_PAROLA), {}, ev);
      const gk = existsSync(path.join(G, "TOREN-KUNYE.json")) ? (JSON.parse(readFileSync(path.join(G, "TOREN-KUNYE.json"), "utf8")) as { paket?: { x?: string } }) : {};
      const gp = existsSync(path.join(G, "paket", `paket-${YIL}.paket.json`)) ? readFileSync(path.join(G, "paket", `paket-${YIL}.paket.json`), "utf8") : "";
      kontrol("§4a tören gerçek PAKET aracıyla uçtan uca: parolalı dosya (ham d yok), künyede açık yarı; parola hiçbir süreçte görünmedi",
        g.status === 0 && !!gk.paket?.x && gp.includes(gk.paket.x) && !gp.includes(PAKET_PAROLA) && !/"d"\s*:/.test(gp) && !g.parolaGoruldu, `${g.status} ${g.status === 0 ? "" : g.cikti.slice(-300)}`);
    } else {
      // Ön yoklama çökmesi atlanmaz: tam çıktı (ilk hata satırı dahil) basılır, parola maskelenir.
      const yokCikti = `${yok.error?.message ?? ""} ${yok.stderr ?? ""} ${yok.stdout ?? ""}`.replaceAll(PAKET_PAROLA, "***").trim();
      const yokSatirlar = yokCikti.split("\n");
      const yokAsil = [/Cannot find (module|package)/, /^\s*(\w+ )?\w*Error( \[\w+\])?:/, /ENOENT|EACCES/].reduce<string | undefined>((bulunan, kalip) => bulunan ?? yokSatirlar.find((l) => kalip.test(l)), undefined);
      kontrol("§4a gerçek PAKET aracı ön yoklamada çökmedi (üretim kid'ini tanıyor, parolalı dosya yazıyor)", false, `çıkış ${yok.status} ${[yokAsil, ...yokSatirlar.slice(-3)].filter(Boolean).join(" | ").slice(0, 500)}`);
    }

    console.log("\n§6 DÖNEM TÖRENİ (G4 §2.4) — ara imzacı · ALT · İNDİRME 395 gün · iptal belgesi · kök kuyruğu, KÖKSÜZ paket");
    const donemler = path.join(D, "donemler");
    const donemDizinleri = () => (existsSync(donemler) ? readdirSync(donemler).sort() : []);
    const kuyrukYuku = {
      v: 1,
      hakId: randomUUID(),
      surum: 2,
      lisansNo: "TKS-2099-0001",
      musteri: { id: randomUUID(), ad: "Tören Tekstil" },
      tesis: { id: randomUUID(), ad: "Merkez" },
      kurulumId: randomUUID(),
      sinif: "URETIM",
      moduller: ["production.enabled", "finance.enabled"],
      kalici: true,
      bakimBitis: new Date(Date.now() + 365 * 86_400_000).toISOString(),
      verilis: new Date(Date.now() - 86_400_000).toISOString(),
      cevrimdisiUfukGun: 400,
    };
    const kuyrukDosyasi = path.join(tmp, "kuyruk.json");
    writeFileSync(kuyrukDosyasi, JSON.stringify({ v: 1, tur: "tekserp-kok-kuyrugu", uretim: new Date().toISOString(), talepler: [{ talepId: randomUUID(), hakId: kuyrukYuku.hakId, lisansNo: kuyrukYuku.lisansNo, tabanSurum: 1, surum: 2, yuk: kuyrukYuku }] }));
    const ucParola = (kok: string, ara: string, araTekrar = ara) => `${kok}\n${ara}\n${araTekrar}\n`;
    const dogrulaOnce = spawnSync(process.execPath, [TOREN, "dogrula", `--dizin=${D}`], { encoding: "utf8" });
    const d1 = await tore(["donem", `--dizin=${D}`, `--yil=${YIL}`, ET, `--kuyruk=${kuyrukDosyasi}`], ucParola(KOK_PAROLA, ARA_PAROLA), {}, ev);
    const ilkDonem = donemDizinleri().filter((n) => !n.includes(".yarim-"));
    const P = ilkDonem[0] ? path.join(donemler, ilkDonem[0], "vds-paketi") : "";
    kontrol("§6a dönem töreni çıkış 0, TEK dönem dizini, yarım kalıntı yok", d1.status === 0 && ilkDonem.length === 1 && !donemDizinleri().some((n) => n.includes(".yarim-")), `${d1.status} ${d1.status === 0 ? "" : d1.cikti.slice(-500)}`);
    if (d1.status !== 0) throw new Error("dönem töreni koşmadı");
    const paketDosyalari = dosyaListesi(P).sort();
    const beklenenPaket = ["DONEM-KUNYE.json", "SHA256SUMS", `anahtarlar/alt-${YIL}-2.anahtar.json`, `anahtarlar/ara-${YIL}-1.ara.json`, `anahtarlar/ind-${YIL}-2.anahtar.json`, "ice-aktar.json", "iptal.json"];
    kontrol("§6b paket TAM OLARAK beklenen küme (sıradaki numaralar: ALT 2 · ARA 1 · İNDİRME 2 — ilk törenin `ind-<yıl>`ı 1 sayılır)", JSON.stringify(paketDosyalari) === JSON.stringify(beklenenPaket), paketDosyalari.join(" "));
    const kokDosyaMetni = readFileSync(path.join(A, `kok-${YIL}-1.kok.json`), "utf8");
    const kokSifreli = (JSON.parse(kokDosyaMetni) as { sifreli: string }).sifreli;
    const kokIzi = paketDosyalari.filter((f) => {
      const m = readFileSync(path.join(P, f), "utf8");
      return m.includes("tekserp-kok-anahtar") || m.includes(kokSifreli) || f.endsWith(".kok.json");
    });
    kontrol("§6c ⭐ pakette KÖK YOK (kök türü, kökün şifreli yarısı, .kok.json hiçbir dosyada)", kokIzi.length === 0, kokIzi.join(" "));
    const ozetler = readFileSync(path.join(P, "SHA256SUMS"), "utf8").trim().split("\n").map((l) => l.split(/\s+/));
    const dk = JSON.parse(readFileSync(path.join(P, "DONEM-KUNYE.json"), "utf8")) as {
      yeni: Record<"alt" | "ara" | "indirme", { kid: string; x: string; siniflar: string[]; baslangic: string; bitis: string }>;
      iptal: { sira: number; satir: number };
      kuyruk: { imzalanan: number };
      emekliye: string[];
      ozetler: Record<string, string>;
      kok: { kid: string };
    };
    const shaTutar =
      ozetler.length === paketDosyalari.length - 1 &&
      Object.keys(dk.ozetler).length === paketDosyalari.length - 2 &&
      ozetler.every(([oz, f]) => createHash("sha256").update(readFileSync(path.join(P, f!))).digest("hex") === oz && (f === "DONEM-KUNYE.json" || dk.ozetler[f!] === oz));
    kontrol("§6d SHA256SUMS her dosyayı (kendisi hariç) doğrular; DONEM-KUNYE özetleri (künye ve SHA256SUMS hariç) aynı", shaTutar, `${ozetler.length} satır · künye ${Object.keys(dk.ozetler).length}`);
    const izin = [...["", "anahtarlar"].filter((d) => mod(path.join(P, d)) !== 0o700), ...paketDosyalari.filter((f) => mod(path.join(P, f)) !== 0o600)];
    kontrol("§6e izinler: dizinler 700, dosyalar 600", izin.length === 0, izin.join(" "));
    const capaYolu = path.join(tmp, "capa-donem.json");
    writeFileSync(capaYolu, JSON.stringify([{ kid: kok.kid, x: kok.x, classes: kok.siniflar }]));
    const pks = KeyStore.load({ ANAHTAR_DIZINI: path.join(P, "anahtarlar"), GUVEN_CAPASI_DOSYASI: capaYolu });
    const simdi = Date.now();
    const gunSay = (x: { baslangic: string; bitis: string }) => Math.round((Date.parse(x.bitis) - Date.parse(x.baslangic)) / 86_400_000);
    kontrol("§6f paketin anahtarları KÖKE karşı geçerli: kira ALT · İNDİRME · ARA (URETIM) seçilir, üçü de 395 gün (yıllık tören + 30 örtüşme), ara sınıfları URETIM·DR·DEMO·TEST, uyarı yok",
      pks.leaseKeyFor("URETIM", simdi)?.kid === `alt-${YIL}-2` && pks.downloadKey(simdi)?.kid === `ind-${YIL}-2` && pks.intermediateFor("URETIM", simdi)?.kid === `ara-${YIL}-1` &&
        [dk.yeni.alt, dk.yeni.ara, dk.yeni.indirme].every((x) => gunSay(x) === 395) && JSON.stringify([...dk.yeni.ara.siniflar].sort()) === JSON.stringify(["DEMO", "DR", "TEST", "URETIM"]) &&
        pks.warnings.filter((w) => !w.startsWith("Güven çapası DOSYADAN")).length === 0,
      pks.warnings.join(" | "));
    const enErken = Math.min(...[dk.yeni.alt, dk.yeni.ara, dk.yeni.indirme].map((x) => Date.parse(x.bitis)));
    const sonrakiToren = new Date(enErken - 30 * 86_400_000).toISOString().slice(0, 10);
    const sonrakiSatir = /SONRAKİ\s+dönem töreni (\d{4}-\d{2}-\d{2})/.exec(d1.cikti)?.[1];
    kontrol("§6f' ekran sonraki dönem törenini basar: en erken bitişten 30 gün önce (≈ 1 yıl sonra)", sonrakiSatir === sonrakiToren && Math.round((Date.parse(sonrakiToren) - simdi) / 86_400_000) >= 364, `${sonrakiSatir ?? "-"} beklenen ${sonrakiToren}`);
    const araDosya = readWrappedKeyFile(path.join(P, "anahtarlar", `ara-${YIL}-1.ara.json`));
    const araAcik = await unwrapPrivateKey(araDosya, passwordBuffer(ARA_PAROLA)).then((r) => (r.fill(0), true), () => false);
    let araKokle = "";
    await unwrapPrivateKey(araDosya, passwordBuffer(KOK_PAROLA)).catch((e: unknown) => (araKokle = e instanceof KeyFileError ? e.kind : "?"));
    kontrol("§6g ara imzacı ARA parolasıyla açılır, KÖK parolasıyla açılmaz (iki ayrı parola)", araAcik && araKokle === "YANLIS_PAROLA" && araDosya.tur === "tekserp-ara-anahtar");
    const { verifyRevocation, verifyEntitlement } = await import("../src/lisans-protokol");
    const capaKok = [{ kid: kok.kid, x: kok.x, classes: kok.siniflar }];
    const iptal1 = JSON.parse(readFileSync(path.join(P, "iptal.json"), "utf8")) as { sira: number; belge: string };
    const iptalV = verifyRevocation(iptal1.belge, capaKok);
    const ice = JSON.parse(readFileSync(path.join(P, "ice-aktar.json"), "utf8")) as { tur: string; iptal: string; haklar: { talepId: string; belge: string }[] };
    const hakV = ice.haklar[0] ? verifyEntitlement(ice.haklar[0].belge, capaKok) : null;
    const kanonik = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : x));
    kontrol("§6h ilk dönem: iptal belgesi sıra 1 (boş liste, kökle doğrulanır); ice-aktar iptali aynı belge; kuyruktaki HAK KÖKLE imzalandı ve yükü kuyruktakiyle BİREBİR",
      iptalV.ok && iptalV.value.document.sira === 1 && iptalV.value.document.iptaller.length === 0 && ice.tur === "tekserp-donem-ice-aktar" && ice.iptal === iptal1.belge &&
        !!hakV?.ok && hakV.value.signer.kind === "KOK" && kanonik(hakV.value.document) === kanonik(kuyrukYuku) && dk.kuyruk.imzalanan === 1);
    kontrol("§6i emekliye listesi: önceki ALT · İNDİRME (ilk törenin) var, yeniler YOK", dk.emekliye.includes(`alt-${YIL}-1`) && dk.emekliye.includes(`ind-${YIL}`) && !dk.emekliye.some((k) => [`alt-${YIL}-2`, `ara-${YIL}-1`, `ind-${YIL}-2`].includes(k)), dk.emekliye.join(","));
    const dogrulaSonra = spawnSync(process.execPath, [TOREN, "dogrula", `--dizin=${D}`], { encoding: "utf8" });
    kontrol("§6j ilk tören dizini dokunulmadı: `dogrula` önce ve sonra 0 (künye özetleri aynı)", dogrulaOnce.status === 0 && dogrulaSonra.status === 0, `${dogrulaOnce.status}/${dogrulaSonra.status}`);
    const paketSirlari = [ARA_PAROLA, KOK_PAROLA, (JSON.parse(readFileSync(path.join(P, "anahtarlar", `alt-${YIL}-2.anahtar.json`), "utf8")) as { d: string }).d];
    kontrol("§6k ⭐ parolalar hiçbir sürecin argv/env'inde görünmedi; ekran parola ve ALT özel yarısı taşımaz, yeni kid'leri ve sonraki adımları basar",
      !d1.parolaGoruldu && d1.yoklama >= 5 && paketSirlari.every((x) => !d1.cikti.includes(x)) && [`alt-${YIL}-2`, `ara-${YIL}-1`, `ind-${YIL}-2`, "Sonraki adımlar", "emekliye-ayir"].every((x) => d1.cikti.includes(x)),
      `${d1.yoklama} yoklama`);
    const dkc = JSON.parse(readFileSync(path.join(P, "DONEM-KUNYE.json"), "utf8")) as { capaSatirlari: Record<string, string> };
    const w6 = await workerSatiriOlc(dkc.capaSatirlari, dk.yeni.indirme);
    kontrol("§6k' ⭐ dönem künyesinin CF Worker satırı (L2-8): yeni İNDİRME'nin kid · x · 395 günlük penceresi + güncelleme grupları; Worker ayarı onu KABUL eder", w6.ok, w6.detay);
    kontrol("§6k'' ⭐ dönem Sonraki adımlar: CF Worker adımı anahtar birimine kurmadan ÖNCE (örtüşmeli geçiş)", sonra(d1.cikti, "CF Worker", "Anahtar birimine kur"), "");

    const d2 = await tore(["donem", `--dizin=${D}`, `--yil=${YIL}`, ET, `--iptal=ara-${YIL}-1`, "--neden=bekçi acil iptal"], ucParola(KOK_PAROLA, `${ARA_PAROLA}-2`), {}, ev);
    const ikinciDonem = donemDizinleri().filter((n) => !n.includes(".yarim-") && n !== ilkDonem[0]);
    const P2 = ikinciDonem[0] ? path.join(donemler, ikinciDonem[0], "vds-paketi") : "";
    const iptal2 = P2 && existsSync(path.join(P2, "iptal.json")) ? verifyRevocation((JSON.parse(readFileSync(path.join(P2, "iptal.json"), "utf8")) as { belge: string }).belge, capaKok) : null;
    const dk2 = P2 ? (JSON.parse(readFileSync(path.join(P2, "DONEM-KUNYE.json"), "utf8")) as typeof dk) : null;
    kontrol("§6l olağan dışı dönem (--iptal): numaralar ilerler (ALT 3 · ARA 2 · İND 3), iptal sıra 2 ara-…-1'i taşır, ice-aktar'da HAK yok, emekliye eski ara dahil",
      d2.status === 0 && !!iptal2?.ok && iptal2.value.document.sira === 2 && iptal2.value.document.iptaller.some((e) => e.kid === `ara-${YIL}-1` && e.kullanim === "HAK" && e.neden === "bekçi acil iptal") &&
        dk2?.yeni.alt.kid === `alt-${YIL}-3` && dk2.yeni.ara.kid === `ara-${YIL}-2` && dk2.yeni.indirme.kid === `ind-${YIL}-3` && dk2.kuyruk.imzalanan === 0 && dk2.emekliye.includes(`ara-${YIL}-1`) && dk2.emekliye.includes(`alt-${YIL}-2`),
      `${d2.status} ${d2.status === 0 ? "" : d2.cikti.slice(-300)}`);

    const sayiOnce = donemDizinleri().length;
    const ayni = await tore(["donem", `--dizin=${D}`, `--yil=${YIL}`, ET], ucParola(KOK_PAROLA, KOK_PAROLA), {}, ev);
    const yanlisKok = await tore(["donem", `--dizin=${D}`, `--yil=${YIL}`, ET], ucParola(`${KOK_PAROLA}-yanlis`, `${ARA_PAROLA}-3`), {}, ev);
    const eslesmez = await tore(["donem", `--dizin=${D}`, `--yil=${YIL}`, ET], ucParola(KOK_PAROLA, `${ARA_PAROLA}-4`, `${ARA_PAROLA}-5`), {}, ev);
    const bilinmezKid = await tore(["donem", `--dizin=${D}`, `--yil=${YIL}`, ET, "--iptal=ara-2099-99"], ucParola(KOK_PAROLA, `${ARA_PAROLA}-6`), {}, ev);
    writeFileSync(path.join(tmp, "bozuk-kuyruk.json"), JSON.stringify({ v: 1, tur: "baska" }));
    const bozukKuyruk = await tore(["donem", `--dizin=${D}`, `--yil=${YIL}`, ET, `--kuyruk=${path.join(tmp, "bozuk-kuyruk.json")}`], ucParola(KOK_PAROLA, `${ARA_PAROLA}-7`), {}, ev);
    const argvParola = await tore(["donem", `--dizin=${D}`, `--ara-parolasi=${ARA_PAROLA}`], "", {}, ev);
    const kokIptal = await tore(["donem", `--dizin=${D}`, `--yil=${YIL}`, ET, `--iptal=kok-${YIL}-1`], ucParola(KOK_PAROLA, `${ARA_PAROLA}-8`), {}, ev);
    kontrol("§6m RED, dönem paketi YAZILMADAN: ara = kök parolası (2) · yanlış kök parolası (1, yarım silindi) · eşleşmeyen ara (2) · bilinmeyen --iptal kid (2) · biçimsiz kuyruk (2) · argv'de parola (2) · kök iptal (2)",
      ayni.status === 2 && /AYNI olamaz/.test(ayni.cikti) &&
        yanlisKok.status === 1 && /yarım dönem dizini silindi/.test(yanlisKok.cikti) &&
        eslesmez.status === 2 && /eşleşmedi/.test(eslesmez.cikti) &&
        bilinmezKid.status === 2 && /bulunamadı/.test(bilinmezKid.cikti) &&
        bozukKuyruk.status === 2 && /--kuyruk tanınmıyor/.test(bozukKuyruk.cikti) &&
        argvParola.status === 2 && /argümandan ALINMAZ/.test(argvParola.cikti) &&
        kokIptal.status === 2 && /iptal edilemez tür/.test(kokIptal.cikti) &&
        donemDizinleri().length === sayiOnce && ![ayni, yanlisKok, eslesmez].some((r) => r.parolaGoruldu),
      [ayni, yanlisKok, eslesmez, bilinmezKid, bozukKuyruk, argvParola, kokIptal].map((r) => r.status).join("/"));

    console.log("\n§7 TEK KİP — hazırlık kökü doğmaz (`hazirlik-*` kök kid'i biçim düzeyinde RED)");
    const HZ = path.join(tmp, "satici-hazirlik");
    const HA = path.join(HZ, "anahtarlar");
    mkdirSync(HA, { recursive: true, mode: 0o700 });
    chmodSync(HZ, 0o700);
    const HKOK = `hkok-sonda-${randomBytes(9).toString("hex")}`;
    const cli = (argv: string[], girdi: string) => spawnSync(process.execPath, ["--import", "tsx", "scripts/anahtar.ts", ...argv], { cwd: SATICI_KOKU, encoding: "utf8", input: girdi });
    const hKok = cli(["kok-uret", `--kid=hazirlik-${YIL}-1`, `--dizin=${HA}`], `${HKOK}\n${HKOK}\n`);
    kontrol("§7a ⭐ `kok-uret --kid=hazirlik-<yıl>-1` RED (kök kid biçimi `kok-<yıl>-<n>`), dizine hiçbir dosya yazılmaz",
      hKok.status !== 0 && /Kök kid biçimi: kok-<yıl>-<n>/.test(hKok.stderr) && readdirSync(HA).length === 0,
      `${hKok.status} ${hKok.stderr.trim().slice(0, 120)} · ${readdirSync(HA).join(",")}`);
    // Eski hazırlık kökü dosyası elle konmuş bir tören dizini: dönem töreni onu ortam saymaz (tek kök ailesi).
    const hKid = `hazirlik-${YIL}-1`;
    writeFileSync(path.join(HA, `${hKid}.kok.json`), JSON.stringify({ tur: "tekserp-kok-anahtar", kid: hKid, siniflar: ["TEST", "DEMO"] }), { mode: 0o600 });
    const hDonem = await tore(["donem", `--dizin=${HZ}`, `--kok=${hKid}`, `--yil=${YIL}`, ET], ucParola(KOK_PAROLA, ARA_PAROLA), {}, ev);
    kontrol("§7b ⭐ dönem töreni `hazirlik-*` kökle parola SORULMADAN RED (çıkış 2), dönem dizini doğmaz",
      hDonem.status === 2 && /kök ailesinde değil \(kok-\*\)/.test(hDonem.cikti) && !/\[1\/8\]/.test(hDonem.cikti) && !existsSync(path.join(HZ, "donemler")),
      `${hDonem.status} ${hDonem.cikti.trim().split("\n").pop()?.slice(0, 140)}`);
    const karsi = await tore(["donem", `--dizin=${D}`, `--yil=${YIL}`, ET, `--karsi-dizin=${HZ}`], "", {}, ev);
    kontrol("§7c eski `--karsi-dizin` bayrağı tanınmaz (karşı ortam yok) → çıkış 2", karsi.status === 2 && /Tanınmayan argüman: --karsi-dizin/.test(karsi.cikti), `${karsi.status} ${karsi.cikti.trim().split("\n").pop()?.slice(0, 140)}`);

    console.log("\n§5 KAYNAK — kirli ağaç, origin/main dışı HEAD, yanlış etiket, npm ls (parola SORULMADAN RED)");
    const H5 = path.join(tmp, "kaynak-hedef");
    const kaynakRed = async (argv: string[], desen: RegExp): Promise<[boolean, string]> => {
      const r = await tore([`--dizin=${H5}`, `--yil=${YIL}`, ...argv, paketBayragi()], iki(KOK_PAROLA, PAKET_PAROLA), {}, ev);
      return [r.status === 2 && desen.test(r.cikti) && !/\[2\/10\]/.test(r.cikti) && !existsSync(H5), `${r.status} ${r.cikti.trim().split("\n").pop()?.slice(0, 140)}`];
    };
    const ornekEnv = path.join(KLON, "deploy", "satici", "ornek-uretim.env");
    writeFileSync(ornekEnv, `${readFileSync(ornekEnv, "utf8")}# kirli\n`);
    const [kirli, kirliA] = await kaynakRed([ET], /Ağaç KİRLİ/);
    gitK(["checkout", "--", "deploy/satici/ornek-uretim.env"]);
    kontrol("§5a izlenen dosyada değişiklik → RED (kirli)", kirli, kirliA);
    writeFileSync(path.join(KLON, "satici", "sunucu", "src", "sonda-izlenmeyen.ts"), "export {};\n");
    const [izsiz, izsizA] = await kaynakRed([ET], /Ağaç KİRLİ/);
    rmSync(path.join(KLON, "satici", "sunucu", "src", "sonda-izlenmeyen.ts"));
    kontrol("§5b izlenmeyen dosya → RED (kirli)", izsiz, izsizA);
    const yetim = gitK(["commit-tree", gitK(["write-tree"]).stdout.trim(), "-m", "ilgisiz"]).stdout.trim();
    gitK(["update-ref", "refs/remotes/origin/main", yetim]);
    const [disarida, disaridaA] = await kaynakRed([], /origin\/main'de DEĞİL/);
    kontrol("§5c etiketsiz ve HEAD origin/main'de değil → RED", disarida, disaridaA);
    gitK(["tag", "baska-sonda", yetim]);
    const [baska, baskaA] = await kaynakRed(["--etiket=baska-sonda"], /HEAD'i göstermiyor/);
    kontrol("§5d etiket başka commit'i gösteriyor → RED", baska, baskaA);
    gitK(["update-ref", "refs/remotes/origin/main", klonHead]);
    const icinde = await tore([`--dizin=${H5}`, `--yil=${YIL}`, paketBayragi()], iki("kisa-parola", PAKET_PAROLA), {}, ev);
    kontrol("§5e ✓K etiketsiz ama HEAD origin/main'de → kaynak kapısı GEÇER (parola adımına kadar gelir, zayıf parolada durur)", icinde.status === 2 && /\[2\/10\]/.test(icinde.cikti) && /en az 12/.test(icinde.cikti) && /origin\/main/.test(icinde.cikti), `${icinde.status}`);
    const pj = path.join(KLON, "satici", "sunucu", "package.json");
    const pjEski = readFileSync(pj, "utf8");
    const pjYeni = JSON.parse(pjEski) as { dependencies?: Record<string, string> };
    pjYeni.dependencies = { ...(pjYeni.dependencies ?? {}), "tekserp-sonda-kurulmamis": "1.0.0" };
    writeFileSync(pj, `${JSON.stringify(pjYeni, null, 2)}\n`);
    gitK(["commit", "-q", "-am", "kurulmamış bağımlılık"]);
    gitK(["tag", "npm-sonda"]);
    const [npmls, npmlsA] = await kaynakRed(["--etiket=npm-sonda"], /npm ls --all hatalı/);
    kontrol("§5f ⭐ temiz + etiketli ama node_modules kilitle uyuşmuyor (kurulmamış bağımlılık) → RED npm ls", npmls, npmlsA);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  sonuc();
}

main().catch((err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  process.exit(1);
});
