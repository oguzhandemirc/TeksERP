// =============================================================================
// BEKÇİ — BACKEND WINDOWS HİZMETİ DÜZENİ (düşük yetkili sanal hesap, pm2'siz)
// Çalıştır: npx tsx scripts/run-all-tests.ts hizmet_duzeni   (DB'siz)
// =============================================================================
// Dağıtım v2 / D3: backend `TeksERP-Backend` hizmetinde `NT SERVICE\TeksERP-Backend` ile koşar,
// program dizini salt okunurdur, yolların tek kaynağı konağın verdiği `TEKSERP_KOK`tur. pm2
// düzeni (geçiş D6'ya dek sahada) DEĞİŞMEMELİ. Ölçülen sözleşmeler:
//   §1 `hizmet-duzeni.ts` saf işlevleri (kök çözümü fail-closed · `.env` yolu · varsayılanlar
//      `.env`i EZMEZ · süreç yöneticisi · hizmet adı PowerShell'e güvenli · program dizini)
//   §2 ecosystem.config.js env bloğunun HER anahtarı hizmet düzeninde bir karşılık taşır
//      (varsayılan = aynı değer · bilinçli fark · kod varsayılanı · konak sözleşmesi) — yeni
//      anahtar sınıflanmadan eklenirse kırmızı
//   §3 alt süreçte gerçek yükleme sırası: önce → dotenv → sonra (hizmet kipi · pm2/geliştirme
//      sıfır fark · okunamayan `.env` ve göreli kök fail-closed)
//   §4 stdin kapanış kanalı (birim + alt süreç: `kapat` satırı · boru kapanışı · tek tetik)
//   §5 server.ts kablolaması: üç import sırası, SIGBREAK, stdin kanalı, dotenv'i başka modül yüklemez
//   §6 LICENSE_DIR hizmette program dizininde RED · §7 yedek şifreleme niyeti hizmet kipinde
//   §8 takas komutu hizmet kipi (Stop/Start-Service guard'lı, pm2 yok, npx yok, paketin Node'u)
//   §9 `deploy/hizmet/backend-hizmeti.ps1`: dizin + güncelleme kanalı tablosu = TS tablosu (iki yönlü) ·
//      sınıflar (guncelleyici\ ve guncelleme\is\ yasak, durum\ okunur) · varsayılan ÖLÇÜM (değişiklik yalnız
//      `-Uygula` dalında) · kayıt TEK kaynak (`tekserp-hizmet.exe hizmet-kur`; New-Service/sc.exe/WMI yok) ·
//      SIRA iyi bilinen SID'li iskelet → hizmet-kur → sanal hesaplı izin (kayıttan önce icacls 1332) ·
//      hizmeti başlatmaz/durdurmaz · SeImpersonate yok · kurtarma ölçülür ve §9h Rust kaydıyla aynı ·
//      sanal hesap SID algoritması (pwsh varsa koşar)
//   §10 geri yükleme listesi/etkisi süreç bilgisini taşır (panel hizmet bloğunu kurar)
// NEGATİF SONDA: §5 ve §9'un yüklemleri dosya içinde bozulmuş kopyalara da koşar ("sonda:"
//   satırları, her koşumda). Dosya dışı zincir bu commit'te ölçüldü (başlık altı liste).
//   (B) ① varsayılanlar `.env`i ezecek biçimde değişti → §1c/§3a KIRMIZI · ② SIGBREAK satırı
//   silindi → §5 KIRMIZI · ③ ps1'de lisans sınıfı `oku` yapıldı → §9b KIRMIZI · ④ `-Uygula`
//   dalı dışına `IzinYaz` kondu → §9c KIRMIZI · ⑤ kapanış kanalı ikinci tetiği yuttu değil
//   iki kez çağırdı → §4 KIRMIZI. Hepsi geri alındı, yeşil.
//   D6 (2026-10-01): §9 sırası/kaydı ve §11 ikiz kapı (`HizmetDuzeniIzi`, kur.ps1 ↔ ilk-kurulum.ps1) dosya
//   içi sondalarla ölçülür (21 kalıcı sonda); her sondanın kırmızısı KENDİ ihlaliyle doğrulandı.
// GEREKLİ Mİ: kapı bugün var olan bir kusuru yakalamadı (yeni düzen); gerekçesi ölçülmemiş —
//   pm2 düzeninin env bloğu 18 anahtarı taşıyor ve ikisi (rclone.conf, zamanlayıcı) hizmette
//   farklı olmak ZORUNDA; sınıflanmamış anahtar sessizce yanlış yola yazar.
// =============================================================================
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import Module from "node:module";
import vm from "node:vm";
import { PassThrough } from "node:stream";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  SERVICE_DIRS,
  DEFAULT_SERVICE_NAME,
  relativePathSettings,
  serviceName,
  isServiceNameInvalid,
  resolveServiceRoot,
  serviceDefaults,
  applyServiceDefaults,
  shutdownChannel,
  resolveEnvFilePath,
  isInProgramDir,
  processControlInfo,
  detectProcessManager,
} from "../src/lib/hizmet-duzeni";
import { listenShutdownChannel } from "../src/lib/kapanis-kanali";
import { resolveLicenseDir } from "../src/lib/license/store";
import { compareBackupCryptoIntent } from "../src/lib/backup-crypto/intent";
import { buildSwapCommands } from "../src/services/helpers/db-swap-command.helper";
import { psTara } from "./lib/ps-tarama";
import { atlamaDefteri } from "./lib/atlama";

const TEKS = join(__dirname, "..");
const KOK = join(TEKS, "..");
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}
const defter = atlamaDefteri(() => fail++);

// --- §1 saf işlevler ------------------------------------------------------------------
function saf(): void {
  console.log("§1 hizmet-duzeni saf işlevler");
  check("§1a kök yoksa düzen yok (pm2/geliştirme)", resolveServiceRoot({}).root === null && resolveServiceRoot({}).error === null);
  check("§1a ⭐ göreli ya da sürücüsüz kök fail-closed (hata dolu)",
    ["TeksERP", ".\\x", "\\TeksERP"].every((k) => resolveServiceRoot({ TEKSERP_KOK: k }).error !== null));
  check("§1a mutlak kök ayırıcı `/`, sondaki ayırıcı atılır",
    resolveServiceRoot({ TEKSERP_KOK: "C:\\TeksERP\\" }).root === "C:/TeksERP" && resolveServiceRoot({ TEKSERP_KOK: "\\\\srv\\t" }).root === "//srv/t");
  const K = "C:/TeksERP";
  check("§1b `.env` yolu: açık DOTENV_CONFIG_PATH > hizmet `<kök>/yapilandirma/.env` > `<cwd>/.env` (dotenv varsayılanı)",
    resolveEnvFilePath({ DOTENV_CONFIG_PATH: "D:/x.env", TEKSERP_KOK: K }, "/a") === "D:/x.env" &&
      resolveEnvFilePath({ TEKSERP_KOK: K }, "/a") === "C:/TeksERP/yapilandirma/.env" &&
      resolveEnvFilePath({}, "/a/app") === path.resolve("/a/app", ".env"));
  const env: NodeJS.ProcessEnv = { BACKUP_DIR: "E:/yedek", BACKUP_SCHEDULE_ENABLED: "", PORT: "4100" };
  const uygulanan = applyServiceDefaults(env, K);
  check("§1c ⭐ varsayılan `.env`deki değeri EZMEZ, boşu doldurur",
    env.BACKUP_DIR === "E:/yedek" && env.BACKUP_SCHEDULE_ENABLED === "false" && !uygulanan.includes("BACKUP_DIR") && uygulanan.includes("BACKUP_SCHEDULE_ENABLED"),
    uygulanan.join(","));
  const v = serviceDefaults(K);
  check("§1c ⭐ rclone.conf backend'in YAZABİLDİĞİ dizinde (veri), kökte değil", v.BACKUP_RCLONE_CONFIG === "C:/TeksERP/veri/rclone.conf");
  check("§1c gece yedeğini SYSTEM görevi alır → backend zamanlayıcısı kapalı", v.BACKUP_SCHEDULE_ENABLED === "false");
  check("§1d göreli yol ayarı uyarılır", relativePathSettings({ BACKUP_KEY_DIR: "../yedek-anahtar", BACKUP_DIR: "C:/x" }).join() === "BACKUP_KEY_DIR");
  check("§1e süreç yöneticisi: kök → hizmet · pm_id → pm2 · yoksa yok",
    detectProcessManager({ TEKSERP_KOK: K, pm_id: "0" }) === "service" && detectProcessManager({ pm_id: "0" }) === "pm2" && detectProcessManager({}) === "none");
  check("§1f ⭐ hizmet adı PowerShell'e güvenli: geçersiz ad komuta girmez, varsayılan kullanılır",
    serviceName({ TEKSERP_HIZMET_ADI: "x'; Remove-Item C:\\" }) === DEFAULT_SERVICE_NAME &&
      isServiceNameInvalid({ TEKSERP_HIZMET_ADI: "a b" }) && serviceName({ TEKSERP_HIZMET_ADI: "TeksERP-Backend-2" }) === "TeksERP-Backend-2");
  check("§1f komut bilgisi: hizmet → ad; pm2 → `name`; geliştirme → pm2 varsayılanı (bugünkü)",
    processControlInfo({ TEKSERP_KOK: K }).processManager === "service" &&
      processControlInfo({ name: "tekserp-backend-yeni", pm_id: "3" }).name === "tekserp-backend-yeni" &&
      processControlInfo({}).name === "teks-erp-backend");
  check("§1g program dizini: surumler/* ve current RED, lisans değil (büyük/küçük harf duyarsız)",
    isInProgramDir("C:\\TeksERP\\SURUMLER\\2.13.0\\lisans", K) && isInProgramDir("C:/TeksERP/current", K) &&
      !isInProgramDir("C:/TeksERP/lisans", K) && !isInProgramDir("C:/TeksERP/surumlerx", K));
  check("§1h kapanış kanalı: stdin · tanınmayan değer ayrı döner · yoksa kanal yok",
    shutdownChannel({ TEKSERP_KAPANIS: "stdin" }).channel === "stdin" && shutdownChannel({ TEKSERP_KAPANIS: "boru" }).unknown === "boru" &&
      shutdownChannel({}).channel === null);
}

// --- §2 ecosystem eşdeğerliği -----------------------------------------------------------
// pm2 düzeninde env bloğu; hizmet düzeninde her anahtar dört sınıftan birine girer.
const BILINCLI_FARK: Record<string, string> = {
  BACKUP_RCLONE_CONFIG: "pm2'de kök (<BACKUP_DIR>/../rclone.conf); hizmet hesabı kökü YAZAMAZ → veri/",
};
const KOD_VARSAYILANI: Record<string, string> = {
  PORT: "4000", HOST: "0.0.0.0", BACKUP_RETENTION_DAYS: "30", BACKUP_OFFSITE_DIR: "", BACKUP_RCLONE_REMOTE: "", BACKUP_HOUR: "3",
};
const KONAK_SOZLESMESI: Record<string, string> = {
  NODE_USE_SYSTEM_CA: "Node açılışta okur; .env'den etkisiz → konak ortamı",
};
/** `module.exports.apps[0].env` — tip zorlaması yerine çalışma anında daraltma. */
function ecosystemEnv(ihrac: unknown): Record<string, string> {
  if (typeof ihrac !== "object" || ihrac === null || !("apps" in ihrac) || !Array.isArray(ihrac.apps)) return {};
  const uygulama: unknown = ihrac.apps[0];
  if (typeof uygulama !== "object" || uygulama === null || !("env" in uygulama)) return {};
  const env: unknown = uygulama.env;
  if (typeof env !== "object" || env === null) return {};
  return Object.fromEntries(Object.entries(env).filter((g): g is [string, string] => typeof g[1] === "string"));
}
function ecosystemEsdegerligi(): void {
  console.log("\n§2 ecosystem.config.js ↔ hizmet düzeni");
  const kaynak = readFileSync(join(TEKS, "ecosystem.config.js"), "utf8");
  // Dosya `__dirname`den kökü türetir: sanal konum /k/app → KOK = /k (pm2 düzeni <kök>\app).
  const sanal = "/k/app/ecosystem.config.js";
  const modul: { exports: unknown } = { exports: {} };
  vm.runInThisContext(Module.wrap(kaynak), { filename: sanal })(modul.exports, require, modul, sanal, path.dirname(sanal));
  const eco = ecosystemEnv(modul.exports);
  const hv = serviceDefaults("/k");
  const sinifsiz: string[] = [];
  const ayrisan: string[] = [];
  for (const [k, deger] of Object.entries(eco)) {
    if (k in BILINCLI_FARK || k in KONAK_SOZLESMESI) continue;
    if (k in hv) {
      if (hv[k] !== deger) ayrisan.push(`${k}: pm2 ${deger} ↔ hizmet ${hv[k]}`);
    } else if (k in KOD_VARSAYILANI) {
      if (KOD_VARSAYILANI[k] !== deger) ayrisan.push(`${k}: ecosystem ${deger} ↔ kod varsayılanı ${KOD_VARSAYILANI[k]}`);
    } else {
      sinifsiz.push(k);
    }
  }
  check("§2 körlük zemini: ecosystem env bloğu okundu", Object.keys(eco).length >= 12, `${Object.keys(eco).length} anahtar`);
  check("§2a ⭐ ecosystem'in her anahtarı sınıflı (varsayılan · bilinçli fark · kod varsayılanı · konak)", sinifsiz.length === 0,
    sinifsiz.join(", ") || "hepsi");
  check("§2b ⭐ aynı sınıftaki değerler EŞİT (hizmet düzeni pm2 düzeninin yollarını üretir)", ayrisan.length === 0, ayrisan.join(" | ") || "eşit");
  const hizmetFazla = Object.keys(hv).filter((k) => !(k in eco) && k !== "MOBILE_UPDATE_DIR");
  check("§2c hizmet varsayılanında ecosystem'de olmayan tek anahtar MOBILE_UPDATE_DIR (pm2'de cwd/../ türetilir)",
    hizmetFazla.length === 0 && hv.MOBILE_UPDATE_DIR === "/k/mobil-guncelleme", hizmetFazla.join(", "));
}

// --- §3 alt süreçte yükleme sırası ------------------------------------------------------
const TSX = join(TEKS, "node_modules", "tsx", "dist", "cli.mjs");
const HARNESS = [
  'require("./src/lib/hizmet-duzeni-once");',
  'require("dotenv/config");',
  'require("./src/lib/hizmet-duzeni-sonra");',
  'const k = ["DOTENV_CONFIG_PATH","PORT","BACKUP_DIR","LICENSE_DIR","BACKUP_SCHEDULE_ENABLED","BACKUP_RCLONE_CONFIG","NODE_ENV","JWT_SECRET"];',
  'console.log("SONUC " + JSON.stringify(Object.fromEntries(k.map((x) => [x, process.env[x] ?? null]))));',
].join("\n");
function cocuk(ek: Record<string, string>, cwd = TEKS): { kod: number | null; sonuc: Record<string, string | null> | null; cikti: string } {
  const r = spawnSync(process.execPath, [TSX, "-e", HARNESS], {
    cwd, encoding: "utf8", timeout: 60_000,
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", DOTENV_CONFIG_QUIET: "true", ...ek },
  });
  const satir = (r.stdout ?? "").split("\n").find((l) => l.startsWith("SONUC "));
  return { kod: r.status, sonuc: satir ? (JSON.parse(satir.slice(6)) as Record<string, string | null>) : null, cikti: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
function yuklemeSirasi(): void {
  console.log("\n§3 alt süreçte yükleme sırası (önce → dotenv → sonra)");
  const kok = mkdtempSync(join(tmpdir(), "hizmet-duzeni-"));
  try {
    mkdirSync(join(kok, "yapilandirma"), { recursive: true });
    writeFileSync(join(kok, "yapilandirma", ".env"), 'PORT=4100\nBACKUP_DIR="/yedek/ozel"\nJWT_SECRET="bekci"\n');
    const k = kok.replace(/\\/g, "/");
    const h = cocuk({ TEKSERP_KOK: kok });
    const s = h.sonuc;
    check("§3a ⭐ hizmet kipi: `.env` <kök>/yapilandirma'dan yüklendi, .env değeri kazandı, eksikler varsayılanla doldu",
      h.kod === 0 && !!s && s.DOTENV_CONFIG_PATH === `${k}/yapilandirma/.env` && s.PORT === "4100" && s.BACKUP_DIR === "/yedek/ozel" &&
        s.JWT_SECRET === "bekci" && s.LICENSE_DIR === `${k}/lisans` && s.BACKUP_SCHEDULE_ENABLED === "false" &&
        s.BACKUP_RCLONE_CONFIG === `${k}/veri/rclone.conf` && s.NODE_ENV === "production",
      s ? JSON.stringify(s) : h.cikti.slice(0, 300));
    const pm2 = cocuk({});
    const p = pm2.sonuc;
    check("§3b ⭐ pm2/geliştirme kipi SIFIR fark: hiçbir anahtar türetilmez, dotenv cwd'den okur",
      pm2.kod === 0 && !!p && p.DOTENV_CONFIG_PATH === null && p.LICENSE_DIR === null && p.BACKUP_SCHEDULE_ENABLED === null && p.BACKUP_DIR === null,
      p ? JSON.stringify(p) : pm2.cikti.slice(0, 300));
    const yok = cocuk({ TEKSERP_KOK: join(kok, "olmayan") });
    check("§3c ⭐ hizmet kipinde `.env` okunamıyorsa açılmaz (sırsız açılış yok)", yok.kod === 1 && yok.sonuc === null && /yapılandırma dosyası okunamıyor/.test(yok.cikti),
      `kod ${yok.kod}`);
    const goreli = cocuk({ TEKSERP_KOK: "TeksERP" });
    check("§3d ⭐ göreli kök açılmaz (fail-closed, yanlış dizine yazmaz)", goreli.kod === 1 && goreli.sonuc === null && /mutlak/.test(goreli.cikti),
      `kod ${goreli.kod}`);
  } finally {
    rmSync(kok, { recursive: true, force: true });
  }
}

// --- §4 kapanış kanalı ------------------------------------------------------------------
async function kanal(): Promise<void> {
  console.log("\n§4 stdin kapanış kanalı");
  const dene = async (parcalar: string[], bitir: boolean): Promise<string[]> => {
    const a = new PassThrough();
    const nedenler: string[] = [];
    listenShutdownChannel(a, (n) => nedenler.push(n));
    for (const p of parcalar) a.write(p);
    if (bitir) a.end();
    await new Promise((r) => setTimeout(r, 20));
    return nedenler;
  };
  check("§4a `kapat` satırı (CRLF dahil) → tek tetik", (await dene(["merhaba\r\n", "kapat\r\n"], false)).join() === "hizmet: kapat");
  check("§4a satır parçalı gelirse de tanınır", (await dene(["ka", "pat", "\n"], false)).join() === "hizmet: kapat");
  check("§4b tanınmayan satır tetiklemez (ileri uyum)", (await dene(["kapatma\n", "durdur\n"], false)).length === 0);
  check("§4c ⭐ boru kapanınca (konak öldü) kapanış — yetim backend kalmaz", (await dene([], true)).join() === "hizmet: kapanış kanalı kapandı");
  check("§4d ⭐ `kapat` + EOF → YALNIZ bir kez", (await dene(["kapat\n"], true)).length === 1);
  const c = spawnSync(process.execPath, [TSX, "-e", [
    'const { listenShutdownChannel } = require("./src/lib/kapanis-kanali");',
    'listenShutdownChannel(process.stdin, (n) => { console.log("KAPANIS " + n); process.exit(0); });',
    'setTimeout(() => { console.log("ZAMAN ASIMI"); process.exit(3); }, 15000);',
  ].join("\n")], { cwd: TEKS, encoding: "utf8", input: "selam\nkapat\n", timeout: 60_000, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" } });
  check("§4e alt süreç: gerçek stdin borusunda `kapat` → temiz çıkış", c.status === 0 && /KAPANIS hizmet: kapat/.test(c.stdout ?? ""), `${c.status} ${(c.stdout ?? "").trim()}`);
}

// --- §5 server.ts kablolaması -----------------------------------------------------------
function serverIhlalleri(src: string): string[] {
  const ih: string[] = [];
  const importlar = src.split("\n").filter((l) => /^import\s/.test(l)).slice(0, 3).map((l) => l.replace(/;.*$/, ""));
  const beklenen = ['import "./lib/hizmet-duzeni-once"', 'import "dotenv/config"', 'import "./lib/hizmet-duzeni-sonra"'];
  if (importlar.join("|") !== beklenen.join("|")) ih.push(`ilk üç import ${importlar.join(" · ")}`);
  if (!/process\.on\("SIGBREAK",\s*\(\)\s*=>\s*gracefulShutdown\("SIGBREAK"\)\)/.test(src)) ih.push("SIGBREAK dinleyicisi yok");
  if (!/listenShutdownChannel\(process\.stdin,\s*\(reason\)\s*=>\s*gracefulShutdown\(reason\)\)/.test(src)) ih.push("stdin kanalı gracefulShutdown'a bağlı değil");
  if (!/process\.on\("message",/.test(src)) ih.push("pm2 shutdown mesajı dinleyicisi kalktı (D6 geçişine dek sahada pm2 var)");
  return ih;
}
function serverKablolamasi(): void {
  console.log("\n§5 server.ts kablolaması");
  const src = readFileSync(join(TEKS, "src", "server.ts"), "utf8");
  const ih = serverIhlalleri(src);
  check("§5a ⭐ önce → dotenv → sonra ilk üç import · SIGBREAK · stdin kanalı · pm2 mesajı (geçişe dek)", ih.length === 0, ih.join(" | ") || "temiz");
  const sondalar: Array<[string, string]> = [
    ["dotenv ilk satıra döndü", src.replace('import "./lib/hizmet-duzeni-once";', "").replace('import "dotenv/config";', 'import "dotenv/config";\nimport "./lib/hizmet-duzeni-once";')],
    ["SIGBREAK silindi", src.replace(/process\.on\("SIGBREAK".*\n/, "")],
    ["stdin kanalı başka işleve bağlandı", src.replace("(reason) => gracefulShutdown(reason)", "(reason) => void reason")],
  ];
  for (const [ad, mutasyon] of sondalar) {
    const uygulandi = mutasyon !== src;
    check(`§5 sonda: ${ad} → kırmızı`, uygulandi && serverIhlalleri(mutasyon).length > 0, uygulandi ? "" : "MUTASYON UYGULANMADI");
  }
  // Her .env yükleyicisi düzenin yolunu kullanır: `dotenv/config` DOTENV_CONFIG_PATH'i okur (önce modülü
  // kurar); doğrudan `dotenv.config` ise yolu `resolveEnvFilePath`ndan alır. Yolsuz çağrı cwd'yi okurdu.
  const dotenvYukleyen = spawnSync("git", ["grep", "-l", "-E", "from \"dotenv\"|dotenv/config|require\\(\"dotenv", "--", "src"], { cwd: TEKS, encoding: "utf8" });
  const dosyalar = (dotenvYukleyen.stdout ?? "").split("\n").filter(Boolean).sort();
  const yolsuz = dosyalar.filter((d) => {
    const m = readFileSync(join(TEKS, d), "utf8");
    if (d === "src/server.ts") return !/^import "\.\/lib\/hizmet-duzeni-once";/m.test(m);
    return !/dotenv\.config\(\{ path: resolveEnvFilePath\(process\.env, process\.cwd\(\)\) \}\)/.test(m) || /dotenv\.config\(\)/.test(m);
  });
  check("§5b körlük zemini: .env yükleyicileri bulundu (server.ts + prisma.ts)", dosyalar.join() === "src/lib/prisma.ts,src/server.ts", dosyalar.join(", "));
  check("§5b ⭐ src'deki her .env yükleyicisi düzenin yolunu kullanır (hizmette cwd = sürüm dizini, .env orada YOK)",
    yolsuz.length === 0, yolsuz.join(", ") || "hepsi");
}

// --- §6 lisans dizini · §7 niyet · §8 takas ------------------------------------------------
function lisansVeNiyet(): void {
  console.log("\n§6 LICENSE_DIR · §7 yedek şifreleme niyeti · §8 takas komutu");
  const K = "/k";
  check("§6 ⭐ hizmette LICENSE_DIR program dizininde (surumler/current) RED",
    resolveLicenseDir({ TEKSERP_KOK: K, LICENSE_DIR: "/k/surumler/2.13.0/lisans" }, "/k/surumler/2.13.0").problem === "APP_ICINDE" &&
      resolveLicenseDir({ TEKSERP_KOK: K, LICENSE_DIR: "/k/current/lisans" }, "/k/surumler/2.13.0").problem === "APP_ICINDE" &&
      resolveLicenseDir({ TEKSERP_KOK: K, LICENSE_DIR: "/k/lisans" }, "/k/surumler/2.13.0").problem === null);
  const kok = mkdtempSync(join(tmpdir(), "hizmet-niyet-"));
  try {
    mkdirSync(join(kok, "yapilandirma"), { recursive: true });
    mkdirSync(join(kok, "yedek-anahtar"), { recursive: true });
    writeFileSync(join(kok, "yapilandirma", ".env"), "PORT=4000\n");
    const env = { TEKSERP_KOK: kok, TEKSERP_HIZMET_ADI: "TeksERP-Backend" };
    const r = compareBackupCryptoIntent({ env, appDir: join(kok, "surumler", "2.13.0"), platform: "win32" });
    check("§7a ⭐ hizmette gece görevinin varsayılan anahtar dizini <kök>/yedek-anahtar (sürüm dizininin kardeşi DEĞİL)",
      r.nightly?.dir === path.resolve(kok, "yedek-anahtar") && r.nightly?.encrypts === true, r.nightly?.dir ?? "");
    check("§7b ⭐ uyarı pm2 değil `Restart-Service TeksERP-Backend` der", /Restart-Service TeksERP-Backend/.test(r.warning ?? "") && !/pm2/.test(r.warning ?? ""),
      r.warning ?? "");
    writeFileSync(join(kok, "yapilandirma", ".env"), `BACKUP_KEY_DIR="${join(kok, "yedek-anahtar")}"\n`);
    const r2 = compareBackupCryptoIntent({ env, appDir: join(kok, "surumler", "2.13.0"), platform: "win32" });
    check("§7c `.env` backend'le AYNI yoldan okunur (yapilandirma)", r2.nightly?.source === "env-dosyasi", r2.nightly?.source ?? "");
  } finally {
    rmSync(kok, { recursive: true, force: true });
  }
  const c = buildSwapCommands({
    liveDatabase: "TeksErpDb", copyDatabase: "TeksErpDb_restore_1", oldDatabase: "TeksErpDb_old_1", failedDatabase: "TeksErpDb_failed_1",
    psqlPath: "C:/TeksERP/pgsql/bin/psql.exe", maintenanceDb: "postgres", host: "127.0.0.1", port: "5432", user: "tekserp",
    pm2AppName: "teks-erp-backend", process: { processManager: "service", name: "TeksERP-Backend" },
    backendCwd: "C:/TeksERP/surumler/2.13.0", nodePath: "C:\\TeksERP\\surumler\\2.13.0\\runtime\\node.exe",
    envFile: "C:/TeksERP/yapilandirma/.env", needsMigrateDeploy: true,
  });
  for (const [ad, blok] of [["ileri", c.forward], ["geri alma", c.rollback]] as const) {
    const kod = blok.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
    check(`§8 ⭐ ${ad}: pm2 YOK, durdurma Stop-Service + $stopped guard'ı, son satır Start-Service`,
      !/\bpm2\b/.test(blok) && blok.includes("$stopped = ((Get-Service -Name $svc") && kod[kod.length - 1] === "Start-Service -Name $svc -ErrorAction SilentlyContinue");
  }
  check("§8 ⭐ geri almada da işlem $stopped'a bağlı (hizmet durmadan rename yok)", c.rollback.includes("$go = $stopped -and"));
  check("§8 göç: npx YOK, paketin Node'u + prisma giriş noktası, DOTENV_CONFIG_PATH önce ve sonda temizlenir",
    !c.forward.includes("npx") && c.forward.includes("'node_modules/prisma/build/index.js' migrate deploy") &&
      c.forward.indexOf("DOTENV_CONFIG_PATH = ") < c.forward.indexOf("migrate deploy") && c.forward.includes("Remove-Item Env:DOTENV_CONFIG_PATH"));
}

// --- §9 backend-hizmeti.ps1 --------------------------------------------------------------
const BEKLENEN_SINIF: Record<string, string> = {
  surumler: "oku", "mobil-guncelleme": "oku", rclone: "oku",
  yapilandirma: "sir", "yedek-anahtar": "sir",
  lisans: "yaz", backups: "yaz", logs: "yaz", veri: "yaz",
  "pg-setup": "yasak", guncelleyici: "yasak",
};
/** Güncelleme kanalı (GUNCELLEYICI.md §4.4): üst yasak · kanal oku · niyet yaz · durum oku · is yasak. */
const BEKLENEN_KANAL: Record<string, string> = { $programData: "yasak", $GuncellemeDizini: "oku", niyet: "yaz", durum: "oku", is: "yasak" };
/** Kayıt TEK kaynakta: konağın Rust kaydı (tekserp-hizmet) — ölçümün beklediği değerler onunla aynı olmalı. */
function rustKayitIhlalleri(mainRs: string, contractRs: string): string[] {
  const ih: string[] = [];
  if (!/restart_delays:\s*\[5,\s*5,\s*30\]/.test(mainRs)) ih.push("Rust hizmet-kur kurtarma gecikmeleri 5/5/30 değil (ps1 ölçümü 1/5000,1/5000,1/30000 bekliyor)");
  if (!/BACKEND_PRIVILEGES:\s*\[&str;\s*2\]\s*=\s*\["SeChangeNotifyPrivilege",\s*"SeCreateGlobalPrivilege"\]/.test(contractRs)) ih.push("Rust BACKEND_PRIVILEGES ps1 $Ayricaliklar ile aynı değil");
  if (!/executable:\s*root\.join\(path::CURRENT\)\.join\(path::RUNTIME\)\.join\(path::HOST_EXE\)/.test(mainRs)) ih.push("Rust kayıt ImagePath'i current\\runtime\\tekserp-hizmet.exe değil (ps1 ölçümü onu bekler)");
  return ih;
}
function ps1Ihlalleri(metin: string): string[] {
  const ih: string[] = [];
  const tablo = new Map<string, string>();
  for (const m of metin.matchAll(/@\{\s*Ad\s*=\s*"([^"]+)";\s*Sinif\s*=\s*"([^"]+)"\s*\}/g)) tablo.set(m[1]!, m[2]!);
  const baglanti = /\$BAGLANTILAR\s*=\s*@\(([^)]*)\)/.exec(metin)?.[1]?.match(/"([^"]+)"/g)?.map((x) => x.slice(1, -1)) ?? [];
  const ts = new Set<string>(Object.values(SERVICE_DIRS));
  const ps = new Set<string>([...tablo.keys(), ...baglanti]);
  const eksik = [...ts].filter((d) => !ps.has(d));
  const fazla = [...ps].filter((d) => !ts.has(d));
  if (eksik.length || fazla.length) ih.push(`tablo ↔ TS: eksik ${eksik.join(",") || "-"} fazla ${fazla.join(",") || "-"}`);
  for (const [ad, sinif] of Object.entries(BEKLENEN_SINIF)) if (tablo.get(ad) !== sinif) ih.push(`${ad} sınıfı ${tablo.get(ad) ?? "YOK"} (beklenen ${sinif})`);
  const kanal = new Map<string, string>();
  for (const m of metin.matchAll(/@\{\s*Yol\s*=\s*(\$\w+|\(Join-Path \$GuncellemeDizini "(\w+)"\));\s*Sinif\s*=\s*"([^"]+)"\s*\}/g)) kanal.set(m[2] ?? m[1]!, m[3]!);
  for (const [ad, sinif] of Object.entries(BEKLENEN_KANAL)) if (kanal.get(ad) !== sinif) ih.push(`kanal ${ad} sınıfı ${kanal.get(ad) ?? "YOK"} (beklenen ${sinif})`);
  if (!/DosyaOlc \(Join-Path \(Join-Path \$GuncellemeDizini "durum"\) "durum\.json"\)/.test(metin)) ih.push("durum.json guncelleme\\durum\\ altında ölçülmüyor");
  const t = psTara(metin);
  const uygulaBas = t.satirlar.find((s) => /^if \(\$Uygula\) \{\s*$/.test(s.ciplak.trim()) && s.derinlik === 0);
  // Blok, başlıktan sonra derinliğin yeniden 0'a indiği ilk satırda biter (kapanış satırı derinlik 1'de başlar).
  let uygulaSon = -1;
  if (uygulaBas) uygulaSon = t.satirlar.find((s) => s.no > uygulaBas.no && s.derinlik === 0)?.no ?? -1;
  if (!uygulaBas || uygulaSon < 0) ih.push("`if ($Uygula) {` bloğu bulunamadı");
  const degistiren = /\b(IzinYaz|KonakKos|New-Item|New-Service|icacls\.exe|Invoke-CimMethod|Set-Service)\b/;
  const fonk = (no: number) => t.fonksiyonlar.find((f) => no >= f.bas && no <= f.son);
  const disarida = t.satirlar.filter((s) => degistiren.test(s.ciplak) && !fonk(s.no) && !(uygulaBas && s.no > uygulaBas.no && s.no < uygulaSon));
  if (disarida.length) ih.push(`değiştiren çağrı -Uygula dışında: satır ${disarida.map((s) => s.no).join(",")}`);
  if (t.satirlar.some((s) => /\b(Start|Stop|Restart)-Service\b/.test(s.ciplak))) ih.push("hizmeti başlatıyor/durduruyor (çağıranın işi)");
  // Kayıt TEK kaynaktan (konağın `hizmet-kur`u); PowerShell'de ikinci bir kayıt yazıcısı ayrışırdı.
  if (t.satirlar.some((s) => /\bNew-Service\b|\bsc\.exe\b|Invoke-CimMethod/.test(s.ciplak))) ih.push("kayıt PowerShell'de yazılıyor (New-Service/sc.exe/WMI) — tek kaynak hizmet-kur");
  // SIRA (§4.2): iyi bilinen SID'li iskelet → hizmet-kur → sanal hesaplı izin. Kayıttan ÖNCE sanal hesaba izin icacls 1332 ile düşer.
  const blok = t.satirlar.filter((s) => uygulaBas && s.no > uygulaBas.no && s.no < uygulaSon);
  const kurSatir = blok.find((s) => /KonakKos @kurArg/.test(s.ciplak))?.no ?? -1;
  const sidliIzin = blok.filter((s) => /\bIzinYaz\b.*\$sid\b/.test(s.ciplak)).map((s) => s.no);
  const iskeletIzin = blok.filter((s) => /\bIzinYaz\b.*\$null\b/.test(s.ciplak)).map((s) => s.no);
  const iskeletCikis = blok.find((s) => /if \(\$YalnizIskelet\) \{/.test(s.ciplak))?.no ?? -1;
  if (kurSatir < 0) ih.push("-Uygula bloğunda `hizmet-kur` çağrısı yok");
  if (!sidliIzin.length || sidliIzin.some((n) => n < kurSatir)) ih.push(`sanal hesaplı izin hizmet-kur'dan ÖNCE (izin ${sidliIzin.join(",") || "-"} · kayıt ${kurSatir})`);
  if (!iskeletIzin.length || iskeletIzin.some((n) => n > kurSatir)) ih.push(`iskelet izni (iyi bilinen SID) kayıttan sonra ya da yok (${iskeletIzin.join(",") || "-"})`);
  if (iskeletCikis < 0 || iskeletCikis > kurSatir || iskeletIzin.some((n) => n > iskeletCikis)) ih.push("-YalnizIskelet çıkışı iskeletten sonra ve kayıttan önce değil");
  if (/SeImpersonatePrivilege/.test(metin.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n"))) ih.push("SeImpersonatePrivilege ayrıcalık listesinde");
  if (!/\$Ayricaliklar = @\("SeChangeNotifyPrivilege", "SeCreateGlobalPrivilege"\)/.test(metin)) ih.push("ayrıcalık beklentisi değişti");
  if (!/"1\/5000,1\/5000,1\/30000"/.test(metin) || !/\$sifirla -eq 86400/.test(metin) || !/FailureActionsOnNonCrashFailures -ne 1/.test(metin)) ih.push("kurtarma eylemleri ölçülmüyor");
  if (!/\/inheritance:r/.test(metin) || !/"S-1-5-32-545", "S-1-5-11", "S-1-1-0"/.test(metin)) ih.push("miras kesme / geniş grupların silinmesi yok");
  return ih;
}
function hizmetBetigi(): void {
  console.log("\n§9 deploy/hizmet/backend-hizmeti.ps1");
  const metin = readFileSync(join(KOK, "deploy", "hizmet", "backend-hizmeti.ps1"), "utf8");
  const mainRs = readFileSync(join(TEKS, "native", "tekserp-hizmet", "src", "main.rs"), "utf8");
  const contractRs = readFileSync(join(TEKS, "native", "tekserp-hizmet", "src", "contract.rs"), "utf8");
  const ih = ps1Ihlalleri(metin);
  check("§9 körlük zemini: tablo satırları okundu", (metin.match(/@\{\s*Ad\s*=/g) ?? []).length >= 10 && (metin.match(/@\{\s*Yol\s*=/g) ?? []).length === 5);
  check("§9a-f ⭐ dizin + kanal tablosu = TS (iki yönlü) · sınıflar · değişiklik yalnız -Uygula'da · kayıt TEK kaynak (hizmet-kur) · SIRA iskelet → kayıt → sanal hesap izni · başlat/durdur yok · en az ayrıcalık · kurtarma ölçülür · miras kesik",
    ih.length === 0, ih.join(" | ") || "temiz");
  const rih = rustKayitIhlalleri(mainRs, contractRs);
  check("§9h ⭐ ps1 ölçümünün beklediği kayıt = konağın Rust kaydı (kurtarma 5/5/30 · ayrıcalıklar · ImagePath current\\runtime)", rih.length === 0, rih.join(" | ") || "aynı");
  const sondalar: Array<[string, string]> = [
    ["lisans sınıfı oku", metin.replace('@{ Ad = "lisans";           Sinif = "yaz"   }', '@{ Ad = "lisans";           Sinif = "oku"   }')],
    ["tabloya TS'de olmayan dizin (hizmet\\ geri geldi)", metin.replace('@{ Ad = "veri";', '@{ Ad = "hizmet"; Sinif = "oku" },\n  @{ Ad = "veri";')],
    ["IzinYaz -Uygula dışında", metin.replace('Write-Host ""\nWrite-Host "OLCUM (hizmet', 'IzinYaz $kokTam "oku" $sid\nWrite-Host ""\nWrite-Host "OLCUM (hizmet')],
    ["SeImpersonate eklendi", metin.replace('@("SeChangeNotifyPrivilege", "SeCreateGlobalPrivilege")', '@("SeChangeNotifyPrivilege", "SeImpersonatePrivilege")')],
    ["Start-Service eklendi", metin.replace("exit 2\n", "Start-Service $HizmetAdi\nexit 2\n")],
    ["sanal hesap izni kayıttan ÖNCE", metin.replace('IzinYaz $kokTam "oku" $null\n', 'IzinYaz $kokTam "oku" $null\n  IzinYaz $kokTam "oku" $sid\n')],
    ["kayıt New-Service ile", metin.replace("    $kod = KonakKos @kurArg\n", "    New-Service -Name $HizmetAdi -BinaryPathName $KonakYolu | Out-Null\n    $kod = KonakKos @kurArg\n")],
    ["is\\ backend'e okunur", metin.replace('(Join-Path $GuncellemeDizini "is");        Sinif = "yasak"', '(Join-Path $GuncellemeDizini "is");        Sinif = "oku"')],
    ["durum.json düz kanal dizininde ölçülüyor", metin.replace('DosyaOlc (Join-Path (Join-Path $GuncellemeDizini "durum") "durum.json")', 'DosyaOlc (Join-Path $GuncellemeDizini "durum.json")')],
  ];
  for (const [ad, mutasyon] of sondalar) {
    const uygulandi = mutasyon !== metin;
    check(`§9 sonda: ${ad} → kırmızı`, uygulandi && ps1Ihlalleri(mutasyon).length > 0, uygulandi ? "" : "MUTASYON UYGULANMADI");
  }
  const rMut = mainRs.replace(/restart_delays:\s*\[5,\s*5,\s*30\]/, "restart_delays: [5, 5, 60]");
  check("§9h sonda: Rust kurtarma gecikmesi değişti → kırmızı", rMut !== mainRs && rustKayitIhlalleri(rMut, contractRs).length > 0, rMut !== mainRs ? "" : "MUTASYON UYGULANMADI");
  // Sanal hesap SID'i: TrustedInstaller bilinen vektör; betikteki gövde pwsh'ta koşar.
  const tsSid = (ad: string): string => {
    const h = createHash("sha1").update(Buffer.from(ad.toUpperCase(), "utf16le")).digest();
    return `S-1-5-80-${[0, 1, 2, 3, 4].map((i) => h.readUInt32LE(i * 4)).join("-")}`;
  };
  check("§9g algoritma vektörü: TrustedInstaller", tsSid("TrustedInstaller") === "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464");
  const govde = /function HizmetSid\(\[string\]\$ad\) \{[\s\S]*?\n\}/.exec(metin)?.[0];
  const pw = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", `${govde ?? ""}\nHizmetSid 'TrustedInstaller'; HizmetSid '${DEFAULT_SERVICE_NAME}'`], { encoding: "utf8", timeout: 60_000 });
  if (pw.error || pw.status === null) defter.atla("§9g betiğin HizmetSid gövdesi pwsh'ta", "pwsh yok");
  else {
    const [ti, tb] = (pw.stdout ?? "").trim().split(/\r?\n/);
    check("§9g ⭐ betiğin HizmetSid gövdesi pwsh'ta: TrustedInstaller + TeksERP-Backend = Node algoritması",
      !!govde && ti === tsSid("TrustedInstaller") && tb === tsSid(DEFAULT_SERVICE_NAME), `${ti} · ${tb}`);
  }
}

// --- §10 geri yükleme listesi/etkisi ---------------------------------------------------------
function geriYukleme(): void {
  console.log("\n§10 geri yükleme komutunun süreç bilgisi");
  const liste = readFileSync(join(TEKS, "src", "services", "backup.service.ts"), "utf8");
  const etki = readFileSync(join(TEKS, "src", "services", "backup-impact.service.ts"), "utf8");
  check("§10a listeleme süreç yöneticisini tek kaynaktan (processControlInfo) taşır",
    /const proc = processControlInfo\(process\.env\)/.test(liste) && /processManager: proc\.processManager/.test(liste));
  check("§10b ⭐ etki hizmet bloğunun yollarını taşır (paketin Node'u, .env, pg araçları tam yol)",
    /nodePath: process\.execPath/.test(etki) && /envFile: listing\.processManager === "service"/.test(etki) &&
      /pgDumpPath: pgTool\("pg_dump"\)/.test(etki) && /pgRestorePath: pgTool\("pg_restore"\)/.test(etki));
}

// --- §11 pm2 betikleri hizmet düzenine dokunmaz · §12 gece yedeği hizmet düzenini tanır ---------------
function izFonksiyonu(metin: string): string {
  return /function HizmetDuzeniIzi\(\$kokYolu\) \{[\s\S]*?\n\}/.exec(metin.replace(/\r\n/g, "\n"))?.[0] ?? "";
}
function izIhlalleri(metin: string, ad: "kur" | "ilk"): string[] {
  const ih: string[] = [];
  const satirlar = metin.replace(/\r\n/g, "\n").split("\n");
  const fn = izFonksiyonu(metin);
  if (!/@\("surumler", "current", "yapilandirma\\\.env"\)/.test(fn)) ih.push("iz fonksiyonu üç kök işaretini ölçmüyor");
  // Önek eşleşmesi: ikinci kanalın adı (TeksERP-Backend-demofabrika) da yakalanmalı.
  if (!/Get-CimInstance Win32_Service/.test(fn) || !/\.StartsWith\("TeksERP-Backend", \[System\.StringComparison\]::OrdinalIgnoreCase\)/.test(fn) ||
    !/\.StartsWith\("TeksERP-Guncelleyici", \[System\.StringComparison\]::OrdinalIgnoreCase\)/.test(fn) || !/"--kok"/.test(fn)) ih.push("iz fonksiyonu bu kökü kullanan TeksERP hizmetini (backend/güncelleyici, her ad — önek) ölçmüyor");
  if (!/OLCULEMEDI/.test(fn)) ih.push("hizmet listesi okunamazsa iz sayılmıyor (fail-closed değil)");
  const iz = satirlar.findIndex((l) => /^\$hizmetIzi = HizmetDuzeniIzi \$[Kk]ok\s*$/.test(l));
  const dur = satirlar.findIndex((l, i) => i > iz && /^if \(\$hizmetIzi\.Count\) \{ (Fail|Dur) /.test(l));
  if (iz < 0 || dur < 0) ih.push("hizmet izi kapısı yok");
  const ilkDegisen = satirlar.findIndex((l) =>
    ad === "kur" ? /^if \(\$GeriAl\) \{|^\s*Pm2AdiDogrula |^Expand-Archive/.test(l) : /^\$DbParola\s+= ParolaCoz|^Adim "Klasor iskeleti/.test(l));
  if (ilkDegisen < 0 || dur > ilkDegisen) ih.push(`kapı ilk değiştiren adımdan SONRA (kapı ${dur + 1} · adım ${ilkDegisen + 1})`);
  if (ad === "kur" && !/Get-CimInstance Win32_Service -Filter "Name='TeksERP-Backend'"/.test(metin)) ih.push("çalışan hizmet ölçülmüyor");
  if (ad === "ilk" && !/Get-Service -Name "TeksERP-Backend"/.test(metin)) ih.push("kayıtlı hizmet ölçülmüyor");
  return ih;
}
function pm2Betikleri(): void {
  console.log("\n§11 kur.ps1 / ilk-kurulum.ps1 hizmet düzenine pm2 kurmaz · §12 yedekle.ps1");
  check("§11 işaretler TS tablosundan (surumler · current · yapilandirma)",
    SERVICE_DIRS.versions === "surumler" && SERVICE_DIRS.current === "current" && SERVICE_DIRS.config === "yapilandirma");
  const metinler: Record<string, string> = {};
  for (const [dosya, ad] of [["kur.ps1", "kur"], ["ilk-kurulum.ps1", "ilk"]] as const) {
    const metin = readFileSync(join(KOK, "deploy", dosya), "utf8");
    metinler[ad] = metin;
    const ih = izIhlalleri(metin, ad);
    check(`§11 ⭐ ${dosya}: hizmet düzeni izi (kökte surumler/current/yapilandirma\\.env ya da bu kökü kullanan TeksERP hizmeti; liste okunamazsa iz) varsa HİÇBİR ŞEYE DOKUNMADAN durur`,
      ih.length === 0, ih.join(" | ") || "temiz");
    const sondalar: Array<[string, string]> = [
      ["kapı satırı silindi", metin.replace(/^if \(\$hizmetIzi\.Count\) \{ (Fail|Dur) .*$/m, "")],
      ["current işareti düştü", metin.replace('@("surumler", "current", "yapilandirma\\.env")', '@("surumler", "yapilandirma\\.env")')],
      ["hizmet ölçümü yalnız varsayılan ad", metin.replace('StartsWith("TeksERP-Guncelleyici"', 'Equals("TeksERP-Guncelleyici"')],
      ["liste okunamazsa geç (fail-open)", metin.replace('return ,($iz + @("TeksERP hizmetleri OLCULEMEDI (Win32_Service)"))', "return ,$iz")],
    ];
    for (const [sAd, sonda] of sondalar) check(`§11 sonda: ${dosya} ${sAd} → kırmızı`, sonda !== metin && izIhlalleri(sonda, ad).length > 0, sonda !== metin ? "" : "MUTASYON UYGULANMADI");
  }
  const fk = izFonksiyonu(metinler.kur ?? ""), fi = izFonksiyonu(metinler.ilk ?? "");
  check("§11 ⭐ HizmetDuzeniIzi ikizleri birebir aynı (kur.ps1 ↔ ilk-kurulum.ps1)", fk.length > 200 && fk === fi, `${fk.length} · ${fi.length} bayt`);
  const yed = readFileSync(join(KOK, "deploy", "yedekle.ps1"), "utf8");
  check("§12a ⭐ yedekle.ps1: hizmet düzeni .env'in yerinden anlaşılır; kod current\\, .env yapilandirma\\, Node paketin runtime'ı",
    /\$hizmetEnv = Join-Path \(Join-Path \$Kok "yapilandirma"\) "\.env"/.test(yed) &&
      /\$appDir = if \(\$hizmetDuzeni\) \{ Join-Path \$Kok "current" \} else \{ Join-Path \$Kok "app" \}/.test(yed) &&
      /\$envDosya = if \(\$hizmetDuzeni\) \{ \$hizmetEnv \}/.test(yed) &&
      /if \(\$hizmetDuzeni\) \{ \$node = Join-Path \(Join-Path \$appDir "runtime"\) "node\.exe" \}/.test(yed));
  const reparse = yed.search(/if \(\$hizmetDuzeni -and \(\(Get-Item -LiteralPath \$yedekDir -Force\)\.Attributes -band \[System\.IO\.FileAttributes\]::ReparsePoint\)\)/);
  const ilkYazim = yed.search(/"-f", \$yarim/);
  check("§12b ⭐ yedekle.ps1: hizmet düzeninde backups\\ junction'a çevrilmişse SYSTEM görevi yazmadan/silmeden durur",
    reparse > 0 && ilkYazim > reparse, `kapı ${reparse} · ilk yazım ${ilkYazim}`);
}

async function main(): Promise<void> {
  console.log("=== Backend Windows hizmeti düzeni ===\n");
  saf();
  ecosystemEsdegerligi();
  yuklemeSirasi();
  await kanal();
  serverKablolamasi();
  lisansVeNiyet();
  hizmetBetigi();
  geriYukleme();
  pm2Betikleri();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${defter.ozetEki()} ===`);
  process.exit(fail > 0 ? 1 : 0);
}
void main();
