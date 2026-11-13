// =============================================================================
// BEKÇİ — PATRON RAPORU: istek üzerine oluştur + sakla + geçmiş (`/api/patron/v1/raporlar`, V5a 2026-11-13)
// =============================================================================
// Kullanıcı kararı: düzenli hesap YOK; "Oluştur" hesaplar ve saklar, ekranda son koşum, rapora tıklayınca geçmiş.
//   §1 statik: toplu kapı (verifyToken + patron-app:login) ilk uçtan önce · küme = REMOTE_REPORTS ∩ v2, kişi adlı rapor yok,
//      bulutta bekletilen 4 rapor ERP kipinde VAR · tel biçimi api.ts `ReportRequest` anahtarlarını taşır
//   §2 oluştur → sakla → katalogda son koşum → geçmiş → tek koşum sonucu (HAZIR, sonuc.veri = RaporSunumu)
//   §3 çift dokunuş (aynı clientToken) tek koşum · farklı parametreyle aynı token 409
//   §4 başkasının koşumu görünmez (GET/DELETE 404, liste boş) · silinen koşum listeden düşer, token'ı 409
//   §5 kapılar: izin yok 403 · modül kapalı 403 MODULE_DISABLED · rapor kapalı 403 REPORT_DISABLED · izinli listede
//      olmayan 404 · bozuk parametre 400 · patron-app:login yok 403
//   §6 yük: saatlik tavan 429 RAPOR_TAVAN · eşzamanlı ikinci hesap 429 RAPOR_SIRADA (elle açık tutulan tablo kilidi) ·
//      zaman aşımı HATA ZAMAN_ASIMI olarak saklanır · yarım kalan koşum YARIM_KALDI olur
//   §7 budama: rapor başına N, gün sınırı, silinmiş satır; son 1 saat ve HESAPLANIYOR dokunulmaz
// NEGATİF SONDA: harita satırında (`docs/bekci-harita/raporlar.md`).
// Koşum: npx tsx scripts/run-all-tests.ts patron_rapor   (kendi _test DB'si; ayar yazar → hedef DB kapısı)
// =============================================================================
import prisma, { pool } from "../src/lib/prisma"; // İLK import: dotenv.config()
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import ts from "typescript";
import { AuthService } from "../src/services/auth.service";
import { SETTING_KEYS, invalidateFeatureFlagsCache } from "../src/services/system-setting.service";
import { PATRON_LOGIN_PERMISSION, PERMISSION_CATALOG } from "../src/constants/permission-catalog";
import { REPORT_CATALOG } from "../src/constants/report-catalog";
import { CLOUD_HELD_REPORT_KEYS, REMOTE_REPORTS } from "../src/cloud-sync/report-requests";
import { PATRON_REPORTS } from "../src/services/patron-rapor/katalog";
import { setPatronReportTimeoutForTest } from "../src/services/patron-rapor/kosum.service";
import { prunePatronReportRuns } from "../src/services/patron-rapor/budama";
import { reconcilePermissionCatalog } from "../src/jobs/permission-catalog.job";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
type Reply = { status: number; body: { data?: Record<string, unknown> & { kayitlar?: Array<Record<string, unknown>> }; details?: { code?: string } } };

function requiredMembers(name: string): string[] {
  const src = ts.createSourceFile("api.ts", read("patron/sunucu/src/wire/api.ts"), ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  src.forEachChild((n) => {
    if (!ts.isInterfaceDeclaration(n) || n.name.text !== name) return;
    for (const m of n.members) if (ts.isPropertySignature(m) && m.name && ts.isIdentifier(m.name) && !m.questionToken) out.push(m.name.text);
  });
  return out;
}

function statik(): void {
  console.log("=== §1 statik ===");
  const route = read("Teks-Erp/src/routes/patron-rapor.routes.ts");
  const use = route.indexOf("router.use(verifyToken, requirePermission(PATRON_LOGIN_PERMISSION))");
  const firstRoute = Math.min(...["router.get(", "router.post(", "router.delete("].map((s) => route.indexOf(s)).filter((i) => i >= 0));
  check("§1a toplu kapı verifyToken + patron-app:login, ilk uçtan ÖNCE", use > 0 && use < firstRoute);
  const v2Remote = REMOTE_REPORTS.filter((r) => REPORT_CATALOG.find((e) => e.key === r.key)?.nesil === "v2").map((r) => r.key);
  check("§1b küme = REMOTE_REPORTS ∩ v2 (yeni sorgu yok)", [...PATRON_REPORTS.keys()].join("|") === v2Remote.join("|"), String(PATRON_REPORTS.size));
  check("§1c eski (v1) rapor ve kişi adlı uretim-akisi kümede YOK",
    [...PATRON_REPORTS.values()].every((r) => r.entry.nesil === "v2") && !PATRON_REPORTS.has("production/uretim-akisi"));
  check("§1d bulutta bekletilen raporlar ERP kipinde AÇIK", [...CLOUD_HELD_REPORT_KEYS].every((k) => PATRON_REPORTS.has(k)), [...CLOUD_HELD_REPORT_KEYS].join(","));
  check("§1e her raporun ERP izni katalog izniyle başlar", [...PATRON_REPORTS.values()].every((r) => r.erpPermissions[0] === r.entry.izin));
  const known = new Set<string>(PERMISSION_CATALOG.map((p) => p.code));
  const unknownPerms = [...PATRON_REPORTS.values()].flatMap((r) => r.erpPermissions).filter((p) => !known.has(p));
  check("§1f her ERP izni izin kataloğunda", unknownPerms.length === 0, unknownPerms.join(","));
}

async function main(): Promise<void> {
  statik();
  const block = hedefDbEngeli();
  if (block) { check("§0 hedef DB yazılabilir", false, block); return; }
  await reconcilePermissionCatalog();
  process.env.RATE_LIMIT_ENABLED = "false";
  const T = `TEST-PRP-${Date.now()}`;
  const PASS = "Deneme-patron-rapor-12345";
  const userIds: string[] = [];
  const settingKeys = [SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.REPORTS_CLOSED_KEYS, SETTING_KEYS.PATRON_REPORT_HOURLY_MAX];
  const before = await prisma.systemSetting.findMany({ where: { key: { in: settingKeys } }, select: { key: true, value: true } });
  const setSetting = async (key: string, value: unknown) => {
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
    invalidateFeatureFlagsCache();
  };
  const app = (await import("../src/app")).default;
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const call = async (path: string, token?: string, method = "GET", body?: unknown): Promise<Reply> => {
    const r = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    try { return { status: r.status, body: JSON.parse(await r.text()) as Reply["body"] }; } catch { return { status: r.status, body: {} }; }
  };
  const makeUser = async (tag: string, codes: string[], clientType = "patron") => {
    const perms = await prisma.permission.findMany({ where: { code: { in: codes } }, select: { id: true } });
    if (perms.length !== codes.length) throw new Error(`fikstür izinleri eksik: ${codes}`);
    const u = await prisma.user.create({ data: { username: `${T}-${tag}`, passwordHash: await AuthService.hashPassword(PASS), fullName: `TEST patron rapor ${tag}`, permissions: { create: perms.map((p) => ({ permissionId: p.id })) } }, select: { id: true, username: true } });
    userIds.push(u.id);
    const r = await call("/auth/login", undefined, "POST", { username: u.username, password: PASS, clientType, confirmKick: true });
    const token = (r.body.data as { token?: string } | undefined)?.token;
    if (!token) throw new Error(`giriş başarısız ${tag}: ${r.status}`);
    return { id: u.id, token };
  };
  const create = (token: string, raporAnahtari: string, parametreler: Record<string, unknown> = {}, clientToken = randomUUID()) =>
    call("/patron/v1/raporlar", token, "POST", { clientToken, raporAnahtari, parametreler });
  try {
    await setSetting(SETTING_KEYS.PRODUCTION_ENABLED, true);
    await prisma.systemSetting.deleteMany({ where: { key: { in: [SETTING_KEYS.REPORTS_CLOSED_KEYS, SETTING_KEYS.PATRON_REPORT_HOURLY_MAX] } } });
    const boss = await makeUser("boss", [PATRON_LOGIN_PERMISSION, "report:inventory", "report:sales", "report:quality"]);
    const other = await makeUser("other", [PATRON_LOGIN_PERMISSION, "report:inventory"]);
    const noReport = await makeUser("norep", [PATRON_LOGIN_PERMISSION, "report:sales"]);
    const panel = await makeUser("panel", ["report:inventory"], "electron");

    console.log("\n=== §2 oluştur → sakla → son → geçmiş ===");
    const me = await call("/auth/me", boss.token);
    check("§2a /auth/me patronReportApi = 1", (me.body.data as Record<string, unknown> | undefined)?.patronReportApi === 1);
    const tok = randomUUID();
    const c1 = await create(boss.token, "inventory/depo", {}, tok);
    const run = c1.body.data as Record<string, unknown> | undefined;
    const sonuc = run?.sonuc as { veri?: { anahtar?: string } } | null | undefined;
    check("§2b oluştur 201 HAZIR, sonuç gövdede (RaporSunumu)", c1.status === 201 && run?.durum === "HAZIR" && sonuc?.veri?.anahtar === "inventory/depo", `${c1.status} ${String(run?.durum)} ${String(run?.hataKodu)}`);
    const reqKeys = requiredMembers("ReportRequest");
    check("§2c tel biçimi api.ts ReportRequest anahtarlarını taşır (+sonuc)", reqKeys.length > 5 && reqKeys.every((k) => run !== undefined && k in run) && run !== undefined && "sonuc" in run, reqKeys.join(","));
    const stored = await prisma.patronReportRun.findFirst({ where: { clientToken: tok }, select: { status: true, result: true, userId: true, durationMs: true } });
    check("§2d satır saklandı (HAZIR, sonuç dolu, sahip, süre)", stored?.status === "HAZIR" && stored.result !== null && stored.userId === boss.id && typeof stored.durationMs === "number");
    const cat = await call("/patron/v1/raporlar/katalog", boss.token);
    const rows = (cat.body.data?.raporlar as Array<{ anahtar: string; sonKosum: { id: string } | null }> | undefined) ?? [];
    check("§2e katalog son koşumu gösterir (yeni hesap yok)", rows.find((r) => r.anahtar === "inventory/depo")?.sonKosum?.id === run?.id);
    check("§2f katalog izinle süzülür (finans/maliyet yok, kalite ve satış var)",
      !rows.some((r) => r.anahtar.startsWith("finance/") || r.anahtar.startsWith("maliyet/")) && rows.some((r) => r.anahtar === "quality/kalite") && rows.some((r) => r.anahtar === "sales/sevkiyat"));
    await create(boss.token, "inventory/depo");
    const hist = await call("/patron/v1/raporlar?raporAnahtari=inventory%2Fdepo&limit=1", boss.token);
    check("§2g geçmiş en yeni önce, sayfalı (sonraki imleç)", hist.status === 200 && hist.body.data?.kayitlar?.length === 1 && hist.body.data.kayitlar[0]!.id !== run?.id && typeof hist.body.data.sonraki === "string");
    const page2 = await call(`/patron/v1/raporlar?raporAnahtari=inventory%2Fdepo&limit=1&imlec=${String(hist.body.data?.sonraki)}`, boss.token);
    check("§2h ikinci sayfa ilk koşumu verir", page2.body.data?.kayitlar?.[0]?.id === run?.id);
    const one = await call(`/patron/v1/raporlar/${String(run?.id)}`, boss.token);
    check("§2i tek koşum saklı sonucu döner", one.status === 200 && ((one.body.data?.sonuc as { veri?: unknown } | null)?.veri) !== undefined);
    const ranged = await create(boss.token, "sales/sevkiyat", { dateFrom: "2026-11-01", dateTo: "2026-11-13" });
    check("§2j fabrika günü parametresi kabul + özet", ranged.status === 201 && ranged.body.data?.durum === "HAZIR" && String(ranged.body.data?.parametreOzeti).includes("01.11.2026"), String(ranged.body.data?.parametreOzeti));

    console.log("\n=== §3 çift dokunuş ===");
    const again = await create(boss.token, "inventory/depo", {}, tok);
    check("§3a aynı clientToken → aynı koşum, tek satır", again.status === 201 && again.body.data?.id === run?.id && (await prisma.patronReportRun.count({ where: { clientToken: tok } })) === 1);
    const tok2 = randomUUID();
    const [p1, p2] = await Promise.all([create(boss.token, "sales/sevkiyat", {}, tok2), create(boss.token, "sales/sevkiyat", {}, tok2)]);
    check("§3b eşzamanlı çift dokunuş → tek koşum", p1.body.data?.id !== undefined && p1.body.data?.id === p2.body.data?.id && (await prisma.patronReportRun.count({ where: { clientToken: tok2 } })) === 1, `${p1.status}/${p2.status}`);
    const coll = await create(boss.token, "inventory/depo", { x: 1 }, tok);
    check("§3c aynı token farklı parametre → 409", coll.status === 409, `${coll.status} ${String(coll.body.details?.code)}`);

    console.log("\n=== §4 sahiplik ===");
    check("§4a başkasının koşumu GET 404", (await call(`/patron/v1/raporlar/${String(run?.id)}`, other.token)).status === 404);
    check("§4b başkasının koşumu DELETE 404", (await call(`/patron/v1/raporlar/${String(run?.id)}`, other.token, "DELETE")).status === 404);
    const otherList = await call("/patron/v1/raporlar?raporAnahtari=inventory%2Fdepo", other.token);
    check("§4c başkasının geçmişi boş", otherList.status === 200 && otherList.body.data?.kayitlar?.length === 0);
    const del = await call(`/patron/v1/raporlar/${String(run?.id)}`, boss.token, "DELETE");
    check("§4d kendi koşumunu siler (soft delete)", del.status === 200 && (await prisma.patronReportRun.findUnique({ where: { id: String(run?.id) }, select: { deletedAt: true } }))?.deletedAt != null);
    check("§4e silinen koşum GET 404 + listeden düşer", (await call(`/patron/v1/raporlar/${String(run?.id)}`, boss.token)).status === 404
      && !((await call("/patron/v1/raporlar?raporAnahtari=inventory%2Fdepo", boss.token)).body.data?.kayitlar ?? []).some((k) => k.id === run?.id));
    const dead = await create(boss.token, "inventory/depo", {}, tok);
    check("§4f silinen koşumun token'ı 409 RAPOR_KOSUMU_SILINMIS", dead.status === 409 && dead.body.details?.code === "RAPOR_KOSUMU_SILINMIS", `${dead.status}`);

    console.log("\n=== §5 kapılar ===");
    const noPerm = await create(noReport.token, "inventory/depo");
    check("§5a rapor izni yok → 403 RAPOR_IZNI_YOK", noPerm.status === 403 && noPerm.body.details?.code === "RAPOR_IZNI_YOK");
    const unknown = await create(boss.token, "production/uretim-akisi");
    check("§5b izinli listede olmayan rapor → 404 RAPOR_BILINMIYOR", unknown.status === 404 && unknown.body.details?.code === "RAPOR_BILINMIYOR");
    check("§5c eski (v1) anahtar → 404", (await create(boss.token, "inventory/scorecard")).status === 404);
    const bad = await create(boss.token, "inventory/depo", { tanimsiz: 1 });
    check("§5d bozuk parametre → 400 PARAMETRE_GECERSIZ", bad.status === 400 && bad.body.details?.code === "PARAMETRE_GECERSIZ");
    const badDay = await create(boss.token, "sales/sevkiyat", { dateFrom: "2026-13-45" });
    check("§5e taşan gün → 400", badDay.status === 400);
    await setSetting(SETTING_KEYS.PRODUCTION_ENABLED, false);
    const modOff = await create(boss.token, "quality/kalite");
    const catOff = await call("/patron/v1/raporlar/katalog", boss.token);
    await setSetting(SETTING_KEYS.PRODUCTION_ENABLED, true);
    check("§5f modül kapalı → 403 MODULE_DISABLED + katalogdan düşer", modOff.status === 403 && modOff.body.details?.code === "MODULE_DISABLED"
      && !((catOff.body.data?.raporlar as Array<{ anahtar: string }>) ?? []).some((r) => r.anahtar === "quality/kalite"), `${modOff.status}`);
    await setSetting(SETTING_KEYS.REPORTS_CLOSED_KEYS, ["inventory/depo"]);
    const closed = await create(boss.token, "inventory/depo");
    await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.REPORTS_CLOSED_KEYS } });
    check("§5g rapor kapalı → 403 REPORT_DISABLED", closed.status === 403 && closed.body.details?.code === "REPORT_DISABLED");
    check("§5h patron-app:login yok → 403", (await call("/patron/v1/raporlar/katalog", panel.token)).status === 403);
    check("§5i izinsiz rapor geçmişi boş döner (sızmaz)", ((await call("/patron/v1/raporlar?raporAnahtari=inventory%2Fdepo", noReport.token)).body.data?.kayitlar ?? []).length === 0);

    console.log("\n=== §6 yük ===");
    const lastHour = await prisma.patronReportRun.count({ where: { userId: boss.id, createdAt: { gte: new Date(Date.now() - 3_600_000) } } });
    await setSetting(SETTING_KEYS.PATRON_REPORT_HOURLY_MAX, lastHour);
    const capped = await create(boss.token, "inventory/depo");
    await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.PATRON_REPORT_HOURLY_MAX } });
    check("§6a saatlik tavan → 429 RAPOR_TAVAN", capped.status === 429 && capped.body.details?.code === "RAPOR_TAVAN", `${capped.status}`);
    // Elle açık tutulan satır kilidi: ilk isteğin yarım-kaldı süpürgesi (hesap kilidini ALDIKTAN sonra) bu satırda bekler;
    // replay okuması ve kapılar kilitsiz okur — ikinci istek eşzamanlılık kapısına ulaşır.
    const stale = await prisma.patronReportRun.create({ data: { userId: other.id, reportKey: "inventory/depo", params: {}, createdAt: new Date(Date.now() - 10 * 60_000) }, select: { id: true } });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query('SELECT 1 FROM "patron_report_runs" WHERE "id" = $1 FOR UPDATE', [stale.id]);
      const first = create(other.token, "inventory/depo");
      await new Promise((r) => setTimeout(r, 600));
      const second = await Promise.race([create(other.token, "inventory/depo"), new Promise<null>((r) => setTimeout(() => r(null), 15_000))]);
      await client.query("COMMIT");
      const firstDone = await first;
      check("§6b eşzamanlı ikinci hesap → 429 RAPOR_SIRADA, ilki tamamlanır", second?.status === 429 && second.body.details?.code === "RAPOR_SIRADA" && firstDone.status === 201, `${String(second?.status)}/${firstDone.status}`);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
    const staleAfter = await prisma.patronReportRun.findUnique({ where: { id: stale.id }, select: { status: true, errorCode: true } });
    check("§6d yarım kalan koşum → HATA YARIM_KALDI", staleAfter?.status === "HATA" && staleAfter.errorCode === "YARIM_KALDI");
    setPatronReportTimeoutForTest(1);
    const slow = await create(boss.token, "sales/sevkiyat").catch(() => null);
    setPatronReportTimeoutForTest(null);
    const slowRow = slow?.body.data;
    check("§6c zaman aşımı → 201 HATA ZAMAN_ASIMI saklanır", slow?.status === 201 && slowRow?.durum === "HATA" && slowRow?.hataKodu === "ZAMAN_ASIMI", `${String(slow?.status)} ${String(slowRow?.hataKodu)}`);
    console.log("\n=== §7 budama ===");
    const key = "sales/termin";
    const ago = (ms: number) => new Date(Date.now() - ms);
    const mk = (createdAt: Date, extra: Record<string, unknown> = {}) =>
      prisma.patronReportRun.create({ data: { userId: other.id, reportKey: key, params: {}, status: "HAZIR", createdAt, ...extra }, select: { id: true } });
    const young = await mk(ago(5 * 60_000));
    const olds = [];
    for (let i = 0; i < 4; i++) olds.push(await mk(ago(2 * 3_600_000 + i * 60_000)));
    const ancient = await mk(ago(100 * 86_400_000));
    const softDel = await mk(ago(3 * 3_600_000), { deletedAt: new Date() });
    const running = await mk(ago(4 * 3_600_000), { status: "HESAPLANIYOR" });
    const otherKey = await prisma.patronReportRun.create({ data: { userId: other.id, reportKey: "inventory/depo", params: {}, status: "HAZIR", createdAt: ago(2 * 3_600_000) }, select: { id: true } });
    const removed = await prunePatronReportRuns(other.id, key, { hourlyMax: 60, keepCount: 2, keepDays: 90 });
    const left = new Set((await prisma.patronReportRun.findMany({ where: { userId: other.id }, select: { id: true } })).map((r) => r.id));
    check("§7a rapor başına N: en yeni 2 görünür (genç dahil) kalır, fazlası budanır", left.has(young.id) && left.has(olds[0]!.id) && !olds.slice(1).some((o) => left.has(o.id)), `budanan=${removed}`);
    check("§7b gün sınırını aşan ve silinmiş satır budanır", !left.has(ancient.id) && !left.has(softDel.id));
    check("§7c HESAPLANIYOR ve başka raporun satırı dokunulmaz", left.has(running.id) && left.has(otherKey.id));
    const youngMany = [];
    for (let i = 0; i < 3; i++) youngMany.push(await mk(ago(i * 1000)));
    await prunePatronReportRuns(other.id, key, { hourlyMax: 60, keepCount: 1, keepDays: 90 });
    const left2 = new Set((await prisma.patronReportRun.findMany({ where: { userId: other.id, reportKey: key }, select: { id: true } })).map((r) => r.id));
    check("§7d son 1 saat budanmaz (tavan sayımı korunur)", youngMany.every((y) => left2.has(y.id)) && left2.has(young.id));
  } finally {
    setPatronReportTimeoutForTest(null);
    for (const key of settingKeys) {
      const b = before.find((f) => f.key === key);
      if (b) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: b.value as never }, update: { value: b.value as never } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
    invalidateFeatureFlagsCache();
    // Zaman aşımına uğrayan hesap arka planda sürebilir: satırı kapanmadan silmeyelim diye kısa bekleme.
    await new Promise((r) => setTimeout(r, 1500));
    await prisma.patronReportRun.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.session.updateMany({ where: { userId: { in: userIds } }, data: { revokedAt: new Date() } });
    await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { isActive: false } });
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
}

main()
  .catch((e) => { check("beklenmeyen hata", false, String((e as Error)?.stack ?? e)); })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
