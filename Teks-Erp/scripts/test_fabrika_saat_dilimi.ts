// =============================================================================
// BEKÇİ — FABRİKA SAAT DİLİMİ: tek kaynak + TARİHLİ DÖNEMLER (kullanıcı kararları 2026-09-30)
// =============================================================================
//   §1 statik: IANA dilim literal'i YALNIZ constants/time.ts'te (src; yorumlar hariç)
//   §2 statik: çıplak `AT TIME ZONE` / `DATE_TRUNC` YALNIZ time.ts'te (muaf listesi iki yönlü)
//   §3 saf: tek dilimli yorumda gün sınırı (Europe/Berlin · America/New_York; DST günleri dahil)
//   §4 saf: doğrulama (IANA listesi, SQL'e gömülecek metin) ve geçersiz dilimin REDDİ
//   §5 DB: dönem defteri — önizleme yazmaz · yanlış beklenen 409 · değişiklik ERTESİ GÜN başından · bekleyen varken
//          409 PENDING · tekrar idempotent · iptal = ters kayıt (silme yok) · audit
//   §8 DB: geçersiz kayıtlı dilim (eski ayar / dönem satırı) → varsayılanla yorum + uyarı; eski kayıt düzeltilir
//   §7 HTTP: uç sözleşmesi, planlı yazım ve iptal (gerçek sunucu)
//   §6 sondalar: tarayıcı literal'i/SQL'i YAKALAR (negatif) ve tek kaynak çağrısını TEMİZ sayar (pozitif)
// Geçmiş değişmezliği, geçiş günü, SQL↔JS ve istemci↔backend eşdeğerliği: test_saat_dilimi_donemleri.ts.
// Koşum: npx tsx scripts/test_fabrika_saat_dilimi.ts   (§5 kendi `_test` DB'sini ister)
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import {
  DEFAULT_FACTORY_TIMEZONE, FACTORY_TIMEZONE_INVALID_STORED, applyFactoryTimezone, applyFactoryTimezonePeriods,
  factoryDateTimeTr, factoryDayEnd, factoryDaySql, factoryDayStart, factoryTimezoneWarning, factoryYmd, getFactoryTimezone,
  getFactoryTimezonePeriods, isValidFactoryTimezone, resolveRangeStart,
} from "../src/constants/time";
import { isReservedSettingKey } from "../src/constants/reserved-settings";
import { SETTING_KEYS, invalidateFeatureFlagsCache, systemSettingService } from "../src/services/system-setting.service";
import { cancelFactoryTimezoneChange, loadFactoryTimezoneAtBoot, setFactoryTimezone } from "../src/services/factory-timezone.service";
import { previewFactoryTimezone } from "../src/services/factory-timezone-preview.service";
import { buildRichHealth } from "../src/lib/health-snapshot";
import { publicFactoryTimezone } from "../src/services/helpers/factory-timezone-state.helper";
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
const RAW_SQL_EXEMPT: Record<string, string> = {};

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
  try { applyFactoryTimezonePeriods([{ validFrom: new Date("2027-01-01T00:00:00Z"), timeZone: "Europe/X'--" }]); } catch { sqlThrew = true; }
  check("§4e geçersiz dilimli dönem uygulanamaz (SQL'e gömülemez)", sqlThrew && !factoryDaySql('x."t"').sql.includes("X'--"));
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
const codeOfErr = (e: unknown): string => String((e as { details?: { code?: string } }).details?.code ?? (e as Error).message);
const periodCount = (): Promise<number> => prisma.factoryTimezonePeriod.count();

async function dbSection(): Promise<void> {
  console.log("\n§5 — dönem defteri: önizleme, planlı yazım, iptal");
  const admin = await ensureTestAdmin();
  const before = await prisma.systemSetting.findUnique({ where: { key: KEY }, select: { value: true, description: true } });
  rowExisted = before !== null;
  savedRow = before;
  if (before) await prisma.systemSetting.delete({ where: { key: KEY } });
  await temizleDonemler();
  await loadFactoryTimezoneAtBoot();

  check("§5a ⭐ ham ayar ucundan yazılamaz (rezerve)", isReservedSettingKey(KEY));
  invalidateFeatureFlagsCache();
  const flags0 = (await systemSettingService.getFeatureFlags()).data as unknown as Record<string, unknown>;
  const pub0 = publicFactoryTimezone();
  check("§5b dönem yokken ayar yanıtı varsayılanı ve boş dönem listesini taşır", flags0.factoryTimezone === DEFAULT_FACTORY_TIMEZONE &&
    pub0.factoryTimezonePeriods.length === 0 && pub0.factoryTimezonePending === null && pub0.factoryTimezoneBase === DEFAULT_FACTORY_TIMEZONE,
    String(flags0.factoryTimezone));

  const pv = await previewFactoryTimezone("Europe/Berlin");
  check("§5c önizleme yürürlük anını iki dilimde ve 'geçmiş değişmez'i söyler", pv.changed && pv.current === DEFAULT_FACTORY_TIMEZONE &&
    pv.effectiveFrom !== null && pv.effectiveFromProposedLocal?.endsWith(" 00:00") === true && pv.warnings.some((w) => w.startsWith("Geçmiş kayıtlar DEĞİŞMEZ")),
    `${pv.effectiveFrom} ${pv.effectiveFromCurrentLocal} / ${pv.effectiveFromProposedLocal}`);
  check("§5d ⭐ önizleme HİÇBİR ŞEY yazmaz", (await periodCount()) === 0);

  let conflict = "";
  try { await setFactoryTimezone({ timeZone: "Europe/Berlin", expectedCurrent: "Asia/Tokyo" }, admin.id); }
  catch (e) { conflict = codeOfErr(e); }
  check("§5e ⭐ yanlış beklenen dilim → 409", conflict === "FACTORY_TIMEZONE_CHANGED", conflict);
  check("§5f reddedilen yazım dönem eklemedi", (await periodCount()) === 0 && getFactoryTimezone() === DEFAULT_FACTORY_TIMEZONE);

  const r1 = await setFactoryTimezone({ timeZone: "Europe/Berlin", expectedCurrent: DEFAULT_FACTORY_TIMEZONE }, admin.id);
  const e1 = r1.effectiveFrom ? new Date(r1.effectiveFrom) : null;
  check("§5g ⭐ yazım BUGÜNÜ değiştirmez: yeni dilim ertesi gün başından (Berlin gece yarısı) geçerli", r1.changed && e1 !== null &&
    e1.getTime() > Date.now() && getFactoryTimezone() === DEFAULT_FACTORY_TIMEZONE && r1.pending?.timeZone === "Europe/Berlin" &&
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(e1!) === "00:00",
    `${r1.effectiveFrom}`);
  const flags1 = (await systemSettingService.getFeatureFlags()).data as unknown as Record<string, unknown>;
  const pub1 = publicFactoryTimezone();
  check("§5h ayar yanıtı bekleyen değişikliği ve dönemi taşır; şimdiki dilim değişmedi", pub1.factoryTimezonePending?.timeZone === "Europe/Berlin" &&
    pub1.factoryTimezonePeriods.length === 1 && flags1.factoryTimezone === DEFAULT_FACTORY_TIMEZONE, JSON.stringify(pub1.factoryTimezonePending));

  let pendingErr = "";
  try { await setFactoryTimezone({ timeZone: "America/New_York", expectedCurrent: DEFAULT_FACTORY_TIMEZONE }, admin.id); }
  catch (e) { pendingErr = codeOfErr(e); }
  check("§5i ⭐ bekleyen değişiklik varken yenisi → 409 PENDING", pendingErr === "FACTORY_TIMEZONE_PENDING", pendingErr);
  const again = await setFactoryTimezone({ timeZone: "Europe/Berlin", expectedCurrent: DEFAULT_FACTORY_TIMEZONE }, admin.id);
  check("§5j aynı değişikliğin tekrarı idempotent (satır eklemez)", !again.changed && again.pending?.id === r1.pending?.id && (await periodCount()) === 1);

  let notPending = "";
  try { await cancelFactoryTimezoneChange({ periodId: "00000000-0000-4000-8000-000000000000" }, admin.id); }
  catch (e) { notPending = codeOfErr(e); }
  check("§5k yanlış kimlikle iptal → 409 NOT_PENDING", notPending === "FACTORY_TIMEZONE_NOT_PENDING", notPending);
  const c = await cancelFactoryTimezoneChange({ periodId: r1.pending!.id }, admin.id);
  const rows = await prisma.factoryTimezonePeriod.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  check("§5l ⭐ iptal = TERS KAYIT: satır silinmez, aynı ana önceki dilimle yeni satır (reversesPeriodId)", rows.length === 2 &&
    rows[1]!.reversesPeriodId === rows[0]!.id && rows[1]!.validFrom.getTime() === rows[0]!.validFrom.getTime() &&
    rows[1]!.timeZone === DEFAULT_FACTORY_TIMEZONE && rows[1]!.createdAt > rows[0]!.createdAt && c.cancelledId === rows[0]!.id,
    JSON.stringify(rows.map((r) => [r.timeZone, r.reversesPeriodId !== null])));
  check("§5m iptal sonrası etkin dönem yok, bekleyen yok", getFactoryTimezonePeriods().length === 0 &&
    (await previewFactoryTimezone("Europe/Berlin")).pending === null);
  let twice = "";
  try { await cancelFactoryTimezoneChange({ periodId: r1.pending!.id }, admin.id); }
  catch (e) { twice = codeOfErr(e); }
  check("§5n ikinci iptal → 409 (ters kayıt tekil)", twice === "FACTORY_TIMEZONE_NOT_PENDING", twice);
  const audits = await prisma.systemLog.count({ where: { tableName: "FACTORY_TIMEZONE_PERIOD", createdAt: { gte: startedAt } } });
  check("§5o planlama + iptal audit'e düştü", audits >= 2, `${audits}`);
}

const TZ_INVALID_MSG = "Kayıtlı saat dilimi geçersiz; İstanbul kullanılıyor — Şirket Bilgileri → Saat dilimi'den düzeltin";
const tzWarningCode = (v: unknown): unknown => (v as { code?: unknown } | null | undefined)?.code;

/** §8 — geçersiz kayıtlı dilim: sunucu DURMAZ, o dönem varsayılanla yorumlanır ve uyarır; panelden düzeltilir. */
async function invalidStoredSection(): Promise<void> {
  console.log("\n§8 — geçersiz kayıtlı dilimle açılış");
  const admin = await ensureTestAdmin();
  await temizleDonemler();
  await prisma.systemSetting.deleteMany({ where: { key: KEY } });
  await prisma.systemSetting.create({ data: { key: KEY, value: "Mars/Olympus", description: "bekçi §8" } });
  applyFactoryTimezone("Europe/Berlin");
  const boot = await loadFactoryTimezoneAtBoot();
  check("§8a ⭐ geçersiz eski kayıtla açılış REDDEDİLMEZ, varsayılanla sürer", boot.storedInvalid &&
    boot.timeZone === DEFAULT_FACTORY_TIMEZONE && getFactoryTimezone() === DEFAULT_FACTORY_TIMEZONE, getFactoryTimezone());
  const w = factoryTimezoneWarning();
  check("§8b ⭐ uyarı kodu ve metni", w?.code === FACTORY_TIMEZONE_INVALID_STORED && w.message === TZ_INVALID_MSG, w?.message ?? "uyarı yok");
  const health = (await buildRichHealth()).factoryTimezone as { active?: string; warning?: unknown } | undefined;
  check("§8c sağlık ucu uyarıyı taşır", tzWarningCode(health?.warning) === FACTORY_TIMEZONE_INVALID_STORED &&
    health?.active === DEFAULT_FACTORY_TIMEZONE, JSON.stringify(health));
  invalidateFeatureFlagsCache();
  const flags = (await systemSettingService.getFeatureFlags()).data as unknown as Record<string, unknown>;
  check("§8d ayar yanıtı (panel şeridi) uyarıyı taşır", tzWarningCode(flags.factoryTimezoneWarning) === FACTORY_TIMEZONE_INVALID_STORED &&
    flags.factoryTimezone === DEFAULT_FACTORY_TIMEZONE, String(flags.factoryTimezone));
  const pv = await previewFactoryTimezone(DEFAULT_FACTORY_TIMEZONE);
  check("§8e önizleme geçersiz kaydı söyler ve aynı dilimi değişiklik sayar", pv.storedInvalid && pv.changed && pv.current === DEFAULT_FACTORY_TIMEZONE);
  let stale = "";
  try { await setFactoryTimezone({ timeZone: DEFAULT_FACTORY_TIMEZONE, expectedCurrent: "Asia/Tokyo" }, admin.id); }
  catch (e) { stale = codeOfErr(e); }
  check("§8f yanlış beklenenle geçersiz kayıt düzeltilmez (409)", stale === "FACTORY_TIMEZONE_CHANGED", stale);
  const fixed = await setFactoryTimezone({ timeZone: DEFAULT_FACTORY_TIMEZONE, expectedCurrent: pv.current }, admin.id);
  const row = await prisma.systemSetting.findUnique({ where: { key: KEY }, select: { value: true } });
  check("§8g ⭐ yürürlükteki dilimle kaydetmek geçersiz eski kaydı düzeltir, dönem eklemez, uyarıyı kaldırır",
    fixed.changed && row?.value === DEFAULT_FACTORY_TIMEZONE && factoryTimezoneWarning() === null && (await periodCount()) === 0, JSON.stringify(row?.value));

  // Geçersiz dilimli DÖNEM (elle bozulmuş satır): o dönem varsayılanla yorumlanır, geçmiş/gelecek kaymaz.
  const past = new Date(Date.now() - 86_400_000);
  await prisma.factoryTimezonePeriod.create({ data: { timeZone: "Mars/Olympus", validFrom: past, createdById: admin.id, reason: "bekçi §8" } });
  await loadFactoryTimezoneAtBoot();
  check("§8h ⭐ geçersiz dilimli yürürlükteki dönem varsayılanla yorumlanır + uyarı", getFactoryTimezone() === DEFAULT_FACTORY_TIMEZONE &&
    getFactoryTimezonePeriods().length === 0 && factoryTimezoneWarning()?.code === FACTORY_TIMEZONE_INVALID_STORED);
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

/** §7 — gerçek sunucu: uçların sözleşmesi, planlı yazım ve iptal (bekci-http.ts ile koşar). */
async function httpSection(): Promise<void> {
  console.log("\n§7 — HTTP (gerçek sunucu)");
  const kapi = await httpBekciKapisi({ base: BASE, kontrolSayisi: HTTP_CHECKS });
  if (kapi.kirmizi) { check("§7 HTTP ayağı ölçülebildi", false, kapi.kirmizi); return; }
  if (!kapi.token) { ATLAMA.atla("§7 HTTP", kapi.atlaSebebi ?? "sunucu yok", HTTP_CHECKS); return; }
  const t = kapi.token;
  const data = (j: Record<string, unknown>): Record<string, unknown> => (j.data ?? {}) as Record<string, unknown>;
  const f0 = await call(t, "GET", "/api/feature-flags");
  check("§7a ayar yanıtı şimdiki dilimi + dönem listesini taşır", f0.status === 200 && data(f0.json).factoryTimezone === DEFAULT_FACTORY_TIMEZONE &&
    Array.isArray(data(f0.json).factoryTimezonePeriods), String(data(f0.json).factoryTimezone));
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
  const pend = data(f1.json).factoryTimezonePending as { id?: string; timeZone?: string } | null;
  check("§7f ⭐ yazım bekleyen dönem ekler, şimdiki dilim değişmez", ok.status === 200 && pend?.timeZone === "Europe/Berlin" &&
    data(f1.json).factoryTimezone === DEFAULT_FACTORY_TIMEZONE, `${ok.status} ${JSON.stringify(pend)}`);
  const cancel = await call(t, "POST", "/api/feature-flags/factory-timezone/cancel", { periodId: pend?.id ?? "" });
  check("§7g iptal 200", cancel.status === 200, `${cancel.status}`);
  const f2 = await call(t, "GET", "/api/feature-flags");
  check("§7h iptal sonrası bekleyen yok", data(f2.json).factoryTimezonePending === null && data(f2.json).factoryTimezone === DEFAULT_FACTORY_TIMEZONE);
}

/** Bekçinin KENDİ dönem satırları (bu koşumda doğanlar) — defter yalnız teardown'da ve yalnız `_test` DB'de silinir. */
async function temizleDonemler(): Promise<void> {
  const ids = (await prisma.factoryTimezonePeriod.findMany({ where: { createdAt: { gte: DB_BASLANGIC } }, select: { id: true } })).map((r) => r.id);
  if (ids.length === 0) return;
  await prisma.factoryTimezonePeriod.updateMany({ where: { id: { in: ids } }, data: { reversesPeriodId: null } });
  await prisma.factoryTimezonePeriod.deleteMany({ where: { id: { in: ids } } });
}

// Koşumun başı DB saatinden: satırların `createdAt`i DB'nin saatidir (konteyner saati süreçten kayabilir).
let DB_BASLANGIC = new Date(0);

/** Dönem defteri bu koşumdan ÖNCE boş olmalı: bekçi yalnız kendi satırlarını siler, başkasınınkini yorumlayamaz. */
async function defterBosMu(): Promise<boolean> {
  DB_BASLANGIC = (await prisma.$queryRaw<Array<{ t: Date }>>`SELECT clock_timestamp() AS t`)[0]!.t;
  const onceki = await prisma.factoryTimezonePeriod.count({ where: { createdAt: { lt: DB_BASLANGIC } } });
  check("§0 dönem defteri koşum öncesi boş (değilse ÖLÇÜLEMEDİ — başka bir koşumun satırları)", onceki === 0, `${onceki} satır`);
  return onceki === 0;
}

async function temizle(): Promise<void> {
  await prisma.systemSetting.deleteMany({ where: { key: KEY } });
  if (rowExisted && savedRow) {
    await prisma.systemSetting.create({ data: { key: KEY, value: savedRow.value as never, description: savedRow.description } });
  }
  await temizleDonemler();
  await prisma.systemLog.deleteMany({ where: { createdAt: { gte: startedAt }, OR: [{ tableName: "FACTORY_TIMEZONE_PERIOD" }, { tableName: "SYSTEM_SETTING", recordId: KEY }] } });
  applyFactoryTimezone(DEFAULT_FACTORY_TIMEZONE);
  invalidateFeatureFlagsCache();
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
  if (!(await defterBosMu())) return;
  try { await dbSection(); await invalidStoredSection(); await httpSection(); } finally { await temizle(); }
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail ? 1 : 0);
  });
