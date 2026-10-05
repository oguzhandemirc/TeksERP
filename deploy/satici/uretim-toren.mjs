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
// (hepsi ya da hiçbiri — yarım kalan dizin, düz ALT/İNDİRME taşıdığı için silinir). TOCTOU: yol boyunca sembolik bağ
// RED (lstat; root'a ait sistem bağı hariç), üst dizin bizim ve grup/başkalarına kapalı, yarım dizin recursive OLMADAN
// yaratılır (varsa RED), hedef rename'den hemen önce yeniden ölçülüp özel mkdir ile sahiplenilir, dosyalar `wx`.
// Kaynak: ağaç TEMİZ (git status boş) ve HEAD origin/main'de ya da `--etiket=<ad>` etiketinin commit'i; npm ls hatasız —
// değilse RED (parola sorulmadan). HEAD sha + package-lock özetleri ekrana ve künyeye yazılır.
//
// Kullanım (repo kökünden; önkoşul: `git fetch` + origin/main · `cd satici/sunucu && npm ci` · `cd Teks-Erp && npm ci`):
//   node deploy/satici/uretim-toren.mjs [--dizin=~/.tekserp/satici-uretim] [--yil=<YYYY>] [--alt-gun=180]
//                                      [--ind-gun=365] [--moduller=<a.b,c.d|yok>] [--usb=<USB kökü>] [--etiket=<git etiketi>]
//                                      [--paket-komutu="<betik> <argümanlar; {kid} {dizin} yer tutucu>"]
//   node deploy/satici/uretim-toren.mjs usb-kopyala --usb=/Volumes/<USB> [--dizin=…]
//       Var olan ŞİFRELİ dosyaları + açık künyeyi + BENIOKU'yu USB'ye kopyalar ve özetleri doğrular; HİÇBİR ŞEY üretmez.
//   node deploy/satici/uretim-toren.mjs dogrula [--dizin=…]
//       Salt okuma: izinler (dizin 700 · dosya 600) + dosya özetleri künyeyle aynı mı.
//   node deploy/satici/uretim-toren.mjs donem [--dizin=…] [--etiket=<ad>] [--kuyruk=<kuyruk.json>] [--iptal=<kid>[,…]]
//                                            [--neden=<metin>] [--ara-siniflar=URETIM,DR,DEMO,TEST] [--yil=<YYYY>] [--kok=<kid>]
//                                            [--karsi-dizin=<öteki ortamın tören dizini>]
//       YILLIK DÖNEM TÖRENİ (G4 §2.4, K4): kök parolası BİR kez + YENİ ara imzacı parolası (iki kez, kökten FARKLI) →
//       yeni ALT · HAK ara imzacısı · İNDİRME (her biri 395 gün = 365 + 30 örtüşme) · iptal belgesi (ilk törende sıra 1;
//       `--iptal` verilirse sıra + 1, önceki satırlar taşınır; yoksa önceki belge AYNEN) · kuyruktaki kök imzası bekleyen
//       HAK'lar (`--kuyruk`, VDS'ten `anahtar.js kuyruk-disa-aktar`) → `<dizin>/donemler/<damga>/vds-paketi/` (KÖK YOK;
//       DONEM-KUNYE.json + SHA256SUMS). Yarım dizinde kurulur, sonda TEK rename; ortada düşerse hiçbir şey kalmaz.
//       Ortam kök dosyasının kimliğinden (`kok-*` üretim · `hazirlik-*` hazırlık; bayrak YOK); hazırlıkta kid'ler
//       `alt|ara|ind-hazirlik-<yıl>-<n>`. Yeni kid karşı ortamın kalıbında ya da anahtar kümesinde (`--karsi-dizin`,
//       varsayılan öteki ortamın `~/.tekserp/satici-*` dizini) ise parola sorulmadan RED.
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
// Ortam başına Mac'teki tören dizini: dönem töreni KARŞI ortamın anahtar kümesini buradan okur (`--karsi-dizin` ezer).
const ORTAM_DIZINI = { uretim: "~/.tekserp/satici-uretim", hazirlik: "~/.tekserp/satici-hazirlik" };
// Dönem kid'i ortamın KALIBINDADIR; iki kalıp ayrıktır (hazırlık ALT/ARA/İND'si üretiminkiyle aynı kid'i alamaz).
const ORTAM_KID_KALIBI = { uretim: /^(alt|ara|ind)-\d{4}-\d{1,3}$/, hazirlik: /^(alt|ara|ind)-hazirlik-\d{4}-\d{1,3}$/ };
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
  toren: ["dizin", "yil", "alt-gun", "ind-gun", "moduller", "usb", "etiket", "paket-komutu"],
  donem: ["dizin", "etiket", "kuyruk", "iptal", "neden", "ara-siniflar", "yil", "kok", "karsi-dizin"],
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

/** Alt süreç hatasının ilk asıl hata satırı + son satırları (son satır çoğu kez yalnız "Node.js vX"); parola baytı taşıyan çıktı hiç basılmaz. */
function hataOzeti(r, parolalar) {
  const ham = Buffer.concat([r.stderr ?? Buffer.alloc(0), r.stdout]);
  if (parolalar.some((p) => p.length > 0 && ham.indexOf(p) >= 0)) return "(çıktı parola içeriyordu — basılmadı)";
  const satirlar = ham.toString("utf8").trim().split("\n");
  const son = satirlar.slice(-3);
  const asil = [/Cannot find (module|package)/, /^\s*(\w+ )?\w*Error( \[\w+\])?:/, /ENOENT|EACCES/].reduce((bulunan, kalip) => bulunan ?? satirlar.find((l) => kalip.test(l)), undefined);
  const secilen = asil !== undefined && !son.includes(asil) ? [asil.trim().slice(0, 200), ...son] : son;
  return secilen.join(" | ").slice(0, 600);
}

async function kosVeDenetle(ad, cwd, betik, argv, parolalar, gizliler) {
  const r = await kos(cwd, betik, argv, parolalar);
  if (r.status !== 0) throw new TorenHatasi(`${ad} başarısız (çıkış ${r.status}): ${hataOzeti(r, gizliler)}`);
  return r;
}

// ---------------------------------------------------------------- dosya yardımcıları
const sha256 = (dosya) => crypto.createHash("sha256").update(fs.readFileSync(dosya)).digest("hex");
const jsonOku = (dosya) => JSON.parse(fs.readFileSync(dosya, "utf8"));

/**
 * Kökün ORTAMI kök dosyasının KENDİ kimliğinden çözülür, argümanla ezilemez: `hazirlik-*` (sınıfları yalnız TEST/DEMO)
 * hazırlık, `kok-*` üretim. Dosyadaki kid istenenden farklıysa ya da sınıflar kimlikle çelişirse parola sorulmadan RED.
 */
function kokOrtami(kokDosya, istenenKid) {
  const kok = jsonOku(kokDosya);
  if (kok.kid !== istenenKid) throw new TorenHatasi(`Kök dosyasının kimliği (${kok.kid}) istenen kök (${istenenKid}) değil — ortam çözülemedi`, 2);
  if (/^kok-/.test(kok.kid)) return "uretim";
  const siniflar = Array.isArray(kok.siniflar) ? kok.siniflar : [];
  if (/^hazirlik-/.test(kok.kid) && siniflar.length > 0 && siniflar.every((c) => c === "TEST" || c === "DEMO")) return "hazirlik";
  throw new TorenHatasi(`Kök ${kok.kid} ortamı belirsiz: hazırlık kökü yalnız TEST/DEMO taşır (${siniflar.join("·") || "sınıf yok"})`, 2);
}

/**
 * Yeni kid'ler KARŞI ortamın kalıbında ya da anahtar kümesinde olamaz (fail-closed): iki satıcı aynı kid'i basarsa
 * CF Worker aynı kid'i iki listede görür ve bütün indirmeleri 503'le durdurur, sertifika/iptal kayıtları karışır.
 * Küme: karşı ortamın tören dizinindeki ilk anahtarlar + dönem paketleri (dizin yoksa yalnız kalıp ölçülür).
 */
function karsiOrtamDenetle(ortam, kidler, karsiDizin) {
  const karsi = ortam === "uretim" ? "hazirlik" : "uretim";
  for (const k of kidler) {
    if (!ORTAM_KID_KALIBI[ortam].test(k) || ORTAM_KID_KALIBI[karsi].test(k)) {
      throw new TorenHatasi(`Yeni kid ${k} ${ortam === "uretim" ? "ÜRETİM" : "HAZIRLIK"} kalıbında değil (karşı ortamla çakışabilir) — tören durduruldu, hiçbir anahtar üretilmedi`, 2);
    }
  }
  if (!lstatYa(karsiDizin)?.isDirectory()) return { dizin: karsiDizin, adet: null };
  const kume = new Set();
  for (const d of anahtarDizinleri(karsiDizin)) {
    for (const ad of fs.readdirSync(d)) {
      const m = /^((?:alt|ara|ind)-[a-z0-9-]+)\.(anahtar|ara|sertifika)\.json$/.exec(ad);
      if (m) kume.add(m[1]);
    }
  }
  const cakisan = kidler.filter((k) => kume.has(k));
  if (cakisan.length > 0) {
    throw new TorenHatasi(`Yeni kid ${cakisan.join(", ")} KARŞI ortamın (${karsi}) anahtar kümesinde var: ${karsiDizin} — tören durduruldu, hiçbir anahtar üretilmedi`, 2);
  }
  return { dizin: karsiDizin, adet: kume.size };
}

/**
 * CF Worker İNDİRME listesi (L2-8): kökün ortamı listeyi (`uretim` | `hazirlik`), `deploy/kanallar.json`da o kipe
 * (`backend.guvenCapasi`) bağlı kanallar satırın kanal kümesini verir. Kanal yoksa satır kurulamaz → parola sorulmadan RED.
 */
function workerListesi(liste) {
  const kayit = path.join(REPO, "deploy", "kanallar.json");
  if (!fs.existsSync(kayit)) throw new TorenHatasi(`Kanal kaydı yok: ${kayit} — CF Worker İNDİRME satırı kurulamaz`, 2);
  const kanallar = Object.entries(jsonOku(kayit).kanallar ?? {})
    .filter(([, k]) => k?.backend?.guvenCapasi === liste)
    .map(([kod]) => kod)
    .sort();
  if (kanallar.length === 0) throw new TorenHatasi(`deploy/kanallar.json'da ${liste} çapalı kanal yok — CF Worker İNDİRME satırı kurulamaz`, 2);
  return { liste, kanallar };
}

/** Panelde `TKL_INDIRME_AYAR.indirmeListesi.<liste>` dizisine OLDUĞU GİBİ yapıştırılan satır; pencere sertifikanınki. */
function workerSatiri(worker, ind) {
  return JSON.stringify({ kid: ind.kid, x: ind.x, kanallar: worker.kanallar, baslangic: ind.baslangic, bitis: ind.bitis });
}

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

/** Kilit dosyaları: künyeye ve ekrana özetleri (tören hangi bağımlılık ağacıyla koştu). */
const KILITLER = ["satici/sunucu/package-lock.json", "Teks-Erp/package-lock.json"];

/**
 * Tören yalnız DONMUŞ kaynaktan koşar (parola sorulmadan önce, RED — uyarı değil): ağaç temiz (izlenen + izlenmeyen),
 * HEAD origin/main'de ya da `--etiket`in gösterdiği commit; iki projede `npm ls --all` hatasız (npm ci sonrası).
 */
function kaynakDenetle(etiket) {
  const git = (args) => spawnSync("git", ["-C", REPO, ...args], { encoding: "utf8", env: altOrtam() });
  const bas = git(["rev-parse", "--verify", "HEAD^{commit}"]);
  if (bas.status !== 0) throw new TorenHatasi(`Kaynak ölçülemedi (git rev-parse HEAD): ${(bas.stderr || "").trim().slice(0, 160)}`, 2);
  const commit = bas.stdout.trim();
  const durum = git(["status", "--porcelain", "--untracked-files=all"]);
  if (durum.status !== 0) throw new TorenHatasi(`Kaynak ölçülemedi (git status): ${(durum.stderr || "").trim().slice(0, 160)}`, 2);
  const kirli = durum.stdout.split("\n").filter(Boolean);
  if (kirli.length > 0) {
    throw new TorenHatasi(`Ağaç KİRLİ (${kirli.length} değişiklik; ilk: ${kirli[0].trim()}) — tören yalnız temiz ağaçta koşar: git status boş olmalı`, 2);
  }
  let dayanak;
  if (etiket !== undefined) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/.test(etiket)) throw new TorenHatasi("--etiket biçimsiz", 2);
    const e = git(["rev-parse", "--verify", "--quiet", `refs/tags/${etiket}^{commit}`]);
    if (e.status !== 0 || e.stdout.trim() !== commit) throw new TorenHatasi(`--etiket=${etiket} HEAD'i göstermiyor (${e.status === 0 ? e.stdout.trim().slice(0, 12) : "etiket yok"} ≠ ${commit.slice(0, 12)})`, 2);
    dayanak = `etiket:${etiket}`;
  } else {
    const ana = git(["rev-parse", "--verify", "--quiet", "refs/remotes/origin/main^{commit}"]);
    if (ana.status !== 0) throw new TorenHatasi("origin/main yok — önce git fetch (ya da --etiket=<ad>)", 2);
    if (git(["merge-base", "--is-ancestor", commit, "refs/remotes/origin/main"]).status !== 0) {
      throw new TorenHatasi(`HEAD (${commit.slice(0, 12)}) origin/main'de DEĞİL — git fetch && git switch --detach origin/main (ya da açık --etiket=<ad>)`, 2);
    }
    dayanak = "origin/main";
  }
  const kilitler = Object.fromEntries(KILITLER.map((k) => [k, fs.existsSync(path.join(REPO, k)) ? sha256(path.join(REPO, k)) : "YOK"]));
  for (const [proje, ad] of [
    [SATICI, "satici/sunucu"],
    [TEKS, "Teks-Erp"],
  ]) {
    const r = spawnSync("npm", ["ls", "--all"], { cwd: proje, env: altOrtam(), encoding: "utf8", timeout: ALT_SURE_MS });
    if (r.status !== 0) {
      const neden = r.error ? r.error.message : (r.stderr || r.stdout || "").trim().split("\n").find((l) => /ERR|missing|invalid|extraneous/i.test(l)) ?? `çıkış ${r.status}`;
      throw new TorenHatasi(`${ad}: npm ls --all hatalı (${neden.slice(0, 160)}) — bağımlılıklar kilit dosyasıyla aynı değil: (cd ${ad} && npm ci)`, 2);
    }
  }
  return { commit, dayanak, kirli: false, kilitler, npmLs: "hatasız" };
}

// ---------------------------------------------------------------- yol güvenliği (TOCTOU)
const lstatYa = (p) => {
  try {
    return fs.lstatSync(p);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
};

/** Kökten `hedef`e her VAR bileşen gerçek dizin; sembolik bağ RED (root'a ait sistem bağı — macOS /var · /tmp — hariç). */
function yolDenetle(hedef) {
  let yol = path.parse(hedef).root;
  for (const parca of path.resolve(hedef).split(path.sep).filter(Boolean)) {
    yol = path.join(yol, parca);
    const st = lstatYa(yol);
    if (st === null) return;
    if (st.isSymbolicLink()) {
      if (st.uid === 0) continue;
      throw new TorenHatasi(`Yolda sembolik bağ: ${yol} — tören bağ izlemez; gerçek yolu ver`, 2);
    }
    if (!st.isDirectory() && yol !== path.resolve(hedef)) throw new TorenHatasi(`Yol bileşeni dizin değil: ${yol}`, 2);
  }
}

/** Üst dizin: eksik bileşenler TEK TEK (recursive değil) 0700 yaratılır; sonuç bizim, gerçek dizin, grup/başkalarına kapalı. */
function ustHazirla(ust) {
  yolDenetle(ust);
  const eksik = [];
  for (let p = ust; lstatYa(p) === null; p = path.dirname(p)) eksik.unshift(p);
  for (const d of eksik) fs.mkdirSync(d, { mode: 0o700 });
  const st = fs.lstatSync(ust);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new TorenHatasi(`Üst dizin gerçek dizin değil: ${ust}`, 2);
  if (typeof process.getuid === "function" && st.uid !== process.getuid()) throw new TorenHatasi(`Üst dizin başka kullanıcının: ${ust}`, 2);
  if ((st.mode & 0o022) !== 0) throw new TorenHatasi(`Üst dizine grup/başkaları yazabiliyor (${(st.mode & 0o777).toString(8)}): ${ust} — chmod go-w`, 2);
  yolDenetle(ust);
}

/** Recursive OLMADAN dizin yaratır; varsa (araya giren dizin ya da bağ) RED. */
function ozelDizin(p) {
  try {
    fs.mkdirSync(p, { mode: 0o700 });
  } catch (e) {
    if (e.code === "EEXIST") throw new TorenHatasi(`Araya giren yol: ${p} tören başladıktan sonra doğdu — dokunulmadı`);
    throw e;
  }
  const st = fs.lstatSync(p);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new TorenHatasi(`Yaratılan dizin gerçek dizin değil: ${p}`);
}

/** Dosya YALNIZ yoksa yazılır (`wx`, 0600): araya giren dosya/bağ ezilmez. */
const dosyaYaz = (p, icerik) => fs.writeFileSync(p, icerik, { mode: 0o600, flag: "wx" });

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
function onkosullar(hedef, usb, etiket) {
  if (Number(process.versions.node.split(".")[0]) < 22) throw new TorenHatasi(`Node ≥ 22 gerekli (${process.versions.node})`, 2);
  for (const [proje, ad] of [
    [SATICI, "satici/sunucu"],
    [TEKS, "Teks-Erp"],
  ]) {
    if (!fs.existsSync(path.join(proje, "node_modules", "tsx", "package.json"))) throw new TorenHatasi(`Önkoşul: ${ad} bağımlılıkları yok — (cd ${ad} && npm ci)`, 2);
  }
  const kay = kaynakDenetle(etiket);
  yolDenetle(hedef);
  if (lstatYa(hedef) !== null) throw new TorenHatasi(`Hedef zaten var: ${hedef} — tören var olan anahtarların üstüne YAZMAZ (rotasyon yeni kid ile: docs/ops/URETIM-SATICI-TOREN.md §6)`, 2);
  const ust = path.dirname(hedef);
  const yarimlar = lstatYa(ust)?.isDirectory() ? fs.readdirSync(ust).filter((n) => n.startsWith(`${path.basename(hedef)}.yarim-`)) : [];
  if (yarimlar.length > 0) {
    throw new TorenHatasi(`Yarım kalmış tören dizini var: ${path.join(ust, yarimlar[0])} — içinde düz ALT/İNDİRME anahtarı olabilir; sil (rm -rf) ve yeniden başla`, 2);
  }
  if (usb !== undefined) usbHedefiDenetle(usb);
  return kay;
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
  const kay = onkosullar(hedef, usb, bayraklar.get("etiket"));
  paketKomutu(paketSablonu, kid.paket, "{dizin}");
  const worker = workerListesi("uretim");
  const toplam = usb ? 11 : 10;
  const adim = (n, baslik) => process.stdout.write(`[${n}/${toplam}] ${baslik}\n`);

  console.log("TeksERP üretim satıcısı — anahtar töreni");
  console.log(`  kaynak : ${kay.commit} (temiz · ${kay.dayanak} · npm ls ${kay.npmLs})`);
  for (const [k, oz] of Object.entries(kay.kilitler)) console.log(`  kilit  : ${k} sha256 ${oz}`);
  console.log(`  hedef  : ${hedef}`);
  console.log(`  USB    : ${usb ?? "verilmedi — sonra: uretim-toren.mjs usb-kopyala --usb=<yol>"}`);
  console.log(`  kid'ler: ${kid.kok} · ${kid.alt} (${altGun} gün) · ${kid.ind} (${indGun} gün) · ${kid.paket} · modül: ${moduller.join(", ") || "yok"}`);
  console.log(`  PAKET  : ${paketSablonu}${paketSablonu === PAKET_KOMUTU ? "" : "  ← varsayılan DEĞİL (--paket-komutu)"}`);
  console.log(`  Worker : indirmeListesi.${worker.liste} · kanallar ${worker.kanallar.join(", ")}\n`);
  adim(1, "Önkoşullar ✓");

  adim(2, "Kök parolası (kâğıda yazılacak; PAKET parolasını 7. adımda PAKET aracı kendisi sorar)");
  const parolalar = [];
  const yarim = `${hedef}.yarim-${process.pid}`;
  // Yalnız BİZİM yarattığımız yollar silinir: araya giren dizin/bağ (başkasının) dokunulmadan kalır.
  let yarimBizim = false;
  let hedefBizim = false;
  const temizlik = () => {
    for (const p of parolalar) p.fill(0);
    if (yarimBizim) fs.rmSync(yarim, { recursive: true, force: true });
    if (hedefBizim) {
      try {
        fs.rmdirSync(hedef);
      } catch {
        // rename sonrası dolu ya da yok — tören tamamlandı ya da zaten temiz
      }
    }
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

    ustHazirla(path.dirname(hedef));
    ozelDizin(yarim);
    yarimBizim = true;
    for (const d of ["anahtarlar", "paket", "modul-anahtarlari", "yedek-alici", "yedek-ozel", "kurtarma"]) ozelDizin(path.join(yarim, d));
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
    dosyaYaz(sinama, `TeksERP üretim satıcısı — yedek alıcısı sınaması · ${new Date().toISOString()} · ${crypto.randomBytes(8).toString("hex")}\n`);
    await yedek("sınama şifreleme", ["sifrele", "--girdi", sinama, "--cikti", `${sinama}.tkenc`, ...alicilar, "--duzu-sil"]);
    await yedek("sınama (Mac anahtarı)", ["dogrula", "--girdi", `${sinama}.tkenc`, "--anahtar", path.join(O, `${ALICI_MAC}.txt`)]);
    await yedek("sınama (kurtarma anahtarı)", ["dogrula", "--girdi", `${sinama}.tkenc`, "--anahtar", path.join(O, `${ALICI_KURTARMA}.tkkey`), "--parola-stdin"], [kokParola]);

    adim(10, "Kurtarma arşivi · künye · BENIOKU · izinler · yerine koy");
    const duzTar = path.join(yarim, "kurtarma", ".sirlar.tar");
    dosyaYaz(duzTar, "");
    const tar = spawnSync("tar", ["-C", yarim, "-cf", duzTar, "anahtarlar", "paket", ...(moduller.length ? ["modul-anahtarlari"] : [])], { env: altOrtam(), encoding: "utf8" });
    if (tar.status !== 0) throw new TorenHatasi(`kurtarma arşivi (tar) başarısız: ${(tar.stderr || "").trim().slice(0, 200)}`);
    const arsiv = path.join(yarim, "kurtarma", "sirlar.tar.tkenc");
    await yedek("kurtarma arşivi", ["sifrele", "--girdi", duzTar, "--cikti", arsiv, ...alicilar, "--duzu-sil"]);
    await yedek("kurtarma arşivi sınaması", ["dogrula", "--girdi", arsiv, "--anahtar", path.join(O, `${ALICI_MAC}.txt`)]);

    const kunye = kunyeKur(yarim, kid, moduller, kay, worker);
    dosyaYaz(path.join(yarim, BENIOKU), beniOku(kunye, hedef));
    kunye.ozetler = Object.fromEntries(dosyalar(yarim).map((f) => [f, sha256(path.join(yarim, f))]));
    dosyaYaz(path.join(yarim, KUNYE), `${JSON.stringify(kunye, null, 2)}\n`);
    for (const d of ["", ...dizinler(yarim)]) fs.chmodSync(path.join(yarim, d), 0o700);
    for (const f of dosyalar(yarim)) fs.chmodSync(path.join(yarim, f), 0o600);
    // Hedef rename'den HEMEN önce yeniden ölçülür ve özel mkdir ile sahiplenilir: araya giren (boş) dizin ezilmez.
    yolDenetle(hedef);
    if (lstatYa(hedef) !== null) throw new TorenHatasi(`Hedef tören sürerken doğdu: ${hedef} — üstüne YAZILMAZ, dokunulmadı`);
    ozelDizin(hedef);
    hedefBizim = true;
    fs.renameSync(yarim, hedef);
    yarimBizim = false;
    hedefBizim = false;
  } catch (e) {
    const yarimVardi = yarimBizim;
    temizlik();
    if (e instanceof TorenHatasi) throw new TorenHatasi(`${e.message}\n  → ${yarimVardi ? "yarım dizin silindi" : "yarım dizin yaratılmadı"}; hedefe (${hedef}) hiçbir şey yazılmadı`, e.kod);
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

function kunyeKur(kok, kid, moduller, kay, worker) {
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
      CF_WORKER_INDIRME: workerSatiri(worker, { kid: indDosya.kid, x: indDosya.x, baslangic: indS.baslangic, bitis: indS.bitis }),
      CF_WORKER_LISTESI: worker.liste,
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
- İNDİRME (sertifika ${k.indirme.bitis.slice(0, 10)}): yıllık dönem töreni (\`uretim-toren.mjs donem\`) yenisini üretir; künyedeki \`CF_WORKER_INDIRME\` satırı CF Worker İNDİRME listesine VDS'ten ÖNCE eklenir (runbook §8).
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
  console.log(`  4. CF Worker — VDS'TEN ÖNCE (satıcı İNDİRME anahtarıyla yüklendiği an basar): TKL_INDIRME_AYAR.indirmeListesi.${k.capaSatirlari.CF_WORKER_LISTESI}'e ekle → Deploy`);
  console.log(`     ${k.capaSatirlari.CF_WORKER_INDIRME}`);
  console.log("  5. VDS: anahtar birimi + üretim satıcısı (docs/ops/SATICI-KURULUM.md §13).");
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

// ---------------------------------------------------------------- dönem töreni (G4 §2.4)
// Yılda bir tören: 365 gün + 30 gün örtüşme (sonraki tören = bitiş − 30 gün; satıcı uyarısı da o gün başlar).
const DONEM_ORTUSME_GUN = 30;
const DONEM_GUN = 365 + DONEM_ORTUSME_GUN;
const DONEM_KUNYE = "DONEM-KUNYE.json";
const DONEM_SINIFLAR = ["URETIM", "TEST", "DR", "DEMO", "BAYI", "BARINDIRILAN"];

/** Tören dizininde kid aranan yerler: kökün yanındaki ilk anahtarlar + önceki dönem paketlerinin anahtarları. */
function anahtarDizinleri(kok) {
  const donemler = path.join(kok, "donemler");
  const paketler = lstatYa(donemler)?.isDirectory()
    ? fs.readdirSync(donemler).filter((n) => !n.includes(".yarim-")).map((n) => path.join(donemler, n, "vds-paketi", "anahtarlar"))
    : [];
  return [path.join(kok, "anahtarlar"), ...paketler].filter((d) => lstatYa(d)?.isDirectory());
}

/**
 * `alt|ara|ind-[hazirlik-]<yıl>[-<n>]` → tür başına bu yılın sıradaki numarası (`ind-2026` · `ind-hazirlik-2026` ilk biçim = 1).
 * İki biçim de sayılır: hazırlık dizininde önekli ilk anahtarlar ve önceki öneksiz dönemler numarayı ilerletir.
 */
function siradakiNumaralar(kok, yil) {
  const enBuyuk = { alt: 0, ara: 0, ind: 0 };
  for (const d of anahtarDizinleri(kok)) {
    for (const ad of fs.readdirSync(d)) {
      const m = /^(alt|ara|ind)-(?:hazirlik-)?(\d{4})(?:-(\d{1,3}))?\.(anahtar|ara|sertifika)\.json$/.exec(ad);
      if (m && Number(m[2]) === yil) enBuyuk[m[1]] = Math.max(enBuyuk[m[1]], m[3] ? Number(m[3]) : 1);
    }
  }
  return { alt: enBuyuk.alt + 1, ara: enBuyuk.ara + 1, ind: enBuyuk.ind + 1 };
}

/** Önceki dönemlerin en yüksek sıralı iptal belgesi dosyası (yoksa null) — doğrulamayı `iptal-uret --onceki` yapar. */
function oncekiIptal(kok) {
  let enIyi = null;
  const donemler = path.join(kok, "donemler");
  if (!lstatYa(donemler)?.isDirectory()) return null;
  for (const n of fs.readdirSync(donemler).filter((x) => !x.includes(".yarim-"))) {
    const dosya = path.join(donemler, n, "vds-paketi", "iptal.json");
    if (!fs.existsSync(dosya)) continue;
    const sira = Number(jsonOku(dosya).sira);
    if (Number.isInteger(sira) && (!enIyi || sira > enIyi.sira)) enIyi = { dosya, sira };
  }
  return enIyi;
}

/** İptal edilecek kid'in dosyası (anahtar · ara · bayi · emekli künye) tören dizininde aranır; yoksa RED. */
function anahtarDosyasi(kok, kid) {
  if (!/^(alt|ara|ind|bayi)-[a-z0-9-]{1,60}$/.test(kid)) throw new TorenHatasi(`--iptal: kid biçimsiz ya da iptal edilemez tür: ${kid} (kök iptal edilmez)`, 2);
  for (const d of anahtarDizinleri(kok)) {
    for (const ek of [".anahtar.json", ".ara.json", ".bayi.json", ".sertifika.json"]) {
      const yol = path.join(d, `${kid}${ek}`);
      if (fs.existsSync(yol)) return yol;
    }
  }
  throw new TorenHatasi(`--iptal: ${kid} tören dizininde bulunamadı`, 2);
}

/** Dönem paketine giren her dosya kökten ARINMIŞ olmalı: kök türü ya da kökün şifreli yarısı bulunursa RED. */
function kokSizdiMi(paket, kokDosya) {
  const sifreli = String(jsonOku(kokDosya).sifreli ?? "");
  return dosyalar(paket).filter((f) => {
    const metin = fs.readFileSync(path.join(paket, f), "utf8");
    return metin.includes("tekserp-kok-anahtar") || (sifreli.length > 16 && metin.includes(sifreli)) || /\.kok\.json$/.test(f);
  });
}

async function donem(bayraklar) {
  if (Number(process.versions.node.split(".")[0]) < 22) throw new TorenHatasi(`Node ≥ 22 gerekli (${process.versions.node})`, 2);
  if (!fs.existsSync(path.join(SATICI, "node_modules", "tsx", "package.json"))) throw new TorenHatasi("Önkoşul: satici/sunucu bağımlılıkları yok — (cd satici/sunucu && npm ci)", 2);
  const kay = kaynakDenetle(bayraklar.get("etiket"));
  const hedef = evYolu(bayraklar.get("dizin") || VARSAYILAN_DIZIN);
  yolDenetle(hedef);
  const st = lstatYa(hedef);
  if (!st?.isDirectory()) throw new TorenHatasi(`Tören dizini yok: ${hedef} — dönem töreni ilk törenin dizininde koşar`, 2);
  if (typeof process.getuid === "function" && st.uid !== process.getuid()) throw new TorenHatasi(`Tören dizini başka kullanıcının: ${hedef}`, 2);
  if ((st.mode & 0o077) !== 0) throw new TorenHatasi(`Tören dizini grup/başkalarına açık (${(st.mode & 0o777).toString(8)}): ${hedef} — chmod 700`, 2);
  const kunyeYolu = path.join(hedef, KUNYE);
  const kokKid = bayraklar.get("kok") ?? (fs.existsSync(kunyeYolu) ? jsonOku(kunyeYolu).kok?.kid : undefined);
  if (typeof kokKid !== "string" || !/^(kok|hazirlik)-[a-z0-9-]{1,40}$/.test(kokKid)) throw new TorenHatasi("Kök kimliği belirsiz: künyede yok — --kok=<kid> ver", 2);
  const K = path.join(hedef, "anahtarlar");
  const kokDosya = path.join(K, `${kokKid}.kok.json`);
  if (!fs.existsSync(kokDosya)) throw new TorenHatasi(`Kök dosyası yok: ${kokDosya}`, 2);
  const ortam = kokOrtami(kokDosya, kokKid);
  const worker = workerListesi(ortam);
  const yil = Number(bayraklar.get("yil") ?? new Date().getUTCFullYear());
  if (!Number.isInteger(yil) || yil < 2026 || yil > 2099) throw new TorenHatasi("--yil 2026–2099 olmalı", 2);
  const araSiniflar = bayraklar.get("ara-siniflar");
  if (araSiniflar !== undefined && araSiniflar.split(",").some((c) => !DONEM_SINIFLAR.includes(c.trim()))) throw new TorenHatasi(`--ara-siniflar: tanınmayan sınıf (${araSiniflar})`, 2);
  let kuyruk = null;
  if (bayraklar.has("kuyruk")) {
    const yol = evYolu(bayraklar.get("kuyruk"));
    const icerik = fs.existsSync(yol) ? jsonOku(yol) : null;
    if (!icerik || icerik.v !== 1 || icerik.tur !== "tekserp-kok-kuyrugu" || !Array.isArray(icerik.talepler)) throw new TorenHatasi(`--kuyruk tanınmıyor (tekserp-kok-kuyrugu): ${yol}`, 2);
    kuyruk = { yol, adet: icerik.talepler.length };
  }
  const iptalKidleri = (bayraklar.get("iptal") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const iptalDosyalari = iptalKidleri.map((k) => anahtarDosyasi(hedef, k));
  const neden = bayraklar.get("neden") ?? (iptalKidleri.length ? "olağan dışı tören" : "");
  if (neden.length > 200) throw new TorenHatasi("--neden en çok 200 karakter", 2);
  const no = siradakiNumaralar(hedef, yil);
  const onek = ortam === "hazirlik" ? "hazirlik-" : "";
  const kid = { alt: `alt-${onek}${yil}-${no.alt}`, ara: `ara-${onek}${yil}-${no.ara}`, ind: `ind-${onek}${yil}-${no.ind}` };
  const karsiDizin = evYolu(bayraklar.get("karsi-dizin") || ORTAM_DIZINI[ortam === "uretim" ? "hazirlik" : "uretim"]);
  if (karsiDizin === hedef) throw new TorenHatasi(`--karsi-dizin tören dizininin kendisi: ${karsiDizin}`, 2);
  const karsiKume = karsiOrtamDenetle(ortam, Object.values(kid), karsiDizin);
  const onceki = oncekiIptal(hedef);
  const yeniIptal = !onceki || iptalDosyalari.length > 0;
  const donemler = path.join(hedef, "donemler");
  if (!lstatYa(donemler)) fs.mkdirSync(donemler, { mode: 0o700 });
  yolDenetle(donemler);
  const yarimlar = fs.readdirSync(donemler).filter((n) => n.includes(".yarim-"));
  if (yarimlar.length > 0) throw new TorenHatasi(`Yarım kalmış dönem dizini var: ${path.join(donemler, yarimlar[0])} — içinde düz ALT/İNDİRME olabilir; sil ve yeniden başla`, 2);
  const damga = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const son = path.join(donemler, damga);
  if (lstatYa(son)) throw new TorenHatasi(`Dönem dizini zaten var: ${son}`, 2);
  const toplam = 8;
  const adim = (n, baslik) => process.stdout.write(`[${n}/${toplam}] ${baslik}\n`);

  console.log("TeksERP satıcısı — dönem töreni (G4)");
  console.log(`  kaynak : ${kay.commit} (temiz · ${kay.dayanak} · npm ls ${kay.npmLs})`);
  console.log(`  dizin  : ${hedef} · kök ${kokKid} · ortam ${ortam === "uretim" ? "ÜRETİM" : "HAZIRLIK"} (kökün kimliğinden)`);
  console.log(`  karşı  : ${karsiKume.adet === null ? `${karsiKume.dizin} yok — yalnız kalıp ayrımı ölçüldü` : `${karsiKume.dizin} · ${karsiKume.adet} kid, çakışma yok`}`);
  console.log(`  yeni   : ${kid.alt} · ${kid.ara} · ${kid.ind} (${DONEM_GUN} gün = 365 + ${DONEM_ORTUSME_GUN} örtüşme)`);
  console.log(`  iptal  : ${yeniIptal ? `YENİ belge, sıra ${(onceki?.sira ?? 0) + 1}${iptalKidleri.length ? ` — iptal: ${iptalKidleri.join(", ")}` : ""}` : `önceki belge aynen (sıra ${onceki.sira})`}`);
  console.log(`  kuyruk : ${kuyruk ? `${kuyruk.adet} HAK kökle imzalanacak (${kuyruk.yol})` : "verilmedi"}`);
  console.log(`  Worker : indirmeListesi.${worker.liste} · kanallar ${worker.kanallar.join(", ")}`);
  console.log(`  paket  : ${son}/vds-paketi (KÖK GİRMEZ)\n`);
  adim(1, "Önkoşullar ✓");

  const parolalar = [];
  const yarim = `${son}.yarim-${process.pid}`;
  let yarimBizim = false;
  const temizlik = () => {
    for (const p of parolalar) p.fill(0);
    if (yarimBizim) fs.rmSync(yarim, { recursive: true, force: true });
  };
  const kesme = () => {
    temizlik();
    process.stderr.write("\nİptal edildi — dönem paketi yazılmadı.\n");
    process.exit(130);
  };
  process.on("SIGINT", kesme);
  process.on("SIGTERM", kesme);
  try {
    adim(2, `Kök (${kokKid}) parolası — tören boyunca bir kez`);
    const kokParola = await parolaSor(`Kök (${kokKid}) parolası: `);
    parolalar.push(kokParola);
    adim(3, "YENİ ara imzacı parolası (kökten FARKLI; portalda HAK imzalarken yazılır → parola yöneticisine)");
    const araParola = await yeniParola("Ara imzacı parolası");
    parolalar.push(araParola);
    if (araParola.length === kokParola.length && crypto.timingSafeEqual(araParola, kokParola)) {
      throw new TorenHatasi("Ara imzacı parolası kök parolasıyla AYNI olamaz (ara parolası VDS'te yazılır, kökünki asla) — hiçbir anahtar üretilmedi", 2);
    }

    ozelDizin(yarim);
    yarimBizim = true;
    const P = path.join(yarim, "vds-paketi");
    const A = path.join(P, "anahtarlar");
    ozelDizin(P);
    ozelDizin(A);
    const anahtar = (ad, argv, p) => kosVeDenetle(ad, SATICI, "scripts/anahtar.ts", argv, p, parolalar);
    const ortak = [`--kok=${kokKid}`, `--kok-dizin=${K}`];

    adim(4, `ALT ${kid.alt} (kira imzası, ${DONEM_GUN} gün)`);
    await anahtar("ALT", ["alt-uret", `--kid=${kid.alt}`, ...ortak, `--gun=${DONEM_GUN}`, `--dizin=${A}`], [kokParola]);
    adim(5, `HAK ARA İMZACISI ${kid.ara} (${DONEM_GUN} gün)`);
    await anahtar("ara imzacı", ["ara-uret", `--kid=${kid.ara}`, ...ortak, `--gun=${DONEM_GUN}`, `--dizin=${A}`, ...(araSiniflar ? [`--siniflar=${araSiniflar}`] : [])], [kokParola, araParola, araParola]);
    adim(6, `İNDİRME ${kid.ind} (${DONEM_GUN} gün)`);
    await anahtar("İNDİRME", ["indirme-uret", `--kid=${kid.ind}`, ...ortak, `--gun=${DONEM_GUN}`, `--dizin=${A}`], [kokParola]);

    adim(7, yeniIptal ? "İptal belgesi (yalnız kök imzalar)" : `İptal belgesi: önceki (sıra ${onceki.sira}) aynen`);
    const iptalYolu = path.join(P, "iptal.json");
    if (yeniIptal) {
      const argv = ["iptal-uret", ...ortak, `--cikti=${iptalYolu}`];
      if (onceki) argv.push(`--onceki=${onceki.dosya}`);
      if (iptalDosyalari.length) argv.push(`--iptal=${iptalDosyalari.join(",")}`, `--neden=${neden}`);
      await anahtar("iptal belgesi", argv, [kokParola]);
    } else {
      fs.copyFileSync(onceki.dosya, iptalYolu, fs.constants.COPYFILE_EXCL);
    }

    adim(8, kuyruk ? `Kök imzası bekleyen ${kuyruk.adet} HAK · paket · künye · yerine koy` : "Paket · künye · yerine koy");
    let haklar = [];
    if (kuyruk) {
      const imzaliYolu = path.join(yarim, "kok-imzali-haklar.json");
      await anahtar("kuyruk imzası", ["kuyruk-imzala", ...ortak, `--kuyruk=${kuyruk.yol}`, `--cikti=${imzaliYolu}`], [kokParola]);
      haklar = jsonOku(imzaliYolu).haklar;
    }
    const iptal = jsonOku(iptalYolu);
    dosyaYaz(path.join(P, "ice-aktar.json"), `${JSON.stringify({ v: 1, tur: "tekserp-donem-ice-aktar", iptal: iptal.belge, haklar })}\n`);
    const yeniKidler = new Set(Object.values(kid));
    const emekliye = [
      ...new Set(
        anahtarDizinleri(hedef)
          .filter((d) => !d.startsWith(yarim))
          .flatMap((d) => fs.readdirSync(d))
          .map((ad) => /^((?:alt|ara|ind)-[a-z0-9-]+)\.(anahtar|ara)\.json$/.exec(ad)?.[1])
          .filter((k) => k && !yeniKidler.has(k)),
      ),
    ].sort();
    const sizinti = kokSizdiMi(P, kokDosya);
    if (sizinti.length > 0) throw new TorenHatasi(`Dönem paketinde KÖK izi: ${sizinti.join(", ")} — paket yazılmadı`);
    const kunye = donemKunyesi({ P, A, kid, kokDosya, kay, iptal, haklar, emekliye, kuyruk, worker });
    dosyaYaz(path.join(P, DONEM_KUNYE), `${JSON.stringify(kunye, null, 2)}\n`);
    const ozetSatirlari = dosyalar(P).map((f) => `${sha256(path.join(P, f))}  ${f}`);
    dosyaYaz(path.join(P, "SHA256SUMS"), `${ozetSatirlari.join("\n")}\n`);
    for (const d of ["", ...dizinler(yarim)]) fs.chmodSync(path.join(yarim, d), 0o700);
    for (const f of dosyalar(yarim)) fs.chmodSync(path.join(yarim, f), 0o600);
    yolDenetle(son);
    if (lstatYa(son) !== null) throw new TorenHatasi(`Dönem dizini tören sürerken doğdu: ${son} — üstüne YAZILMAZ`);
    fs.renameSync(yarim, son);
    yarimBizim = false;
    donemOzetiBas(son, kunye);
  } catch (e) {
    const yarimVardi = yarimBizim;
    temizlik();
    if (e instanceof TorenHatasi) throw new TorenHatasi(`${e.message}\n  → ${yarimVardi ? "yarım dönem dizini silindi" : "yarım dizin yaratılmadı"}; dönem paketi yazılmadı`, e.kod);
    throw e;
  } finally {
    for (const p of parolalar) p.fill(0);
    process.off("SIGINT", kesme);
    process.off("SIGTERM", kesme);
  }
}

function donemKunyesi({ P, A, kid, kokDosya, kay, iptal, haklar, emekliye, kuyruk, worker }) {
  const kok = jsonOku(kokDosya);
  const oku = (dosya) => {
    const d = jsonOku(path.join(A, dosya));
    const s = jwsYuku(d.sertifika);
    return { kid: d.kid, x: d.x, siniflar: s.siniflar, baslangic: s.baslangic, bitis: s.bitis, dosya: `anahtarlar/${dosya}` };
  };
  const ind = oku(`${kid.ind}.anahtar.json`);
  const iptalYuku = jwsYuku(iptal.belge);
  return {
    v: 1,
    tur: "tekserp-donem-paketi",
    tarih: new Date().toISOString(),
    kaynak: kay,
    kok: { kid: kok.kid, x: kok.x },
    yeni: { alt: oku(`${kid.alt}.anahtar.json`), ara: oku(`${kid.ara}.ara.json`), indirme: ind },
    iptal: { sira: iptalYuku.sira, satir: iptalYuku.iptaller.length, kidler: iptalYuku.iptaller.map((e) => e.kid) },
    kuyruk: { verildi: Boolean(kuyruk), imzalanan: haklar.length },
    emekliye,
    capaSatirlari: { CF_WORKER_INDIRME: workerSatiri(worker, ind), CF_WORKER_LISTESI: worker.liste },
    ozetler: Object.fromEntries(dosyalar(P).map((f) => [f, sha256(path.join(P, f))])),
  };
}

function donemOzetiBas(son, k) {
  const kisa = (s) => s.slice(0, 10);
  const P = path.join(son, "vds-paketi");
  console.log("\n✅ Dönem töreni tamam.");
  for (const [ad, x] of [["ALT", k.yeni.alt], ["ARA", k.yeni.ara], ["İNDİRME", k.yeni.indirme]]) {
    console.log(`  ${ad.padEnd(8)} ${x.kid.padEnd(14)} x=${x.x}  ${kisa(x.baslangic)} → ${kisa(x.bitis)}  ${x.siniflar.join("·")}`);
  }
  console.log(`  İPTAL    sıra ${k.iptal.sira} · ${k.iptal.satir} satır${k.iptal.kidler.length ? ` (${k.iptal.kidler.join(", ")})` : ""}`);
  console.log(`  KUYRUK   ${k.kuyruk.imzalanan} HAK kökle imzalandı`);
  console.log(`  EMEKLİYE ${k.emekliye.join(", ") || "(yok)"}`);
  console.log(`  paket    ${P} (KÖK YOK · ${Object.keys(k.ozetler).length} dosya · SHA256SUMS)`);
  const enErkenBitis = Math.min(...[k.yeni.alt, k.yeni.ara, k.yeni.indirme].map((x) => Date.parse(x.bitis)));
  console.log(`  SONRAKİ  dönem töreni ${kisa(new Date(enErkenBitis - DONEM_ORTUSME_GUN * 86_400_000).toISOString())} (en erken bitişten ${DONEM_ORTUSME_GUN} gün önce)`);
  console.log("\nSonraki adımlar (docs/ops/URETIM-SATICI-TOREN.md §8):");
  console.log("  1. Ara imzacı parolası → parola yöneticisi (kâğıda DEĞİL). Kök parolası kâğıtta kalır.");
  console.log(`  2. CF Worker — anahtar birimine kurmadan ÖNCE (satıcı yeni İNDİRME'yi yüklendiği dakika basar): TKL_INDIRME_AYAR.indirmeListesi.${k.capaSatirlari.CF_WORKER_LISTESI}'e EKLE → Deploy (eski satır kalır, penceresi kendiliğinden kapanır)`);
  console.log(`     ${k.capaSatirlari.CF_WORKER_INDIRME}`);
  console.log(`  3. VDS'e taşı: scp -P 2222 -rp ${P} <vds>:~/donem-paketi && ssh … 'cd ~/donem-paketi && sha256sum -c SHA256SUMS'`);
  console.log("  4. Anahtar birimine kur (anahtarlar/* → 0600, 10001) · içe aktar: … anahtar.js donem-ice-aktar < ice-aktar.json");
  console.log("  5. 1 dk sonra portal Anahtarlar: yeni ALT/ARA/İNDİRME yüklü; İptal belgeleri: dağıtılan sıra = paketinki");
  console.log(`  6. Eski özel yarılar: … anahtar.js emekliye-ayir --kid=${k.emekliye.join(",") || "<yok>"} (önce kuru, sonra --uygula) · VDS'teki paket kopyası silinir (shred).`);
  // PAKET anahtarı yenilemesi yıllık törene katılacak (iş listesi 3.9); o inene dek ayrı adım.
  console.log("  7. PAKET anahtarı: iş listesi 3.9 (kök altında sertifikalı paket anahtarı) inince bu törenin adımı olur; o güne dek runbook §6 PAKET satırı.");
}

async function main() {
  const { komut, bayraklar } = argumanlar(process.argv.slice(2));
  const hedef = evYolu(bayraklar.get("dizin") || VARSAYILAN_DIZIN);
  if (komut === "toren") return toren(bayraklar);
  if (komut === "donem") return donem(bayraklar);
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
