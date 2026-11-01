// =============================================================================
// Bekçi: barındırılan kurulumda şifreli yedek zorunluluğu + halka emaneti dökümün içinde + Etkili alıcısı
// =============================================================================
// Denetim 2026-11-01 K2 (VDS barındırma). Ölçülenler:
//   §1  hostedPlainBackupReason: LAN'da HER girdide null (bayt-aynı) · barındırılanda kapalı/düz → sebep
//   §2  sağlık (backupHealth): aynı düz gece yedeği LAN'da ok, barındırılanda KRİTİK + sebep
//   §3  yedek işi: barındırılan + şifreleme kapalı → yedek ALINIR ama iş kırmızı, düz döküm makine dışına
//       çıkmaz; LAN bugünkü gibi (yeşil, düz offsite kopyası); liste `hostedRequired` alanını YALNIZ
//       barındırılanda taşır
//   §4  ⭐ halka emaneti şifreli yedeğin İÇİNDE: döküm müşteri anahtarıyla açılır, emanet satırı müşteri
//       anahtarıyla halkadaki anahtarın ta kendisini verir
//   §5  "Etkili alıcısı varsayılan" (lisans.md): etkili.tkpub varken yedek başlığında etkili, kaldırınca
//       (kapatma) yok; iki durumda müşteri anahtarı çözer; kurulum etkili.tkpub'ı varsayılan koyar
// Sonda: TEKSERP_SONDA=emanetsiz (yedek öncesi emanet silinir → §4 kırmızı) · =lan-kirmizi (LAN'da da
//        sebep üretilir → §1 kırmızı). DB ister (yedek işi pg_dump + emanet tablosu); PG_BIN_DIR opsiyonel.
// =============================================================================
import "dotenv/config";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { atlamaDefteri } from "./lib/atlama";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import * as bc from "../src/lib/backup-crypto";

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

const SONDA = process.env.TEKSERP_SONDA ?? "";
const KOK_DIZIN = path.resolve(__dirname, "../..");
const kok = fs.mkdtempSync(path.join(os.tmpdir(), "tekserp-yedek-bar-"));
const yol = (ad: string): string => path.join(kok, ad);
const backups = yol("backups");
const offsite = yol("offsite");
fs.mkdirSync(backups, { recursive: true });
// Modüller BACKUP_DIR / BACKUP_OFFSITE_DIR'i yüklenirken okur: dinamik import'tan ÖNCE.
process.env.BACKUP_DIR = backups;
process.env.BACKUP_OFFSITE_DIR = offsite;
delete process.env.BACKUP_KEY_DIR;
const eskiSinif = process.env.TEKSERP_KURULUM_SINIFI;
const lan = (): void => {
  delete process.env.TEKSERP_KURULUM_SINIFI;
};
const barindirilan = (): void => {
  process.env.TEKSERP_KURULUM_SINIFI = "BARINDIRILAN";
};

const uc = { musteri: bc.generateRawKeyPair(), etkili: bc.generateRawKeyPair() };
const kimlik = (k: bc.RawKeyPair) => bc.privateKeyFromRaw(k.privateRaw);
const bekle = (ms: number) => new Promise((res) => setTimeout(res, ms));

async function saf(): Promise<void> {
  console.log("\n§1 hostedPlainBackupReason");
  const { hostedPlainBackupReason } = await import("../src/services/helpers/hosted-backup.helper");
  const girdiler = [
    { keyDir: undefined, nightlyName: "tekserp_20261101_030000.dump" },
    { keyDir: "", nightlyName: null },
    { keyDir: "/k", nightlyName: "tekserp_20261101_030000.dump" },
    { keyDir: "/k", nightlyName: "tekserp_20261101_030000.dump.tkenc" },
  ];
  const lanHosted = SONDA === "lan-kirmizi";
  check("§1a ⭐ LAN: her girdide null (bugünkü davranış bayt-aynı)",
    girdiler.every((g) => hostedPlainBackupReason({ hosted: lanHosted, ...g }) === null));
  check("§1b barındırılan + BACKUP_KEY_DIR yok → sebep",
    /KAPALI/.test(hostedPlainBackupReason({ hosted: true, keyDir: undefined, nightlyName: null }) ?? ""));
  check("§1c barındırılan + son gece yedeği düz → sebep (dosya adıyla)",
    /ŞİFRESİZ.*tekserp_20261101_030000\.dump/.test(hostedPlainBackupReason({ hosted: true, ...girdiler[2]! }) ?? ""));
  check("§1d barındırılan + son gece yedeği .tkenc → null",
    hostedPlainBackupReason({ hosted: true, ...girdiler[3]! }) === null);
}

async function saglik(): Promise<void> {
  console.log("\n§2 sağlık hükmü");
  const duz = path.join(backups, "tekserp_20990101_000000.dump");
  fs.writeFileSync(duz, "duz");
  const { backupHealth } = await import("../src/lib/health-snapshot");
  lan();
  const l = backupHealth();
  check("§2a LAN: taze düz gece yedeği → ok (bugünkü hüküm)", l.verdict === "ok", JSON.stringify(l));
  barindirilan();
  const k = backupHealth();
  check("§2b barındırılan + BACKUP_KEY_DIR yok → KRİTİK + KAPALI sebebi", k.verdict === "kritik" && /KAPALI/.test(k.reason), JSON.stringify(k));
  process.env.BACKUP_KEY_DIR = yol("bos-anahtar");
  const h = backupHealth();
  delete process.env.BACKUP_KEY_DIR;
  check("§2b2 ⭐ barındırılan + anahtar dizini beyanlı ama son gece yedeği düz → KRİTİK + ŞİFRESİZ", h.verdict === "kritik" && /ŞİFRESİZ/.test(h.reason), JSON.stringify(h));
  const src = fs.readFileSync(path.join(__dirname, "../src/services/notification-sources/sistem.ts"), "utf8");
  check("§2c bildirim kaynağı KRİTİK hükmü 'sistem.yedek-basarisiz'e taşıyor (zil yüzeyi)",
    /h\.verdict === "uyari" \|\| h\.verdict === "kritik"/.test(src));
  lan();
  fs.rmSync(duz);
}

function pgDumpEngeli(): string | null {
  if (!process.env.DATABASE_URL) return "DATABASE_URL yok";
  const bin = process.env.PG_BIN_DIR ? path.join(process.env.PG_BIN_DIR, "pg_dump") : "pg_dump";
  return spawnSync(bin, ["--version"]).status === 0 ? null : `pg_dump çalıştırılamadı (${bin})`;
}

async function yedekIsi(): Promise<void> {
  console.log("\n§3 yedek işi (gerçek pg_dump)");
  const svc = await import("../src/services/backup.service");
  barindirilan();
  const h = await svc.runBackupJob("manual");
  const hAd = h.file ? path.basename(h.file) : "";
  check("§3a ⭐ barındırılan + şifreleme kapalı → yedek ALINDI ama iş KIRMIZI",
    !h.ok && !!h.file && fs.existsSync(h.file) && /BARINDIRILAN/.test(h.message), h.message);
  check("§3b barındırılanda düz döküm makine dışına KOPYALANMADI",
    !fs.existsSync(path.join(offsite, hAd)));
  const hl = await svc.listBackups();
  check("§3c barındırılan liste `hostedRequired: true` taşır", hl.encryption.hostedRequired === true);
  lan();
  await bekle(1100);
  const l = await svc.runBackupJob("manual");
  check("§3d LAN + şifreleme kapalı → bugünkü gibi yeşil, düz offsite kopyası",
    l.ok && !!l.file && fs.existsSync(path.join(offsite, path.basename(l.file))), l.message);
  const ll = await svc.listBackups();
  check("§3e ⭐ LAN listesinde `hostedRequired` alanı HİÇ yok (yanıt bayt-aynı)", !("hostedRequired" in ll.encryption));
  for (const f of [h.file, l.file]) if (f) fs.rmSync(f, { force: true });
}

function emanetSatiri(sql: string, kid: string): string | null {
  // COPY satırları sekmeyle ayrılır; sütun sırası başlıktan okunur (şema değişse de doğru sütun).
  const bas = sql.split("\n").find((s) => s.startsWith("COPY public.short_credential_key_escrows"));
  if (!bas) return null;
  const sutunlar = bas.slice(bas.indexOf("(") + 1, bas.indexOf(")")).split(",").map((s) => s.trim().replace(/"/g, ""));
  const iKid = sutunlar.indexOf("kid");
  const iSealed = sutunlar.indexOf("sealed");
  const govde = sql.slice(sql.indexOf(bas) + bas.length).split("\n\\.")[0] ?? "";
  for (const satir of govde.split("\n")) {
    const alan = satir.split("\t");
    if (alan[iKid] === kid) return alan[iSealed] ?? null;
  }
  return null;
}

async function emanetVeEtkili(): Promise<void> {
  console.log("\n§4 halka emaneti şifreli yedeğin içinde · §5 Etkili alıcısı");
  const prisma = (await import("../src/lib/prisma")).default;
  const keyring = await import("../src/lib/short-credential/keyring");
  const { openSealedKey } = await import("../src/lib/short-credential/escrow-crypto");
  const svc = await import("../src/services/backup.service");
  keyring.setShortCredentialKeyDirForTests(yol("lisans"));
  const halka = keyring.getShortCredentialKeyRing();
  if (!halka.ok) {
    check("§4 halka kurulamadı", false, halka.detail);
    return;
  }
  const kid = halka.ring.active.kid;
  const anahtarDizini = yol("yedek-anahtar");
  fs.mkdirSync(anahtarDizini, { recursive: true });
  fs.writeFileSync(path.join(anahtarDizini, "musteri.tkpub"), `${bc.encodePublicKey(uc.musteri.publicRaw)}\n`);
  fs.writeFileSync(path.join(anahtarDizini, "etkili.tkpub"), `${bc.encodePublicKey(uc.etkili.publicRaw)}\n`);
  process.env.BACKUP_KEY_DIR = anahtarDizini;
  barindirilan();
  try {
    if (SONDA === "emanetsiz") {
      // Sonda: yedek işinin emaneti tazelemediği durumu benzetir (syncEscrow çağrısı silinmiş gibi).
      const orijinal = (await import("../src/services/short-credential-admin.service")).ShortCredentialAdminService;
      orijinal.syncEscrow = async () => ({ state: "acik", sealed: [], current: [] });
    }
    const r = await svc.runBackupJob("manual");
    check("§4a barındırılan + alıcılar var → yedek ŞİFRELİ ve yeşil", r.ok && !!r.file?.endsWith(".dump.tkenc"), r.message);
    if (!r.file?.endsWith(".dump.tkenc")) return;
    const duz = yol("acilan.dump");
    await bc.decryptFile(r.file, duz, [kimlik(uc.musteri)]);
    const pgr = process.env.PG_BIN_DIR ? path.join(process.env.PG_BIN_DIR, "pg_restore") : "pg_restore";
    const out = spawnSync(pgr, ["-a", "-t", "short_credential_key_escrows", "-f", "-", duz], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const muhur = emanetSatiri(out.stdout ?? "", kid);
    check("§4b ⭐ şifreli dökümün içinde halkanın etkin anahtarının emanet satırı VAR", muhur !== null, `kid=${kid} pg_restore=${out.status}`);
    if (muhur) {
      const acik = await openSealedKey(muhur, [kimlik(uc.musteri)]);
      check("§4c ⭐ emanet müşteri anahtarıyla açılır ve halkadaki anahtarın TA KENDİSİDİR", acik.equals(halka.ring.active.key));
      check("§4d emanet anahtarı düz taşımaz", !muhur.includes(halka.ring.active.key.toString("base64url")));
      let etkiliAcar = false;
      try {
        etkiliAcar = (await openSealedKey(muhur, [kimlik(uc.etkili)])).equals(halka.ring.active.key);
      } catch {
        etkiliAcar = false;
      }
      check("§4e emaneti Etkili alıcısı da açar (kurtarma yolu)", etkiliAcar);
    }
    fs.rmSync(duz, { force: true });

    const bas1 = (await bc.readHeader(r.file)).header.alicilar.map((a) => a.ad);
    check("§5a ⭐ etkili.tkpub varken yedek başlığında Etkili alıcısı var", bas1.includes("etkili") && bas1.includes("musteri"), bas1.join(","));
    // Kapatma: müşteri etkili.tkpub'ı kaldırır → bir sonraki yedekten itibaren alıcı değildir.
    fs.rmSync(path.join(anahtarDizini, "etkili.tkpub"));
    await bekle(1100);
    const r2 = await svc.runBackupJob("manual");
    const bas2 = r2.file?.endsWith(".tkenc") ? (await bc.readHeader(r2.file)).header.alicilar.map((a) => a.ad) : [];
    check("§5b kapatınca (etkili.tkpub yok) başlıkta Etkili YOK, müşteri var", r2.ok && !bas2.includes("etkili") && bas2.includes("musteri"), bas2.join(","));
    let ikisiDeAcilir = false;
    if (r2.file) {
      await bc.decryptFile(r.file, yol("a1.dump"), [kimlik(uc.musteri)]);
      await bc.decryptFile(r2.file, yol("a2.dump"), [kimlik(uc.musteri)]);
      ikisiDeAcilir = fs.statSync(yol("a1.dump")).size > 0 && fs.statSync(yol("a2.dump")).size > 0;
    }
    check("§5c iki durumda da müşteri anahtarı yedeği çözer", ikisiDeAcilir);
  } finally {
    await prisma.shortCredentialKeyEscrow.deleteMany({ where: { kid } }).catch(() => undefined);
    keyring.setShortCredentialKeyDirForTests(null);
    delete process.env.BACKUP_KEY_DIR;
    lan();
  }
}

function kurulumVarsayilani(): void {
  console.log("\n§5 kurulumun Etkili alıcısı varsayılanı (statik)");
  const kurulum = fs.readFileSync(path.join(KOK_DIZIN, "deploy/kurulum/kurulum.ps1"), "utf8");
  const onOlcum = fs.readFileSync(path.join(KOK_DIZIN, "deploy/kurulum/on-olcum.ps1"), "utf8");
  const iss = fs.readFileSync(path.join(KOK_DIZIN, "deploy/kurulum/tekserp-kurulum.iss"), "utf8");
  check("§5d ön ölçüm arşivdeki etkili.tkpub'ı bulur, sihirbaz şifrelemede onu cevaba koyar (varsayılan dahil)",
    /etkiliAnahtar.*etkili\.tkpub/.test(onOlcum) && /if Sifre then Etkili := Olc\('etkiliAnahtar'\)/.test(iss));
  check("§5e kurulum etkili.tkpub'ı anahtar dizinine kopyalar, var olanı EZMEZ (sonradan kapatma kalıcı)",
    /yedek\.etkiliAcikAnahtar"\] -and -not \(Test-Path -LiteralPath \(Join-Path \$ad "etkili\.tkpub"\)\)/.test(kurulum));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  try {
    await saf();
    await saglik();
    kurulumVarsayilani();
    const pg = engel ?? pgDumpEngeli();
    if (pg) {
      defter.atla("§3–§5 yedek zinciri", pg, "?");
    } else {
      await yedekIsi();
      await emanetVeEtkili();
    }
  } catch (e) {
    fail++;
    console.log(`❌ beklenmeyen hata: ${e instanceof Error ? e.stack : String(e)}`);
  } finally {
    if (eskiSinif === undefined) delete process.env.TEKSERP_KURULUM_SINIFI;
    else process.env.TEKSERP_KURULUM_SINIFI = eskiSinif;
    fs.rmSync(kok, { recursive: true, force: true });
    if (process.env.DATABASE_URL) {
      const { default: prisma, pool } = await import("../src/lib/prisma");
      await prisma.$disconnect().catch(() => {});
      await pool.end().catch(() => {});
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${defter.ozetEki()} ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

void main();
