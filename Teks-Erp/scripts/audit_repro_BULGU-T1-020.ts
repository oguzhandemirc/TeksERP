// =============================================================================
// AUDIT REPRO — BULGU-T1-020: kur.ps1'in [5/9] dosya yerleştirme adımı
// sunucudaki `ecosystem.config.js`i paketinkiyle EZER; korunan tek dosya `.env`.
// Sonuç: operatörün sunucuda açtığı gece yedeği (BACKUP_SCHEDULE_ENABLED) ve
// makine dışı kopya hedefi (BACKUP_OFFSITE_DIR) sessizce repo değerlerine döner.
//
// Ortam: SADECE dev makinesi. DB'ye YAZMAZ (yalnız salt-okunur sonda).
// Yan etki YOK: pg_dump / rclone / yazıcı ÇAĞRILMAZ; tüm dosya işi os.tmpdir()
// altında geçici bir klasörde olur ve `finally`de silinir.
//
// Beklenen (sağlıklı sistem): kurulum sonrası app\ecosystem.config.js hâlâ
//   operatörün değerlerini taşır (ya da script en azından FARKI SÖYLER).
// Gözlenen: aşağıdaki koşumun çıktısına bak — audit/repro/BULGU-T1-020.log
//
// Çalıştır:
//   cd Teks-Erp && npx tsx scripts/audit_repro_BULGU-T1-020.ts
// =============================================================================
import "dotenv/config";

function devDbGuard(): void {
  const url = process.env.DATABASE_URL ?? "";
  if ((process.env.NODE_ENV ?? "") === "production" || (process.env.APP_ENV ?? "") === "production") {
    throw new Error("REPRO: production ortamında koşturulamaz");
  }
  let host = "";
  let db = "";
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    db = decodeURIComponent(u.pathname.replace(/^\//, ""));
  } catch {
    throw new Error("REPRO: DATABASE_URL çözümlenemedi (fail-closed)");
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(`REPRO: yerel olmayan host reddedildi: ${host}`);
  }
  if (/saha|prod|canli|sahin/i.test(db) && db !== "adnansahin_db") {
    throw new Error(`REPRO: prod kopyası/prod adı reddedildi: ${db}`);
  }
}
devDbGuard();

import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import prisma from "../src/lib/prisma";

const REPO = path.resolve(__dirname, "..", "..");
const DAMGA = `AUDITREPRO-BULGU-T1-020-${crypto.randomBytes(3).toString("hex")}`;

let pass = 0;
let fail = 0;
const ok = (m: string) => { pass += 1; console.log(`  ✅ ${m}`); };
const no = (m: string) => { fail += 1; console.log(`  ❌ ${m}`); };
const bilgi = (m: string) => console.log(`  ·  ${m}`);

// ---------------------------------------------------------------------------
// §1 — Sözleşme okuması: kur.ps1 neyi koruyor, paketle.ps1 neyi taşıyor
// ---------------------------------------------------------------------------
function bolum1(): void {
  console.log("\n§1 Deploy sözleşmesi (kur.ps1 [5/9] + paketle.ps1)");
  const kur = fs.readFileSync(path.join(REPO, "deploy", "kur.ps1"), "utf8").split("\n");
  const paketle = fs.readFileSync(path.join(REPO, "deploy", "paketle.ps1"), "utf8").split("\n");

  const kopyaSatir = kur.findIndex((l) => l.includes('Copy-Item "$temp\\*" $appDir'));
  const envSatir = kur.findIndex((l) => l.includes("Copy-Item $envYedek"));
  if (kopyaSatir >= 0) ok(`kur.ps1:${kopyaSatir + 1} paketin TAMAMINI app\\ üzerine kopyalıyor`);
  else no("kur.ps1'de toplu kopyalama satırı bulunamadı — script değişmiş, bulgu yeniden ölçülmeli");
  if (envSatir >= 0) ok(`kur.ps1:${envSatir + 1} kurulumdan sonra geri konan TEK dosya: .env`);
  else no("kur.ps1'de .env geri koyma satırı bulunamadı");

  // Korunan dosya sayısı: yalnız .env mi?
  const korunan = kur.filter((l) => /Copy-Item \$envYedek|Copy-Item \$env[A-Za-z]*Yedek/.test(l)).length;
  if (korunan === 1) ok("korunan dosya sayısı = 1 (yalnız .env) — ecosystem.config.js korunmuyor");
  else no(`korunan dosya sayısı beklenmedik: ${korunan}`);

  const eko = paketle.findIndex((l) => l.includes('ecosystem.config.js" "$stage'));
  if (eko >= 0) ok(`paketle.ps1:${eko + 1} repo kopyası ecosystem.config.js'i PAKETE koyuyor`);
  else no("paketle.ps1'de ecosystem.config.js paketleme satırı yok");

  // Karşılaştırma/uyarı adımı var mı?
  const uyari = kur.filter((l) => /ecosystem/i.test(l) && /(Compare|diff|fark|farkli|degisti)/i.test(l)).length;
  if (uyari === 0) ok("kur.ps1'de ecosystem.config.js için KARŞILAŞTIRMA/UYARI adımı YOK (sessiz ezme)");
  else no(`beklenmedik: kur.ps1'de ${uyari} karşılaştırma satırı var — bulgu yeniden ölçülmeli`);
}

// ---------------------------------------------------------------------------
// §2 — Davranışsal repro: [5/9] adımını birebir yeniden oynat
//      (pwsh bu makinede YOK; adım Node ile 1:1 taklit edilir)
// ---------------------------------------------------------------------------
type Env = Record<string, string>;

function pm2Env(dosya: string): Env {
  // pm2 `start ecosystem.config.js` derken dosyayı Node ile değerlendirir ve
  // apps[0].env'i sürecin ortamına enjekte eder. Burada aynısını yapıyoruz.
  delete require.cache[require.resolve(dosya)];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const cfg = require(dosya) as { apps: Array<{ env?: Env }> };
  return cfg.apps[0].env ?? {};
}

function birTur(tur: number): { bozulan: string[]; envKorundu: boolean } {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), `${DAMGA}-t${tur}-`));
  try {
    const appDir = path.join(kok, "app");
    const temp = path.join(kok, "paket");
    fs.mkdirSync(appDir);
    fs.mkdirSync(temp);

    // (a) SUNUCUDAKİ ÇALIŞAN KURULUM — operatör iki anahtarı elle değiştirmiş
    const repoEko = fs.readFileSync(path.join(REPO, "Teks-Erp", "ecosystem.config.js"), "utf8");
    const sahaEko = repoEko
      .replace('BACKUP_SCHEDULE_ENABLED: "false"', 'BACKUP_SCHEDULE_ENABLED: "true"')
      .replace('BACKUP_OFFSITE_DIR: ""', 'BACKUP_OFFSITE_DIR: "E:/tekserp-offsite"');
    if (sahaEko === repoEko) throw new Error("REPRO: saha varyantı üretilemedi (anahtar metinleri değişmiş)");
    fs.writeFileSync(path.join(appDir, "ecosystem.config.js"), sahaEko);
    fs.writeFileSync(path.join(appDir, ".env"), `DATABASE_URL="postgresql://x"\n# ${DAMGA}\n`);
    fs.writeFileSync(path.join(appDir, "MARKER-CALISAN"), DAMGA);

    const oncesi = pm2Env(path.join(appDir, "ecosystem.config.js"));

    // (b) PAKET — paketle.ps1:129 repo kopyasını koyar
    fs.writeFileSync(path.join(temp, "ecosystem.config.js"), repoEko);
    fs.writeFileSync(path.join(temp, "MARKER-PAKET"), DAMGA);

    // (c) kur.ps1 [5/9] — birebir sıra
    const envYedek = path.join(kok, "env.bak");
    fs.copyFileSync(path.join(appDir, ".env"), envYedek);          // kur.ps1:164
    fs.renameSync(appDir, path.join(kok, "app.eski-TEST"));         // Move-Item  (:263)
    fs.mkdirSync(appDir);                                           // New-Item   (:265)
    for (const f of fs.readdirSync(temp)) {                         // Copy-Item  (:266)
      fs.copyFileSync(path.join(temp, f), path.join(appDir, f));
    }
    fs.copyFileSync(envYedek, path.join(appDir, ".env"));           // Copy-Item  (:267)

    // (d) pm2 delete + start ecosystem.config.js → yeni env yüklenir (kur.ps1:190, :303)
    const sonrasi = pm2Env(path.join(appDir, "ecosystem.config.js"));

    const bozulan: string[] = [];
    for (const k of ["BACKUP_SCHEDULE_ENABLED", "BACKUP_OFFSITE_DIR"]) {
      if (oncesi[k] !== sonrasi[k]) bozulan.push(`${k}: "${oncesi[k]}" → "${sonrasi[k]}"`);
    }
    const envKorundu = fs.readFileSync(path.join(appDir, ".env"), "utf8").includes(DAMGA);
    return { bozulan, envKorundu };
  } finally {
    fs.rmSync(kok, { recursive: true, force: true });
  }
}

function bolum2(): void {
  console.log("\n§2 Davranışsal repro — kur.ps1 [5/9] + pm2 env yüklemesi (10 tekrar)");
  bilgi("pwsh bu makinede kurulu DEĞİL (`which pwsh` → not found) → adım Node ile birebir taklit edildi.");
  let bozuk = 0;
  let ornek: string[] = [];
  let envHep = true;
  for (let i = 1; i <= 10; i += 1) {
    const r = birTur(i);
    if (r.bozulan.length > 0) { bozuk += 1; if (ornek.length === 0) ornek = r.bozulan; }
    if (!r.envKorundu) envHep = false;
  }
  console.log(`  → 10 tekrarın ${bozuk}'unda operatör ayarı kayboldu.`);
  for (const s of ornek) console.log(`     • ${s}`);
  if (bozuk === 10) ok("DETERMİNİSTİK: her kurulumda ecosystem.config.js paketinkiyle ezilir");
  else no(`beklenmedik: yalnız ${bozuk}/10 turda ezildi`);
  if (envHep) ok(".env her turda korundu (kontrast: koruma MEKANİZMASI var, kapsamı dar)");
  else no(".env korunamadı — repro kurgusu hatalı");
}

// ---------------------------------------------------------------------------
// §3 — Kurtarıcı var mı? DB'de (SystemSetting) bir geri düşüş bulunuyor mu
// ---------------------------------------------------------------------------
async function bolum3(): Promise<void> {
  console.log("\n§3 DB tarafında kurtarıcı sonda (salt-okunur)");
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: ["backup.offsiteDir", "backup.offsiteRemote", "backup.hour", "backup.lastNightlyAt"] } },
    select: { key: true, updatedAt: true },
  });
  const bulunan = new Set(rows.map((r) => r.key));
  for (const k of ["backup.offsiteDir", "backup.offsiteRemote", "backup.hour", "backup.lastNightlyAt"]) {
    bilgi(`${k}: ${bulunan.has(k) ? "kayıt VAR" : "kayıt YOK"}`);
  }

  const svc = fs.readFileSync(path.join(REPO, "Teks-Erp", "src", "services", "backup.service.ts"), "utf8");
  if (/const OFFSITE_DIR = process\.env\.BACKUP_OFFSITE_DIR/.test(svc)) {
    ok("backup.service.ts OFFSITE_DIR'i MODÜL YÜKÜNDE env'den okuyor (DB geri düşüşü YOK)");
  } else no("backup.service.ts deseni değişmiş — bulgu yeniden ölçülmeli");
  if (!/readOffsiteDir/.test(svc)) {
    ok("backup.service.ts `readOffsiteDir()` (SystemSetting) fonksiyonunu HİÇ çağırmıyor → panelden girilen offsite dizini yedek motoruna ULAŞMAZ");
  } else no("backup.service.ts readOffsiteDir kullanıyor — ayrışma iddiası düşer");

  const sch = fs.readFileSync(path.join(REPO, "Teks-Erp", "src", "jobs", "backup-scheduler.ts"), "utf8");
  if (/process\.env\.BACKUP_SCHEDULE_ENABLED === "false"/.test(sch)) {
    ok("backup-scheduler.ts bayrağı YALNIZ env'den okuyor (SystemSetting ezmesi YOK)");
  } else no("backup-scheduler.ts deseni değişmiş");

  // Kontrast: rclone hedefi SystemSetting'ten okunur → panelde kayıt VARSA deploy'u atlatır
  const helper = fs.readFileSync(
    path.join(REPO, "Teks-Erp", "src", "services", "helpers", "offsite-backup.helper.ts"), "utf8");
  if (/readOffsiteRemote\(\)/.test(helper)) {
    ok("KONTRAST: rclone hedefi readOffsiteRemote() → SystemSetting öncelikli (panel kaydı varsa deploy'dan SAĞ ÇIKAR)");
  } else no("offsite-backup.helper.ts deseni değişmiş");
}

async function main(): Promise<void> {
  console.log(`AUDIT REPRO BULGU-T1-020 — damga ${DAMGA}`);
  console.log(`repo: ${REPO}`);
  bolum1();
  bolum2();
  await bolum3();
  console.log(`\nÖZET: ${pass} geçti, ${fail} düştü.`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main()
  .catch((e) => { console.error("REPRO HATASI:", e); process.exitCode = 1; })
  .finally(async () => {
    await prisma.$disconnect();
    // tsx/pg havuzu açık handle bırakabiliyor — çıkışı kesinleştir (log kesilmesin).
    process.exit(process.exitCode ?? 0);
  });
