// =============================================================================
// BEKÇİ — YEDEK ŞİFRELEME (`.tkenc`: X25519 + AES-256-GCM akış, çok alıcılı)
// =============================================================================
// Çalıştır: npx tsx scripts/test_yedek_sifreleme.ts
//   (yedek zinciri bölümü sunucuyla AYNI ana sürümde pg_dump ister — PG_BIN_DIR)
//
//   §1  gidiş-dönüş: her boyutta, üç alıcının HER BİRİYLE birebir aynı düz metin
//   §2  kurcalama: yük baytı · başlık baytı · kesme · ekleme · parça takası → RED
//   §3  yanlış anahtar → YANLIS_ANAHTAR, yarım düz dosya BIRAKILMAZ
//   §4  parolayla sarılı anahtar: doğru/yanlış parola · kısa parola · alan takası
//   §5  kâğıt satırı: sağlama yazım hatasını "yanlış anahtar"dan ayırır
//   §6  yapılandırma: env yok → KAPALI (bugünkü davranış) · boş/iç içe → GEÇERSİZ
//   §7  adlandırma: `.dump.tkenc` yedek sayılır, `.part` sayılmaz, damga okunur
//   §8  offsite süzgeci: şifreleme niyeti varken DÜZ döküm makine dışına çıkmaz
//   §9  araç: parola argümandan REDDEDİLİR · araç derleme listesinde
//   §10 yedek zinciri (gerçek pg_dump): şifreli yayın, düz yok, offsite şifreli,
//       "şifreli — çöz" teşhisi, anahtarla tam doğrulama, eski düz yedek, GEÇERSİZ yapılandırma
//   §11 yedek parolası kapısı: parolasız 403 · yanlış 403 · doğru → anahtar
//   §12 niyet ayrışması (D13): backend ile gece görevi farklı karar verirse sağlıkta uyarı
// =============================================================================

import "dotenv/config";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { atlamaDefteri } from "./lib/atlama";
import * as bc from "../src/lib/backup-crypto";
import * as naming from "../src/services/helpers/backup-naming.helper";
import { compareBackupCryptoIntent, readEnvFileValue } from "../src/lib/backup-crypto/intent";

let pass = 0;
let fail = 0;
const defter = atlamaDefteri(() => {
  fail++;
});
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}`);
  } else {
    fail++;
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function hataKodu(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return bc.isBackupCryptoError(e) ? e.code : `DIS:${e instanceof Error ? e.message : String(e)}`;
  }
}

const kok = fs.mkdtempSync(path.join(os.tmpdir(), "tekserp-tkenc-"));
const yol = (ad: string): string => path.join(kok, ad);
const uc = { yerel: bc.generateRawKeyPair(), musteri: bc.generateRawKeyPair(), etkili: bc.generateRawKeyPair() };
const alicilar: bc.Recipient[] = Object.entries(uc).map(([ad, k]) => ({ ad, publicRaw: k.publicRaw }));
const kimlik = (k: bc.RawKeyPair) => bc.privateKeyFromRaw(k.privateRaw);

async function gidisDonus(): Promise<void> {
  console.log("\n§1 gidiş-dönüş");
  for (const boy of [0, 1, bc.CHUNK_SIZE - 1, bc.CHUNK_SIZE, bc.CHUNK_SIZE + 1, 3 * bc.CHUNK_SIZE, 200_003]) {
    const duz = crypto.randomBytes(boy);
    fs.writeFileSync(yol("d"), duz);
    fs.rmSync(yol("e"), { force: true });
    await bc.encryptFile(yol("d"), yol("e"), alicilar);
    const hepsi = await Promise.all(
      Object.entries(uc).map(async ([ad, k]) => {
        const hedef = yol(`o-${ad}`);
        fs.rmSync(hedef, { force: true });
        await bc.decryptFile(yol("e"), hedef, [kimlik(k)]);
        return fs.readFileSync(hedef).equals(duz);
      }),
    );
    check(`§1 ${boy} bayt: üç alıcının her biri birebir çözer`, hepsi.every(Boolean));
  }
  const sifreli = fs.readFileSync(yol("e"));
  check("§1b dosya sihirli baytla başlar", sifreli.subarray(0, 8).equals(bc.TKENC_MAGIC));
  check("§1c isEncryptedBackup: şifreli → true, düz → false",
    (await bc.isEncryptedBackup(yol("e"))) && !(await bc.isEncryptedBackup(yol("d"))));
  const ins = await bc.inspectEncrypted(yol("e"));
  check("§1d başlık alıcıları adıyla ve parmak iziyle taşır (anahtarsız okunur)",
    ins.header.alicilar.map((a) => a.ad).join(",") === "yerel,musteri,etkili" &&
      ins.header.alicilar[1]!.parmakIzi === bc.fingerprint(uc.musteri.publicRaw));
  check("§1e aynı düz metin iki kez şifrelenince farklı bayt (rastgele dosya anahtarı)", await (async () => {
    fs.rmSync(yol("e2"), { force: true });
    await bc.encryptFile(yol("d"), yol("e2"), alicilar);
    return !fs.readFileSync(yol("e2")).equals(sifreli);
  })());
}

async function kurcalama(): Promise<void> {
  console.log("\n§2 kurcalama");
  const duz = crypto.randomBytes(3 * bc.CHUNK_SIZE + 500);
  fs.writeFileSync(yol("k-d"), duz);
  fs.rmSync(yol("k-e"), { force: true });
  await bc.encryptFile(yol("k-d"), yol("k-e"), alicilar);
  const asil = fs.readFileSync(yol("k-e"));
  const prefix = (await bc.readHeader(yol("k-e"))).prefixLength;
  const dene = async (ad: string, bayt: Buffer): Promise<string | null> => {
    fs.writeFileSync(yol(`k-${ad}`), bayt);
    return hataKodu(() => bc.verifyEncrypted(yol(`k-${ad}`), [kimlik(uc.yerel)]));
  };
  const cevir = (b: Buffer, i: number): Buffer => {
    const c = Buffer.from(b);
    c[i] = c[i]! ^ 0x01;
    return c;
  };
  check("§2a sağlam dosya doğrulanır", (await dene("ok", asil)) === null);
  check("§2b yük baytı çevrildi → KURCALANMIS", (await dene("yuk", cevir(asil, prefix + 100))) === "KURCALANMIS");
  // Başlıktaki tarih rakamı değişir, JSON geçerli kalır → yalnız MAC yakalar.
  const json = asil.indexOf(Buffer.from('"olusturma":"20'));
  check("§2c başlık alanı değişti (JSON geçerli) → KURCALANMIS", (await dene("bas", cevir(asil, json + 16))) === "KURCALANMIS");
  const tam = bc.CHUNK_SIZE + bc.TAG_SIZE;
  check("§2d parça sınırında kesildi → RED", (await dene("sinir", asil.subarray(0, prefix + 2 * tam))) !== null);
  check("§2e son bayt kesildi → RED", (await dene("son", asil.subarray(0, asil.length - 1))) !== null);
  check("§2f sona bayt eklendi → RED", (await dene("ek", Buffer.concat([asil, Buffer.from([0])]))) !== null);
  const takas = Buffer.concat([
    asil.subarray(0, prefix),
    asil.subarray(prefix + tam, prefix + 2 * tam),
    asil.subarray(prefix, prefix + tam),
    asil.subarray(prefix + 2 * tam),
  ]);
  check("§2g iki parça yer değiştirdi → KURCALANMIS", (await dene("takas", takas)) === "KURCALANMIS");
  check("§2h anahtarsız yapısal denetim yarım başlığı yakalar",
    (await hataKodu(async () => {
      fs.writeFileSync(yol("k-yarim"), asil.subarray(0, 20));
      await bc.inspectEncrypted(yol("k-yarim"));
    })) === "KESIK");
  fs.rmSync(yol("k-cikti"), { force: true });
  const kod = await hataKodu(() => bc.decryptFile(yol("k-yuk"), yol("k-cikti"), [kimlik(uc.yerel)]));
  check("§2i kurcalanmış dosya çözülürken yarım düz çıktı SİLİNİR", kod === "KURCALANMIS" && !fs.existsSync(yol("k-cikti")));
}

async function yanlisAnahtar(): Promise<void> {
  console.log("\n§3 yanlış anahtar");
  const yabanci = bc.generateRawKeyPair();
  fs.rmSync(yol("y-cikti"), { force: true });
  const kod = await hataKodu(() => bc.decryptFile(yol("k-e"), yol("y-cikti"), [kimlik(yabanci)]));
  check("§3a alıcı olmayan anahtar → YANLIS_ANAHTAR", kod === "YANLIS_ANAHTAR", String(kod));
  check("§3b çıktı dosyası bırakılmadı", !fs.existsSync(yol("y-cikti")));
  check("§3c alıcısız şifreleme reddedilir", (await hataKodu(() => bc.encryptFile(yol("k-d"), yol("bos-e"), []))) === "ALICI_YOK");
}

async function sariliAnahtar(): Promise<void> {
  console.log("\n§4 parolayla sarılı anahtar");
  const w = await bc.wrapSecretKey("yerel", uc.yerel.privateRaw, "dogru-parola-2026");
  const metin = JSON.stringify(w);
  check("§4a dosya özel anahtarı DÜZ taşımaz", !metin.includes(bc.encodeSecretKey(uc.yerel.privateRaw).slice(7, 30)));
  const acik = await bc.unwrapSecretKey(bc.parseWrappedKeyFile(metin), "dogru-parola-2026");
  check("§4b doğru parola → aynı özel anahtar", acik.equals(uc.yerel.privateRaw));
  check("§4c yanlış parola → YANLIS_PAROLA",
    (await hataKodu(() => bc.unwrapSecretKey(bc.parseWrappedKeyFile(metin), "yanlis-parola-2026"))) === "YANLIS_PAROLA");
  check("§4d kısa parola sarmada reddedilir",
    (await hataKodu(() => bc.wrapSecretKey("yerel", uc.yerel.privateRaw, "kisa"))) === "YANLIS_PAROLA");
  const baskaAd = JSON.stringify({ ...w, ad: "musteri" });
  check("§4e ad alanı değiştirilmiş dosya (AAD) doğru parolayla da açılmaz",
    (await hataKodu(() => bc.unwrapSecretKey(bc.parseWrappedKeyFile(baskaAd), "dogru-parola-2026"))) === "YANLIS_PAROLA");
  const sor = async (): Promise<string> => "dogru-parola-2026";
  check("§4f privateRawFromText: sarılı JSON ve düz satır aynı anahtarı verir",
    (await bc.privateRawFromText(metin, sor)).equals(uc.yerel.privateRaw) &&
      (await bc.privateRawFromText(bc.encodeSecretKey(uc.yerel.privateRaw), sor)).equals(uc.yerel.privateRaw));
}

function kagitSatiri(): void {
  console.log("\n§5 kâğıt satırı");
  const s = bc.encodeSecretKey(uc.musteri.privateRaw);
  check("§5a gidiş-dönüş", bc.decodeSecretKey(s).equals(uc.musteri.privateRaw));
  const hata = s.slice(0, 12) + (s[12] === "A" ? "B" : "A") + s.slice(13);
  let kod = "";
  try {
    bc.decodeSecretKey(hata);
  } catch (e) {
    kod = bc.isBackupCryptoError(e) ? e.code : "?";
  }
  check("§5b tek karakter yazım hatası → ANAHTAR_BICIMI (yanlış anahtar DEĞİL)", kod === "ANAHTAR_BICIMI");
  let tur = "";
  try {
    bc.decodePublicKey(s);
  } catch (e) {
    tur = bc.isBackupCryptoError(e) ? e.code : "?";
  }
  check("§5c özel satır açık anahtar yerine verilemez", tur === "ANAHTAR_BICIMI");
}

async function yapilandirma(): Promise<void> {
  console.log("\n§6 yapılandırma");
  const kapali = await bc.readBackupCryptoConfig({ keyDir: undefined, backupDir: yol("backups") });
  check("§6a BACKUP_KEY_DIR yok → kapali (bugünkü davranış)", kapali.state === "kapali" && kapali.recipients.length === 0);
  fs.mkdirSync(yol("bos-anahtar"), { recursive: true });
  const bos = await bc.readBackupCryptoConfig({ keyDir: yol("bos-anahtar") });
  check("§6b boş dizin → gecersiz (niyet var, alıcı yok)", bos.state === "gecersiz" && bos.problems.length > 0);
  const anahtar = yol("anahtar");
  fs.mkdirSync(anahtar, { recursive: true });
  for (const [ad, k] of Object.entries(uc)) fs.writeFileSync(path.join(anahtar, `${ad}.tkpub`), `# yorum\n${bc.encodePublicKey(k.publicRaw)}\n`);
  const yerelsiz = await bc.readBackupCryptoConfig({ keyDir: anahtar, backupDir: yol("backups") });
  check("§6c üç alıcı → acik; yerel anahtar yok UYARISI", yerelsiz.state === "acik" && yerelsiz.recipients.length === 3 && yerelsiz.localKeyPath === null && yerelsiz.warnings.length > 0);
  fs.writeFileSync(path.join(anahtar, bc.LOCAL_KEY_FILE), JSON.stringify(await bc.wrapSecretKey("yerel", uc.yerel.privateRaw, "yedek-parolasi-2026")));
  const tam = await bc.readBackupCryptoConfig({ keyDir: anahtar, backupDir: yol("backups") });
  check("§6d yerel.tkkey → localKeyPath dolu, uyarı yok", tam.state === "acik" && tam.localKeyPath !== null && tam.warnings.length === 0);
  const ic = await bc.readBackupCryptoConfig({ keyDir: path.join(yol("backups"), "anahtar"), backupDir: yol("backups") });
  check("§6e dizin BACKUP_DIR içinde → gecersiz", ic.state === "gecersiz" && ic.problems.some((p) => p.includes("İÇİNDE")));
  fs.writeFileSync(path.join(yol("bos-anahtar"), "bozuk.tkpub"), "tkpub1:bozuk\n");
  const bozuk = await bc.readBackupCryptoConfig({ keyDir: yol("bos-anahtar") });
  check("§6f okunamayan alıcı → gecersiz (sessizce atlanmaz)", bozuk.state === "gecersiz" && bozuk.problems.some((p) => p.includes("bozuk.tkpub")));
  const ozet = bc.summarizeBackupCrypto(tam);
  const ozetMetni = JSON.stringify(ozet);
  check("§6g panele giden özet anahtar baytı taşımaz",
    !ozetMetni.includes("tkpub1:") && !ozetMetni.includes("tksec1:") && ozet.recipients.length === 3 && ozet.localKey);
  const wrong = await hataKodu(() => bc.unlockLocalKey(tam, "yanlis-parola-2026"));
  const dogru = await bc.unlockLocalKey(tam, "yedek-parolasi-2026");
  check("§6h unlockLocalKey: yanlış → YANLIS_PAROLA, doğru → yerel kimlik",
    wrong === "YANLIS_PAROLA" && bc.rawPublic(crypto.createPublicKey(dogru)).equals(uc.yerel.publicRaw));
}

function niyetAyrismasi(): void {
  console.log("\n§12 niyet ayrışması (backend ↔ gece görevi)");
  const kurulum = yol("kurulum");
  const app = path.join(kurulum, "app");
  const varsayilan = path.join(kurulum, "yedek-anahtar");
  const baska = path.join(kurulum, "baska-anahtar");
  fs.mkdirSync(app, { recursive: true });
  const envYaz = (satirlar: string[]): void => fs.writeFileSync(path.join(app, ".env"), satirlar.join("\n") + "\n");
  const kos = (env: Record<string, string>, platform: NodeJS.Platform = "win32") =>
    compareBackupCryptoIntent({ env, appDir: app, platform });

  check("§12a .env satırı: anahtar büyük/küçük harf DUYARLI, tırnak soyulur, ilk eşleşme",
    readEnvFileValue('backup_key_dir=x\nBACKUP_KEY_DIR="C:/k"\nBACKUP_KEY_DIR=ikinci', "BACKUP_KEY_DIR") === "C:/k" &&
      readEnvFileValue("PORT=4000", "BACKUP_KEY_DIR") === null);
  envYaz(["PORT=4000"]);
  let r = kos({});
  check("§12b ikisi de kapalı (satır yok, dizin yok) → ölçüldü, uyarı YOK",
    r.measured && !r.backend.encrypts && r.nightly?.encrypts === false && r.warning === null, JSON.stringify(r));
  fs.mkdirSync(varsayilan, { recursive: true });
  r = kos({});
  check("§12c ⭐ varsayılan dizin var, backend ortamında yok → gece görevi şifreler, backend düz: UYARI",
    r.nightly?.encrypts === true && r.nightly.source === "varsayilan" && !r.backend.encrypts && /ŞİFRELİYOR/.test(r.warning ?? ""), r.warning ?? "");
  envYaz(["PORT=4000", `BACKUP_KEY_DIR="${varsayilan}"`]);
  r = kos({ BACKUP_KEY_DIR: varsayilan });
  check("§12d satır .env'de ve backend ortamında aynı dizin → uyarı YOK",
    r.nightly?.source === "env-dosyasi" && r.backend.encrypts && r.warning === null, r.warning ?? "");
  r = kos({});
  check("§12e ⭐ satır .env'de ama backend ortamında yok (pm2 restart edilmedi) → UYARI",
    /pm2 restart/.test(r.warning ?? "") && /ŞİFRELİYOR/.test(r.warning ?? ""), r.warning ?? "");
  fs.rmSync(varsayilan, { recursive: true, force: true });
  envYaz(["PORT=4000"]);
  r = kos({ BACKUP_KEY_DIR: varsayilan });
  check("§12f ⭐ backend ortamında var, .env'de satır ve varsayılan dizin yok → gece yedeği düz: UYARI",
    r.backend.encrypts && r.nightly?.encrypts === false && /ŞİFRELEMİYOR/.test(r.warning ?? ""), r.warning ?? "");
  envYaz(["PORT=4000", `BACKUP_KEY_DIR=${baska}`]);
  r = kos({ BACKUP_KEY_DIR: varsayilan });
  check("§12g ⭐ iki taraf FARKLI dizin → UYARI", /FARKLI/.test(r.warning ?? ""), r.warning ?? "");
  r = kos({ BACKUP_KEY_DIR: varsayilan }, "linux");
  check("§12h gece görevi olmayan platform → ölçülmedi, uyarı YOK (sahte alarm yok)", !r.measured && r.warning === null);
  const saglik = fs.readFileSync(path.join(__dirname, "../src/lib/health-snapshot.ts"), "utf8");
  check("§12i /api/admin/health ayrışmayı taşıyor (backupCryptoIntent)",
    /backupCryptoIntent:\s*backupCryptoIntent\(\)/.test(saglik) && /compareBackupCryptoIntent\(\)/.test(saglik));
}

function adlandirma(): void {
  console.log("\n§7 adlandırma");
  check("§7a .dump ve .dump.tkenc yedek; .part / .tkenc.part değil",
    naming.isBackupFileName("tekserp_20260929_030001.dump") &&
      naming.isBackupFileName("tekserp_20260929_030001.dump.tkenc") &&
      !naming.isBackupFileName("tekserp_20260929_030001.dump.part") &&
      !naming.isBackupFileName("tekserp_20260929_030001.dump.tkenc.part") &&
      !naming.isBackupFileName("tekserp_20260929_030001.dump.coz-elle.part"));
  const d = naming.parseBackupStamp("premigrate_20260929_030001.dump.tkenc");
  check("§7b şifreli adın damgası okunur (yerel kurucuyla aynı an)", d?.getTime() === new Date(2026, 8, 29, 3, 0, 1).getTime());
  check("§7c düz ↔ şifreli ad dönüşümü",
    naming.plainBackupName("x_20260929_030001.dump.tkenc") === "x_20260929_030001.dump" &&
      naming.encryptedBackupName("x.dump") === "x.dump.tkenc");
  check("§7d geçici çözülmüş kopya `.part` ile biter (liste/süpürücü görmez)",
    naming.decryptedTempName("x.dump.tkenc", "ab").endsWith(".part") && !naming.isBackupFileName(naming.decryptedTempName("x.dump.tkenc", "ab")));
}

async function offsiteSuzgeci(): Promise<void> {
  console.log("\n§8 offsite süzgeci");
  const { isOffsiteBackupFile } = await import("../src/services/helpers/offsite-backup.helper");
  check("§8a şifreleme kapalı: düz .dump kopyalanır (bugünkü davranış)", isOffsiteBackupFile("tekserp_20260929_030001.dump", false));
  check("§8b şifreleme niyeti var: düz .dump KOPYALANMAZ", !isOffsiteBackupFile("tekserp_20260929_030001.dump", true));
  check("§8c şifreli yedek her iki kipte kopyalanır",
    isOffsiteBackupFile("premigrate_20260929_030001.dump.tkenc", true) && isOffsiteBackupFile("premigrate_20260929_030001.dump.tkenc", false));
  check("§8d yarım şifreli dosya kopyalanmaz", !isOffsiteBackupFile("tekserp_20260929_030001.dump.tkenc.part", true));
}

function arac(): void {
  console.log("\n§9 araç");
  const tsx = path.join(__dirname, "..", "node_modules", ".bin", "tsx");
  const r = spawnSync(tsx, [path.join(__dirname, "yedek-sifrele.ts"), "coz", "--girdi", "x", "--parola", "sir"], {
    encoding: "utf8",
    timeout: 60_000,
  });
  check("§9a parola argümanı reddedilir (çıkış 1, parola ekrana basılmaz)",
    r.status === 1 && /argumandan verilmez/.test(r.stderr) && !r.stderr.includes("sir\n"), `${r.status} ${r.stderr}`);
  const liste = fs.readFileSync(path.join(__dirname, "build-araclar.mjs"), "utf8");
  check("§9b araç sunucu paketine derleniyor (dist/tools/yedek-sifrele.cjs)",
    liste.includes('giris: "scripts/yedek-sifrele.ts"') && liste.includes('cikti: "dist/tools/yedek-sifrele.cjs"'));
}

function pgDumpUygun(): string | null {
  const exe = process.platform === "win32" ? "pg_dump.exe" : "pg_dump";
  const bin = process.env.PG_BIN_DIR ? path.join(process.env.PG_BIN_DIR, exe) : exe;
  const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
  return r.status === 0 ? null : `pg_dump çalıştırılamadı (${bin})`;
}

async function yedekZinciri(): Promise<void> {
  console.log("\n§10 yedek zinciri (gerçek pg_dump)");
  const engel = !process.env.DATABASE_URL ? "DATABASE_URL yok" : pgDumpUygun();
  if (engel) {
    defter.atla("§10 yedek zinciri", engel, "?");
    return;
  }
  const backups = yol("backups");
  const offsite = yol("offsite");
  process.env.BACKUP_DIR = backups;
  process.env.BACKUP_OFFSITE_DIR = offsite;
  process.env.BACKUP_KEY_DIR = yol("anahtar");
  const svc = await import("../src/services/backup.service");

  const r = await svc.runBackupJob("manual");
  if (!r.ok && /sürüm|istemci/i.test(r.message)) {
    defter.atla("§10 yedek zinciri", `pg_dump sunucuyla uyumsuz — ${r.message}`, "?");
    return;
  }
  const dosyalar = fs.readdirSync(backups);
  check("§10a yedek ŞİFRELİ yayınlandı (.dump.tkenc)", r.ok && !!r.file && r.file.endsWith(".dump.tkenc"), r.message);
  check("§10b klasörde DÜZ döküm ve yarım dosya YOK", !dosyalar.some((f) => f.endsWith(".dump") || f.endsWith(".part")), dosyalar.join(","));
  const off = fs.existsSync(offsite) ? fs.readdirSync(offsite) : [];
  check("§10c offsite klasörüne giden kopya şifreli (düz yok)", off.length === 1 && off[0]!.endsWith(".dump.tkenc"), off.join(","));
  const liste = await svc.listBackups();
  check("§10d liste şifreli yedeği gösterir ve işaretler", liste.files.some((f) => f.encrypted && f.name === path.basename(r.file!)) && liste.encryption.state === "acik");
  const v = await svc.verifyBackupFile(r.file!);
  check("§10e anahtarsız teşhis 'encrypted' (bozuk DEĞİL)", v === "encrypted", v);
  const kim = await bc.unlockLocalKey(await bc.readBackupCryptoConfig(), "yedek-parolasi-2026");
  const tam = await svc.verifyEncryptedBackupWithKey(r.file!, kim);
  check("§10f yerel anahtarla tam doğrulama → ok (içindeki döküm pg_restore --list'ten geçer)", tam.verdict === "ok", tam.detail ?? "");
  check("§10g doğrulama geçici düz kopya BIRAKMADI", !fs.readdirSync(backups).some((f) => f.includes(".coz-")));
  const yabanci = await svc.verifyEncryptedBackupWithKey(r.file!, bc.privateKeyFromRaw(bc.generateRawKeyPair().privateRaw));
  check("§10h alıcı olmayan anahtar → 'encrypted' + sebep (bozuk DEĞİL)", yabanci.verdict === "encrypted" && !!yabanci.detail);
  const kurc = path.join(backups, "elden_20260101_000000.dump.tkenc");
  const b = fs.readFileSync(r.file!);
  b[b.length - 5] = b[b.length - 5]! ^ 0xff;
  fs.writeFileSync(kurc, b);
  const kv = await svc.verifyEncryptedBackupWithKey(kurc, kim);
  check("§10i kurcalanmış şifreli yedek → corrupt + sebep", kv.verdict === "corrupt" && /kurcalan|yarım/i.test(kv.detail ?? ""), kv.detail ?? "");
  fs.rmSync(kurc);
  // Y5: eski düz yedek geri yüklenebilir kalır.
  const duz = path.join(backups, "tekserp_20260101_000000.dump");
  await bc.decryptFile(r.file!, duz, [kim]);
  check("§10j eski düz yedek listede ve verify=ok", (await svc.verifyBackupFile(duz)) === "ok" && (await svc.listBackups()).files.some((f) => f.name === path.basename(duz) && !f.encrypted));
  check("§10k resolveBackupPath iki biçimi de çözer", svc.resolveBackupPath(path.basename(duz)) === duz && svc.resolveBackupPath(path.basename(r.file!)) === r.file);
  fs.rmSync(duz);

  // GEÇERSİZ yapılandırma: yedek alınır, düz kalır, makine dışına çıkmaz, iş KIRMIZI.
  process.env.BACKUP_KEY_DIR = yol("bos-anahtar-2");
  fs.mkdirSync(yol("bos-anahtar-2"), { recursive: true });
  fs.rmSync(offsite, { recursive: true, force: true });
  await new Promise((res) => setTimeout(res, 1100)); // aynı saniyede ikinci ad çakışmasın
  const g = await svc.runBackupJob("manual");
  check("§10l geçersiz yapılandırma → iş kırmızı, düz yedek KORUNDU",
    !g.ok && !!g.file && g.file.endsWith(".dump") && fs.existsSync(g.file) && /GEÇERSİZ/.test(g.message), g.message);
  check("§10m geçersiz yapılandırmada düz yedek offsite'a KOPYALANMADI", !fs.existsSync(offsite) || fs.readdirSync(offsite).length === 0);

  // Kapalı yapılandırma: bugünkü davranış — düz .dump, offsite düz.
  delete process.env.BACKUP_KEY_DIR;
  await new Promise((res) => setTimeout(res, 1100));
  const k = await svc.runBackupJob("manual");
  check("§10n şifreleme kapalı → bugünkü gibi düz .dump + offsite kopyası",
    k.ok && !!k.file && k.file.endsWith(".dump") && fs.existsSync(path.join(offsite, path.basename(k.file))), k.message);
}

async function parolaKapisi(): Promise<void> {
  console.log("\n§11 yedek parolası kapısı");
  if (!process.env.DATABASE_URL) {
    defter.atla("§11 yedek parolası kapısı", "DATABASE_URL yok (kilit ayarı DB'den okunur)", 5);
    return;
  }
  process.env.BACKUP_KEY_DIR = yol("anahtar");
  const { unlockBackupForRequest } = await import("../src/middlewares/backup-password");
  const sifreli = yol("kapi.dump.tkenc");
  fs.rmSync(sifreli, { force: true });
  await bc.encryptFile(yol("k-d"), sifreli, alicilar);
  fs.writeFileSync(yol("kapi.dump"), "duz");
  const istek = (parola?: string) =>
    ({
      headers: parola ? { "x-backup-password": parola } : {},
      ip: "127.0.0.77",
      socket: { remoteAddress: "127.0.0.77" },
      user: undefined,
      baseUrl: "/api/admin",
      path: "/backups/x/restore-impact",
      query: {},
    }) as never;
  const kod = async (p?: string, dosya = sifreli) => {
    try {
      const r = await unlockBackupForRequest(istek(p), dosya);
      return r.encrypted ? (r.identity ? "ACIK" : "YEREL_YOK") : "DUZ";
    } catch (e) {
      return ((e as { details?: { code?: string } }).details?.code ?? "?") as string;
    }
  };
  check("§11a düz yedek → kapı devreye girmez", (await kod(undefined, yol("kapi.dump"))) === "DUZ");
  check("§11b şifreli + parolasız → 403 BACKUP_PASSWORD_REQUIRED", (await kod()) === "BACKUP_PASSWORD_REQUIRED");
  check("§11c yanlış parola → 403 BACKUP_PASSWORD_INVALID", (await kod("yanlis-parola-2026")) === "BACKUP_PASSWORD_INVALID");
  check("§11d doğru parola → yerel kimlik", (await kod("yedek-parolasi-2026")) === "ACIK");
  process.env.BACKUP_KEY_DIR = yol("anahtar-yerelsiz");
  fs.mkdirSync(yol("anahtar-yerelsiz"), { recursive: true });
  fs.writeFileSync(path.join(yol("anahtar-yerelsiz"), "musteri.tkpub"), bc.encodePublicKey(uc.musteri.publicRaw));
  check("§11e sunucuda yerel anahtar yok → açılamaz (parola sorulmaz)", (await kod("yedek-parolasi-2026")) === "YEREL_YOK");
}

async function main(): Promise<void> {
  try {
    await gidisDonus();
    await kurcalama();
    await yanlisAnahtar();
    await sariliAnahtar();
    kagitSatiri();
    await yapilandirma();
    adlandirma();
    niyetAyrismasi();
    await offsiteSuzgeci();
    arac();
    await yedekZinciri();
    await parolaKapisi();
  } catch (e) {
    fail++;
    console.log(`❌ beklenmeyen hata: ${e instanceof Error ? e.stack : String(e)}`);
  } finally {
    fs.rmSync(kok, { recursive: true, force: true });
    if (process.env.DATABASE_URL) {
      const { default: prisma } = await import("../src/lib/prisma");
      await prisma.$disconnect().catch(() => {});
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${defter.ozetEki()} ===`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
