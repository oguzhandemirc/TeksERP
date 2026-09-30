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
//      eşleşmeyen · yarım kalıntı · tanınmayan bayrak · PAKET aracı parolasız dosya üretirse · ortada düşen adım
//   §4 GERÇEK PAKET aracı (varsayılan PAKET_KOMUTU): üretim kid'ini tanıyorsa tören onunla uçtan uca; tanımıyorsa
//      (ayrı dilim henüz inmedi) beyanlı ⏭ — araç tanıdığı gün bu bölüm kendiliğinden koşar
// ⭐ KALICI SONDA ✓K (her koşumda): süreç yüzeyi okuyucusu KÖR DEĞİL — parolayı argv'de ve env'de taşıyan kukla
//    süreçlerde BULUR.
// Koşum: node ../../scripts/agir-is.mjs -- npx tsx scripts/test_uretim_toren.ts   (DB GEREKMEZ; Teks-Erp npm ci ister)
// =============================================================================
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LICENSE_CLASSES, parseModuleKeyFile } from "../src/lisans-protokol";
import { KeyFileError, passwordBuffer, readWrappedKeyFile, unwrapPrivateKey } from "../src/keys/key-files";
import { KeyStore } from "../src/keys/key-store";
import { loadServerSecrets } from "../src/keys/server-secrets";
import { SATICI_KOKU, kontrol, sonuc } from "./lib/test-ortam";

const REPO = path.resolve(SATICI_KOKU, "..", "..");
const TEKS = path.join(REPO, "Teks-Erp");
const TOREN = path.join(REPO, "deploy", "satici", "uretim-toren.mjs");
const YIL = "2099";
const KOK_PAROLA = `kok-sonda-${randomBytes(9).toString("hex")}`;
const PAKET_PAROLA = `paket-sonda-${randomBytes(9).toString("hex")}`;
const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ozet = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/**
 * Saplama PAKET aracı: gerçek aracın sözleşmesi — stdin'den iki satır (yeni + tekrar, ≥ 12, eşit), {dizin}/{kid}.paket.json
 * (0600, üstüne yazmaz) `kid` + `x` taşır. Aldığı parolanın ÖZETİNİ yazar: tören hangi satırı geçirdi ölçülsün.
 */
const SAPLAMA = `import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto";
const a = new Map(process.argv.slice(2).map((x) => { const m = /^--([a-z]+)=(.*)$/.exec(x); return [m[1], m[2]]; }));
const parcalar = []; for await (const p of process.stdin) parcalar.push(p);
const [p1 = "", p2 = ""] = Buffer.concat(parcalar).toString("utf8").split("\\n");
if (p1 !== p2 || [...p1].length < 12) { console.error("✖ saplama: parola eşleşmedi ya da kısa"); process.exit(2); }
const { privateKey } = crypto.generateKeyPairSync("ed25519"); const j = privateKey.export({ format: "jwk" });
const govde = { tur: "tekserp-paket-anahtar", surum: 2, kid: a.get("kid"), x: j.x, sarili: { ad: a.get("kid"), ozet: crypto.createHash("sha256").update(p1, "utf8").digest("hex") } };
if (a.get("kip") === "parolasiz") govde.d = j.d;
if (a.get("kip") !== "dosyasiz") fs.writeFileSync(path.join(a.get("dizin"), a.get("kid") + ".paket.json"), JSON.stringify(govde) + "\\n", { mode: 0o600, flag: "wx" });
console.log("PACKAGE_PUBLIC_KEYS girdisi: { kid: " + JSON.stringify(a.get("kid")) + ", x: " + JSON.stringify(j.x) + " }");
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

/** Töreni gerçek alt süreçte koşar; koşum boyunca süreç yüzeyinde parolayı arar. */
async function tore(argv: string[], stdin: string, ekOrtam: Record<string, string> = {}, ev?: string): Promise<Kosum> {
  const cocuk = spawn(process.execPath, [TOREN, ...argv], {
    cwd: REPO,
    env: { ...process.env, ...(ev ? { HOME: ev } : {}), ...ekOrtam },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let cikti = "";
  cocuk.stdout.on("data", (c: Buffer) => (cikti += c.toString("utf8")));
  cocuk.stderr.on("data", (c: Buffer) => (cikti += c.toString("utf8")));
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
    if (y.includes(KOK_PAROLA) || y.includes(PAKET_PAROLA)) parolaGoruldu = true;
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
  const paketBayragi = (kip = "normal") => `--paket-komutu=${saplama} --kid={kid} --dizin={dizin} --kip=${kip}`;
  const gercekEv = path.join(os.homedir(), ".tekserp", "satici-uretim");
  const gercekEvOnce = existsSync(gercekEv) ? statSync(gercekEv).mtimeMs : null;
  const D = path.join(tmp, "satici-uretim");
  const A = path.join(D, "anahtarlar");
  let atlanan = 0;
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

    console.log("\n§1 tören uçtan uca (geçici dizin, stdin parolaları, saplama PAKET aracı)");
    const t = await tore([`--dizin=${D}`, `--yil=${YIL}`, paketBayragi()], iki(KOK_PAROLA, PAKET_PAROLA), {}, ev);
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
      indirme: { kid: string; x: string };
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
    kontrol("§1o künye çapa satırları: kök (bütün sınıflar) · paket · CF Worker İNDİRME",
      k.capaSatirlari.ROOT_PUBLIC_KEYS!.includes(k.kok.x) && k.capaSatirlari.PACKAGE_PUBLIC_KEYS!.includes(`paket-${YIL}`) && k.capaSatirlari.CF_WORKER_INDIRME!.includes(k.indirme.x));

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
    const var_ = await tore([`--dizin=${D}`, `--yil=${YIL}`, paketBayragi()], iki(KOK_PAROLA, PAKET_PAROLA), {}, ev);
    kontrol("§3a hedef VAR → çıkış 2, dokunulmadı (özetler künyeyle aynı)", var_.status === 2 && /zaten var/.test(var_.cikti) && spawnSync(process.execPath, [TOREN, "dogrula", `--dizin=${D}`]).status === 0);
    const argv = await tore([`--dizin=${H}`, `--kok-parolasi=${KOK_PAROLA}`], "", {}, ev);
    kontrol("§3b argv'de parola → çıkış 2, değer basılmadı", argv.status === 2 && /argümandan ALINMAZ/.test(argv.cikti) && !argv.cikti.includes(KOK_PAROLA) && temiz());
    const env = await tore([`--dizin=${H}`, `--yil=${YIL}`, paketBayragi()], "", { KOK_PAROLASI: KOK_PAROLA, TOREN_PAROLA: KOK_PAROLA, PAKET_PAROLASI: PAKET_PAROLA }, ev);
    kontrol("§3c ortamdaki parola KULLANILMAZ (stdin boşken 'stdin bitti' ile durur)", env.status === 2 && /stdin bitti/.test(env.cikti) && temiz());
    const zayif = await tore([`--dizin=${H}`, `--yil=${YIL}`, paketBayragi()], iki("kisa-parola", PAKET_PAROLA), {}, ev);
    kontrol("§3d zayıf kök parolası (<12) → çıkış 2", zayif.status === 2 && /en az 12/.test(zayif.cikti) && temiz());
    const farkli = await tore([`--dizin=${H}`, `--yil=${YIL}`, paketBayragi()], `${KOK_PAROLA}\n${KOK_PAROLA}x\n${PAKET_PAROLA}\n${PAKET_PAROLA}\n`, {}, ev);
    kontrol("§3e eşleşmeyen tekrar → çıkış 2", farkli.status === 2 && /eşleşmedi/.test(farkli.cikti) && temiz());
    const parolasiz = await tore([`--dizin=${H}`, `--yil=${YIL}`, paketBayragi("parolasiz")], iki(KOK_PAROLA, PAKET_PAROLA), {}, ev);
    const dosyasiz = await tore([`--dizin=${H}`, `--yil=${YIL}`, paketBayragi("dosyasiz")], iki(KOK_PAROLA, PAKET_PAROLA), {}, ev);
    kontrol("§3f PAKET aracı parolasız (ham d) dosya ya da hiç dosya üretmezse → RED, yarım dizin silinir",
      parolasiz.status === 1 && /PAROLASIZ/.test(parolasiz.cikti) && dosyasiz.status === 1 && /beklenen dosyayı üretmedi/.test(dosyasiz.cikti) && temiz(), `${parolasiz.status}/${dosyasiz.status}`);
    const kalinti = path.join(tmp, "hedef-yok.yarim-12345");
    mkdirSync(kalinti);
    const yarim = await tore([`--dizin=${H}`, `--yil=${YIL}`, paketBayragi()], iki(KOK_PAROLA, PAKET_PAROLA), {}, ev);
    rmSync(kalinti, { recursive: true });
    kontrol("§3g yarım tören dizini kalıntısı → çıkış 2 (sil ve yeniden başla)", yarim.status === 2 && /Yarım kalmış/.test(yarim.cikti) && !existsSync(H));
    const bilinmez = await tore([`--dizin=${H}`, "--kok-kid=kok-2099-9"], "", {}, ev);
    kontrol("§3h tanınmayan bayrak → çıkış 2", bilinmez.status === 2 && /Tanınmayan argüman/.test(bilinmez.cikti) && temiz());
    const uzun = `depo.${"a".repeat(70)}`;
    const ortada = await tore([`--dizin=${H}`, `--yil=${YIL}`, `--moduller=${uzun}`, paketBayragi()], iki(KOK_PAROLA, PAKET_PAROLA), {}, ev);
    kontrol("§3i ⭐ ortada düşen adım (kök · ALT · İND · sırlar · PAKET üretildikten SONRA modül) → yarım dizin silinir, hedef doğmaz",
      ortada.status === 1 && /\[7\/10\] PAKET/.test(ortada.cikti) && /yarım dizin silindi/.test(ortada.cikti) && temiz() && !ortada.parolaGoruldu, `${ortada.status}`);

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
      const g = await tore([`--dizin=${G}`, `--yil=${YIL}`], iki(KOK_PAROLA, PAKET_PAROLA), {}, ev);
      const gk = existsSync(path.join(G, "TOREN-KUNYE.json")) ? (JSON.parse(readFileSync(path.join(G, "TOREN-KUNYE.json"), "utf8")) as { paket?: { x?: string } }) : {};
      const gp = existsSync(path.join(G, "paket", `paket-${YIL}.paket.json`)) ? readFileSync(path.join(G, "paket", `paket-${YIL}.paket.json`), "utf8") : "";
      kontrol("§4a tören gerçek PAKET aracıyla uçtan uca: parolalı dosya (ham d yok), künyede açık yarı; parola hiçbir süreçte görünmedi",
        g.status === 0 && !!gk.paket?.x && gp.includes(gk.paket.x) && !gp.includes(PAKET_PAROLA) && !/"d"\s*:/.test(gp) && !g.parolaGoruldu, `${g.status} ${g.status === 0 ? "" : g.cikti.slice(-300)}`);
    } else {
      atlanan++;
      console.log(`  ⏭ ATLANDI — gerçek PAKET aracı üretim kid'ini henüz tanımıyor (lisans/uretim-gecis dilimi): ${(yok.stderr || yok.stdout).trim().split("\n").pop()?.slice(0, 140) ?? ""}`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  if (atlanan > 0) console.log(`\nℹ️  ${atlanan} bölüm beyanla atlandı (§4) — geçti SAYILMADI`);
  sonuc();
}

main().catch((err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  process.exit(1);
});
