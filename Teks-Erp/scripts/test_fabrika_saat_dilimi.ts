// =============================================================================
// BEKÇİ — FABRİKA SAAT DİLİMİ: tek kaynak + fabrikaya göre seçilebilir (kullanıcı kararı 2026-09-30)
// =============================================================================
//   §1 statik: IANA dilim literal'i YALNIZ constants/time.ts'te (src; yorumlar hariç)
//   §2 statik: çıplak `AT TIME ZONE` / `DATE_TRUNC` YALNIZ time.ts'te + beyanlı muaflarda (iki yönlü)
//   §3 saf: varsayılan dışı dilimde gün sınırı (Europe/Berlin · America/New_York; DST günleri dahil)
//   §4 saf: doğrulama (IANA listesi, SQL'e gömülecek metin) ve geçersiz dilimin REDDİ
//   §5 DB: yokken varsayılan · atomik claim (yanlış beklenen → 409) · önizleme yazmaz · ham uç rezerve
//          · ayar yanıtı süreç içi dilimi taşır · SQL gün kesimi JS ile aynı gün
//   §6 sondalar: tarayıcı literal'i/SQL'i YAKALAR (negatif) ve tek kaynak çağrısını TEMİZ sayar (pozitif)
// Koşum: npx tsx scripts/test_fabrika_saat_dilimi.ts   (§5 kendi `_test` DB'sini ister)
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import {
  DEFAULT_FACTORY_TIMEZONE, applyFactoryTimezone, factoryDateTimeTr, factoryDayEnd, factoryDaySql,
  factoryDayStart, factoryYmd, getFactoryTimezone, isValidFactoryTimezone, resolveRangeStart,
} from "../src/constants/time";
import { isReservedSettingKey } from "../src/constants/reserved-settings";
import { SETTING_KEYS, systemSettingService } from "../src/services/system-setting.service";
import { previewFactoryTimezone, setFactoryTimezone } from "../src/services/factory-timezone.service";
import { hedefDbAdi, hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";
import { httpBekciKapisi } from "./lib/http-bekci-kapisi";
import { atlamaDefteri } from "./lib/atlama";
import { yorumlariSok } from "./lib/regime-gate-scan";

let pass = 0;
let fail = 0;
const ATLAMA = atlamaDefteri(() => {
  fail++;
});
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const SRC = path.resolve(__dirname, "..", "src");
const TIME_TS = "constants/time.ts";
const ZONE_LITERAL_RE = /["'`](?:Europe|America|Asia|Africa|Australia|Pacific|Atlantic|Indian|Antarctica|Arctic|Etc)\/[A-Za-z_+-]+["'`]/;
const RAW_TZ_SQL_RE = /\bAT\s+TIME\s+ZONE\b|\bDATE_TRUNC\s*\(/i;
/** Çıplak SQL muafları — gerekçeli; iki yönlü (muaf dosyada artık eşleşme yoksa bayat = kırmızı). */
const RAW_SQL_EXEMPT: Record<string, string> = {
  "services/factory-timezone.service.ts": "önizleme İKİ dilimi bind parametresiyle karşılaştırır (gün kesimi değil, kayma sayımı)",
};

/** Kaynak metinde (yorumlar sökülmüş) eşleşen satır numaraları. */
export function scanSource(src: string, re: RegExp): number[] {
  const out: number[] = [];
  yorumlariSok(src).split("\n").forEach((l, i) => { if (re.test(l)) out.push(i + 1); });
  return out;
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith(".ts")) acc.push(p);
  }
  return acc;
}

function staticSection(): void {
  console.log("\n§1–§2 — statik tarama");
  const files = walk(SRC);
  check("§0 zemin: taranan dosya sayısı makul", files.length > 500, `${files.length} .ts`);
  const literalHits: string[] = [];
  const sqlHits: string[] = [];
  const sqlSeen = new Set<string>();
  let timeTsLiteral = 0;
  for (const f of files) {
    const rel = path.relative(SRC, f).split(path.sep).join("/");
    const src = fs.readFileSync(f, "utf8");
    const lit = scanSource(src, ZONE_LITERAL_RE);
    const sql = scanSource(src, RAW_TZ_SQL_RE);
    if (rel === TIME_TS) { timeTsLiteral = lit.length; continue; }
    if (lit.length) literalHits.push(`${rel}:${lit.join(",")}`);
    if (sql.length) { sqlSeen.add(rel); if (!RAW_SQL_EXEMPT[rel]) sqlHits.push(`${rel}:${sql.join(",")}`); }
  }
  check("§1a zemin: time.ts'te literal TAM BİR kez (varsayılan)", timeTsLiteral === 1, `${timeTsLiteral}`);
  check("§1b ⭐ IANA dilim literal'i time.ts dışında YOK", literalHits.length === 0, literalHits.join(" · "));
  check("§2a ⭐ çıplak dilim/gün kesimi SQL'i time.ts ve beyanlı muaf dışında YOK", sqlHits.length === 0, sqlHits.join(" · "));
  const stale = Object.keys(RAW_SQL_EXEMPT).filter((k) => !sqlSeen.has(k));
  check("§2b muaf listesi bayat değil", stale.length === 0, stale.join(" · "));
}

function withZone<T>(tz: string, fn: () => T): T {
  const prev = getFactoryTimezone();
  applyFactoryTimezone(tz);
  try { return fn(); } finally { applyFactoryTimezone(prev); }
}

function pureSection(): void {
  console.log("\n§3 — varsayılan dışı dilimde gün sınırı");
  // Varsayılanın BUGÜNKÜ davranış olduğu iddianın kendisidir — literal burada ölçüm değeridir.
  // eslint-disable-next-line no-restricted-syntax
  const todayDefault = "Europe/Istanbul";
  check("§3a varsayılan dilim bugünkü davranış", getFactoryTimezone() === DEFAULT_FACTORY_TIMEZONE && DEFAULT_FACTORY_TIMEZONE === todayDefault);
  const at = new Date("2026-07-31T22:30:00.000Z"); // İstanbul 01:30 (1 Ağu) · Berlin 00:30 (1 Ağu) · New York 18:30 (31 Tem)
  check("§3b İstanbul günü", factoryYmd(at) === "2026-08-01");
  withZone("Europe/Berlin", () => {
    check("§3c ⭐ Berlin: 22:30Z → 2026-08-01", factoryYmd(at) === "2026-08-01", factoryYmd(at));
    check("§3d Berlin gün başı 31 Tem 22:00Z (CEST)", factoryDayStart(at).toISOString() === "2026-07-31T22:00:00.000Z", factoryDayStart(at).toISOString());
    const early = new Date("2026-07-31T21:30:00.000Z"); // İstanbul 00:30 (1 Ağu) ama Berlin 23:30 (31 Tem)
    check("§3e ⭐ Berlin: İstanbul'un yeni gününe düşen an Berlin'de ÖNCEKİ gün", factoryYmd(early) === "2026-07-31", factoryYmd(early));
    check("§3f Berlin basım saati", factoryDateTimeTr(at) === "01.08.2026 00:30", factoryDateTimeTr(at));
    const dst = new Date("2026-03-29T12:00:00.000Z"); // Berlin DST ileri günü (23 saatlik gün)
    const len = factoryDayEnd(dst).getTime() + 1 - factoryDayStart(dst).getTime();
    check("§3g Berlin DST günü 23 saat", len === 23 * 3600_000, `${len / 3600_000} sa`);
    check("§3h gün-yalnız sınır Berlin gece yarısına çözülür", resolveRangeStart("2026-01-15").toISOString() === "2026-01-14T23:00:00.000Z", resolveRangeStart("2026-01-15").toISOString());
  });
  withZone("America/New_York", () => {
    check("§3i ⭐ New York: 22:30Z → 2026-07-31 (negatif ofset)", factoryYmd(at) === "2026-07-31", factoryYmd(at));
    check("§3j New York gün başı 04:00Z (EDT)", factoryDayStart(at).toISOString() === "2026-07-31T04:00:00.000Z", factoryDayStart(at).toISOString());
    const fall = new Date("2026-11-01T12:00:00.000Z"); // DST geri günü (25 saat)
    const len = factoryDayEnd(fall).getTime() + 1 - factoryDayStart(fall).getTime();
    check("§3k New York DST geri günü 25 saat", len === 25 * 3600_000, `${len / 3600_000} sa`);
    check("§3l SQL ifadesi seçilen dilimi taşır", factoryDaySql('x."t"').sql.includes("AT TIME ZONE 'America/New_York'"));
  });
  check("§3m dilim geri yüklendi", getFactoryTimezone() === DEFAULT_FACTORY_TIMEZONE);

  console.log("\n§4 — doğrulama");
  check("§4a geçerli IANA kabul", isValidFactoryTimezone("Europe/Berlin") && isValidFactoryTimezone("UTC"));
  check("§4b ⭐ SQL enjeksiyonu reddedilir", !isValidFactoryTimezone("Europe/Istanbul'; DROP TABLE rolls; --"));
  check("§4c uydurma dilim reddedilir", !isValidFactoryTimezone("Mars/Olympus") && !isValidFactoryTimezone("") && !isValidFactoryTimezone(3));
  let threw = false;
  try { applyFactoryTimezone("Mars/Olympus"); } catch { threw = true; }
  check("§4d ⭐ geçersiz dilim uygulanamaz (fail-closed)", threw && getFactoryTimezone() === DEFAULT_FACTORY_TIMEZONE);
  let sqlThrew = false;
  try { factoryDaySql('x."t"', "Europe/X'--"); } catch { sqlThrew = true; }
  check("§4e factoryDaySql geçersiz dilimi SQL'e gömmez", sqlThrew);
}

function probeSection(): void {
  console.log("\n§6 — tarayıcı sondaları");
  check("§6a ⭐ NEGATİF: kod satırındaki literal yakalanır", scanSource('const z = "Europe/Berlin";', ZONE_LITERAL_RE).length === 1);
  check("§6b ⭐ NEGATİF: çıplak AT TIME ZONE yakalanır", scanSource('sql`SELECT x AT TIME ZONE ${tz}`', RAW_TZ_SQL_RE).length === 1);
  check("§6c POZİTİF: tek kaynak çağrısı temiz", scanSource("const z = getFactoryTimezone();\nfactoryDaySql(col);", ZONE_LITERAL_RE).length === 0 &&
    scanSource("factoryDaySql(col);", RAW_TZ_SQL_RE).length === 0);
  check("§6d POZİTİF: yorumdaki literal sayılmaz", scanSource('// Europe/Istanbul günü\nconst a = 1; // "Europe/Berlin"', ZONE_LITERAL_RE).length === 0);
}

const KEY = SETTING_KEYS.COMPANY_TIMEZONE;
let savedRow: { value: unknown; description: string | null } | null = null;
let rowExisted = false;
const startedAt = new Date();

async function dbSection(): Promise<void> {
  console.log("\n§5 — ayar, atomik yazım, önizleme");
  const admin = await ensureTestAdmin();
  const before = await prisma.systemSetting.findUnique({ where: { key: KEY }, select: { value: true, description: true } });
  rowExisted = before !== null;
  savedRow = before;
  if (before) await prisma.systemSetting.delete({ where: { key: KEY } });

  check("§5a ⭐ ham ayar ucundan yazılamaz (rezerve)", isReservedSettingKey(KEY));
  const flags0 = (await systemSettingService.getFeatureFlags()).data as unknown as Record<string, unknown>;
  check("§5b satır yokken ayar yanıtı varsayılanı taşır", flags0.factoryTimezone === DEFAULT_FACTORY_TIMEZONE, String(flags0.factoryTimezone));

  const pv = await previewFactoryTimezone("Europe/Berlin");
  check("§5c önizleme değişikliği ve ofsetleri söyler", pv.changed && pv.current === DEFAULT_FACTORY_TIMEZONE && pv.warnings.length >= 3, `${pv.currentOffset}→${pv.proposedOffset}`);
  check("§5d ⭐ önizleme HİÇBİR ŞEY yazmaz", (await prisma.systemSetting.findUnique({ where: { key: KEY } })) === null);

  let conflict = "";
  try { await setFactoryTimezone({ timeZone: "Europe/Berlin", expectedCurrent: "Asia/Tokyo" }, admin.id); }
  catch (e) { conflict = String((e as { details?: { code?: string } }).details?.code ?? (e as Error).message); }
  check("§5e ⭐ yanlış beklenen dilim → 409 (atomik claim)", conflict === "FACTORY_TIMEZONE_CHANGED", conflict);
  check("§5f reddedilen yazım dilimi değiştirmedi", getFactoryTimezone() === DEFAULT_FACTORY_TIMEZONE);

  const r1 = await setFactoryTimezone({ timeZone: "Europe/Berlin", expectedCurrent: DEFAULT_FACTORY_TIMEZONE }, admin.id);
  check("§5g satır yokken varsayılandan yazım (create)", r1.changed && getFactoryTimezone() === "Europe/Berlin");
  const flags1 = (await systemSettingService.getFeatureFlags()).data as unknown as Record<string, unknown>;
  check("§5h ayar yanıtı yeni dilimi taşır (önbellek geçersizlendi)", flags1.factoryTimezone === "Europe/Berlin", String(flags1.factoryTimezone));

  let stale = "";
  try { await setFactoryTimezone({ timeZone: "America/New_York", expectedCurrent: DEFAULT_FACTORY_TIMEZONE }, admin.id); }
  catch (e) { stale = String((e as { details?: { code?: string } }).details?.code ?? ""); }
  check("§5i ⭐ bayat önizlemeyle ikinci yazım → 409", stale === "FACTORY_TIMEZONE_CHANGED", stale);

  const probe = new Date("2026-07-31T21:30:00.000Z");
  const sqlDay = await prisma.$queryRaw<Array<{ d: string }>>`SELECT to_char((${probe}::timestamptz AT TIME ZONE ${getFactoryTimezone()})::date, 'YYYY-MM-DD') AS d`;
  check("§5j ⭐ SQL gün kesimi (Berlin) JS ile aynı gün", sqlDay[0]?.d === factoryYmd(probe) && factoryYmd(probe) === "2026-07-31", `${sqlDay[0]?.d} / ${factoryYmd(probe)}`);

  const r2 = await setFactoryTimezone({ timeZone: DEFAULT_FACTORY_TIMEZONE, expectedCurrent: "Europe/Berlin" }, admin.id);
  check("§5k geri dönüş (update) ve varsayılan davranış", r2.changed && getFactoryTimezone() === DEFAULT_FACTORY_TIMEZONE);
  const audits = await prisma.systemLog.count({ where: { recordId: KEY, createdAt: { gte: startedAt } } });
  check("§5l iki başarılı yazım audit'e düştü", audits >= 2, `${audits}`);
}

const BASE = process.env.TEST_API_URL ?? "http://localhost:4112";
const HTTP_CHECKS = 8;

async function call(token: string, method: string, url: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const r = await fetch(`${BASE}${url}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}
const codeOf = (j: Record<string, unknown>): unknown => (j.details as { code?: unknown } | undefined)?.code;

/** §7 — gerçek sunucu: uçların sözleşmesi ve süreç içi dilimin yazmayla değişmesi (bekci-http.ts ile koşar). */
async function httpSection(): Promise<void> {
  console.log("\n§7 — HTTP (gerçek sunucu)");
  const kapi = await httpBekciKapisi({ base: BASE, kontrolSayisi: HTTP_CHECKS });
  if (kapi.kirmizi) { check("§7 HTTP ayağı ölçülebildi", false, kapi.kirmizi); return; }
  if (!kapi.token) { ATLAMA.atla("§7 HTTP", kapi.atlaSebebi ?? "sunucu yok", HTTP_CHECKS); return; }
  const t = kapi.token;
  const f0 = await call(t, "GET", "/api/feature-flags");
  const tz0 = (f0.json.data as { factoryTimezone?: unknown } | undefined)?.factoryTimezone;
  check("§7a ayar yanıtı factoryTimezone taşır", f0.status === 200 && tz0 === DEFAULT_FACTORY_TIMEZONE, String(tz0));
  const bad = await call(t, "GET", "/api/feature-flags/factory-timezone/preview?timeZone=Mars%2FOlympus");
  check("§7b uydurma dilim önizlemesi 400", bad.status === 400 && codeOf(bad.json) === "FACTORY_TIMEZONE_INVALID", `${bad.status}`);
  const raw = await call(t, "PUT", `/api/admin/settings/${KEY}`, { value: "Europe/Berlin" });
  check("§7c ⭐ ham ayar ucu 400 SETTING_KEY_RESERVED", raw.status === 400 && codeOf(raw.json) === "SETTING_KEY_RESERVED", `${raw.status} ${String(codeOf(raw.json))}`);
  const patch = await call(t, "PATCH", "/api/feature-flags", { factoryTimezone: "Europe/Berlin" });
  check("§7d ⭐ PATCH /api/feature-flags dilimi yazamaz", patch.status === 400, `${patch.status}`);
  const stale = await call(t, "PUT", "/api/feature-flags/factory-timezone", { timeZone: "Europe/Berlin", expectedCurrent: "Asia/Tokyo" });
  check("§7e ⭐ yanlış beklenen dilim 409", stale.status === 409 && codeOf(stale.json) === "FACTORY_TIMEZONE_CHANGED", `${stale.status}`);
  const ok = await call(t, "PUT", "/api/feature-flags/factory-timezone", { timeZone: "Europe/Berlin", expectedCurrent: DEFAULT_FACTORY_TIMEZONE });
  const f1 = await call(t, "GET", "/api/feature-flags");
  check("§7f ⭐ yazım sunucunun süreç içi dilimini değiştirir", ok.status === 200 &&
    (f1.json.data as { factoryTimezone?: unknown }).factoryTimezone === "Europe/Berlin", `${ok.status}`);
  const back = await call(t, "PUT", "/api/feature-flags/factory-timezone", { timeZone: DEFAULT_FACTORY_TIMEZONE, expectedCurrent: "Europe/Berlin" });
  check("§7g geri dönüş 200", back.status === 200, `${back.status}`);
  const f2 = await call(t, "GET", "/api/feature-flags");
  check("§7h sunucu varsayılana döndü", (f2.json.data as { factoryTimezone?: unknown }).factoryTimezone === DEFAULT_FACTORY_TIMEZONE);
}

async function temizle(): Promise<void> {
  await prisma.systemSetting.deleteMany({ where: { key: KEY } });
  if (rowExisted && savedRow) {
    await prisma.systemSetting.create({ data: { key: KEY, value: savedRow.value as never, description: savedRow.description } });
  }
  await prisma.systemLog.deleteMany({ where: { recordId: KEY, createdAt: { gte: startedAt } } });
  applyFactoryTimezone(DEFAULT_FACTORY_TIMEZONE);
}

async function main(): Promise<void> {
  staticSection();
  pureSection();
  probeSection();
  const engel = hedefDbEngeli();
  if (engel) {
    console.error(`\n⛔ §5 DURDURULDU — ${engel}`);
    fail++;
    return;
  }
  console.log(`\nHedef veritabanı: ${hedefDbAdi()}`);
  try { await dbSection(); await httpSection(); } finally { await temizle(); }
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail ? 1 : 0);
  });
