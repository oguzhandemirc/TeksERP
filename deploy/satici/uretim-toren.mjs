#!/usr/bin/env node
// =============================================================================
// ÜRETİM SATICISI ANAHTAR TÖRENİ — Mac'te, gerçek terminalde, tek komut (runbook docs/ops/URETIM-SATICI-TOREN.md)
// =============================================================================
// Kriptoyu YAZMAZ, var olan araçları sırayla koşturur:
//   kök · ALT · İNDİRME · sunucu sırları  → satici/sunucu/scripts/anahtar.ts
//   PAKET (bütünlük listesi, parolalı)     → PAKET aracı (ayrı dilim; komut PAKET_KOMUTU, `--paket-komutu` ile ezilir)
//   şifreli modül anahtarları              → satici/sunucu/scripts/modul-anahtari.ts uret
//   yedek alıcıları + kurtarma arşivi      → Teks-Erp/scripts/yedek-sifrele.ts
// Kök parolası TTY'den gizli sorulur (TTY yoksa stdin satırları — yalnız bekçi) ve alt süreçlere YALNIZ stdin borusuyla
// gider: argv'ye, ortama, loga, dosyaya girmez. PAKET parolasını tören GÖRMEZ: PAKET aracı terminali devralıp kendisi
// sorar (TTY yoksa törenin stdin'inde kalan satırlar ona geçer). Alt süreçler yalın ortamla koşar (ANAHTAR_DIZINI,
// GUVEN_CAPASI_DOSYASI, DATABASE_URL, NODE_OPTIONS geçmez). Ekrana yalnız kid + açık anahtar + parmak izi + sonraki adım.
// Hedef dizin VARSA dokunulmaz; anahtarlar `<hedef>.yarim-<pid>`de kurulur ve en sonda TEK rename ile hedefe geçer
// (hepsi ya da hiçbiri — yarım kalan dizin, düz ALT/İNDİRME taşıdığı için silinir).
//
// Kullanım (repo kökünden; önkoşul: `cd satici/sunucu && npm ci` ve `cd Teks-Erp && npm ci`):
//   node deploy/satici/uretim-toren.mjs [--dizin=~/.tekserp/satici-uretim] [--yil=<YYYY>] [--alt-gun=180]
//                                      [--ind-gun=365] [--moduller=<a.b,c.d|yok>] [--usb=<USB kökü>]
//                                      [--paket-komutu="<betik> <argümanlar; {kid} {dizin} yer tutucu>"]
//   node deploy/satici/uretim-toren.mjs usb-kopyala --usb=/Volumes/<USB> [--dizin=…]
//       Var olan ŞİFRELİ dosyaları + açık künyeyi + BENIOKU'yu USB'ye kopyalar ve özetleri doğrular; HİÇBİR ŞEY üretmez.
//   node deploy/satici/uretim-toren.mjs dogrula [--dizin=…]
//       Salt okuma: izinler (dizin 700 · dosya 600) + dosya özetleri künyeyle aynı mı.
// Çıkış: 0 tamam · 1 hata (hedefe hiçbir şey yazılmadı) · 2 kullanım/önkoşul.
// =============================================================================
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SATICI = path.join(REPO, "satici", "sunucu");
const TEKS = path.join(REPO, "Teks-Erp");
const VARSAYILAN_DIZIN = "~/.tekserp/satici-uretim";
const MIN_PAROLA = 12;
const ALT_SURE_MS = 120_000;
const USB_KLASORU = "tekserp-satici-uretim";
const KUNYE = "TOREN-KUNYE.json";
const BENIOKU = "BENIOKU.md";
const ALICI_MAC = "satici-uretim-mac";
const ALICI_KURTARMA = "satici-uretim-kurtarma";
const SUNUCU_SIRLARI = ["portal-totp.key", "etkinlestirme-kodu.pepper", "modul-kasasi.key"];
// PAKET anahtarı üreticisi: ayrı dilimin CLI'ı (lisans/uretim-gecis). Arayüz değişirse YALNIZ bu satır değişir.
// Betik yolu repo köküne göre; `.ts` ise o projede `node --import tsx` ile koşar. Çıktı: {dizin}/{kid}.paket.json (`kid` + `x`,
// parolalı) + `--json` ile stdout'ta tek satır {"v":1,"kid","x","dosya","parolali":true}.
const PAKET_KOMUTU = "Teks-Erp/scripts/build-korumali-imza.ts anahtar-uret --kid={kid} --dizin={dizin} --json";
const PAROLA_ARG = /^--[^=]*(parola|password|sifre|secret)/i;
const KOMUTLAR = {
  toren: ["dizin", "yil", "alt-gun", "ind-gun", "moduller", "usb", "paket-komutu"],
  "usb-kopyala": ["dizin", "usb"],
  dogrula: ["dizin"],
};

class TorenHatasi extends Error {
  constructor(mesaj, kod = 1) {
    super(mesaj);
    this.kod = kod;
  }
}

// ---------------------------------------------------------------- argümanlar
function argumanlar(argv) {
  const bayrak = argv.find((a) => PAROLA_ARG.test(a));
  if (bayrak) throw new TorenHatasi(`Parola argümandan ALINMAZ (${bayrak.split("=")[0]}) — terminalde gizli sorulur`, 2);
  const komut = argv[0] && !argv[0].startsWith("--") ? argv[0] : "toren";
  const kalan = argv[0] && !argv[0].startsWith("--") ? argv.slice(1) : argv;
  if (!KOMUTLAR[komut]) throw new TorenHatasi(`Komut: ${Object.keys(KOMUTLAR).join(" | ")} (ayrıntı dosya başında)`, 2);
  const bayraklar = new Map();
  for (const a of kalan) {
    const m = /^--([a-z-]+)=(.*)$/.exec(a);
    if (!m || !KOMUTLAR[komut].includes(m[1])) throw new TorenHatasi(`Tanınmayan argüman: ${a.split("=")[0]} (${komut}: ${KOMUTLAR[komut].map((b) => `--${b}`).join(" ")})`, 2);
    bayraklar.set(m[1], m[2]);
  }
  return { komut, bayraklar };
}

const evYolu = (p) => path.resolve(p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p);

function gun(bayraklar, ad, varsayilan) {
  const n = Number(bayraklar.get(ad) ?? varsayilan);
  if (!Number.isInteger(n) || n < 1 || n > 730) throw new TorenHatasi(`--${ad} 1–730 gün olmalı`, 2);
  return n;
}

// ---------------------------------------------------------------- parola girişi
let stdinSatirlari = null;

async function stdinOku() {
  const parcalar = [];
  for await (const p of process.stdin) parcalar.push(p);
  const hepsi = Buffer.concat(parcalar);
  for (const p of parcalar) p.fill(0);
  const satirlar = [];
  let bas = 0;
  for (let i = 0; i <= hepsi.length; i++) {
    if (i === hepsi.length || hepsi[i] === 0x0a) {
      let son = i;
      if (son > bas && hepsi[son - 1] === 0x0d) son--;
      if (son > bas || i < hepsi.length) satirlar.push(Buffer.from(hepsi.subarray(bas, son)));
      bas = i + 1;
    }
  }
  hepsi.fill(0);
  return satirlar;
}

function ttyGizliOku(soru) {
  return new Promise((resolve, reject) => {
    // Önce yankı kapanır, sonra istem basılır: istemi görüp hızla yazılan (ya da yapıştırılan) parola yankılanmasın.
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    process.stderr.write(soru);
    const baytlar = [];
    const bitir = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write("\n");
    };
    const onData = (parca) => {
      for (const b of parca) {
        if (b === 0x03) {
          bitir();
          baytlar.fill(0);
          parca.fill(0);
          reject(new TorenHatasi("İptal edildi (Ctrl+C)"));
          return;
        }
        if (b === 0x0d || b === 0x0a) {
          bitir();
          const cikti = Buffer.from(baytlar);
          baytlar.fill(0);
          parca.fill(0);
          resolve(cikti);
          return;
        }
        if (b === 0x7f || b === 0x08) baytlar.pop();
        else baytlar.push(b);
      }
      parca.fill(0);
    };
    stdin.on("data", onData);
  });
}

async function parolaSor(soru) {
  let ham;
  if (process.stdin.isTTY) ham = await ttyGizliOku(soru);
  else {
    stdinSatirlari ??= await stdinOku();
    ham = stdinSatirlari.shift();
    if (!ham) throw new TorenHatasi(`Parola bekleniyordu, stdin bitti (${soru.trim()})`, 2);
  }
  const nfc = Buffer.from(ham.toString("utf8").normalize("NFC"), "utf8");
  ham.fill(0);
  return nfc;
}

/** İki kez sorulur; eşleşmeli ve en az MIN_PAROLA karakter olmalı. Dönen Buffer'ı çağıran sıfırlar. */
async function yeniParola(ad) {
  const ilk = await parolaSor(`${ad} (en az ${MIN_PAROLA} karakter): `);
  const ikinci = await parolaSor(`${ad} (tekrar): `);
  const ayni = ilk.length === ikinci.length && crypto.timingSafeEqual(ilk, ikinci);
  ikinci.fill(0);
  if (!ayni) {
    ilk.fill(0);
    throw new TorenHatasi(`${ad}: iki giriş eşleşmedi — hiçbir anahtar üretilmedi`, 2);
  }
  if ([...ilk.toString("utf8")].length < MIN_PAROLA) {
    ilk.fill(0);
    throw new TorenHatasi(`${ad} en az ${MIN_PAROLA} karakter olmalı — hiçbir anahtar üretilmedi`, 2);
  }
  return ilk;
}

// ---------------------------------------------------------------- alt süreçler
/** Yalın ortam: sır taşıyan ya da davranış değiştiren hiçbir değişken alt sürece geçmez. */
function altOrtam() {
  const e = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? os.homedir(), COPYFILE_DISABLE: "1" };
  if (process.env.TMPDIR) e.TMPDIR = process.env.TMPDIR;
  return e;
}

/** `node --import tsx <betik>`; parolalar yalnız stdin'e, satır satır. Yazılan birleşik tampon boşalınca sıfırlanır. */
function kos(cwd, betik, argv, parolalar = []) {
  return kosNode(cwd, ["--import", "tsx", betik, ...argv], parolalar);
}

/** `terminal`: stdin ve stderr devralınır (alt süreç parolasını KENDİSİ sorar); stdout her durumda yakalanır. */
function kosNode(cwd, nodeArgv, parolalar = [], terminal = false) {
  return new Promise((resolve, reject) => {
    const cocuk = spawn(process.execPath, nodeArgv, { cwd, env: altOrtam(), stdio: terminal ? ["inherit", "pipe", "inherit"] : ["pipe", "pipe", "pipe"] });
    const out = [];
    const err = [];
    // Terminali devralan alt süreçte insan yazıyor: süre sınırı yok (Ctrl+C her an keser).
    const zaman = terminal ? undefined : setTimeout(() => cocuk.kill("SIGKILL"), ALT_SURE_MS);
    cocuk.stdout.on("data", (c) => out.push(c));
    cocuk.stderr?.on("data", (c) => err.push(c));
    cocuk.on("error", (e) => {
      clearTimeout(zaman);
      reject(e);
    });
    cocuk.on("close", (status) => {
      clearTimeout(zaman);
      resolve({ status, stdout: Buffer.concat(out), stderr: Buffer.concat(err) });
    });
    if (terminal) return;
    cocuk.stdin.on("error", () => undefined);
    const girdi = Buffer.concat(parolalar.flatMap((p) => [p, Buffer.from("\n")]));
    cocuk.stdin.end(girdi, () => girdi.fill(0));
  });
}

/** PAKET komutunun elle yazılışı (BENIOKU için): `.ts` betik kendi projesinde `npx tsx` ile. */
function paketElle(kid, dizin) {
  const [betik, ...arg] = PAKET_KOMUTU.split(/\s+/);
  const argv = arg.map((a) => a.replaceAll("{kid}", kid).replaceAll("{dizin}", dizin)).join(" ");
  for (const proje of ["Teks-Erp/", "satici/sunucu/"]) {
    if (betik.startsWith(proje)) return `cd ${proje.slice(0, -1)} && npx tsx ${betik.slice(proje.length)} ${argv}`;
  }
  return `node ${betik} ${argv}`;
}

/** PAKET komut şablonu → node argv + çalışma dizini ({kid} · {dizin} yer tutucu; boşlukla ayrık, tırnak yok). */
function paketKomutu(sablon, kid, dizin) {
  const [betik, ...arg] = sablon.trim().split(/\s+/);
  if (!betik) throw new TorenHatasi("--paket-komutu boş", 2);
  const yol = path.resolve(REPO, betik);
  if (!fs.existsSync(yol)) throw new TorenHatasi(`PAKET aracı bulunamadı: ${yol}`, 2);
  const argv = arg.map((a) => a.replaceAll("{kid}", kid).replaceAll("{dizin}", dizin));
  if (!yol.endsWith(".ts")) return { cwd: REPO, nodeArgv: [yol, ...argv] };
  return { cwd: yol.startsWith(`${SATICI}${path.sep}`) ? SATICI : TEKS, nodeArgv: ["--import", "tsx", yol, ...argv] };
}

/** Alt süreç hatasının son satırları; parola baytı taşıyan çıktı hiç basılmaz. */
function hataOzeti(r, parolalar) {
  const ham = Buffer.concat([r.stderr ?? Buffer.alloc(0), r.stdout]);
  if (parolalar.some((p) => p.length > 0 && ham.indexOf(p) >= 0)) return "(çıktı parola içeriyordu — basılmadı)";
  return ham.toString("utf8").trim().split("\n").slice(-3).join(" | ").slice(0, 400);
}

async function kosVeDenetle(ad, cwd, betik, argv, parolalar, gizliler) {
  const r = await kos(cwd, betik, argv, parolalar);
  if (r.status !== 0) throw new TorenHatasi(`${ad} başarısız (çıkış ${r.status}): ${hataOzeti(r, gizliler)}`);
  return r;
}

// ---------------------------------------------------------------- dosya yardımcıları
const sha256 = (dosya) => crypto.createHash("sha256").update(fs.readFileSync(dosya)).digest("hex");
const jsonOku = (dosya) => JSON.parse(fs.readFileSync(dosya, "utf8"));

function dosyalar(kok, alt = "") {
  const out = [];
  for (const e of fs.readdirSync(path.join(kok, alt), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const yol = alt ? `${alt}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...dosyalar(kok, yol));
    else out.push(yol);
  }
  return out;
}

function dizinler(kok, alt = "") {
  const out = [];
  for (const e of fs.readdirSync(path.join(kok, alt), { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const yol = alt ? `${alt}/${e.name}` : e.name;
    out.push(yol, ...dizinler(kok, yol));
  }
  return out;
}

/** JWS yükü (imza burada DOĞRULANMAZ — sertifikayı üreten araç köke karşı doğruladı; burada yalnız künye için okunur). */
function jwsYuku(belge) {
  return JSON.parse(Buffer.from(String(belge).split(".")[1] ?? "", "base64url").toString("utf8"));
}

/** `.tkpub` ilk anahtar satırından yedek şifrelemesinin parmak izi (SHA-256(açık anahtar) ilk 8 bayt). */
function aliciParmakIzi(dosya) {
  const satir = fs.readFileSync(dosya, "utf8").split(/\r?\n/).map((s) => s.trim()).find((s) => s && !s.startsWith("#")) ?? "";
  if (!satir.startsWith("tkpub1:")) throw new TorenHatasi(`Yedek alıcısı okunamadı: ${dosya}`);
  const ham = Buffer.from(satir.slice(7), "base64url").subarray(0, 32);
  return crypto.createHash("sha256").update(ham).digest().subarray(0, 8).toString("hex");
}

function kaynak() {
  const git = (args) => spawnSync("git", ["-C", REPO, ...args], { encoding: "utf8" });
  const sha = git(["rev-parse", "--short=12", "HEAD"]);
  const durum = git(["status", "--porcelain", "--", "satici/sunucu", "Teks-Erp/scripts", "Teks-Erp/src", "deploy/satici"]);
  return { commit: sha.status === 0 ? sha.stdout.trim() : "ölçülemedi", kirli: durum.status === 0 ? durum.stdout.trim().length > 0 : null };
}

function modulListesi(deger) {
  if (deger === "yok") return [];
  if (deger !== undefined) {
    const liste = [...new Set(deger.split(",").map((s) => s.trim()).filter(Boolean))];
    for (const m of liste) if (!/^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/.test(m)) throw new TorenHatasi(`--moduller: biçimsiz modül anahtarı ${m}`, 2);
    return liste;
  }
  const katalog = jsonOku(path.join(TEKS, "src/lib/license/sifreli-moduller.json"));
  return [...new Set(katalog.paketler.map((p) => p.modul))];
}

// ---------------------------------------------------------------- tören
function onkosullar(hedef, usb) {
  if (Number(process.versions.node.split(".")[0]) < 22) throw new TorenHatasi(`Node ≥ 22 gerekli (${process.versions.node})`, 2);
  for (const [proje, ad] of [
    [SATICI, "satici/sunucu"],
    [TEKS, "Teks-Erp"],
  ]) {
    if (!fs.existsSync(path.join(proje, "node_modules", "tsx", "package.json"))) throw new TorenHatasi(`Önkoşul: ${ad} bağımlılıkları yok — (cd ${ad} && npm ci)`, 2);
  }
  if (fs.existsSync(hedef)) throw new TorenHatasi(`Hedef zaten var: ${hedef} — tören var olan anahtarların üstüne YAZMAZ (rotasyon yeni kid ile: docs/ops/URETIM-SATICI-TOREN.md §6)`, 2);
  const ust = path.dirname(hedef);
  const yarimlar = fs.existsSync(ust) ? fs.readdirSync(ust).filter((n) => n.startsWith(`${path.basename(hedef)}.yarim-`)) : [];
  if (yarimlar.length > 0) {
    throw new TorenHatasi(`Yarım kalmış tören dizini var: ${path.join(ust, yarimlar[0])} — içinde düz ALT/İNDİRME anahtarı olabilir; sil (rm -rf) ve yeniden başla`, 2);
  }
  if (usb !== undefined) usbHedefiDenetle(usb);
}

function usbHedefiDenetle(usb) {
  if (!fs.existsSync(usb) || !fs.statSync(usb).isDirectory()) throw new TorenHatasi(`USB kökü yok ya da dizin değil: ${usb}`, 2);
  if (fs.existsSync(path.join(usb, USB_KLASORU))) throw new TorenHatasi(`USB'de ${USB_KLASORU} zaten var — üstüne yazılmaz (başka USB ya da eskisini kenara al)`, 2);
}

async function toren(bayraklar) {
  const hedef = evYolu(bayraklar.get("dizin") || VARSAYILAN_DIZIN);
  const usb = bayraklar.has("usb") ? evYolu(bayraklar.get("usb")) : undefined;
  const yil = Number(bayraklar.get("yil") ?? new Date().getUTCFullYear());
  if (!Number.isInteger(yil) || yil < 2026 || yil > 2099) throw new TorenHatasi("--yil 2026–2099 olmalı", 2);
  const altGun = gun(bayraklar, "alt-gun", 180);
  const indGun = gun(bayraklar, "ind-gun", 365);
  const moduller = modulListesi(bayraklar.get("moduller"));
  const kid = { kok: `kok-${yil}-1`, alt: `alt-${yil}-1`, ind: `ind-${yil}`, paket: `paket-${yil}` };
  const paketSablonu = bayraklar.get("paket-komutu") || PAKET_KOMUTU;
  onkosullar(hedef, usb);
  paketKomutu(paketSablonu, kid.paket, "{dizin}");
  const kay = kaynak();
  const toplam = usb ? 11 : 10;
  const adim = (n, baslik) => process.stdout.write(`[${n}/${toplam}] ${baslik}\n`);

  console.log("TeksERP üretim satıcısı — anahtar töreni");
  console.log(`  kaynak : ${kay.commit} (kirli: ${kay.kirli === null ? "ölçülemedi" : kay.kirli ? "EVET — temiz ağaçta koşmalıydın" : "hayır"})`);
  console.log(`  hedef  : ${hedef}`);
  console.log(`  USB    : ${usb ?? "verilmedi — sonra: uretim-toren.mjs usb-kopyala --usb=<yol>"}`);
  console.log(`  kid'ler: ${kid.kok} · ${kid.alt} (${altGun} gün) · ${kid.ind} (${indGun} gün) · ${kid.paket} · modül: ${moduller.join(", ") || "yok"}`);
  console.log(`  PAKET  : ${paketSablonu}${paketSablonu === PAKET_KOMUTU ? "" : "  ← varsayılan DEĞİL (--paket-komutu)"}\n`);
  adim(1, "Önkoşullar ✓");

  adim(2, "Kök parolası (kâğıda yazılacak; PAKET parolasını 7. adımda PAKET aracı kendisi sorar)");
  const parolalar = [];
  const yarim = `${hedef}.yarim-${process.pid}`;
  const temizlik = () => {
    for (const p of parolalar) p.fill(0);
    fs.rmSync(yarim, { recursive: true, force: true });
  };
  const kesme = () => {
    temizlik();
    process.stderr.write("\nİptal edildi — hedefe hiçbir şey yazılmadı.\n");
    process.exit(130);
  };
  process.on("SIGINT", kesme);
  process.on("SIGTERM", kesme);
  try {
    const kokParola = await yeniParola("Kök parolası");
    parolalar.push(kokParola);

    fs.mkdirSync(path.dirname(hedef), { recursive: true, mode: 0o700 });
    for (const d of ["anahtarlar", "paket", "modul-anahtarlari", "yedek-alici", "yedek-ozel", "kurtarma"]) fs.mkdirSync(path.join(yarim, d), { recursive: true, mode: 0o700 });
    const A = path.join(yarim, "anahtarlar");
    const anahtar = (ad, argv, p) => kosVeDenetle(ad, SATICI, "scripts/anahtar.ts", argv, p, parolalar);

    adim(3, `KÖK ${kid.kok} (bütün sınıflar)`);
    await anahtar("kök", ["kok-uret", `--kid=${kid.kok}`, `--dizin=${A}`], [kokParola, kokParola]);
    adim(4, `ALT ${kid.alt} (kira imzası, ${altGun} gün)`);
    await anahtar("ALT", ["alt-uret", `--kid=${kid.alt}`, `--kok=${kid.kok}`, `--gun=${altGun}`, `--dizin=${A}`], [kokParola]);
    adim(5, `İNDİRME ${kid.ind} (${indGun} gün)`);
    await anahtar("İNDİRME", ["indirme-uret", `--kid=${kid.ind}`, `--kok=${kid.kok}`, `--gun=${indGun}`, `--dizin=${A}`], [kokParola]);
    adim(6, "Sunucu sırları (portal TOTP · etkinleştirme kodu · modül kasası)");
    await anahtar("sunucu sırları", ["sirlar-uret", `--dizin=${A}`], []);

    adim(7, `PAKET ${kid.paket} (bütünlük listesi imzası) — PAKET aracı kendi parolasını sorar (kökten FARKLI; parola yöneticisine)`);
    // Kök parolası PAKET aracına GEÇMEZ; TTY yoksa (bekçi) törenin stdin'inde kalan satırlar ona gider.
    const tty = process.stdin.isTTY === true;
    const kalan = tty ? [] : (stdinSatirlari ?? []).splice(0);
    parolalar.push(...kalan);
    const pk = paketKomutu(paketSablonu, kid.paket, path.join(yarim, "paket"));
    const pr = await kosNode(pk.cwd, pk.nodeArgv, kalan, tty);
    if (pr.status !== 0) throw new TorenHatasi(`PAKET başarısız (çıkış ${pr.status}): ${hataOzeti(pr, parolalar)}`);
    const paketYolu = path.join(yarim, "paket", `${kid.paket}.paket.json`);
    const pj = fs.existsSync(paketYolu) ? jsonOku(paketYolu) : null;
    if (!pj || pj.kid !== kid.paket || typeof pj.x !== "string") throw new TorenHatasi(`PAKET aracı beklenen dosyayı üretmedi (${kid.paket}.paket.json · kid · x) — PAKET_KOMUTU arayüzünü denetle`);
    if (typeof pj.d === "string") throw new TorenHatasi("PAKET dosyası PAROLASIZ (ham `d` alanı var) — üretim PAKET anahtarı parolalı olmalı");
    const ozetSatiri = pr.stdout.toString("utf8").trim().split("\n").pop() ?? "";
    if (paketSablonu.includes("--json") || ozetSatiri.startsWith("{")) {
      let po = null;
      try {
        po = JSON.parse(ozetSatiri);
      } catch {
        // aşağıda biçimsiz sayılır
      }
      if (!po || po.kid !== kid.paket || po.x !== pj.x || po.parolali !== true || (po.dosya && path.resolve(po.dosya) !== paketYolu)) {
        throw new TorenHatasi("PAKET aracının --json özeti dosyayla uyuşmuyor ya da parolalı değil (kid · x · dosya · parolali)");
      }
    }

    adim(8, `Şifreli modül anahtarları: ${moduller.join(", ") || "yok"}`);
    for (const m of moduller) {
      await kosVeDenetle(`modül ${m}`, SATICI, "scripts/modul-anahtari.ts", ["uret", `--modul=${m}`, "--surum=1", `--dizin=${path.join(yarim, "modul-anahtarlari")}`], [], parolalar);
    }

    adim(9, "Yedek alıcıları (Mac · kurtarma) + sınama");
    const yedek = (ad, argv, p = []) => kosVeDenetle(ad, TEKS, "scripts/yedek-sifrele.ts", argv, p, parolalar);
    const Y = path.join(yarim, "yedek-alici");
    const O = path.join(yarim, "yedek-ozel");
    await yedek("Mac alıcısı", ["anahtar-uret", "--ad", ALICI_MAC, "--dizin", Y, "--ozel-cikti", path.join(O, `${ALICI_MAC}.txt`)]);
    // Kurtarma anahtarı kök parolasıyla sarılır: kâğıttaki TEK parola USB kitini açar (kullanıcı kararı: kâğıda yalnız kök parolası).
    await yedek("kurtarma alıcısı", ["anahtar-uret", "--ad", ALICI_KURTARMA, "--dizin", O, "--parolali", "--parola-stdin"], [kokParola]);
    fs.renameSync(path.join(O, `${ALICI_KURTARMA}.tkpub`), path.join(Y, `${ALICI_KURTARMA}.tkpub`));
    const alicilar = [ALICI_MAC, ALICI_KURTARMA].flatMap((a) => ["--alici", path.join(Y, `${a}.tkpub`)]);
    const sinama = path.join(yarim, "yedek-sinama.txt");
    fs.writeFileSync(sinama, `TeksERP üretim satıcısı — yedek alıcısı sınaması · ${new Date().toISOString()} · ${crypto.randomBytes(8).toString("hex")}\n`, { mode: 0o600 });
    await yedek("sınama şifreleme", ["sifrele", "--girdi", sinama, "--cikti", `${sinama}.tkenc`, ...alicilar, "--duzu-sil"]);
    await yedek("sınama (Mac anahtarı)", ["dogrula", "--girdi", `${sinama}.tkenc`, "--anahtar", path.join(O, `${ALICI_MAC}.txt`)]);
    await yedek("sınama (kurtarma anahtarı)", ["dogrula", "--girdi", `${sinama}.tkenc`, "--anahtar", path.join(O, `${ALICI_KURTARMA}.tkkey`), "--parola-stdin"], [kokParola]);

    adim(10, "Kurtarma arşivi · künye · BENIOKU · izinler · yerine koy");
    const duzTar = path.join(yarim, "kurtarma", ".sirlar.tar");
    fs.writeFileSync(duzTar, "", { mode: 0o600 });
    const tar = spawnSync("tar", ["-C", yarim, "-cf", duzTar, "anahtarlar", "paket", ...(moduller.length ? ["modul-anahtarlari"] : [])], { env: altOrtam(), encoding: "utf8" });
    if (tar.status !== 0) throw new TorenHatasi(`kurtarma arşivi (tar) başarısız: ${(tar.stderr || "").trim().slice(0, 200)}`);
    const arsiv = path.join(yarim, "kurtarma", "sirlar.tar.tkenc");
    await yedek("kurtarma arşivi", ["sifrele", "--girdi", duzTar, "--cikti", arsiv, ...alicilar, "--duzu-sil"]);
    await yedek("kurtarma arşivi sınaması", ["dogrula", "--girdi", arsiv, "--anahtar", path.join(O, `${ALICI_MAC}.txt`)]);

    const kunye = kunyeKur(yarim, kid, moduller, kay);
    fs.writeFileSync(path.join(yarim, BENIOKU), beniOku(kunye, hedef), { mode: 0o600 });
    kunye.ozetler = Object.fromEntries(dosyalar(yarim).map((f) => [f, sha256(path.join(yarim, f))]));
    fs.writeFileSync(path.join(yarim, KUNYE), `${JSON.stringify(kunye, null, 2)}\n`, { mode: 0o600 });
    for (const d of ["", ...dizinler(yarim)]) fs.chmodSync(path.join(yarim, d), 0o700);
    for (const f of dosyalar(yarim)) fs.chmodSync(path.join(yarim, f), 0o600);
    fs.renameSync(yarim, hedef);
  } catch (e) {
    temizlik();
    if (e instanceof TorenHatasi) throw new TorenHatasi(`${e.message}\n  → yarım dizin silindi; hedefe (${hedef}) hiçbir şey yazılmadı`, e.kod);
    throw e;
  } finally {
    for (const p of parolalar) p.fill(0);
    process.off("SIGINT", kesme);
    process.off("SIGTERM", kesme);
  }

  let usbHatasi = null;
  if (usb) {
    adim(11, `USB kopyası → ${path.join(usb, USB_KLASORU)}`);
    try {
      usbKopyala(hedef, usb);
    } catch (e) {
      usbHatasi = e;
    }
  }
  ozetBas(hedef, jsonOku(path.join(hedef, KUNYE)), usb && !usbHatasi);
  if (usbHatasi) throw new TorenHatasi(`Tören TAMAM (${hedef}) ama USB kopyası başarısız: ${usbHatasi.message}\n  → yeniden: node deploy/satici/uretim-toren.mjs usb-kopyala --usb=<yol>`);
}

function kunyeKur(kok, kid, moduller, kay) {
  const A = path.join(kok, "anahtarlar");
  const kokDosya = jsonOku(path.join(A, `${kid.kok}.kok.json`));
  const altDosya = jsonOku(path.join(A, `${kid.alt}.anahtar.json`));
  const indDosya = jsonOku(path.join(A, `${kid.ind}.anahtar.json`));
  const paketDosya = jsonOku(path.join(kok, "paket", `${kid.paket}.paket.json`));
  const altS = jwsYuku(altDosya.sertifika);
  const indS = jwsYuku(indDosya.sertifika);
  const modulKunye = moduller.map((m) => {
    const d = jsonOku(path.join(kok, "modul-anahtarlari", `${m}.1.json`));
    return { modul: d.modul, surum: d.surum, kid: d.kid, dosya: `modul-anahtarlari/${m}.1.json` };
  });
  const alicilar = [ALICI_MAC, ALICI_KURTARMA].map((ad) => ({
    ad,
    parmakIzi: aliciParmakIzi(path.join(kok, "yedek-alici", `${ad}.tkpub`)),
    ozelYari: ad === ALICI_MAC ? `yedek-ozel/${ad}.txt (düz, YALNIZ Mac)` : `yedek-ozel/${ad}.tkkey (kök parolasıyla sarılı; Mac → USB)`,
  }));
  return {
    v: 1,
    tur: "tekserp-uretim-satici-toren",
    tarih: new Date().toISOString(),
    kaynak: kay,
    kok: { kid: kokDosya.kid, x: kokDosya.x, siniflar: kokDosya.siniflar, dosya: `anahtarlar/${kid.kok}.kok.json` },
    alt: { kid: altDosya.kid, x: altDosya.x, siniflar: altS.siniflar, baslangic: altS.baslangic, bitis: altS.bitis, dosya: `anahtarlar/${kid.alt}.anahtar.json` },
    indirme: { kid: indDosya.kid, x: indDosya.x, baslangic: indS.baslangic, bitis: indS.bitis, dosya: `anahtarlar/${kid.ind}.anahtar.json` },
    paket: { kid: paketDosya.kid, x: paketDosya.x, dosya: `paket/${kid.paket}.paket.json` },
    sunucuSirlari: SUNUCU_SIRLARI.map((f) => `anahtarlar/${f}`),
    modulAnahtarlari: modulKunye,
    yedekAlicilari: alicilar,
    capaSatirlari: {
      ROOT_PUBLIC_KEYS: `{ kid: "${kokDosya.kid}", x: "${kokDosya.x}", classes: ${JSON.stringify(kokDosya.siniflar)} }`,
      PACKAGE_PUBLIC_KEYS: `{ kid: "${paketDosya.kid}", x: "${paketDosya.x}" }`,
      CF_WORKER_INDIRME: `{ "kid": "${indDosya.kid}", "x": "${indDosya.x}" }`,
    },
    vds: {
      anahtarBirimi: ["anahtarlar/*", `paket/${kid.paket}.paket.json (ara kopya — USB kopyası alınana dek)`],
      yedekAlici: alicilar.map((a) => `yedek-alici/${a.ad}.tkpub`),
      kasayaIceAktar: modulKunye.map((m) => m.dosya),
    },
    usb: usbListesi({ kok: { dosya: `anahtarlar/${kid.kok}.kok.json` }, paket: { dosya: `paket/${kid.paket}.paket.json` }, yedekAlicilari: alicilar }),
  };
}

/** USB'ye giden küme — YALNIZ şifreli ya da açık dosyalar (opt-in liste; düz sır bu listeye giremez). */
function usbListesi(k) {
  return [
    k.kok.dosya,
    k.paket.dosya,
    `yedek-ozel/${ALICI_KURTARMA}.tkkey`,
    ...k.yedekAlicilari.map((a) => `yedek-alici/${a.ad}.tkpub`),
    "kurtarma/sirlar.tar.tkenc",
    "yedek-sinama.txt.tkenc",
    BENIOKU,
    KUNYE,
  ];
}

function beniOku(k, hedef) {
  const m = k.modulAnahtarlari.map((x) => x.dosya).join(" · ") || "(yok)";
  return `# TeksERP üretim satıcısı — anahtar kiti

Tören: ${k.tarih} · kaynak ${k.kaynak.commit} · tören dizini \`${hedef}\`
Açık bilgiler (kid · açık anahtar · parmak izi · dosya özetleri): \`${KUNYE}\`. Runbook: \`docs/ops/URETIM-SATICI-TOREN.md\`.
Bu dosyada SIR YOKTUR. Parolalar hiçbir dosyaya yazılmaz.

## Ne nedir, nerede durur

| Dosya | Ne | Koruma | Nerede |
|---|---|---|---|
| \`${k.kok.dosya}\` | KÖK — HAK ve ALT/İNDİRME/BAYİ sertifikalarını imzalar | kök parolası (scrypt → AES-256-GCM) | Mac · VDS anahtar birimi · USB |
| \`${k.alt.dosya}\` | ALT — kira imzası (sertifika ${k.alt.bitis.slice(0, 10)}'e dek) | düz, 0600 | Mac · VDS anahtar birimi |
| \`${k.indirme.dosya}\` | İNDİRME — indirme belirteci (sertifika ${k.indirme.bitis.slice(0, 10)}'e dek) | düz, 0600 | Mac · VDS anahtar birimi |
| \`${k.sunucuSirlari.join("` · `")}\` | sunucu sırları (portal TOTP sarma · etkinleştirme kodu özeti · modül kasası) | düz, 0600 | Mac · VDS anahtar birimi |
| \`${k.paket.dosya}\` | PAKET — korumalı paketin bütünlük listesi imzası | paket parolası | Mac · VDS anahtar birimi (ara kopya) · USB |
| ${m} | şifreli modül anahtarları | düz, 0600 | Mac (derleme) · VDS kasası (\`ice-aktar\`; dosya VDS'te kalmaz) |
| \`yedek-alici/*.tkpub\` | satıcı yedeklerinin alıcıları (açık) | — | Mac · VDS \`yedek-alici/\` |
| \`yedek-ozel/${ALICI_MAC}.txt\` | satıcı yedeklerini açar (rutin) | düz, 0600 | YALNIZ Mac |
| \`yedek-ozel/${ALICI_KURTARMA}.tkkey\` | satıcı yedeklerini açar (kurtarma) | KÖK parolası | Mac → USB |
| \`kurtarma/sirlar.tar.tkenc\` | anahtarlar/ + paket/ + modül anahtarları arşivi | iki yedek alıcısına şifreli | Mac · USB |
| \`yedek-sinama.txt.tkenc\` | alıcı sınama dosyası (anahtar hâlâ açıyor mu?) | iki alıcıya şifreli | Mac · USB |

- **Kâğıt:** YALNIZ kök parolası (kasada). Paket parolası parola yöneticisinde; kaybı telafi edilir (yeni \`paket-<yıl>-2\` + çapa sürümü).
- **USB:** \`node deploy/satici/uretim-toren.mjs usb-kopyala --usb=/Volumes/<USB>\` — yalnız şifreli/açık dosyaları kopyalar ve özetler (liste künyenin \`usb\` alanında).
- **VDS'e ASLA gitmeyen:** \`yedek-ozel/\` (yedeği açan anahtarlar), \`kurtarma/\`, modül anahtarı dosyaları (yalnız kasaya içe aktarılır).

## Geri yükleme

1. **VDS anahtar birimi kayboldu, Mac sağlam:** \`anahtarlar/\` (+ ara kopya paket) runbook'taki kopyalama adımıyla yeniden VDS'e.
2. **Mac kayboldu, USB + kâğıt sağlam:** kök parolasıyla kurtarma arşivini aç:
   \`cd Teks-Erp && npx tsx scripts/yedek-sifrele.ts coz --girdi <USB>/${USB_KLASORU}/kurtarma/sirlar.tar.tkenc --cikti /tmp/sirlar.tar --anahtar <USB>/${USB_KLASORU}/yedek-ozel/${ALICI_KURTARMA}.tkkey\`
   → \`mkdir -m 700 <yeni tören dizini> && tar -xf /tmp/sirlar.tar -C <yeni tören dizini> && rm -P /tmp/sirlar.tar\`.
3. **Satıcı DB'si:** VDS yedeği \`satici_<damga>.dump.tkenc\` ve \`anahtarlar_<damga>.tar.tkenc\` bu iki özel yarıdan biriyle açılır (runbook).
4. **Anahtar hâlâ açıyor mu:** \`npx tsx scripts/yedek-sifrele.ts dogrula --girdi yedek-sinama.txt.tkenc --anahtar <özel yarı>\` → \`butunluk TAMAM\`.

## Rotasyon (hiçbir araç var olan dosyanın üstüne yazmaz — rotasyon yeni kid'dir)

- ALT (sertifika ${k.alt.bitis.slice(0, 10)}): \`cd satici/sunucu && npx tsx scripts/anahtar.ts alt-uret --kid=alt-<yıl>-<n> --kok=${k.kok.kid} --dizin=${hedef}/anahtarlar\` → VDS anahtar birimine kopya; satıcı dakikada bir yeniden okur. Sonra kurtarma arşivi yenilenir (runbook).
- İNDİRME (sertifika ${k.indirme.bitis.slice(0, 10)}): \`indirme-uret --kid=ind-<yıl+1> --kok=${k.kok.kid}\` + CF Worker'a açık anahtar.
- PAKET (yıllık): \`${paketElle("paket-<yıl>", `${hedef}/paket`)}\` (repo kökünden; parolayı araç sorar) + güven çapası sürümü.
`;
}

function ozetBas(hedef, k, usbTamam) {
  const kisa = (s) => `${s.slice(0, 10)}`;
  console.log("\n✅ Tören tamam.");
  console.log(`  KÖK      ${k.kok.kid.padEnd(12)} x=${k.kok.x}  sınıflar ${k.kok.siniflar.join("·")}`);
  console.log(`  ALT      ${k.alt.kid.padEnd(12)} x=${k.alt.x}  ${kisa(k.alt.baslangic)} → ${kisa(k.alt.bitis)}`);
  console.log(`  İNDİRME  ${k.indirme.kid.padEnd(12)} x=${k.indirme.x}  ${kisa(k.indirme.baslangic)} → ${kisa(k.indirme.bitis)}`);
  console.log(`  PAKET    ${k.paket.kid.padEnd(12)} x=${k.paket.x}`);
  for (const m of k.modulAnahtarlari) console.log(`  MODÜL    ${m.modul} ${m.surum}. sürüm  ${m.kid}`);
  for (const a of k.yedekAlicilari) console.log(`  YEDEK    ${a.ad.padEnd(24)} parmak izi ${a.parmakIzi}`);
  console.log(`  dizin    ${hedef} (700/600) · künye ${KUNYE} · ${BENIOKU}`);
  console.log("\nSonraki adımlar (docs/ops/URETIM-SATICI-TOREN.md):");
  console.log("  1. Kâğıt: YALNIZ kök parolası → kasa. Paket parolası → parola yöneticisi.");
  console.log(`  2. ${usbTamam ? "USB kopyası alındı — USB'yi kasaya koy." : "USB kopyası BEKLİYOR: USB gelince → node deploy/satici/uretim-toren.mjs usb-kopyala --usb=/Volumes/<USB>"}`);
  console.log(`  3. Güven çapası (repo commit'i): cd Teks-Erp && npx tsx scripts/guven-capasi-ekle.ts kok --dosya=${path.join(hedef, k.kok.dosya)}`);
  console.log(`     ve … paket --dosya=${path.join(hedef, k.paket.dosya)} — önce kuru, sonra --yaz (yalnız kid + x okur)`);
  console.log("  4. VDS: anahtar birimi + üretim satıcısı (docs/ops/SATICI-KURULUM.md §13).");
  console.log(`  5. CF Worker İNDİRME anahtarı: ${k.capaSatirlari.CF_WORKER_INDIRME}`);
}

// ---------------------------------------------------------------- usb-kopyala · dogrula
function usbKopyala(hedef, usb) {
  usbHedefiDenetle(usb);
  const kunyeYolu = path.join(hedef, KUNYE);
  if (!fs.existsSync(kunyeYolu)) throw new TorenHatasi(`Tören künyesi yok: ${kunyeYolu} — önce tören`, 2);
  const k = jsonOku(kunyeYolu);
  const liste = usbListesi(k);
  for (const f of liste) {
    if (!fs.existsSync(path.join(hedef, f))) throw new TorenHatasi(`USB kümesinde eksik dosya: ${f}`);
    if (f !== KUNYE && k.ozetler?.[f] !== sha256(path.join(hedef, f))) throw new TorenHatasi(`Mac'teki dosya künyeyle uyuşmuyor: ${f} — kopyalanmadı`);
  }
  const kok = path.join(usb, USB_KLASORU);
  fs.mkdirSync(kok, { mode: 0o700 });
  for (const f of liste) {
    fs.mkdirSync(path.dirname(path.join(kok, f)), { recursive: true, mode: 0o700 });
    fs.copyFileSync(path.join(hedef, f), path.join(kok, f), fs.constants.COPYFILE_EXCL);
    if (sha256(path.join(kok, f)) !== sha256(path.join(hedef, f))) throw new TorenHatasi(`USB'deki kopya kaynakla aynı değil: ${f}`);
  }
  console.log(`  USB: ${liste.length} dosya kopyalandı, özetler kaynakla aynı → ${kok}`);
}

function dogrula(hedef) {
  const k = jsonOku(path.join(hedef, KUNYE));
  let hata = 0;
  const yaz = (ok, s) => {
    if (!ok) hata++;
    console.log(`${ok ? "✅" : "❌"} ${s}`);
  };
  for (const d of ["", ...dizinler(hedef)]) {
    const mod = fs.statSync(path.join(hedef, d)).mode & 0o777;
    if (mod !== 0o700) yaz(false, `dizin ${d || "."} izni ${mod.toString(8)} (700 olmalı)`);
  }
  for (const [f, oz] of Object.entries(k.ozetler ?? {})) {
    const yol = path.join(hedef, f);
    if (!fs.existsSync(yol)) {
      yaz(false, `eksik: ${f}`);
      continue;
    }
    const mod = fs.statSync(yol).mode & 0o777;
    if (mod !== 0o600) yaz(false, `${f} izni ${mod.toString(8)} (600 olmalı)`);
    if (sha256(yol) !== oz) yaz(false, `özet değişti: ${f}`);
  }
  const fazla = dosyalar(hedef).filter((f) => f !== KUNYE && !(f in (k.ozetler ?? {})));
  for (const f of fazla) console.log(`ℹ️  künyede olmayan dosya (rotasyon sonrası beklenir): ${f}`);
  yaz(hata === 0, `${Object.keys(k.ozetler ?? {}).length} dosya: izinler + özetler künyeyle aynı (${k.kok.kid} · ${k.paket.kid})`);
  if (hata > 0) throw new TorenHatasi(`${hata} uyuşmazlık`);
}

async function main() {
  const { komut, bayraklar } = argumanlar(process.argv.slice(2));
  const hedef = evYolu(bayraklar.get("dizin") || VARSAYILAN_DIZIN);
  if (komut === "toren") return toren(bayraklar);
  if (komut === "dogrula") return dogrula(hedef);
  if (!bayraklar.get("usb")) throw new TorenHatasi("usb-kopyala: --usb=<USB kökü> zorunlu", 2);
  console.log(`USB kopyası: ${hedef} → ${path.join(evYolu(bayraklar.get("usb")), USB_KLASORU)}`);
  usbKopyala(hedef, evYolu(bayraklar.get("usb")));
}

main().then(
  () => process.exit(0),
  (e) => {
    process.stderr.write(`HATA: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(e instanceof TorenHatasi ? e.kod : 1);
  },
);
