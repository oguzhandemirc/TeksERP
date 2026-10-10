// =============================================================================
// BEKÇİ — TEZGAH SALONU canlı ekran ucu (`GET /api/loom-floor`) + duruşa DONAN hedef/pay
// =============================================================================
//   §1 saf: `loomStopTier` (hedefsiz/plan dışı UNTRACKED · hedef dolunca OVERDUE) ·
//      `escalationDueAt` = başlangıç + hedef + pay · `countFloor` (şu an % adet payı,
//      bugün % yalnız İZLENEN tezgahların ΣAPT/ΣPOT'u, sınıf kovaları, aşan sayısı)
//   §2 kapı zinciri GERÇEK router yığınında: ilk katman `verifyToken`; tezgah kapalı → 403
//      `MODULE_DISABLED` (modul tezgah) · üretim kapalı → 403 `MODULE_DISABLED` (modul production) ·
//      `loom:live-view` yok → 403 `PERMISSION_DENIED`; üçünde de GET gövdesi KOŞMAZ · izinle 200
//   §3 sebep hedef süresi kapısı (`resolveTargetMinutes`): NOT_APPLICABLE · NOT_TRACKED · OUT_OF_RANGE
//   §4 DONMA (`freezeStopEscalation`, tek yer): açılışta pay+hedef · sınıflandırmada hedef (+ eski
//      satırda pay) · yeniden sınıflandırmada yeni sebebin hedefi, pay DEĞİŞMEZ · katalog ve ayar
//      değişse açık duruşun hedefi/payı değişmez
//   §5 cevap: şekil (anahtar kümesi) · LIVE + açık duruş → STOPPED · OFF → UNMONITORED · kademe
//      donmuş değerden · hol özeti · fabrika günü SINIRI (önceki günün duruşu yok, günü kesen duruş
//      gün başından sayılır, `now` sonrası yok)
//
// Global ayar yazar (`production.enabled` · `tezgah.enabled` · `tezgah.escalationGraceMinutes`);
// bulduğu değere `finally`de döner (satırsızsa satırsız bırakır).
//
// NEGATİF SONDALAR (2026-10-10, cp + sha256 geri alındı):
//   ① classify yolundan donma alanları (`targetMinutes`/`escalationGraceMinutes`) düşürüldü → §4c/§4d/§4e/§5i ❌ · ② `openStopDto` donmuş pay
//   yerine o anki ayarı okudu → §5f/§5i ❌ · ③ route'tan `requireTezgahEnabled` çıkarıldı → §2b/§2c/§2d ❌
// =============================================================================
import { MachineStopLossClass, ReasonPresetKind } from "@prisma/client";
import type { Request, Response } from "express";
import prisma, { pool } from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { verifyToken } from "../src/middlewares/auth.middleware";
import loomFloorRouter from "../src/routes/loom-floor.routes";
import { getLoomFloor, type LoomFloorDto } from "../src/services/loom-floor.service";
import { classifyStop, closeManualStop, openManualStop, reclassifyStop } from "../src/services/machine-stop.service";
import { ReasonPresetService } from "../src/services/reason-preset.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { countFloor, escalationDueAt, loomStopTier, type FloorLoomCore } from "../src/services/helpers/loom-floor.helper";
import { aggregateMachineKpis } from "../src/services/helpers/loom-efficiency.helper";
import { factoryDayStart } from "../src/constants/time";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
async function hata(fn: () => Promise<unknown>): Promise<AppError | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof AppError ? e : null;
  }
}
const kod = (e: AppError | null): string => String(e?.details?.code ?? e?.statusCode ?? "yok");
const MIN = 60_000;

const ek = Date.now().toString(36);
const ids = { station: "", looms: [] as string[], presets: [] as string[] };

// ── global ayar: bul → yaz → finally'de geri yaz ─────────────────────────────
const YONETILEN = [SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.TEZGAH_ENABLED, SETTING_KEYS.TEZGAH_ESCALATION_GRACE_MINUTES];
const ilk = new Map<string, unknown>();
async function ayarlariSakla(): Promise<void> {
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: YONETILEN } }, select: { key: true, value: true } });
  for (const k of YONETILEN) ilk.set(k, rows.find((r) => r.key === k)?.value ?? undefined);
}
async function ayarYaz(key: string, value: boolean | number): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}
async function ayarlariGeriYaz(): Promise<void> {
  for (const [key, value] of ilk) {
    if (value === undefined) await prisma.systemSetting.deleteMany({ where: { key } });
    else await prisma.systemSetting.update({ where: { key }, data: { value: value as never } });
  }
}

// ── GERÇEK router yığını: `verifyToken`dan sonraki katmanlar sırayla koşar ────
interface YiginSonucu { err: AppError | null; body: unknown; reachedHandler: boolean; firstIsVerify: boolean }
async function routerKos(permissions: string[]): Promise<YiginSonucu> {
  type Layer = { handle: (req: Request, res: Response, next: (e?: unknown) => void) => unknown; route?: { methods: Record<string, boolean>; stack: Layer[] } };
  const stack = Reflect.get(loomFloorRouter, "stack") as Layer[];
  const req = { method: "GET", url: "/", user: { id: "bekci", permissions } } as unknown as Request;
  let body: unknown = null;
  let reachedHandler = false;
  for (const [i, layer] of stack.entries()) {
    if (i === 0 && layer.handle === (verifyToken as unknown)) continue; // kimlik doğrulama: JWT bekçinin konusu değil
    const handle = layer.route ? layer.route.stack[0]!.handle : layer.handle;
    if (layer.route) reachedHandler = true;
    const err = await new Promise<unknown>((resolve) => {
      const res = { json: (b: unknown) => { body = b; resolve(undefined); return res; } } as unknown as Response;
      void Promise.resolve(handle(req, res, (e?: unknown) => resolve(e ?? undefined)));
    });
    if (err) return { err: err instanceof AppError ? err : null, body, reachedHandler, firstIsVerify: stack[0]?.handle === (verifyToken as unknown) };
    if (layer.route) break;
  }
  return { err: null, body, reachedHandler, firstIsVerify: stack[0]?.handle === (verifyToken as unknown) };
}

function sifirTerim(pot: number, apt: number) {
  return { potSec: pot, aptSec: apt, unitsActual: 0, gapUnits: 0, targetUnitCapacityApt: 0, targetUnitCapacityPot: 0 };
}

async function main(): Promise<void> {
  console.log("\n=== Tezgah Salonu — kapı zinciri · donan hedef/pay · cevap · fabrika günü sınırı ===\n");
  await ayarlariSakla();
  try {
    await govde();
  } finally {
    await ayarlariGeriYaz();
    const geri = await prisma.systemSetting.findMany({ where: { key: { in: YONETILEN } }, select: { key: true, value: true } });
    const ayni = YONETILEN.every((k) => JSON.stringify(geri.find((r) => r.key === k)?.value) === JSON.stringify(ilk.get(k)));
    check("§0 global ayarlar bulunduğu değere geri yazıldı", ayni);
  }
}

async function govde(): Promise<void> {
  // ── §1 saf ──────────────────────────────────────────────────────────────────
  const t0 = new Date("2026-10-10T08:00:00Z");
  const saat = { startedAt: t0, targetMinutes: 10, graceMinutes: 5, lossClass: MachineStopLossClass.UNPLANNED };
  check("§1a hedef dolmadan WITHIN", loomStopTier(saat, new Date(t0.getTime() + 9 * MIN)) === "WITHIN");
  check("§1b hedef dolunca OVERDUE (sınır dahil)", loomStopTier(saat, new Date(t0.getTime() + 10 * MIN)) === "OVERDUE");
  check("§1c hedefsiz → UNTRACKED", loomStopTier({ ...saat, targetMinutes: null }, new Date(t0.getTime() + 999 * MIN)) === "UNTRACKED");
  check("§1d plan dışı → UNTRACKED + iletim anı yok", loomStopTier({ ...saat, lossClass: "NON_SCHEDULED" }, new Date(t0.getTime() + 99 * MIN)) === "UNTRACKED" && escalationDueAt({ ...saat, lossClass: "NON_SCHEDULED" }) === null);
  check("§1e iletim anı = başlangıç + hedef + pay", escalationDueAt(saat)?.getTime() === t0.getTime() + 15 * MIN);
  const cekirdek = (state: FloorLoomCore["state"], lossClass: MachineStopLossClass | null, tier: "WITHIN" | "OVERDUE" | "UNTRACKED", pot: number, apt: number): FloorLoomCore => ({
    hallId: "H", hallName: "H", state, openStop: state === "STOPPED" ? { lossClass, tier } : null, terms: sifirTerim(pot, apt),
  });
  const saf = countFloor([
    cekirdek("RUNNING", null, "UNTRACKED", 1000, 1000),
    cekirdek("RUNNING", null, "UNTRACKED", 1000, 900),
    cekirdek("STOPPED", "UNPLANNED", "OVERDUE", 1000, 500),
    cekirdek("STOPPED", null, "UNTRACKED", 1000, 600),
    cekirdek("UNMONITORED", null, "UNTRACKED", 1000, 0),
  ]);
  const beklenenBugun = aggregateMachineKpis([sifirTerim(1000, 1000), sifirTerim(1000, 900), sifirTerim(1000, 500), sifirTerim(1000, 600)]).availabilityPct;
  check("§1f sayılar: 5 toplam · 4 izlenen · 2 çalışan · 2 duran · 1 izlenmeyen · 1 aşan",
    saf.total === 5 && saf.monitored === 4 && saf.running === 2 && saf.stopped === 2 && saf.unmonitored === 1 && saf.overdue === 1, JSON.stringify(saf));
  check("§1g şu an % = çalışan/izlenen (adet payı)", saf.nowPct === 50, `${saf.nowPct}`);
  check("§1h bugün % = yalnız izlenenlerin ΣAPT/ΣPOT'u (izlenmeyen dışarıda)", saf.todayPct === beklenenBugun && beklenenBugun === 75, `${saf.todayPct} / ${beklenenBugun}`);
  check("§1i sınıf kovaları: UNPLANNED 1 · sınıfsız 1", saf.stoppedByClass.UNPLANNED === 1 && saf.stoppedByClass.UNCLASSIFIED === 1);

  // ── §2 kapı zinciri ────────────────────────────────────────────────────────
  await ayarYaz(SETTING_KEYS.PRODUCTION_ENABLED, true);
  await ayarYaz(SETTING_KEYS.TEZGAH_ENABLED, false);
  const kapali = await routerKos(["loom:live-view"]);
  check("§2a ilk katman verifyToken (kimlik kapısı önde)", kapali.firstIsVerify);
  check("§2b tezgah kapalı → 403 MODULE_DISABLED (modul tezgah)", kapali.err?.statusCode === 403 && kod(kapali.err) === "MODULE_DISABLED" && kapali.err?.details?.modul === "tezgah", kod(kapali.err));
  check("§2c tezgah kapalıyken GET gövdesi koşmadı", !kapali.reachedHandler && kapali.body === null);
  await ayarYaz(SETTING_KEYS.PRODUCTION_ENABLED, false);
  await ayarYaz(SETTING_KEYS.TEZGAH_ENABLED, true);
  const uretimYok = await routerKos(["loom:live-view"]);
  check("§2d üretim kapalı → 403 MODULE_DISABLED (modul production)", uretimYok.err?.statusCode === 403 && kod(uretimYok.err) === "MODULE_DISABLED" && uretimYok.err?.details?.modul === "production", kod(uretimYok.err));
  await ayarYaz(SETTING_KEYS.PRODUCTION_ENABLED, true);
  const izinsiz = await routerKos(["loom:read", "loom:manual-entry"]);
  check("§2e loom:live-view yok → 403 PERMISSION_DENIED, gövde koşmadı", izinsiz.err?.statusCode === 403 && kod(izinsiz.err) === "PERMISSION_DENIED" && !izinsiz.reachedHandler, kod(izinsiz.err));
  const izinli = await routerKos(["loom:live-view"]);
  check("§2f izin + modül açık → gövde koştu, success", izinli.err === null && izinli.reachedHandler && (izinli.body as { success?: boolean } | null)?.success === true);

  // ── §3 hedef süre kapısı ───────────────────────────────────────────────────
  const naE = await hata(() => ReasonPresetService.create({ kind: ReasonPresetKind.ORDER_CANCEL, label: `TEST-LF iptal ${ek}`, targetMinutes: 10 }));
  check("§3a duruş dışı sebepte hedef → 400 STOP_TARGET_NOT_APPLICABLE", naE?.statusCode === 400 && kod(naE) === "STOP_TARGET_NOT_APPLICABLE", kod(naE));
  const ntE = await hata(() => ReasonPresetService.create({ kind: ReasonPresetKind.MACHINE_STOP, label: `TEST-LF plandisi ${ek}`, stopLossClass: "NON_SCHEDULED", targetMinutes: 10 }));
  check("§3b plan dışı sınıfta hedef → 400 STOP_TARGET_NOT_TRACKED", ntE?.statusCode === 400 && kod(ntE) === "STOP_TARGET_NOT_TRACKED", kod(ntE));
  const orE = await hata(() => ReasonPresetService.create({ kind: ReasonPresetKind.MACHINE_STOP, label: `TEST-LF aralik ${ek}`, stopLossClass: "UNPLANNED", targetMinutes: 1441 }));
  check("§3c 1441 dk → 400 STOP_TARGET_OUT_OF_RANGE", orE?.statusCode === 400 && kod(orE) === "STOP_TARGET_OUT_OF_RANGE", kod(orE));

  // ── fikstür: hol + 4 tezgah (3 LIVE, 1 OFF) + iki sebep ─────────────────────
  const station = await prisma.station.create({
    data: { name: `TEST-LF-HOL-${ek}`, code: `TEST-LF-H-${ek}`.toUpperCase().slice(0, 32), type: "INTERNAL", kind: "WEAVING", isActive: true },
  });
  ids.station = station.id;
  const yeniTezgah = async (n: number, live: boolean) => {
    const m = await prisma.machine.create({ data: { stationId: station.id, name: `TEST-LF-T${n}-${ek}`, code: `TEST-LF-T${n}-${ek}`.toUpperCase().slice(0, 32), isActive: true } });
    ids.looms.push(m.id);
    await prisma.machineSpec.create({ data: { machineId: m.id, monitoringState: live ? "LIVE" : "OFF", ...(live ? { acceptedAt: new Date() } : {}) } });
    return m.id;
  };
  const [duran, sinifli, calisan, izlenmeyen] = [await yeniTezgah(1, true), await yeniTezgah(2, true), await yeniTezgah(3, true), await yeniTezgah(4, false)];
  const P = await ReasonPresetService.create({ kind: ReasonPresetKind.MACHINE_STOP, label: `TEST-LF ariza ${ek}`, stopLossClass: "UNPLANNED", targetMinutes: 10 });
  const Q = await ReasonPresetService.create({ kind: ReasonPresetKind.MACHINE_STOP, label: `TEST-LF ayar ${ek}`, stopLossClass: "SETUP", targetMinutes: 20 });
  ids.presets.push(P.id, Q.id);
  check("§3d geçerli hedef katalogda", P.targetMinutes === 10 && Q.targetMinutes === 20);

  // Ölçüm anı GEÇMİŞ bir fabrika günü: bugünün başından 1 sa önce (damga kapıları geçmişe açıktır).
  const simdi = new Date(factoryDayStart(new Date()).getTime() - 60 * MIN);
  const gunBasi = factoryDayStart(simdi);

  // ── §4 donma ───────────────────────────────────────────────────────────────
  // Tezgah 1: önceki günde biten X · günü kesen Y · `simdi`den sonra W · açık Z (sebepli açılış).
  const X = await openManualStop({ machineId: duran, startedAt: new Date(gunBasi.getTime() - 180 * MIN) });
  await closeManualStop(X.data.id, new Date(gunBasi.getTime() - 60 * MIN));
  const Y = await openManualStop({ machineId: duran, startedAt: new Date(gunBasi.getTime() - 30 * MIN) });
  await closeManualStop(Y.data.id, new Date(gunBasi.getTime() + 20 * MIN));
  const W = await openManualStop({ machineId: duran, startedAt: new Date(simdi.getTime() + 10 * MIN) });
  await closeManualStop(W.data.id, new Date(simdi.getTime() + 20 * MIN));
  await ayarYaz(SETTING_KEYS.TEZGAH_ESCALATION_GRACE_MINUTES, 7);
  const Z = await openManualStop({ machineId: duran, startedAt: new Date(simdi.getTime() - 30 * MIN), reasonCode: P.code });
  check("§4a açılışta sebep → hedef + pay DONDU (10 / 7)", Z.data.targetMinutes === 10 && Z.data.escalationGraceMinutes === 7, `${Z.data.targetMinutes}/${Z.data.escalationGraceMinutes}`);
  const sebepsiz = await openManualStop({ machineId: sinifli, startedAt: new Date(simdi.getTime() - 5 * MIN) });
  check("§4a' sebepsiz açılış: hedef yok, pay dondu", sebepsiz.data.targetMinutes === null && sebepsiz.data.escalationGraceMinutes === 7);

  // Katalog + ayar değişir; açık duruşlar değişmez.
  await ReasonPresetService.update(P.id, { targetMinutes: 45 });
  await ayarYaz(SETTING_KEYS.TEZGAH_ESCALATION_GRACE_MINUTES, 15);
  const zTaze = await prisma.machineStopEvent.findUniqueOrThrow({ where: { id: Z.data.id }, select: { targetMinutes: true, escalationGraceMinutes: true } });
  check("§4b katalog 10→45 ve ayar 7→15 olsa da açık duruş 10 / 7", zTaze.targetMinutes === 10 && zTaze.escalationGraceMinutes === 7, JSON.stringify(zTaze));

  // Eski satır (özellikten önce açılmış): pay NULL → ilk sebep kararında o anki ayar (15) donar.
  await prisma.machineStopEvent.update({ where: { id: sebepsiz.data.id }, data: { escalationGraceMinutes: null } });
  const sinif = await classifyStop(sebepsiz.data.id, { reasonCode: P.code }, undefined);
  check("§4c sınıflandırma: hedef KARAR ANINDAKİ katalogdan (45)", sinif.data.targetMinutes === 45, `${sinif.data.targetMinutes}`);
  check("§4d sınıflandırma: boş pay o anki ayarla doldu (15)", sinif.data.escalationGraceMinutes === 15, `${sinif.data.escalationGraceMinutes}`);
  await ayarYaz(SETTING_KEYS.TEZGAH_ESCALATION_GRACE_MINUTES, 3);
  const yeniden = await reclassifyStop(sebepsiz.data.id, { fromReasonCode: P.code, toReasonCode: Q.code }, undefined);
  check("§4e yeniden sınıflandırma: yeni sebebin hedefi (20), pay DEĞİŞMEDİ (15)", yeniden.data.targetMinutes === 20 && yeniden.data.escalationGraceMinutes === 15, `${yeniden.data.targetMinutes}/${yeniden.data.escalationGraceMinutes}`);

  // Tezgah 4 (OFF): açık duruş olsa da izlenmiyor.
  await openManualStop({ machineId: izlenmeyen, startedAt: new Date(simdi.getTime() - 15 * MIN) });

  // ── §5 cevap ───────────────────────────────────────────────────────────────
  const r = await getLoomFloor(simdi);
  const d: LoomFloorDto = r.data!;
  const anahtar = (o: object) => Object.keys(o).sort().join(",");
  check("§5a üst şekil", anahtar(d) === "asOf,dokumaEnabled,factoryDayStart,graceMinutes,halls,looms,shift,summary", anahtar(d));
  check("§5b fabrika günü başı = factoryDayStart(now) · üst pay o anki ayar (3)", d.factoryDayStart.getTime() === gunBasi.getTime() && d.graceMinutes === 3);
  const t = (id: string) => d.looms.find((l) => l.id === id)!;
  const l1 = t(duran);
  check("§5c tezgah şekli", !!l1 && anahtar(l1) === "code,hallId,hallName,id,job,monitoringState,name,openStop,recentStops,source,state,targetUnitsPerMin,today", l1 ? anahtar(l1) : "yok");
  check("§5d openStop şekli", !!l1?.openStop && anahtar(l1.openStop) === "escalationDueAt,graceMinutes,id,lossClass,reasonCode,reasonLabel,requiresReason,source,startedAt,targetMinutes,tier", l1?.openStop ? anahtar(l1.openStop) : "yok");
  check("§5e LIVE + açık duruş → STOPPED, açık duruş Z", l1?.state === "STOPPED" && l1.openStop?.id === Z.data.id);
  check("§5f kademe DONMUŞ hedeften: 30 dk ≥ 10 → OVERDUE (katalog 45 olsa WITHIN olurdu) · iletim anı +10+7",
    l1?.openStop?.tier === "OVERDUE" && l1.openStop.graceMinutes === 7 && l1.openStop.escalationDueAt?.getTime() === Z.data.startedAt.getTime() + 17 * MIN,
    `${l1?.openStop?.tier} pay ${l1?.openStop?.graceMinutes}`);
  const sonIds = new Set(l1?.recentStops.map((s) => s.id) ?? []);
  check("§5g fabrika günü SINIRI: önceki günün duruşu (X) ve `now` sonrası (W) yok; Y ve Z var",
    !sonIds.has(X.data.id) && !sonIds.has(W.data.id) && sonIds.has(Y.data.id) && sonIds.has(Z.data.id), [...sonIds].length.toString());
  const durusSn = (l1?.today.breakdown ?? []).reduce((a, b) => a + b.stopSec, 0);
  check("§5h günü kesen duruş gün başından sayılır: 20 dk (Y) + 30 dk (Z, now'a kadar) = 3000 sn · 2 duruş",
    durusSn === 3000 && l1?.today.stopCount === 2, `${durusSn} sn · ${l1?.today.stopCount}`);
  const l2 = t(sinifli);
  check("§5i reclass edilmiş açık duruş: SETUP, 5 dk < 20 → WITHIN, pay 15", l2?.state === "STOPPED" && l2.openStop?.lossClass === "SETUP" && l2.openStop.tier === "WITHIN" && l2.openStop.graceMinutes === 15);
  check("§5j duruşsuz LIVE → RUNNING", t(calisan)?.state === "RUNNING" && t(calisan)?.openStop === null);
  check("§5k OFF tezgah açık duruşla bile UNMONITORED", t(izlenmeyen)?.state === "UNMONITORED");
  check("§5l koşum yok → iş bloğu boş", [duran, sinifli, calisan, izlenmeyen].every((id) => t(id)?.job === null));
  const hol = d.halls.find((h) => h.hallId === station.id);
  const izlenenler = [duran, sinifli, calisan].map((id) => sifirTerim(t(id)!.today.potSec, t(id)!.today.aptSec));
  check("§5m hol özeti: 4 toplam · 3 izlenen · 1 çalışan · 2 duran · 1 izlenmeyen · 1 aşan · UNPLANNED 1 · SETUP 1 · şu an %33",
    !!hol && hol.total === 4 && hol.monitored === 3 && hol.running === 1 && hol.stopped === 2 && hol.unmonitored === 1 && hol.overdue === 1
      && hol.stoppedByClass.UNPLANNED === 1 && hol.stoppedByClass.SETUP === 1 && hol.nowPct === 33,
    hol ? JSON.stringify({ ...hol, stoppedByClass: undefined }) : "hol yok");
  check("§5n hol bugün % = izlenen üç tezgahın ΣAPT/ΣPOT'u", hol?.todayPct === aggregateMachineKpis(izlenenler).availabilityPct, `${hol?.todayPct}`);
}

async function cleanup(): Promise<void> {
  try {
    if (ids.looms.length) {
      const stops = await prisma.machineStopEvent.findMany({ where: { machineId: { in: ids.looms } }, select: { id: true } });
      const sid = stops.map((s) => s.id);
      await prisma.machineStopReclass.deleteMany({ where: { stopEventId: { in: sid } } });
      // BEFORE DELETE seddi insan kararlı satırı korur — fikstür temizliği ÖNCE kararı siler (üretim yolu değil).
      await prisma.machineStopEvent.updateMany({ where: { id: { in: sid } }, data: { classifiedById: null, reasonSource: null } });
      await prisma.machineStopEvent.deleteMany({ where: { id: { in: sid } } });
      await prisma.machineSpec.deleteMany({ where: { machineId: { in: ids.looms } } });
      await prisma.machine.deleteMany({ where: { id: { in: ids.looms } } });
    }
    if (ids.presets.length) await prisma.reasonPreset.deleteMany({ where: { id: { in: ids.presets } } });
    if (ids.station) await prisma.station.deleteMany({ where: { id: ids.station } });
  } catch (e) {
    fail++;
    console.error("❌ temizlik hatası (kalıntı büyür):", (e as Error).message);
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
    process.exit(fail > 0 ? 1 : 0);
  });
