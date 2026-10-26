// =============================================================================
// BEKÇİ — Dokuma işi GENEL BAKIŞ (`GET /api/weaving-orders/:id/overview`, GERÇEK DB + HTTP)
// Çalıştır: npx tsx scripts/run-all-tests.ts weaving_order_overview
// =============================================================================
// Panelin sağ paneli "bu iş şu an ne hâlde?" sorusunu bu uçtan okur. Uç YAZMAZ; yüklemler
// kendi helper'larından gelir (kopya yüklem yok):
//   §1 ilerleme: top sayısı detayın `producedRollCount`u ile AYNI · geri alınmış indirmenin topu
//      sayılmaz · iki metre AYRI (top `initialQty` ↔ koşum `producedM`) · ölçülmeyen koşum metreye
//      girmez, ayrı sayılır · geri alınmış koşumun metresi girmez · indirme sayısı geri alınmışı saymaz
//   §2 açık koşum: yalnız `endedAt IS NULL AND revokedAt IS NULL` · tezgah + hat + açık duruş (sebep adı)
//      + bu koşumun indirme sayısı · operatör yoksa null · levent bağı kapalıyken `beams: null`
//   §3 son koşumlar: kapanmış + geri alınmış (sebebiyle), açık koşum girmez · son indirmeler topuyla
//   §4 açık uçlu iş: `plannedM` null, top yokken metre null (0 uydurulmaz)
//   §5 tavan: liste kırpılır, sayı kırpılmaz (`total` + `truncated`)
//   §6 levent: devere kapalı → `beams: null`; açık → işe bağlı levent listesi
//   §7 HTTP: 200 · dokuma kapalı 403 MODULE_DISABLED · izinsiz 403 · bozuk kimlik 400 · bilinmeyen 404
//   §8 yapısal: servis paylaşılan yüklemleri çağırır, kopya yüklem yazmaz; uç detayla aynı izin kümesi
//
// NEGATİF SONDALAR (2026-10-20, koşuldu, dosyalar sha1 ile geri alındı):
//   ① `rollsOfWeavingOrderWhere`dan `revokedAt: null` düştü → §1a + §1c + §7a ❌ (sayı ve detay birlikte
//      kayar — §1b eşit kalır; o yüzden mutlak değer de ölçülür)
//   ② açık koşum sorgusu `OPEN_RUN_WHERE` yerine `{ endedAt: null }` → §2a + §2b + §2d ❌
//   ③ indirme yükleminden `revokedAt: null` düştü → §1g + §3c ❌
// ⚠️ DB'ye ve global ayara YAZAR → `hedefDbEngeli()` ilk adım; ayarlar `finally`de birebir geri döner.
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import bcrypt from "bcryptjs";
import { MachineDataSource, RollEntrySource, RollStatus, StationKind } from "@prisma/client";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { factoryDayKeyUtcMidnight } from "../src/constants/time";
import { PASSWORD_BCRYPT_COST } from "../src/constants/password-policy";
import { invalidateFeatureFlagsCache, SETTING_KEYS } from "../src/services/system-setting.service";
import { createWeavingOrder, getWeavingOrder } from "../src/services/weaving-order.service";
import { getWeavingOrderOverview, OVERVIEW_RECENT_RUN_CAP } from "../src/services/weaving-order-overview.service";
import { ensureTestAdmin, testActorId } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { yorumlariSok } from "./lib/regime-gate-scan";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const TAG = `TEST-WOO-${Date.now().toString(36).toUpperCase()}`;
const H = 3600_000;
const ids = { station: "", machines: [] as string[], items: [] as string[], warpSpec: "", orders: [] as string[], beams: [] as string[], rolls: [] as string[], users: [] as string[], preset: "" };
const YONETILEN = [SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.DEVERE_MOUNT_TRACKING];
const ilk = new Map<string, unknown>();

async function setting(key: string, value: unknown): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
  invalidateFeatureFlagsCache();
}

const code = (s: string) => `${TAG}-${s}`.slice(0, 32);

async function fixture(now: Date) {
  ids.station = (await prisma.station.create({ data: { name: `${TAG}-ST`, code: code("ST"), type: "INTERNAL", kind: StationKind.WEAVING, isActive: true }, select: { id: true } })).id;
  const mk = async (n: string) => {
    const m = await prisma.machine.create({ data: { stationId: ids.station, name: `${TAG} Tezgah ${n}`, code: code(n), isActive: true, productionLineCount: 2 }, select: { id: true } });
    ids.machines.push(m.id);
    return m.id;
  };
  const [t1, t2] = [await mk("T1"), await mk("T2")];
  const fabric = (await prisma.item.create({ data: { code: code("KUMAS"), name: `${TAG} kumaş`, itemType: "FABRIC" }, select: { id: true } })).id;
  ids.items.push(fabric);
  const actor = await testActorId();
  const wo = async (plannedM: number | null) => {
    const r = await createWeavingOrder({ itemId: fabric, plannedM, executionKind: "IN_HOUSE", warpSpecId: null }, actor);
    ids.orders.push(r.data!.id);
    return r.data!.id;
  };
  const [A, B, C] = [await wo(500), await wo(null), await wo(100)];
  const run = (machineId: string, line: number, weavingOrderId: string, p: Record<string, unknown>) =>
    prisma.machineRun.create({ data: { machineId, productionLineNo: line, weavingOrderId, ...p } as never, select: { id: true } });
  const r1 = await run(t1, 1, A, { startedAt: new Date(now.getTime() - 1 * H) }); // açık
  const r2 = await run(t2, 1, A, { startedAt: new Date(now.getTime() - 10 * H), endedAt: new Date(now.getTime() - 8 * H), producedM: 120 }); // kapalı, ölçülmüş
  await run(t2, 1, A, { startedAt: new Date(now.getTime() - 7 * H), endedAt: new Date(now.getTime() - 6 * H), producedM: null }); // kapalı, ölçülmemiş
  await run(t1, 2, A, { startedAt: new Date(now.getTime() - 3 * H), producedM: 999, revokedAt: new Date(now.getTime() - 2 * H), revokeReason: "bekçi: yanlış iş" }); // geri alınmış
  for (let i = 0; i < OVERVIEW_RECENT_RUN_CAP + 2; i++) {
    await run(t2, 2, C, { startedAt: new Date(now.getTime() - (40 - i * 2) * H), endedAt: new Date(now.getTime() - (39 - i * 2) * H), producedM: 5 });
  }
  const doff = (machineId: string, machineRunId: string, at: Date, extra: Record<string, unknown> = {}) =>
    prisma.doffEvent.create({ data: { machineId, machineRunId, productionLineNo: 1, doffedAt: at, pieceCount: 1, counterSource: MachineDataSource.OPERATOR, code: code(`D${randomUUID().slice(0, 6)}`).toUpperCase(), ...extra }, select: { id: true } });
  const roll = async (doffEventId: string, n: string, qty: number) => {
    const r = await prisma.roll.create({ data: { barcode: code(`R${n}`), itemId: fabric, initialQty: qty, currentQty: qty, status: RollStatus.STOCK, entrySource: RollEntrySource.WEAVING, doffEventId }, select: { id: true } });
    ids.rolls.push(r.id);
  };
  const d1 = await doff(t2, r2.id, new Date(now.getTime() - 8.5 * H));
  await roll(d1.id, "1", 60);
  await roll(d1.id, "2", 55);
  const d2 = await doff(t1, r1.id, new Date(now.getTime() - 0.5 * H));
  await roll(d2.id, "3", 40);
  // Geri alınmış indirme (servis yolu toplu indirmeyi geri almaz; defter-dışı yazım yüklemi ölçmek için).
  const d3 = await doff(t2, r2.id, new Date(now.getTime() - 9 * H), { revokedAt: now, revokeReason: "bekçi" });
  await roll(d3.id, "4", 70);
  const preset = await prisma.reasonPreset.create({ data: { kind: "MACHINE_STOP", code: code("SEBEP"), label: `${TAG} atkı kopuşu`, stopLossClass: "UNPLANNED" }, select: { id: true, code: true, label: true } });
  ids.preset = preset.id;
  const stopStart = new Date(now.getTime() - 0.25 * H);
  await prisma.machineStopEvent.create({
    data: { machineId: t1, stopKey: randomUUID(), factoryDay: factoryDayKeyUtcMidnight(stopStart), source: MachineDataSource.OPERATOR, startedAt: stopStart, reasonCode: preset.code, lossClass: "UNPLANNED" },
  });
  const yarn = (await prisma.item.create({ data: { code: code("IPLIK"), name: `${TAG} iplik`, itemType: "YARN" }, select: { id: true } })).id;
  ids.items.push(yarn);
  ids.warpSpec = (await prisma.warpSpec.create({ data: { code: code("CK"), name: `${TAG} çözgü`, yarnItemId: yarn, endsCount: 4000 }, select: { id: true } })).id;
  ids.beams.push((await prisma.warpBeam.create({ data: { beamNo: code("LV1"), warpSpecId: ids.warpSpec, weavingOrderId: A, plannedLengthM: 1500 }, select: { id: true } })).id);
  return { t1, t2, A, B, C, r1: r1.id, preset, stopStart };
}

async function serviceSections(f: Awaited<ReturnType<typeof fixture>>, now: Date): Promise<void> {
  await setting(SETTING_KEYS.DEVERE_ENABLED, false);
  const a = (await getWeavingOrderOverview(f.A, now)).data!;
  const detail = (await getWeavingOrder(f.A)).data!;
  console.log("\n§1 — ilerleme");
  check("§1a top sayısı: geri alınmış indirmenin topu sayılmaz (3)", a.progress.rollCount === 3, String(a.progress.rollCount));
  check("§1b ⭐ top sayısı detayın `producedRollCount`u ile AYNI", a.progress.rollCount === detail.producedRollCount && a.order.producedRollCount === detail.producedRollCount);
  check("§1c top metresi Σ initialQty (60+55+40 = 155)", a.progress.rollMeters === 155, String(a.progress.rollMeters));
  check("§1d koşum metresi yalnız kapanmış ∧ geri alınmamış koşumdan (120; geri alınmışın 999'u girmez)", a.progress.runMeters === 120, String(a.progress.runMeters));
  check("§1e ölçülmeyen koşum ayrı sayılır (kapanmış 2, ölçülmemiş 1)", a.progress.closedRunCount === 2 && a.progress.unmeasuredRunCount === 1);
  check("§1f hedef ve fason alanı (kendi tezgahımızda → null)", a.progress.plannedM === 500 && a.progress.fasonReceivedM === null);
  check("§1g indirme sayısı geri alınmışı saymaz (2)", a.progress.doffCount === 2, String(a.progress.doffCount));

  console.log("\n§2 — açık koşum");
  const live = a.liveRuns.items;
  check("§2a ⭐ yalnız açık koşum (geri alınmış açık-görünen koşum girmez)", live.length === 1 && live[0].id === f.r1 && a.liveRuns.total === 1 && !a.liveRuns.truncated, live.map((l) => l.id).join(","));
  const l = live[0];
  check("§2b tezgah kodu + hat + başlangıç", l?.machine.id === f.t1 && l.machine.code === code("T1") && l.productionLineNo === 1);
  check("§2c açık duruş sebebi ADIYLA + başlangıç", l?.openStop !== null && l?.openStop?.reasonLabel === f.preset.label && l?.openStop?.startedAt.getTime() === f.stopStart.getTime(), JSON.stringify(l?.openStop));
  check("§2d bu koşumun indirme sayısı (1) · operatör yok → null · levent bağı kapalı → beams null", l?.doffCount === 1 && l.operator === null && l.beams === null && a.beamTracking === false);

  console.log("\n§3 — son koşumlar · son indirmeler");
  const past = a.recentRuns.items;
  check("§3a son koşumlar kapanmış + geri alınmış, açık koşum girmez (3)", past.length === 3 && !past.some((r) => r.id === f.r1) && a.recentRuns.total === 3);
  check("§3b geri alınmış koşum sebebiyle döner", past.some((r) => r.revokedAt !== null && r.revokeReason === "bekçi: yanlış iş"));
  const doffs = a.recentDoffs.items;
  check("§3c son indirmeler geri alınmamış, en yeni önce (2)", doffs.length === 2 && a.recentDoffs.total === 2 && doffs[0].doffedAt.getTime() > doffs[1].doffedAt.getTime());
  check("§3d indirmenin doğan topları barkod + metre", doffs[1]?.rolls.map((r) => `${r.barcode}:${r.initialQty}`).join(",") === `${code("R1")}:60,${code("R2")}:55`, JSON.stringify(doffs[1]?.rolls));

  console.log("\n§4 — açık uçlu iş");
  const b = (await getWeavingOrderOverview(f.B, now)).data!;
  check("§4a plannedM null · top yok → metre null (0 uydurulmaz) · koşum yok", b.progress.plannedM === null && b.progress.rollCount === 0 && b.progress.rollMeters === null && b.progress.runMeters === null && b.liveRuns.items.length === 0 && b.recentRuns.total === 0);

  console.log("\n§5 — tavan");
  const c = (await getWeavingOrderOverview(f.C, now)).data!;
  check("§5a liste kırpılır, sayı kırpılmaz", c.recentRuns.items.length === OVERVIEW_RECENT_RUN_CAP && c.recentRuns.total === OVERVIEW_RECENT_RUN_CAP + 2 && c.recentRuns.truncated);
  check("§5b koşum metresi kırpılmış listeden değil tüm kümeden (12 × 5 = 60)", c.progress.runMeters === 60, String(c.progress.runMeters));

  console.log("\n§6 — levent");
  check("§6a devere kapalı → beams null", a.beams === null);
  await setting(SETTING_KEYS.DEVERE_ENABLED, true);
  await setting(SETTING_KEYS.DEVERE_MOUNT_TRACKING, true);
  const a2 = (await getWeavingOrderOverview(f.A, now)).data!;
  check("§6b devere açık → işe bağlı levent (no · durum · kalan)", a2.beams?.items.length === 1 && a2.beams.items[0].beamNo === code("LV1") && a2.beams.items[0].status === "PLANNED" && a2.beams.items[0].remainingM === 0 && a2.beams.total === 1);
  check("§6c bağ defteri açık → açık koşumda takılı levent dizisi (boş)", a2.beamTracking && Array.isArray(a2.liveRuns.items[0]?.beams) && a2.liveRuns.items[0].beams!.length === 0);
}

type Yanit = { status: number; body: { data?: { progress?: { rollCount?: number } }; error?: { details?: { code?: string } }; details?: { code?: string } } };
async function api(base: string, p: string, token: string): Promise<Yanit> {
  const r = await fetch(`${base}${p}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  let body: Yanit["body"] = {};
  try { body = (await r.json()) as Yanit["body"]; } catch { /* boş */ }
  return { status: r.status, body };
}
const kod = (r: Yanit) => `${r.status}:${r.body.error?.details?.code ?? r.body.details?.code ?? ""}`;

async function login(base: string, username: string, password: string): Promise<string> {
  const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
  const j = (await r.json()) as { data?: { token?: string } };
  return String(j.data?.token ?? "");
}

async function httpSection(f: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  console.log("\n§7 — HTTP");
  const server: Server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const cred = await ensureTestAdmin();
    const admin = await login(base, cred.username, cred.password);
    const url = `/api/weaving-orders/${f.A}/overview`;
    const ok = await api(base, url, admin);
    check("§7a 200 · gövde servisle aynı (top sayısı 3)", ok.status === 200 && ok.body.data?.progress?.rollCount === 3, String(ok.status));
    check("§7b bozuk kimlik 400 · bilinmeyen 404 · oturumsuz 401",
      (await api(base, "/api/weaving-orders/x/overview", admin)).status === 400 && (await api(base, `/api/weaving-orders/${randomUUID()}/overview`, admin)).status === 404 && (await api(base, url, "")).status === 401);
    const pw = `Izinsiz-${randomUUID().slice(0, 8)}!`;
    const u = await prisma.user.create({ data: { username: `${TAG}-izinsiz`.toLowerCase(), passwordHash: await bcrypt.hash(pw, PASSWORD_BCRYPT_COST), fullName: `${TAG} izinsiz`, isActive: true }, select: { id: true, username: true } });
    ids.users.push(u.id);
    const bare = await login(base, u.username, pw);
    const red = await api(base, url, bare);
    check("§7c ⭐ izinsiz kullanıcı → 403 (modül kapısı değil izin kapısı)", bare !== "" && red.status === 403 && kod(red) !== "403:MODULE_DISABLED", bare ? kod(red) : "giriş yapılamadı");
    await setting(SETTING_KEYS.DOKUMA_ENABLED, false);
    check("§7d ⭐ dokuma kapalı → 403 MODULE_DISABLED", kod(await api(base, url, admin)) === "403:MODULE_DISABLED");
    await setting(SETTING_KEYS.DOKUMA_ENABLED, true);
  } finally {
    await new Promise((r) => server.close(() => r(undefined)));
  }
}

function structuralSection(): void {
  console.log("\n§8 — yapısal");
  const src = (f: string) => yorumlariSok(readFileSync(path.join(__dirname, "..", f), "utf8"));
  const svc = src("src/services/weaving-order-overview.service.ts");
  check("§8a top yüklemi paylaşılan helper'dan (`rollsOfWeavingOrderWhere`), kopya `doffEvent: { revokedAt` yok",
    /rollsOfWeavingOrderWhere\(/.test(svc) && !/doffEvent\s*:\s*\{\s*revokedAt/.test(svc));
  check("§8b açık koşum `OPEN_RUN_WHERE`den; yazma çağrısı yok (create/update/delete/$transaction)",
    /OPEN_RUN_WHERE/.test(svc) && !/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$transaction/.test(svc));
  const helper = src("src/services/helpers/weaving-order-of-roll.helper.ts");
  check("§8c detayın sayacı da aynı where'i okur", /countRollsOfWeavingOrder[\s\S]*?rollsOfWeavingOrderWhere\(weavingOrderId\)/.test(helper));
  const route = src("src/routes/weaving-order.routes.ts");
  check("§8d uç detayla aynı izin kümesi (`weavingorder:read` + mobile:dokuma)",
    /"\/:id\/overview",\s*requireAnyPermission\("weavingorder:read", \.\.\.MOBILE_DOKUMA\)/.test(route) && /router\.use\(verifyToken, requireDokumaEnabled\)/.test(route));
}

async function cleanup(): Promise<void> {
  try {
    await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
    await prisma.doffEvent.deleteMany({ where: { machineId: { in: ids.machines } } });
    await prisma.machineStopEvent.deleteMany({ where: { machineId: { in: ids.machines } } });
    await prisma.machineRun.deleteMany({ where: { machineId: { in: ids.machines } } });
    if (ids.preset) await prisma.reasonPreset.deleteMany({ where: { id: ids.preset } });
    await prisma.warpBeam.deleteMany({ where: { id: { in: ids.beams } } });
    await prisma.weavingOrderToOrderLine.deleteMany({ where: { weavingOrderId: { in: ids.orders } } });
    await prisma.weavingOrder.deleteMany({ where: { id: { in: ids.orders } } });
    if (ids.warpSpec) await prisma.warpSpec.deleteMany({ where: { id: ids.warpSpec } });
    await prisma.item.deleteMany({ where: { id: { in: ids.items } } });
    await prisma.machine.deleteMany({ where: { id: { in: ids.machines } } });
    if (ids.station) await prisma.station.deleteMany({ where: { id: ids.station } });
    // Bekçi kullanıcısı sert silinmez (audit FK) — pasifleştirilir.
    await prisma.user.updateMany({ where: { id: { in: ids.users } }, data: { isActive: false } });
    for (const [key, value] of ilk) {
      if (value === undefined) await prisma.systemSetting.deleteMany({ where: { key } });
      else await prisma.systemSetting.update({ where: { key }, data: { value: value as never } });
    }
    invalidateFeatureFlagsCache();
  } catch (err) {
    fail++;
    console.error("❌ temizlik hatası (kalıntı büyür):", (err as Error).message);
  }
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.log(`⛔ ${engel}`); process.exit(1); }
  console.log("\n=== Dokuma işi genel bakış ===");
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: YONETILEN } }, select: { key: true, value: true } });
  for (const k of YONETILEN) ilk.set(k, rows.find((r) => r.key === k)?.value ?? undefined);
  await setting(SETTING_KEYS.PRODUCTION_ENABLED, true);
  await setting(SETTING_KEYS.DOKUMA_ENABLED, true);
  await setting(SETTING_KEYS.DEVERE_MOUNT_TRACKING, false);
  const now = new Date();
  const f = await fixture(now);
  await serviceSections(f, now);
  await httpSection(f);
  structuralSection();
}

main()
  .catch((e) => { fail++; console.error("❌ Bekçi hata ile durdu:", e); })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end().catch(() => undefined);
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
