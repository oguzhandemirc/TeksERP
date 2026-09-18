// =============================================================================
// UÇTAN UCA TEST ORTAMI — kendi DB'n, kendi backend'in, kendi kullanıcıların
// =============================================================================
// Koşum (Teks-Erp/ içinden):
//   npx tsx scripts/e2e-ortam.ts kur       # dump kopyası + migrate + fixture (idempotent)
//   npx tsx scripts/e2e-ortam.ts sunucu    # backend'i E2E DB'siyle :4110'da başlat (ön plan)
//   npx tsx scripts/e2e-ortam.ts sistem-hesabi   # sistem hesabını rotasyonla kur, parolayı STDOUT'a bas
//   npx tsx scripts/e2e-ortam.ts temizle   # DB'yi ve ortam dosyasını sil
//
// ⚠️ KULLANICININ 4000/Electron'una DOKUNMAZ. Hedef DB adı KAPALI bir kalıba
// uymak ZORUNDA (`tekserp_<oturum>e2e_test`); başka ad → hiçbir şey yapmadan çık.
// Panel sürücüsü (`Electron/e2e/guzergah/`) bu script'in yazdığı ortam
// dosyasını okur: `${os.tmpdir()}/tekserp-e2e-env.json` (yalnız test
// kullanıcıları; SİSTEM HESABI PAROLASI DOSYAYA YAZILMAZ — `sistem-hesabi`
// alt komutu onu yalnız stdout'a basar, sürücü bellekte tutar).
//
// Kaynak: fabrika dump'ının kopyası (`dump/tekserp_yeni_*.dump`, en yenisi) —
// gerçek veri üzerinde TEST- önekli kayıtlarla koşulur; "fixture'da yeşil"
// sahayı temsil etmez ama dump kopyası eder.
// =============================================================================
import "dotenv/config";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { cocukOrtami, fixtureHedefEngeli, hedefDbEngeli } from "./lib/hedef-db-kapisi";

const DB_ADI = process.env.E2E_DB_NAME ?? "tekserp_d9e2e_test";
const DB_KALIP = /^tekserp_[a-z0-9]+e2e_test$/;
const PG_BIN = process.env.PG_BIN ?? "/opt/homebrew/opt/libpq/bin";
const PG_HOST = process.env.E2E_PG_HOST ?? "localhost";
const PG_PORT = process.env.E2E_PG_PORT ?? "55433";
const PG_USER = process.env.E2E_PG_USER ?? "tekserp";
const PG_PASS = process.env.E2E_PG_PASSWORD ?? "tekserp";
const API_PORT = process.env.E2E_API_PORT ?? "4110";
const ORTAM_DOSYASI = path.join(os.tmpdir(), "tekserp-e2e-env.json");
const KOK = path.resolve(__dirname, "..");

const dbUrl = (db: string): string =>
  `postgresql://${PG_USER}:${PG_PASS}@${PG_HOST}:${PG_PORT}/${db}?schema=public`;
/** libpq araçları (`pg_restore`) `?schema=` parametresini TANIMAZ — Prisma'ya özgü. */
const libpqUrl = (db: string): string => dbUrl(db).replace(/\?schema=public$/, "");

function dur(mesaj: string): never {
  console.error(`⛔ ${mesaj}`);
  process.exit(1);
}

/**
 * Ad kapısı — FAIL-CLOSED ve İKİ KATLI. Bu betik kendi DB hedefini KURAR (DATABASE_URL'i
 * kendisi yazar), o yüzden `.env`i okuyan ortak kapı tek başına yetmez:
 *   ① yerel kalıp: `_test` ile bitmek ve `e2e` damgası ZORUNLU — fabrikanın canlı yedeği
 *     (ve herhangi bir `_dev`) yapısal olarak giremez;
 *   ② ORTAK kapılar (`hedefDbEngeli` üretim adı · `fixtureHedefEngeli` fixture kalıbı) —
 *     kurulan hedef `DATABASE_URL`e yazıldıktan SONRA sorulur; `test_script_guards §10b`
 *     kendi hedefini kuran her betikte bu çağrıyı arar (kapısız hedef kurma tavanı).
 */
function adKapisi(): void {
  if (!DB_KALIP.test(DB_ADI)) dur(`E2E DB adı kalıba uymuyor: ${DB_ADI} (beklenen ${DB_KALIP})`);
  process.env.DATABASE_URL = dbUrl(DB_ADI);
  const engel = hedefDbEngeli() ?? fixtureHedefEngeli();
  if (engel) dur(engel);
}

function pg(arac: string, args: string[], opts: { input?: string; sessiz?: boolean } = {}): string {
  const r = spawnSync(path.join(PG_BIN, arac), args, {
    env: { ...cocukOrtami(), PGPASSWORD: PG_PASS },
    input: opts.input,
    encoding: "utf-8",
  });
  if (r.status !== 0 && !opts.sessiz) dur(`${arac} ${args.join(" ")} → ${r.stderr?.trim()}`);
  return (r.stdout ?? "").trim();
}

function sql(db: string, q: string): string {
  return pg("psql", ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", db, "-tAc", q]);
}

function dbVarMi(): boolean {
  return sql("postgres", `SELECT 1 FROM pg_database WHERE datname='${DB_ADI}'`) === "1";
}

function enYeniDump(): string {
  if (process.env.E2E_DUMP) {
    if (!fs.existsSync(process.env.E2E_DUMP)) dur(`E2E_DUMP yok: ${process.env.E2E_DUMP}`);
    return process.env.E2E_DUMP;
  }
  // dump/ git'e girmez → izole ağaçta yoktur; ana ağacın yolu `git worktree list`ten okunur.
  const anaAgac = spawnSync("git", ["worktree", "list", "--porcelain"], { cwd: KOK, encoding: "utf-8" })
    .stdout?.split("\n").find((l) => l.startsWith("worktree "))?.slice("worktree ".length);
  const dizinler = [path.join(KOK, "..", "dump"), path.join(KOK, "dump"), ...(anaAgac ? [path.join(anaAgac, "dump")] : [])];
  const adaylar = dizinler
    .filter((d) => fs.existsSync(d))
    .flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith(".dump")).map((f) => path.join(d, f)))
    .sort();
  if (adaylar.length === 0) dur("dump/ altında .dump bulunamadı");
  return adaylar[adaylar.length - 1];
}

// ── kur ──────────────────────────────────────────────────────────────────────
async function kur(): Promise<void> {
  adKapisi();
  const tabloSayisi = (): number => Number(sql(DB_ADI, "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'") || 0);
  if (dbVarMi() && tabloSayisi() >= 50) {
    console.log(`ℹ️  ${DB_ADI} zaten dolu — restore ATLANDI (sıfırlamak için önce \`temizle\`).`);
  } else {
    const dump = enYeniDump();
    console.log(`→ ${DB_ADI} ${dbVarMi() ? "boş, dolduruluyor" : "oluşturuluyor"} (kaynak: ${path.basename(dump)})`);
    if (!dbVarMi()) sql("postgres", `CREATE DATABASE "${DB_ADI}"`);
    // Bağlantı URL'i ile restore — sahip/yetki satırları atlanır (farklı rol).
    const r = spawnSync(path.join(PG_BIN, "pg_restore"), ["--no-owner", "--no-privileges", "-d", libpqUrl(DB_ADI), dump], {
      env: { ...cocukOrtami() }, encoding: "utf-8",
    });
    // pg_restore uyarılarda da 1 dönebilir (transaction_timeout vb.) — tablo sayısıyla doğrula.
    const tablo = tabloSayisi();
    if (tablo < 50) dur(`restore başarısız görünüyor (${tablo} tablo)\n${r.stderr?.slice(0, 800)}`);
    console.log(`✅ restore: ${tablo} tablo`);
  }
  console.log("→ prisma migrate deploy");
  const m = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: KOK, env: cocukOrtami({ DATABASE_URL: dbUrl(DB_ADI) }), encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"],
  });
  if (m.status !== 0) dur(`migrate deploy → ${m.stderr?.slice(-600)}`);
  console.log("✅ " + (m.stdout.match(/No pending migrations|have been successfully applied/)?.[0] ?? "migrate deploy"));
  await fixture();
}

// ── fixture ──────────────────────────────────────────────────────────────────
// Test kullanıcıları + kataloglar + tüm modüller AÇIK. Sistem hesabına DOKUNMAZ.
async function fixture(): Promise<void> {
  adKapisi(); // DATABASE_URL'i de yazar — Prisma istemcisi onu modül yüklenirken okur → dinamik import.
  const { default: prisma, pool } = await import("../src/lib/prisma");
  const { reconcilePermissionCatalog } = await import("../src/jobs/permission-catalog.job");
  const { reconcileReasonPresets } = await import("../src/jobs/reason-preset-catalog.job");
  const { PermissionManagementService } = await import("../src/services/permission-management.service");
  const { AuthService } = await import("../src/services/auth.service");
  const { SETTING_KEYS } = await import("../src/services/system-setting.service");
  try {
    await reconcilePermissionCatalog();
    await reconcileReasonPresets();

    const parola = (): string => randomBytes(9).toString("base64url");
    // ⚠️ TABLET OPERATÖRÜ SAYISAL PAROLA: tablet giriş ekranının şifre alanı `number-pad`
    // (LoginScreen "şifre değişken uzunlukta, NUMERİK") — alfanümerik parolayla operatör
    // tablete UI'dan HİÇ giremez (d5 ölçtü 2026-09-18). 12 hane rastgele rakam.
    const sayisalParola = (): string => Array.from(randomBytes(12), (b) => String(b % 10)).join("");
    // `setUserPermissions` ID ister, kod değil — katalog uzlaştırıldıktan sonra tablodan okunur.
    const tumIzinIdleri = (await prisma.permission.findMany({ select: { id: true } })).map((p) => p.id);
    const kullanicilar: Record<string, { username: string; password: string }> = {};
    const tanimlar: Array<{ anahtar: string; username: string; fullName: string; tumIzin: boolean; operator: boolean }> = [
      { anahtar: "yonetici", username: "e2e-yonetici", fullName: "TEST E2E Yönetici", tumIzin: true, operator: false },
      { anahtar: "muhasebe", username: "e2e-muhasebe", fullName: "TEST E2E Muhasebe", tumIzin: true, operator: false },
      { anahtar: "operator", username: "e2e-operator", fullName: "TEST E2E Operatör", tumIzin: false, operator: true },
    ];
    for (const t of tanimlar) {
      const p = t.operator ? sayisalParola() : parola();
      const mevcut = await prisma.user.findUnique({ where: { username: t.username }, select: { id: true } });
      let id: string;
      if (mevcut) {
        id = mevcut.id;
        await prisma.user.update({
          where: { id }, data: { passwordHash: await AuthService.hashPassword(p), isActive: true, tokenVersion: { increment: 1 } },
        });
      } else {
        const olusan = await PermissionManagementService.createUser({
          username: t.username, fullName: t.fullName, password: p, grantOperatorDefaults: t.operator,
        }, undefined as never);
        id = (olusan as { id: string }).id;
      }
      if (t.tumIzin) {
        await PermissionManagementService.setUserPermissions(id, tumIzinIdleri, undefined);
      }
      kullanicilar[t.anahtar] = { username: t.username, password: p };
    }

    // Tüm modüller AÇIK (güzergâh A1 bunu varsayar).
    const modulAnahtarlari = [
      SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.FINANCE_ENABLED, SETTING_KEYS.TICARET_ENABLED,
      SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DEPO_MULTI_ENABLED, SETTING_KEYS.KUMAS_TEKNIK_ENABLED,
      SETTING_KEYS.TEZGAH_ENABLED, SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.DOKUMA_ENABLED,
    ];
    for (const key of modulAnahtarlari) {
      await prisma.systemSetting.upsert({ where: { key }, update: { value: true }, create: { key, value: true, description: "E2E fixture" } });
    }
    await prisma.systemSetting.upsert({
      where: { key: SETTING_KEYS.REPORTS_CLOSED_KEYS }, update: { value: [] }, create: { key: SETTING_KEYS.REPORTS_CLOSED_KEYS, value: [], description: "E2E fixture" },
    });

    const ortam = {
      apiUrl: `http://127.0.0.1:${API_PORT}`, dbUrl: dbUrl(DB_ADI), dbName: DB_ADI, kullanicilar,
      not: "operator parolası SAYISALDIR (tablet number-pad); PIN/kart ortam dosyasına YAZILMAZ",
      yazildi: new Date().toISOString(),
    };
    fs.writeFileSync(ORTAM_DOSYASI, JSON.stringify(ortam, null, 2), { mode: 0o600 });
    console.log(`✅ fixture: ${tanimlar.length} kullanıcı · ${modulAnahtarlari.length} modül açık · ortam → ${ORTAM_DOSYASI}`);
  } finally {
    await prisma.$disconnect();
    await pool.end().catch(() => undefined);
  }
}

// ── sistem-hesabi ────────────────────────────────────────────────────────────
// Parola YALNIZ stdout'a (tek satır JSON). Dosyaya yazılmaz; sürücü bellekte tutar.
async function sistemHesabi(): Promise<void> {
  adKapisi();
  const { default: prisma, pool } = await import("../src/lib/prisma");
  const { provisionSuperadmin } = await import("./superadmin-olustur");
  try {
    const mevcut = await prisma.user.findFirst({ where: { isSystemAccount: true }, select: { username: true } });
    const password = randomBytes(12).toString("base64url");
    const r = await provisionSuperadmin({ username: mevcut?.username ?? "sistem", password, pin: null, rotate: Boolean(mevcut) });
    if (r.kind === "error") dur(`sistem hesabı: ${r.code} ${r.message}`);
    if (r.kind === "exists") dur("sistem hesabı zaten var ama rotasyon yapılmadı — parola bilinmiyor");
    const ad = mevcut?.username ?? "sistem";
    process.stdout.write(JSON.stringify({ username: ad, password }) + "\n");
  } finally {
    await prisma.$disconnect();
    await pool.end().catch(() => undefined);
  }
}

// ── sunucu ───────────────────────────────────────────────────────────────────
function sunucu(): void {
  adKapisi();
  if (!dbVarMi()) dur(`${DB_ADI} yok — önce \`kur\``);
  const jwt = process.env.E2E_JWT_SECRET ?? randomBytes(32).toString("hex");
  console.log(`→ backend :${API_PORT} · DB ${DB_ADI}`);
  const cocuk = spawn("npx", ["tsx", "src/server.ts"], {
    cwd: KOK, stdio: "inherit",
    env: cocukOrtami({ PORT: API_PORT, HOST: "127.0.0.1", DATABASE_URL: dbUrl(DB_ADI), JWT_SECRET: jwt, NODE_ENV: "development" }),
  });
  const kapat = (): void => { cocuk.kill("SIGTERM"); };
  process.on("SIGINT", kapat);
  process.on("SIGTERM", kapat);
  cocuk.on("exit", (kod) => process.exit(kod ?? 0));
}

// ── temizle ──────────────────────────────────────────────────────────────────
function temizle(): void {
  adKapisi();
  if (dbVarMi()) {
    sql("postgres", `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DB_ADI}' AND pid<>pg_backend_pid()`);
    sql("postgres", `DROP DATABASE "${DB_ADI}"`);
    console.log(`✅ ${DB_ADI} silindi`);
  } else console.log(`ℹ️  ${DB_ADI} zaten yok`);
  if (fs.existsSync(ORTAM_DOSYASI)) { fs.unlinkSync(ORTAM_DOSYASI); console.log(`✅ ${ORTAM_DOSYASI} silindi`); }
}

const komut = process.argv[2];
const islem: Record<string, () => void | Promise<void>> = { kur, fixture, "sistem-hesabi": sistemHesabi, sunucu, temizle };
if (!komut || !(komut in islem)) dur(`kullanım: e2e-ortam.ts <${Object.keys(islem).join("|")}>`);
void Promise.resolve(islem[komut]()).catch((e) => dur(String(e?.stack ?? e)));
