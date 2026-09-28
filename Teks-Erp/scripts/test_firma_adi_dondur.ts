// =============================================================================
// BEKÇİ — FİRMA ADI: nötr yedek + mevcut kurulumun adını donduran migration
// =============================================================================
// Koşum: npx tsx scripts/run-all-tests.ts firma_adi_dondur
//
// Kodda müşteri adı yok (tripwire: test_musteri_adi_kodda_yok); ad kurulumun
// `company.name` ayarından gelir, yoksa nötr "TeksERP". Satırı olmayan MEVCUT
// kurulum bugüne kadar adı koddaki sabitten görüyordu → migration
// `20260928120000_firma_adi_dondur` o adı ayar satırına dondurur.
//
// §1 migration METNİ (uygulandıktan sonra değişmez; canlıda değeri o üretir).
// §2 migration DAVRANIŞI — üç yol, gerçek veriye dokunmadan: tx içinde aynı
//    adlı TEMP tablolar (`pg_temp` aramada `public`ten önce gelir) kurulur,
//    SQL onlara karşı koşar, ROLLBACK. Gölgeleme ayrıca ölçülür (körlük zemini).
// §3 `readCompanyName` / etiket / refakat kartı nötr yedeği.
//
// NEGATİF SONDALAR (ölçüldü 2026-09-28, cp+cmp ile birebir geri alındı; taban 22/0):
//   ① veri koşulu satırı silinir (boş DB de damgalanır)       → 2 ❌ §1a + §2a
//   ② NOT EXISTS → `true`, ON CONFLICT → DO UPDATE (ezme)     → 2 ❌ §1b + §2c
//   ③ DEFAULT_COMPANY_NAME eski ada döner                     → 5 ❌ §3a·b·c·f·i
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import { DEFAULT_COMPANY_NAME, readCompanyName } from "../src/services/system-setting.service";
import { buildRollLabelHtml } from "../src/services/helpers/label-html.helper";
import { resolveTravelerCompanyName } from "../src/services/document-render/traveler-card-raw";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exit(1);
}

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

const KOK = path.resolve(__dirname, "..");
const MIG = "20260928120000_firma_adi_dondur";
const DONAN_AD = "Adnan Şahin Tekstil";
const sqlHam = fs.readFileSync(path.join(KOK, "prisma/migrations", MIG, "migration.sql"), "utf8");
const sql = sqlHam
  .split("\n")
  .map((l) => l.replace(/--.*$/, ""))
  .join("\n");

function section1(): void {
  console.log("\n§1 migration metni");
  check("§1a veri koşulu (users VEYA rolls dolu)", /EXISTS \(SELECT 1 FROM "users"/.test(sql) && /EXISTS \(SELECT 1 FROM "rolls"/.test(sql));
  check(
    "§1b satırı olan kuruluma dokunulmaz (NOT EXISTS + ON CONFLICT DO NOTHING)",
    /NOT EXISTS \(SELECT 1 FROM "system_settings" WHERE "key" = 'company\.name'\)/.test(sql) &&
      /ON CONFLICT \("key"\) DO NOTHING/.test(sql),
  );
  check("§1c düz now() (AT TIME ZONE yok)", !/AT TIME ZONE/i.test(sql) && /now\(\), now\(\)/.test(sql));
  const servis = fs.readFileSync(path.join(KOK, "src/services/system-setting.service.ts"), "utf8");
  const m = servis.match(/SETTING_KEYS\.COMPANY_NAME,\s*trimmed \|\| DEFAULT_COMPANY_NAME,\s*"([^"]+)"/);
  const acik = m?.[1] ?? "";
  check("§1d description yazma dalıyla birebir", acik.length > 0 && sql.includes(acik.replace(/'/g, "''")), acik || "yazma dalı bulunamadı");
  check("§1e dondurulan ad bugünkü sabitin değeri", sql.includes(`to_jsonb('${DONAN_AD}'::text)`));
}

type Yol = { ad: string; users: number; rolls: number; mevcut: string | null; beklenen: string | null };

async function yolKos(y: Yol): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query('CREATE TEMP TABLE "users" (id int) ON COMMIT DROP');
    await c.query('CREATE TEMP TABLE "rolls" (id int) ON COMMIT DROP');
    await c.query(
      'CREATE TEMP TABLE "system_settings" ("key" varchar(100) PRIMARY KEY, "value" jsonb NOT NULL, "description" text, "updatedById" uuid, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL) ON COMMIT DROP',
    );
    for (let i = 0; i < y.users; i++) await c.query('INSERT INTO "users" VALUES ($1)', [i]);
    for (let i = 0; i < y.rolls; i++) await c.query('INSERT INTO "rolls" VALUES ($1)', [i]);
    if (y.mevcut !== null) {
      await c.query(`INSERT INTO "system_settings" ("key","value","updatedAt") VALUES ('company.name', to_jsonb($1::text), now())`, [y.mevcut]);
    }
    const golge = await c.query<{ n: string; temp: boolean }>(
      `SELECT (SELECT count(*) FROM "users")::text AS n, (SELECT n.nspname LIKE 'pg_temp%' FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = '"users"'::regclass) AS temp`,
    );
    check(`§2 ${y.ad}: gölgeleme ölçüldü (TEMP tablo okunuyor)`, golge.rows[0]?.temp === true && Number(golge.rows[0]?.n) === y.users);
    await c.query(sql);
    await c.query(sql); // ikinci koşum — idempotent olmalı
    const r = await c.query<{ value: unknown }>(`SELECT "value" FROM "system_settings" WHERE "key" = 'company.name'`);
    const deger = r.rows.length ? (r.rows[0].value as string) : null;
    check(`§2 ${y.ad}`, deger === y.beklenen && r.rows.length <= 1, `satır=${r.rows.length} değer=${JSON.stringify(deger)}`);
  } finally {
    await c.query("ROLLBACK").catch(() => undefined);
    c.release();
  }
}

async function section2(): Promise<void> {
  console.log("\n§2 migration davranışı (TEMP gölge, ROLLBACK)");
  await yolKos({ ad: "a) boş şema = yeni kurulum → satır YAZILMAZ", users: 0, rolls: 0, mevcut: null, beklenen: null });
  await yolKos({ ad: "b) kullanıcı var, satır yok → bugünkü ad donar", users: 1, rolls: 0, mevcut: null, beklenen: DONAN_AD });
  await yolKos({ ad: "b2) yalnız top var, satır yok → bugünkü ad donar", users: 0, rolls: 1, mevcut: null, beklenen: DONAN_AD });
  await yolKos({ ad: "c) satır var → DOKUNULMAZ", users: 1, rolls: 1, mevcut: "TEST SUNUCUSU", beklenen: "TEST SUNUCUSU" });
}

async function section3(): Promise<void> {
  console.log("\n§3 nötr yedek");
  check("§3a DEFAULT_COMPANY_NAME nötr", DEFAULT_COMPANY_NAME === "TeksERP", DEFAULT_COMPANY_NAME);
  const sahte = (value: unknown) =>
    ({ systemSetting: { findUnique: () => Promise.resolve(value === undefined ? null : { value }) } }) as unknown as Parameters<
      typeof readCompanyName
    >[0];
  check("§3b satır yok → TeksERP", (await readCompanyName(sahte(undefined))) === "TeksERP");
  check("§3c boş/boşluk → TeksERP", (await readCompanyName(sahte("   "))) === "TeksERP");
  check("§3d dolu → ayarın değeri", (await readCompanyName(sahte("TEST SUNUCUSU · ThinkPad"))) === "TEST SUNUCUSU · ThinkPad");

  const etiket = (companyName?: string) =>
    buildRollLabelHtml({ payload: { itemName: "X", barcode: "T1" } as never, template: null, barcodeSvg: "", qrSvg: "", companyName });
  check("§3e etiket marka satırı kurulumun adı", etiket("Örnek Tekstil A.Ş.").includes('<span class="brand">Örnek Tekstil A.Ş.</span>'));
  check("§3f etiket ad yoksa nötr", etiket().includes('<span class="brand">TeksERP</span>'));
  check("§3g refakat kartı: kart adı önce", resolveTravelerCompanyName({ companyName: "Kart" }, { companyName: "Kurulum" }) === "Kart");
  check("§3h refakat kartı: kart adı yoksa kurulumun adı", resolveTravelerCompanyName({ companyName: " " }, { companyName: "Kurulum" }) === "Kurulum");
  check("§3i refakat kartı: ikisi de yoksa nötr", resolveTravelerCompanyName({}, {}) === "TeksERP");
}

async function main(): Promise<void> {
  try {
    section1();
    await section2();
    await section3();
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
