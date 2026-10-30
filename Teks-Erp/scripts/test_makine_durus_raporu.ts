// =============================================================================
// BEKÇİ — Makine duruşları raporu + patron bulutu (D4-A4, ister 5.5; DALGA4 §2.5 md. 5–6, §2.8, §13)
// =============================================================================
// SORU: `production/makine-duruslari` span defterinden doğru mu sayıyor ve kapısı tek rejim yüklemine mi bağlı?
//   ① gün bölme saf fonksiyonu: fabrika günü sınırını aşan aralık iki güne bölünür, parçaların toplamı = süre,
//   ② 3 duruşlu fikstür (gece yarısını aşan 1 · geri alınan 1 · açık 1 + kapalı 1): toplam dakika EL HESABINA eşit,
//      geri alınan hariç, açık "sürüyor"; gün kırılımı sınırda bölünmüş; zarf (ana sayı · tablo · uyarı) aynı sayıyı basar,
//   ③ HTTP: 200 + zarf; bilinmeyen tür 400; rejim kapalı (dokuma ∧ ayar kapalı) 403 MODULE_DISABLED,
//   ④ bulut: katalogda yalnız `üretim ∧ ayar` iken; `dokuma/duruslar` kaydı ayardan bağımsız (weavingOpen dokunulmaz),
//   ⑤ dokuma fabrikasında mevcut duruş raporu (`dokuma/duruslar`) ayardan bağımsız: ayar KAPALI/AÇIK bayt-aynı
//      (PR öncesi davranışla snapshot DEĞİL; PR dokuma rapor servisine dokunmaz),
//   ⑥ AST: rapor kapsamı `machineStopScopeWhere` + `machineStopRegime`den; kopya istasyon-türü where'i, ayar
//      okuyucusu, çıplak gün kesimi yok; bulut kapısı rejim helper'ından.
// NEGATİF SONDALAR (2026-10-30, D4-A4):
//   S1 `getMachineStopReport` kapsamı helper yerine `{ machine: { station: { kind: { not: StationKind.WEAVING } } } }` → §6a + §6b kırmızı (28/2).
//   S2 `splitByFactoryDay` tek parça döndürdü (gün bölme kaldırıldı) → §1b + §2d kırmızı (28/2).
//   S3 çıkış metresi fazı yeniden yalnız OUT'a daraltıldı → §2f2 kırmızı (tambur CUT 30 m → 0).
// Global durum yazar (SystemSetting): `hedefDbEngeli()` ilk adım; üç ayar satırı birebir geri yüklenir.
// =============================================================================
import type { Server } from "http";
import type { AddressInfo } from "net";
import { randomUUID } from "crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ItemType, MachineDataSource, MeterApprovalMode, MeterPhase, MeterVarianceBasis, Prisma, StationKind } from "@prisma/client";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { factoryDayEndOfKey, factoryDayKeyUtcMidnight, factoryYmd } from "../src/constants/time";
import { getMachineStopReport, splitByFactoryDay } from "../src/services/reports/machine-stops.report";
import { buildMachineStopsReport, msToMinutes } from "../src/services/reports/temel/makine-duruslari.temel";
import { buildLoomStopsReport } from "../src/services/reports/temel/duruslar.temel";
import { resolveCoreDayRange } from "../src/services/reports/temel/_day-range";
import { remoteReportCatalog } from "../src/cloud-sync/report-requests";
import { ensureTestAdmin } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const SRC = join(__dirname, "..", "src");
const MIN = 60_000;
const DAY = 86_400_000;
const ek = `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const KEYS = [SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.MACHINE_STOP_TRACKING_ENABLED] as const;
const saved = new Map<string, { value: Prisma.JsonValue; description: string | null } | null>();
const ids = { stations: [] as string[], machines: [] as string[], items: [] as string[], rolls: [] as string[], workOrders: [] as string[] };

async function setSetting(key: string, value: boolean): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value, description: "TEST makine duruşu raporu" }, update: { value } });
}

async function fixtureMachine(kind: StationKind, tag: string): Promise<string> {
  const station = await prisma.station.create({
    data: { name: `TEST-MDRP-${tag}-${ek}`, code: `TEST-MDRP-${tag}-${ek}`.slice(0, 32), type: "INTERNAL", kind, isActive: true },
  });
  ids.stations.push(station.id);
  const m = await prisma.machine.create({ data: { stationId: station.id, name: `TEST-MDRP-M-${tag}-${ek}`, code: `TEST-MDRPM${tag}-${ek}`.slice(0, 32), isActive: true } });
  ids.machines.push(m.id);
  return m.id;
}

async function stop(machineId: string, startedAt: Date, endedAt: Date | null, extra: Partial<Prisma.MachineStopEventUncheckedCreateInput> = {}): Promise<void> {
  await prisma.machineStopEvent.create({
    data: {
      machineId, stopKey: randomUUID(), startedAt, endedAt,
      durationSec: endedAt ? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000) : null,
      factoryDay: factoryDayKeyUtcMidnight(startedAt), source: "SUPERVISOR", ...extra,
    },
  });
}

type Res = { status: number; body: { data?: unknown; details?: { code?: string } } };

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  for (const key of KEYS) {
    const row = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true, description: true } });
    saved.set(key, row ? { value: row.value, description: row.description } : null);
  }

  // ── §1 gün bölme (saf) ──
  const d0 = factoryYmd(new Date(Date.now() - 4 * DAY));
  const midnight = factoryDayEndOfKey(d0).getTime() + 1; // d0 → d1 sınırı
  const d1 = factoryYmd(new Date(midnight));
  const split = splitByFactoryDay(new Date(midnight - 30 * MIN), new Date(midnight + 45 * MIN));
  check("§1a parçaların toplamı = süre (75 dk)", split.reduce((s, x) => s + x.ms, 0) === 75 * MIN);
  check("§1b sınırı aşan aralık İKİ fabrika gününe bölünür (30 + 45 dk)",
    split.length === 2 && split[0]!.day === d0 && split[0]!.ms === 30 * MIN && split[1]!.day === d1 && split[1]!.ms === 45 * MIN,
    JSON.stringify(split));
  const inner = splitByFactoryDay(new Date(midnight + MIN), new Date(midnight + 11 * MIN));
  check("§1c gün içi aralık tek parça", inner.length === 1 && inner[0]!.ms === 10 * MIN && inner[0]!.day === d1);
  check("§1d boş/ters aralık parça vermez", splitByFactoryDay(new Date(midnight), new Date(midnight)).length === 0 && splitByFactoryDay(new Date(midnight), new Date(midnight - 1)).length === 0);

  const server: Server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let token = "";
  const call = async (path: string): Promise<Res & { raw: string }> => {
    const r = await fetch(`${base}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const raw = await r.text();
    let parsed: Res["body"] = {};
    try { parsed = JSON.parse(raw) as Res["body"]; } catch { /* boş gövde */ }
    return { status: r.status, body: parsed, raw };
  };

  try {
    const cred = await ensureTestAdmin();
    const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: cred.username, password: cred.password }) });
    token = String(((await login.json()) as { data?: { token?: string } }).data?.token ?? "");
    check("§0 login", login.status === 200 && token.length > 20, `status=${login.status}`);

    // ── §2 fikstür: dokumasız genel rejim ──
    await setSetting(SETTING_KEYS.PRODUCTION_ENABLED, true);
    await setSetting(SETTING_KEYS.DOKUMA_ENABLED, false);
    await setSetting(SETTING_KEYS.MACHINE_STOP_TRACKING_ENABLED, true);
    const qc = await fixtureMachine(StationKind.PROCESS_QC, "QC");
    const tb = await fixtureMachine(StationKind.TAMBUR, "TB");
    const now = new Date();
    await stop(qc, new Date(midnight - 30 * MIN), new Date(midnight + 45 * MIN)); // sınırı aşan: 75 dk (30 + 45)
    await stop(qc, new Date(midnight + 2 * 3600_000), new Date(midnight + 3 * 3600_000), { revokedAt: now, revokeReason: "TEST geri alma" }); // 60 dk, HARİÇ
    await stop(tb, new Date(midnight + 5 * MIN), new Date(midnight + 15 * MIN)); // 10 dk
    await stop(tb, new Date(now.getTime() - 20 * MIN), null); // açık: 20 dk "sürüyor"
    await stop(qc, new Date(midnight + 4 * 3600_000), new Date(midnight + 4 * 3600_000)); // süresi 0: sayılmaz (tanımlarda yazılı)
    const window = resolveCoreDayRange({ from: d0, to: factoryYmd(now) }, 7, now);
    const filters = { machineId: [qc, tb] };
    const r = await getMachineStopReport({ range: window.range, filters, now });
    const expectedMs = (75 + 10 + 20) * MIN;
    check("§2a toplam süre el hesabına eşit (75 + 10 + 20 = 105 dk; geri alınan 60 dk HARİÇ)", r.ms === expectedMs, `ms=${r.ms} beklenen=${expectedMs}`);
    check("§2b duruş sayısı 3 (sınırda bölünen bir kez sayılır; geri alınan yok)", r.stopCount === 3, `sayı=${r.stopCount}`);
    check("§2c açık duruş 'sürüyor' sayılır (1) ve tambur satırında işaretli", r.ongoing === 1 && r.machines.find((m) => m.key === tb)?.ongoing === 1 && r.machines.find((m) => m.key === qc)?.ongoing === 0);
    const dayMs = new Map(r.days.map((d) => [d.day, d.ms]));
    check("§2d gün kırılımı sınırda BÖLÜNMÜŞ: d0 = 30 dk, d1 = 45 + 10 dk", dayMs.get(d0) === 30 * MIN && dayMs.get(d1) === 55 * MIN, JSON.stringify(r.days.slice(0, 3)));
    check("§2e gün parçalarının toplamı = toplam", r.days.reduce((s, d) => s + d.ms, 0) === r.ms);
    check("§2f makine başına: kurşun 75 dk, tambur 30 dk; çıkış metresi okuma yokken 0",
      r.machines.find((m) => m.key === qc)?.ms === 75 * MIN && r.machines.find((m) => m.key === tb)?.ms === 30 * MIN && r.machines.every((m) => m.outMeters === 0));
    // Çıkış metresi: kurşun OUT, tambur CUT yazar (D4-B1b) → ikisi de sayılır; geri alınan okuma girmez.
    const item = await prisma.item.create({ data: { code: `TEST-MDRP-I-${ek}`.slice(0, 32), name: `TEST MDRP kumaş ${ek}`, itemType: ItemType.FABRIC, unit: "MT" }, select: { id: true } });
    ids.items.push(item.id);
    const roll = await prisma.roll.create({ data: { itemId: item.id, initialQty: "100", currentQty: "100" }, select: { id: true } });
    ids.rolls.push(roll.id);
    const stationOf = async (machineId: string) => (await prisma.machine.findUniqueOrThrow({ where: { id: machineId }, select: { stationId: true } })).stationId;
    const wo = await prisma.workOrder.create({
      data: { workOrderNumber: `TEST-MDRP-WO-${ek}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", targetItemId: item.id,
        steps: { create: [{ stationId: await stationOf(qc), stepSequence: 1, status: "ACTIVE" as const }, { stationId: await stationOf(tb), stepSequence: 2, status: "PENDING" as const }] } },
      select: { id: true, steps: { select: { id: true, stepSequence: true } } },
    });
    ids.workOrders.push(wo.id);
    const stepOf = (n: number) => wo.steps.find((x) => x.stepSequence === n)!.id;
    const reading = (machineId: string, step: string, phase: MeterPhase, meters: string, extra: Partial<Prisma.RollMeterReadingUncheckedCreateInput> = {}) =>
      prisma.rollMeterReading.create({
        data: { rollId: roll.id, workOrderStepId: step, phase, meters, source: MachineDataSource.OPERATOR, machineId, clientToken: randomUUID(),
          ...(phase === MeterPhase.CUT ? {} : { basis: MeterVarianceBasis.DECLARED_IN, approvalMode: MeterApprovalMode.NONE }), ...extra },
      });
    await reading(qc, stepOf(1), MeterPhase.OUT, "40.500");
    await reading(tb, stepOf(2), MeterPhase.CUT, "30.000");
    await reading(tb, stepOf(2), MeterPhase.CUT, "99.000", { revokedAt: now, revokeReason: "TEST geri alma" });
    const withMeters = await getMachineStopReport({ range: window.range, filters, now });
    const metersOf = (k: string) => withMeters.machines.find((m) => m.key === k)?.outMeters;
    check("§2f2 çıkış metresi: kurşun OUT 40,5 m · tambur CUT 30 m (geri alınan 99 m HARİÇ)", metersOf(qc) === 40.5 && metersOf(tb) === 30, `qc=${metersOf(qc)} tb=${metersOf(tb)}`);
    const narrowed = await getMachineStopReport({ range: { from: new Date(midnight), to: new Date(midnight + 10 * MIN - 1) }, filters, now });
    check("§2g pencereye kırpma: sınır sonrası 10 dk'lık pencerede 10 + 5 dk", narrowed.ms === 15 * MIN && narrowed.stopCount === 2, `ms=${narrowed.ms}`);

    const built = await buildMachineStopsReport({ window, filters, now });
    const s = built.sunum;
    check("§2h zarf: ana sayı dakika = el hesabı (105)", s.anaSayi.deger === msToMinutes(expectedMs) && s.anaSayi.deger === 105, `ana=${s.anaSayi.deger}`);
    check("§2i zarf: tablo toplamı ana sayıyla aynı + 'Sürüyor' işareti + uyarı",
      s.tablo?.toplam?.dakika === 105 && s.tablo?.satirlar.some((x) => x.durum === "Sürüyor") === true && s.uyarilar.some((u) => u.includes("hâlâ sürüyor")));
    check("§2j zarf: anahtar katalogdan, grafik gün kırılımı (vardiya yok)", s.anahtar === "production/makine-duruslari" && s.grafik?.eksen.x.ad === "Gün");

    // ── §3 HTTP ──
    const q = `from=${d0}&to=${factoryYmd(now)}&machineId=${qc},${tb}`;
    const ok = await call(`/api/reports/production/makine-duruslari?${q}`);
    const okData = ok.body.data as { anaSayi?: { deger?: number } } | undefined;
    check("§3a 200 + ana sayı ≥ 105 dk (açık duruş istek anına kadar büyür)", ok.status === 200 && (okData?.anaSayi?.deger ?? 0) >= 105 && (okData?.anaSayi?.deger ?? 0) < 110, `status=${ok.status} ana=${okData?.anaSayi?.deger}`);
    const bad = await call(`/api/reports/production/makine-duruslari?${q}&stationKind=YOK`);
    check("§3b bilinmeyen istasyon türü 400", bad.status === 400, `status=${bad.status}`);
    const variant = await call(`/api/reports/production/makine-duruslari?${q}&varyant=makine`);
    check("§3c varyant=makine 200", variant.status === 200, `status=${variant.status}`);

    // ── §4 bulut ──
    const cloudOn = (await remoteReportCatalog()).map((e) => e.anahtar);
    check("§4a üretim ∧ ayar: bulut kataloğunda production/makine-duruslari VAR, dokuma/duruslar YOK (dokuma kapalı)",
      cloudOn.includes("production/makine-duruslari") && !cloudOn.includes("dokuma/duruslar"));
    await setSetting(SETTING_KEYS.MACHINE_STOP_TRACKING_ENABLED, false);
    const cloudOff = (await remoteReportCatalog()).map((e) => e.anahtar);
    check("§4b ayar kapalı: bulut kataloğunda YOK", !cloudOff.includes("production/makine-duruslari"));
    const closed = await call(`/api/reports/production/makine-duruslari?${q}`);
    check("§3d rejim kapalı (dokuma ∧ ayar kapalı) → 403 MODULE_DISABLED", closed.status === 403 && closed.body.details?.code === "MODULE_DISABLED", `status=${closed.status} code=${closed.body.details?.code}`);

    // ── §5 dokuma fabrikası: mevcut duruş raporu + weavingOpen ayardan bağımsız (bayt-aynı) ──
    await setSetting(SETTING_KEYS.DOKUMA_ENABLED, true);
    const loomWindow = resolveCoreDayRange({ from: d0, to: factoryYmd(now) }, 7, now);
    const loomOff = JSON.stringify(await buildLoomStopsReport({ window: loomWindow }));
    const httpLoomOff = (await call(`/api/reports/dokuma/duruslar?from=${d0}&to=${factoryYmd(now)}`)).raw;
    const catOff = JSON.stringify((await remoteReportCatalog()).filter((e) => e.anahtar !== "production/makine-duruslari"));
    await setSetting(SETTING_KEYS.MACHINE_STOP_TRACKING_ENABLED, true);
    const loomOn = JSON.stringify(await buildLoomStopsReport({ window: loomWindow }));
    const httpLoomOn = (await call(`/api/reports/dokuma/duruslar?from=${d0}&to=${factoryYmd(now)}`)).raw;
    const catOn = JSON.stringify((await remoteReportCatalog()).filter((e) => e.anahtar !== "production/makine-duruslari"));
    check("§5a dokuma/duruslar servisi ayar KAPALI/AÇIK bayt-aynı", loomOff === loomOn && loomOff.length > 100);
    check("§5b dokuma/duruslar HTTP ayar KAPALI/AÇIK bayt-aynı", httpLoomOff === httpLoomOn && httpLoomOff.includes("\"anaSayi\""));
    check("§5c bulut kataloğunun geri kalanı (dokuma/duruslar dahil) ayardan bağımsız", catOff === catOn && catOn.includes("dokuma/duruslar"));
    const loomFab = await call(`/api/reports/production/makine-duruslari?${q}`);
    check("§5d dokuma açık fabrikada rapor açık (dokuma ∨ …)", loomFab.status === 200, `status=${loomFab.status}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  // ── §6 AST / metin: tek kaynak ──
  const svc = readFileSync(join(SRC, "services/reports/machine-stops.report.ts"), "utf8");
  const code = svc.replace(/\/\/.*$/gm, "");
  check("§6a rapor kapsamı tek helper'dan: machineStopScopeWhere(await machineStopRegime(), …)", /machineStopScopeWhere\(await machineStopRegime\(\)/.test(code));
  check("§6b kopya istasyon-türü where'i yok (station.kind / StationKind.WEAVING / ayar okuyucusu)",
    !/station:\s*\{\s*kind/.test(code) && !/StationKind\.WEAVING/.test(code) && !/readMachineStopTrackingEnabled|readDokumaEnabled/.test(code));
  check("§6c gün kesimi constants/time'dan; çıplak SQL gün kesimi yok", /from "\.\.\/\.\.\/constants\/time"/.test(code) && !new RegExp(`${["DATE", "TRUNC"].join("_")}|AT TIME ZONE`, "i").test(code));
  const cloud = readFileSync(join(SRC, "cloud-sync/report-requests.ts"), "utf8");
  check("§6d bulut kapısı rejim helper'ından (machineStopRegime().general); weavingOpen dokuma'da kalır",
    /machineStopCloudOpen = async \(\): Promise<boolean> => \(await machineStopRegime\(\)\)\.general/.test(cloud) && /key: "dokuma\/duruslar"[^\n]*gate: weavingOpen/.test(cloud) && /key: "production\/makine-duruslari"[^\n]*gate: machineStopCloudOpen/.test(cloud));
  const route = readFileSync(join(SRC, "routes/reports/temel-uretim.routes.ts"), "utf8");
  check("§6e uç kapısı requireMachineStopRegime + rapor kapısı", /router\.get\("\/production\/makine-duruslari", requireMachineStopRegime, \.\.\.reportGate\("production\/makine-duruslari"\)/.test(route));
}

async function cleanup(): Promise<void> {
  try {
    await prisma.machineStopEvent.deleteMany({ where: { machineId: { in: ids.machines } } });
    await prisma.rollMeterReading.deleteMany({ where: { rollId: { in: ids.rolls } } });
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: ids.rolls } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: ids.workOrders } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: ids.workOrders } } });
    await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
    await prisma.item.deleteMany({ where: { id: { in: ids.items } } });
    await prisma.machine.deleteMany({ where: { id: { in: ids.machines } } });
    await prisma.station.deleteMany({ where: { id: { in: ids.stations } } });
  } catch (e) {
    fail++;
    console.error("❌ temizlik hatası:", (e as Error).message);
  }
  for (const [key, row] of saved) {
    if (row) await prisma.systemSetting.update({ where: { key }, data: { value: row.value ?? Prisma.JsonNull, description: row.description } });
    else await prisma.systemSetting.deleteMany({ where: { key } });
  }
}

main()
  .catch((e) => {
    fail++;
    console.error("❌ Bekçi hata ile durdu:", e);
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
