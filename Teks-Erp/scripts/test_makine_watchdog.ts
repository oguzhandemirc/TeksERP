// =============================================================================
// Bekçi: MAKİNE KARTI WATCHDOG'u (makine kaynaklı duruş D4)
// =============================================================================
//   §1 sessizlik eşiği: eşik altı kart sessiz sayılmaz, üstü `silentSince` alır (değer = son görülme) + tek audit;
//      sessizlik DURUŞ AÇMAZ
//   §2 ikinci tur ve "yeniden başlatma" (durum DB'de) çift uyarı üretmez
//   §3 imzalı nabız: `lastSeenAt` yazılır, sessizlik biter (tek audit), 30 sn kısıtı, gövdede alan 400
//   §4 modül kapalı: nabız 403 MODULE_DISABLED, kart "görülmüş" sayılmaz, tur "disabled"
//   §5 geçici kapanış: kart duruşu eşiği aşınca WATCHDOG (`endedAt = provisionalEndedAt = startedAt + eşik`,
//      kapatan yok); insan duruşuna dokunulmaz; ikinci tur no-op
//   §6 düzeltme: gerçek bitiş BİR KEZ düzeltir (`endCorrectedAt`, `provisionalEndedAt` KALIR); tekrar replay,
//      başka bitiş 409 STOP_END_CONFLICT
//   §7 mühür: düzeltme 409 SHIFT_SEALED + `lateEndedAt` kuyruğu (sağlık sayacı); mühür açılınca tur uygular
//   §8 statik: watchdog duruş açmaz, kapanışı yalnız tek boğazdan yazar; liste/kuyruk yüklemi tek kaynaktan
//   §5e/§6f/§7f-g panel listesi `GET /machine-stops?pendingEnd=true`: geçici kapanış (bitiş gelmedi ya da mühür
//      bekliyor) listede; düzeltilen ve insan duruşu listede değil
// Negatif sondalar (kırmızı görüldü, geri alındı): bkz. docs/history/arsiv/2026-10.md (makine duruşu D4).
// =============================================================================
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { invalidateFeatureFlagsCache, SETTING_KEYS } from "../src/services/system-setting.service";
import { setShortCredentialKeyDirForTests } from "../src/lib/short-credential/keyring";
import { openManualStop, STOP_CLOSE_REPLAY_MESSAGE } from "../src/services/machine-stop.service";
import { STOP_CORRECTED_MESSAGE } from "../src/services/helpers/machine-stop-watchdog.helper";
import { readMachineWatchdogCounters, runMachineWatchdogOnce, type WatchdogSummary } from "../src/services/machine-watchdog.service";
import { collectorSigningInput, signCollectorRequest } from "../src/services/helpers/collector-secret.helper";
import { resetCollectorAuthStateForTests } from "../src/middlewares/collector-auth.middleware";
import { factoryDayKeyUtcMidnight } from "../src/constants/time";
import { ensureTestAdmin, testActorId } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}
const MIN = 60_000;
const HOUR = 60 * MIN;
const ek = Date.now().toString(36);
const TYPE = `TEST-MWD-${ek}`.toUpperCase().slice(0, 32);
const ids = { station: "", machines: [] as string[], collectors: [] as string[], shiftDef: "", shift: "", stat: "" };
const YONETILEN = [
  SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.TEZGAH_ENABLED, SETTING_KEYS.DOKUMA_ENABLED,
  SETTING_KEYS.TEZGAH_MAX_OPEN_STOP_HOURS, SETTING_KEYS.TEZGAH_COLLECTOR_SILENCE_MINUTES,
];
const ilk = new Map<string, unknown>();
const anahtarDizini = mkdtempSync(join(tmpdir(), "mwd-halka-"));

type Yanit = { status: number; body: { data?: Record<string, unknown> & { collector?: Record<string, unknown>; secret?: string }; message?: string; details?: { code?: string; lateEndQueued?: boolean }; error?: { details?: { code?: string; lateEndQueued?: boolean } } } };
let base = "";
let token = "";
interface Kart { id: string; secret: string }

async function api(method: string, path: string, body?: unknown): Promise<Yanit> {
  const r = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Yanit["body"] };
}

async function kart(path: string, body: unknown, c: Kart): Promise<Yanit> {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID().replace(/-/g, "");
  const input = collectorSigningInput({ method: "POST", path, timestamp: ts, nonce, body: Buffer.from(raw, "utf8") });
  const r = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-collector-id": c.id, "x-collector-timestamp": ts, "x-collector-nonce": nonce, "x-collector-signature": signCollectorRequest(Buffer.from(c.secret, "hex"), input) },
    body: raw,
  });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Yanit["body"] };
}

const det = (r: Yanit): { code?: string; lateEndQueued?: boolean } => r.body.error?.details ?? r.body.details ?? {};
const kod = (r: Yanit): string => `${r.status}:${det(r).code ?? ""}`;
/** Panelin "geçici kapanışlar" kapsamı — tezgah başına id kümesi. */
async function bekleyen(machineId: string): Promise<string[]> {
  const r = await api("GET", `/api/machine-stops?pendingEnd=true&limit=500&machineId=${machineId}`);
  return Array.isArray(r.body.data) ? (r.body.data as unknown as Array<{ id: string }>).map((x) => x.id) : [`HTTP ${r.status}`];
}
const sayi = (r: Awaited<ReturnType<typeof runMachineWatchdogOnce>>): WatchdogSummary | null => (r === "disabled" ? null : r);

async function setting(key: string, value: unknown): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
  invalidateFeatureFlagsCache();
}

async function makine(n: number): Promise<string> {
  const m = await prisma.machine.create({ data: { stationId: ids.station, name: `TEST-MWD-T${n}-${ek}`, code: `TEST-MWD-T${n}-${ek}`.toUpperCase().slice(0, 32), isActive: true } });
  ids.machines.push(m.id);
  return m.id;
}

async function sessizlikAuditSayisi(id: string): Promise<{ sustu: number; uyandi: number }> {
  const rows = await prisma.systemLog.findMany({ where: { tableName: "MACHINE_COLLECTOR", recordId: id }, select: { changes: true } });
  let sustu = 0;
  let uyandi = 0;
  for (const r of rows) {
    const ch = (Array.isArray(r.changes) ? r.changes : []) as Array<{ field?: string; old?: unknown; new?: unknown }>;
    const s = ch.find((c) => c.field === "silentSince");
    if (!s) continue;
    if (s.old === null && s.new !== null) sustu++;
    if (s.old !== null && s.new === null) uyandi++;
  }
  return { sustu, uyandi };
}

async function sessizlikBolumu(card: Kart, m: string[], issuedAt: Date): Promise<void> {
  console.log("\n§1 — sessizlik eşiği");
  const scope = { onlyCollectorIds: [card.id], onlyMachineIds: m };
  const alt = sayi(await runMachineWatchdogOnce({ ...scope, now: new Date(issuedAt.getTime() + 9 * MIN) }));
  const row0 = await prisma.machineCollector.findUniqueOrThrow({ where: { id: card.id }, select: { silentSince: true } });
  check("§1a eşik (10 dk) altında sessiz sayılmaz", alt?.silenced === 0 && row0.silentSince === null, JSON.stringify(alt));
  const ust = sayi(await runMachineWatchdogOnce({ ...scope, now: new Date(issuedAt.getTime() + 11 * MIN) }));
  const row1 = await prisma.machineCollector.findUniqueOrThrow({ where: { id: card.id }, select: { silentSince: true, secretIssuedAt: true } });
  check("§1b eşik aşılınca `silentSince` = son görülme (hiç görülmediyse sır verildiği an)",
    ust?.silenced === 1 && row1.silentSince?.getTime() === row1.secretIssuedAt?.getTime(), JSON.stringify(ust));
  check("§1c tek audit izi (silentSince null → değer)", (await sessizlikAuditSayisi(card.id)).sustu === 1);
  check("§1d sessizlik duruş AÇMAZ", (await prisma.machineStopEvent.count({ where: { machineId: { in: m } } })) === 0);
  const sayac = await readMachineWatchdogCounters();
  check("§1e sağlık sayacı sessiz kartı sayar", sayac.silentCollectors >= 1, JSON.stringify(sayac));

  console.log("\n§2 — çift uyarı yok");
  const ikinci = sayi(await runMachineWatchdogOnce({ ...scope, now: new Date(issuedAt.getTime() + 30 * MIN) }));
  // Yeniden başlatma: süreçte durum yok — yeni tur yalnız DB'yi görür (claim yüklemi `silentSince IS NULL`).
  const ucuncu = sayi(await runMachineWatchdogOnce({ ...scope, now: new Date(issuedAt.getTime() + 90 * MIN) }));
  const row2 = await prisma.machineCollector.findUniqueOrThrow({ where: { id: card.id }, select: { silentSince: true } });
  check("§2a ikinci ve üçüncü tur kartı yeniden işaretlemez, `silentSince` değişmez",
    ikinci?.silenced === 0 && ucuncu?.silenced === 0 && row2.silentSince?.getTime() === row1.silentSince?.getTime(), `${JSON.stringify(ikinci)} ${JSON.stringify(ucuncu)}`);
  check("§2b audit hâlâ tek", (await sessizlikAuditSayisi(card.id)).sustu === 1);
}

async function nabizBolumu(card: Kart): Promise<void> {
  console.log("\n§3 — imzalı nabız");
  const r = await kart("/api/machine-signals/heartbeat", {}, card);
  const row = await prisma.machineCollector.findUniqueOrThrow({ where: { id: card.id }, select: { silentSince: true, lastSeenAt: true } });
  check("§3a nabız 200 + sunucu saati, `lastSeenAt` yazılır, sessizlik biter",
    r.status === 200 && typeof r.body.data?.serverTime === "number" && row.silentSince === null && row.lastSeenAt !== null, `${r.status}`);
  check("§3b uyanış tek audit izi (değer → null)", (await sessizlikAuditSayisi(card.id)).uyandi === 1);
  await kart("/api/machine-signals/heartbeat", {}, card);
  const row2 = await prisma.machineCollector.findUniqueOrThrow({ where: { id: card.id }, select: { lastSeenAt: true } });
  check("§3c 30 sn içinde ikinci nabız `lastSeenAt`i yeniden yazmaz", row2.lastSeenAt?.getTime() === row.lastSeenAt?.getTime());
  check("§3d nabız gövdesinde alan → 400", (await kart("/api/machine-signals/heartbeat", { x: 1 }, card)).status === 400);
  check("§3e uyanan kart tekrar sessiz sayılmaz (eşik içinde)", sayi(await runMachineWatchdogOnce({ onlyCollectorIds: [card.id], onlyMachineIds: [] }))?.silenced === 0);
}

async function modulBolumu(card: Kart): Promise<void> {
  console.log("\n§4 — modül kapalı");
  await prisma.machineCollector.update({ where: { id: card.id }, data: { lastSeenAt: new Date(Date.now() - 5 * MIN) } });
  const once = await prisma.machineCollector.findUniqueOrThrow({ where: { id: card.id }, select: { lastSeenAt: true } });
  await setting(SETTING_KEYS.TEZGAH_ENABLED, false);
  const r = await kart("/api/machine-signals/heartbeat", {}, card);
  const sonra = await prisma.machineCollector.findUniqueOrThrow({ where: { id: card.id }, select: { lastSeenAt: true } });
  check("§4a tezgah kapalı → nabız 403 MODULE_DISABLED", kod(r) === "403:MODULE_DISABLED", kod(r));
  check("§4b kapalı modülde kart \"görülmüş\" sayılmaz", sonra.lastSeenAt?.getTime() === once.lastSeenAt?.getTime());
  check("§4c tur \"disabled\" (yazım yok)", (await runMachineWatchdogOnce({ onlyCollectorIds: [card.id], onlyMachineIds: [] })) === "disabled");
  await setting(SETTING_KEYS.TEZGAH_ENABLED, true);
  await setting(SETTING_KEYS.DOKUMA_ENABLED, false);
  check("§4d dokuma kapalı → tur \"disabled\"", (await runMachineWatchdogOnce({ onlyCollectorIds: [card.id], onlyMachineIds: [] })) === "disabled");
  await setting(SETTING_KEYS.DOKUMA_ENABLED, true);
}

async function kapanisBolumu(card: Kart, m: string[]): Promise<{ key: string; stopId: string }> {
  console.log("\n§5 — geçici kapanış");
  const key = randomUUID();
  // Gerçek saatte gecikmemiş (2 sa < 12 sa); eşik testin SAHTE saatiyle aşılır. Aynı DB'deki CI sunucularının
  // watchdog turu (60 sn, küresel) gerçek saatle bakar — gecikmiş açılan duruşu testten önce kapatıp §5b'yi düşürüyordu.
  const startedAt = new Date(Math.floor((Date.now() - 2 * HOUR) / 1000) * 1000);
  const saat = { now: new Date(startedAt.getTime() + 13 * HOUR) };
  const ac = await kart("/api/machine-signals/stop", { machineId: m[0], stopKey: key, startedAt: startedAt.toISOString() }, card);
  const insan = await openManualStop({ machineId: m[1], startedAt, source: "SUPERVISOR" } as never, await testActorId());
  check("§5a fikstür: kart duruşu 201 · insan duruşu açık", ac.status === 201 && insan.success === true, `${ac.status}`);
  const stopId = String(ac.body.data?.id);
  const tur = sayi(await runMachineWatchdogOnce({ ...saat, onlyCollectorIds: [], onlyMachineIds: m }));
  const s = await prisma.machineStopEvent.findUniqueOrThrow({ where: { id: stopId } });
  const tahmin = startedAt.getTime() + 12 * HOUR;
  check("§5b kart duruşu WATCHDOG ile kapanır: endedAt = provisionalEndedAt = başlangıç + 12 sa, süre 43200, kapatan yok",
    tur?.provisional === 1 && s.endSource === "WATCHDOG" && s.endedAt?.getTime() === tahmin && s.provisionalEndedAt?.getTime() === tahmin
      && s.durationSec === 12 * 3600 && s.closedById === null && s.endCorrectedAt === null, JSON.stringify(tur));
  const h = await prisma.machineStopEvent.findUniqueOrThrow({ where: { id: (insan.data as { id: string }).id }, select: { endedAt: true } });
  check("§5c insan duruşuna dokunulmaz (açık kalır)", h.endedAt === null);
  check("§5d ikinci tur no-op", sayi(await runMachineWatchdogOnce({ ...saat, onlyCollectorIds: [], onlyMachineIds: m }))?.provisional === 0);
  const l0 = await bekleyen(m[0]);
  const l1 = await bekleyen(m[1]);
  check("§5e panel listesi (pendingEnd): geçici kapanış listede, insanın açık duruşu yok", l0.length === 1 && l0[0] === stopId && l1.length === 0, `${l0} | ${l1}`);
  return { key, stopId };
}

async function duzeltmeBolumu(card: Kart, m: string[], k: { key: string; stopId: string }): Promise<void> {
  console.log("\n§6 — gerçek bitiş düzeltir");
  const before = await prisma.machineStopEvent.findUniqueOrThrow({ where: { id: k.stopId } });
  const endedAt = new Date(Math.floor((Date.now() - HOUR) / 1000) * 1000);
  const r = await kart("/api/machine-signals/end", { machineId: m[0], stopKey: k.key, endedAt: endedAt.toISOString() }, card);
  const s = await prisma.machineStopEvent.findUniqueOrThrow({ where: { id: k.stopId } });
  check("§6a 200 düzeltildi: endedAt gerçek, endSource SIGNAL, endCorrectedAt dolu",
    r.status === 200 && r.body.message === STOP_CORRECTED_MESSAGE && s.endedAt?.getTime() === endedAt.getTime() && s.endSource === "SIGNAL" && s.endCorrectedAt !== null,
    `${r.status} ${r.body.message ?? ""}`);
  check("§6b `provisionalEndedAt` İZİ KALIR (ileri damga null'lanmaz)", s.provisionalEndedAt?.getTime() === before.provisionalEndedAt?.getTime() && s.provisionalEndedAt !== null);
  check("§6c süre gerçek bitişten", s.durationSec === Math.round((endedAt.getTime() - s.startedAt.getTime()) / 1000));
  const tekrar = await kart("/api/machine-signals/end", { machineId: m[0], stopKey: k.key, endedAt: endedAt.toISOString() }, card);
  check("§6d aynı bitiş tekrar → 200 replay", tekrar.status === 200 && tekrar.body.message === STOP_CLOSE_REPLAY_MESSAGE, `${tekrar.status}`);
  const baska = await kart("/api/machine-signals/end", { machineId: m[0], stopKey: k.key, endedAt: new Date(endedAt.getTime() - MIN).toISOString() }, card);
  const l = await bekleyen(m[0]);
  check("§6f düzeltilen duruş panel listesinden düşer", l.length === 0, String(l));
  check("§6e düzeltme TEK KEZ: başka bitiş → 409 STOP_END_CONFLICT", kod(baska) === "409:STOP_END_CONFLICT", kod(baska));
}

async function muhurBolumu(card: Kart, m: string[]): Promise<void> {
  console.log("\n§7 — mühürlü vardiya");
  const key = randomUUID();
  const startedAt = new Date(Math.floor((Date.now() - 14 * HOUR) / 1000) * 1000);
  const ac = await kart("/api/machine-signals/stop", { machineId: m[2], stopKey: key, startedAt: startedAt.toISOString() }, card);
  const stopId = String(ac.body.data?.id);
  await runMachineWatchdogOnce({ onlyCollectorIds: [], onlyMachineIds: [m[2]] });
  // Fikstür: duruşun vardiyası + mühürlü karne (üretim yolu değil — mühür çevrimi kendi bekçisinde).
  const def = await prisma.shiftDefinition.create({ data: { code: `W${ek}`.slice(0, 8), name: `TEST-MWD vardiya ${ek}`, startMinute: 0, durationMinutes: 480 } });
  ids.shiftDef = def.id;
  const shift = await prisma.shiftInstance.create({
    data: { shiftDefinitionId: def.id, factoryDayKey: factoryDayKeyUtcMidnight(startedAt), startsAt: new Date(startedAt.getTime() - MIN), endsAt: new Date(startedAt.getTime() + 8 * HOUR) },
  });
  ids.shift = shift.id;
  await prisma.machineStopEvent.update({ where: { id: stopId }, data: { shiftInstanceId: shift.id } });
  const stat = await prisma.machineShiftStat.create({
    data: { machineId: m[2], shiftInstanceId: shift.id, factoryDay: factoryDayKeyUtcMidnight(startedAt), stopThresholdSec: 20, source: "OPERATOR", monitoringState: "OFF", sealState: "SEALED", sealGeneration: 1, sealedAt: new Date() },
  });
  ids.stat = stat.id;
  const endedAt = new Date(Math.floor((Date.now() - 30 * MIN) / 1000) * 1000);
  const r = await kart("/api/machine-signals/end", { machineId: m[2], stopKey: key, endedAt: endedAt.toISOString() }, card);
  const s = await prisma.machineStopEvent.findUniqueOrThrow({ where: { id: stopId } });
  check("§7a mühürlü vardiyada düzeltme → 409 SHIFT_SEALED (kuyruğa alındı)", kod(r) === "409:SHIFT_SEALED" && det(r).lateEndQueued === true, kod(r));
  check("§7b `lateEndedAt` yazılır, kapanış değişmez (hâlâ WATCHDOG)", s.lateEndedAt?.getTime() === endedAt.getTime() && s.endSource === "WATCHDOG" && s.endCorrectedAt === null);
  const lq = await bekleyen(m[2]);
  check("§7f mühür bekleyen geçici kapanış panel listesinde", lq.length === 1 && lq[0] === stopId, String(lq));
  check("§7c sağlık sayacı geciken kapanışı sayar", (await readMachineWatchdogCounters()).lateStopEnds >= 1);
  const bekle = sayi(await runMachineWatchdogOnce({ onlyCollectorIds: [], onlyMachineIds: [m[2]] }));
  check("§7d mühür sürerken tur uygulamaz (sealed sayılır)", bekle?.corrected === 0 && (bekle?.sealed ?? 0) >= 1, JSON.stringify(bekle));
  // Mühür turun kuyruk okumasından SONRA açılır: okuma mühürlüyken yapıldığı için duruş kuyrukta KESİN
  // (mühürlüyken hiçbir tur uygulayamaz); aynı DB'deki sunucuların küresel turu açılıştan sonra araya girip
  // önce uygularsa bizim tur aynı bitişi replay olarak sayar. Eski sıra (aç → tur) yarışa açıktı.
  const uygula = sayi(await runMachineWatchdogOnce({
    onlyCollectorIds: [], onlyMachineIds: [m[2]],
    afterLateQueueRead: async () => { await prisma.machineShiftStat.update({ where: { id: stat.id }, data: { sealState: "OPEN" } }); },
  }));
  const s2 = await prisma.machineStopEvent.findUniqueOrThrow({ where: { id: stopId } });
  check("§7e mühür açılınca tur geciken kapanışı uygular (SIGNAL, endCorrectedAt, provisional izi kalır)",
    uygula?.corrected === 1 && s2.endSource === "SIGNAL" && s2.endedAt?.getTime() === endedAt.getTime() && s2.endCorrectedAt !== null && s2.provisionalEndedAt !== null,
    JSON.stringify(uygula));
  const lu = await bekleyen(m[2]);
  check("§7g uygulanan geciken kapanış panel listesinden düşer", lu.length === 0, String(lu));
}

function statikBolum(): void {
  console.log("\n§8 — statik");
  const src = readFileSync(join(__dirname, "../src/services/machine-watchdog.service.ts"), "utf8").replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
  check("§8a watchdog duruş AÇMAZ (create/openStopCore/openMachineStop yok)", !/machineStopEvent\.(create|upsert)|openStopCore|openMachineStop/.test(src));
  const liste = readFileSync(join(__dirname, "../src/services/loom-list.service.ts"), "utf8");
  check("§8c yüklem tek kaynak: watchdog kuyruğu `LATE_STOP_END_WHERE`, panel listesi `WATCHDOG_PENDING_END_WHERE` (kopya yüklem yok)",
    /LATE_STOP_END_WHERE/.test(src) && !/lateEndedAt:\s*\{\s*not/.test(src) && /pendingEndOnly \? WATCHDOG_PENDING_END_WHERE/.test(liste));
  check("§8b watchdog duruşu doğrudan yazmaz — kapanış yalnız `closeStopCore`", !/machineStopEvent\.update|UPDATE machine_stop_events/.test(src) && /closeStopCore\(/.test(src));
}

async function cleanup(): Promise<void> {
  try {
    for (const [key, value] of ilk) {
      if (value === undefined) await prisma.systemSetting.deleteMany({ where: { key } });
      else await prisma.systemSetting.update({ where: { key }, data: { value: value as never } });
    }
    invalidateFeatureFlagsCache();
    // Fikstür temizliği (üretim yolu değil).
    await prisma.loomAlarm.deleteMany({ where: { machineId: { in: ids.machines } } });
    await prisma.machineStopEvent.deleteMany({ where: { machineId: { in: ids.machines } } });
    if (ids.stat) await prisma.machineShiftStat.deleteMany({ where: { id: ids.stat } });
    if (ids.shift) await prisma.shiftInstance.deleteMany({ where: { id: ids.shift } });
    if (ids.shiftDef) await prisma.shiftDefinition.deleteMany({ where: { id: ids.shiftDef } });
    await prisma.machineCollector.deleteMany({ where: { OR: [{ id: { in: ids.collectors } }, { collectorType: TYPE }] } });
    await prisma.machine.deleteMany({ where: { id: { in: ids.machines } } });
    if (ids.station) await prisma.station.deleteMany({ where: { id: ids.station } });
  } catch (e) {
    fail++;
    console.error("❌ temizlik hatası (kalıntı büyür):", (e as Error).message);
  }
}

async function main(): Promise<void> {
  console.log("\n=== Makine kartı watchdog'u — sessizlik + geçici kapanış + düzeltme ===");
  setShortCredentialKeyDirForTests(anahtarDizini);
  resetCollectorAuthStateForTests();
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: YONETILEN } }, select: { key: true, value: true } });
  for (const k of YONETILEN) ilk.set(k, rows.find((r) => r.key === k)?.value ?? undefined);
  for (const k of [SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.TEZGAH_ENABLED, SETTING_KEYS.DOKUMA_ENABLED]) await setting(k, true);
  await setting(SETTING_KEYS.TEZGAH_MAX_OPEN_STOP_HOURS, 12);
  await setting(SETTING_KEYS.TEZGAH_COLLECTOR_SILENCE_MINUTES, 10);
  ids.station = (await prisma.station.create({
    data: { name: `TEST-MWD-HOL-${ek}`, code: `TEST-MWD-H-${ek}`.toUpperCase().slice(0, 32), type: "INTERNAL", kind: "WEAVING", isActive: true },
  })).id;
  const server: Server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const cred = await ensureTestAdmin();
    const login = await api("POST", "/api/auth/login", { username: cred.username, password: cred.password });
    token = String(login.body.data?.token ?? "");
    const m = [await makine(1), await makine(2), await makine(3)];
    const reg = await api("POST", "/api/machine-collectors", { name: `TEST MWD ${ek}`, collectorType: TYPE, machineIds: [m[0], m[2]] });
    const card: Kart = { id: String(reg.body.data?.collector?.id ?? ""), secret: String(reg.body.data?.secret ?? "") };
    if (card.id) ids.collectors.push(card.id);
    check("§0 fikstür: kart kaydı 201", reg.status === 201 && /^[0-9a-f]{64}$/.test(card.secret), `${reg.status}`);
    const issued = await prisma.machineCollector.findUniqueOrThrow({ where: { id: card.id }, select: { secretIssuedAt: true } });
    await sessizlikBolumu(card, m, issued.secretIssuedAt!);
    await nabizBolumu(card);
    await modulBolumu(card);
    const k = await kapanisBolumu(card, m);
    await duzeltmeBolumu(card, m, k);
    await muhurBolumu(card, m);
  } catch (e) {
    fail++;
    console.error("❌ beklenmeyen hata:", e);
  } finally {
    await new Promise((r) => server.close(() => r(undefined)));
  }
  statikBolum();
}

main()
  .catch((e) => { fail++; console.error(e); })
  .finally(async () => {
    await cleanup();
    setShortCredentialKeyDirForTests(null);
    rmSync(anahtarDizini, { recursive: true, force: true });
    console.log(`\nSonuç: ${pass} geçti, ${fail} kaldı`);
    await prisma.$disconnect();
    await pool.end().catch(() => undefined);
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
