// =============================================================================
// Bekçi: MAKİNE KAYNAKLI DURUŞ — tek yazma boğazı, kapanış semantiği, kaynaktan bağımsız alarm
// Çalıştır: npx tsx scripts/test_makine_durus_bogazi.ts
// =============================================================================
// Kart (toplayıcı) duruşu ve bitişini otomatik bildirir; insan yalnız müdahale eder. İkisi aynı
// çekirdekten (`openStopCore` · `closeStopCore`) geçer ve alarm motoru kaynağa bakmaz.
//   §1 makine açılışı: kaynak/ham kod/sinyal yazılır, kişi alanları NULL, sınıflandırma borcu doğar
//   §2 giriş kapıları: replay aynı satır · aynı anahtar başka yük 409 · insan kaynağı 400 · damga zorunlu/aralık · anahtar UUID
//   §3 alarm: sebepsiz makine duruşu sebepsiz hedefle alarm doğurur; makine kapanışı alarmı RESOLVED yapar
//   §4 makine kapanışı: endSource SIGNAL, kapatan NULL · aynı bitiş replay · başka bitiş 409 STOP_END_CONFLICT
//   §5 insan önce kapattıysa makine sinyali insan kapanışını EZMEZ (409 STOP_CLOSED_BY_OPERATOR)
//   §6 insan açık duruşu varken makine açılışı 409 STOP_ALREADY_OPEN (sed) · geri alınmış duruş 409 STOP_REVOKED
//   §7 TEK BOĞAZ (statik): `machineStopEvent.create` ve kapanış UPDATE'i src/'de birer kez, çekirdekte; sinyal servisi yazmaz
// Negatif sondalar (kırmızı görüldü, geri alındı): `signalCloseConflict`te OPERATOR dalı replay döndürdü → §5a ·
// sinyal servisine doğrudan `machineStopEvent.create` → §7a+§7c · `openStopCore`dan `...(input.signal ?? {})`
// kaldırıldı → §1a · `resolveStopStamp` beyan kümesinden MACHINE/SIMULATED çıkarıldı → §2d+§2e.
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import { invalidateFeatureFlagsCache, SETTING_KEYS } from "../src/services/system-setting.service";
import { closeManualStop, openManualStop, revokeStop, STOP_CLOSE_REPLAY_MESSAGE, STOP_REPLAY_MESSAGE } from "../src/services/machine-stop.service";
import { closeMachineStop, openMachineStop } from "../src/services/machine-stop-signal.service";
import { runLoomAlarmOnce } from "../src/services/loom-alarm.service";
import { testActorId } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}
const MIN = 60_000;
const ek = Date.now().toString(36);
const ids = { station: "", machines: [] as string[] };
const YONETILEN = [SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.TEZGAH_ENABLED, SETTING_KEYS.TEZGAH_ALARM_UNCLASSIFIED_ENABLED, SETTING_KEYS.TEZGAH_ALARM_UNCLASSIFIED_TARGET_MINUTES, SETTING_KEYS.TEZGAH_ALARM_NO_SHIFT_MODE];
const ilk = new Map<string, unknown>();

async function ayarYaz(key: string, value: boolean | number | string): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/** Hata kodu (`details.code`) ve durum; hata yoksa "ok". */
async function kod(p: Promise<unknown>): Promise<string> {
  try { await p; return "ok"; } catch (e) {
    const err = e as { statusCode?: number; details?: { code?: string } };
    return `${err.statusCode ?? "?"}:${err.details?.code ?? (e as Error).message}`;
  }
}

async function makine(n: number): Promise<string> {
  const m = await prisma.machine.create({ data: { stationId: ids.station, name: `TEST-MDB-T${n}-${ek}`, code: `TEST-MDB-T${n}-${ek}`.toUpperCase().slice(0, 32), isActive: true } });
  ids.machines.push(m.id);
  return m.id;
}

async function makineBolumu(): Promise<void> {
  const now = new Date();
  const m1 = await makine(1);
  const key = randomUUID();
  const startedAt = new Date(now.getTime() - 30 * MIN);
  const base = { machineId: m1, stopKey: key, startedAt, source: "MACHINE" as const, signalKind: "WARP_STOP" as const, rawStopCode: " E-17 " };

  console.log("\n§1 — makine açılışı");
  const o = await openMachineStop(base);
  const d = o.data;
  check("§1a kaynak MACHINE · ham kod kırpılıp çevrilmeden · sinyal türü yazılır", d.source === "MACHINE" && d.rawStopCode === "E-17" && d.signalKind === "WARP_STOP", `${d.source} ${d.rawStopCode} ${d.signalKind}`);
  check("§1b kişi alanları NULL (açan · sınıflayan), sebep yok, sınıflandırma borcu doğar", d.openedById === null && d.classifiedById === null && d.reasonCode === null && d.requiresReason === true);

  console.log("\n§2 — giriş kapıları");
  const again = await openMachineStop(base);
  check("§2a aynı anahtar + aynı yük → aynı satır (replay)", again.data.id === d.id && again.message === STOP_REPLAY_MESSAGE);
  check("§2b aynı anahtar + başka ham kod → 409 CLIENT_TOKEN_COLLISION", (await kod(openMachineStop({ ...base, rawStopCode: "E-99" }))) === "409:CLIENT_TOKEN_COLLISION");
  check("§2c insan kaynağı makine yolundan yazılamaz → 400", (await kod(openMachineStop({ ...base, stopKey: randomUUID(), source: "OPERATOR" as never }))) === "400:STOP_SOURCE_INVALID");
  check("§2d damgasız makine sinyali → 400 STOP_STAMP_REQUIRED", (await kod(openMachineStop({ ...base, stopKey: randomUUID(), startedAt: null as never }))) === "400:STOP_STAMP_REQUIRED");
  check("§2e aralık dışı damga sessizce düzeltilmez → 400", (await kod(openMachineStop({ ...base, stopKey: randomUUID(), startedAt: new Date(now.getTime() - 8 * 24 * 60 * MIN) }))) === "400:STOP_STAMP_OUT_OF_RANGE");
  check("§2f anahtar UUID değilse → 400", (await kod(openMachineStop({ ...base, stopKey: "kart-1" }))) === "400:STOP_KEY_INVALID");

  console.log("\n§3 — alarm motoru kaynaktan bağımsız");
  // Sebepsiz hedef yalnız tezgah modülü açıkken çözülür; global alarm bayrağı KAPALI kalır (tur `enabled` enjekte eder).
  await ayarYaz(SETTING_KEYS.PRODUCTION_ENABLED, true);
  await ayarYaz(SETTING_KEYS.TEZGAH_ENABLED, true);
  await ayarYaz(SETTING_KEYS.TEZGAH_ALARM_UNCLASSIFIED_ENABLED, true);
  await ayarYaz(SETTING_KEYS.TEZGAH_ALARM_UNCLASSIFIED_TARGET_MINUTES, 15);
  await ayarYaz(SETTING_KEYS.TEZGAH_ALARM_NO_SHIFT_MODE, "ALWAYS");
  invalidateFeatureFlagsCache();
  await runLoomAlarmOnce({ now, onlyMachineIds: [m1], enabled: true });
  const alarm = await prisma.loomAlarm.findUnique({ where: { stopEventId: d.id }, select: { state: true, targetMinutes: true } });
  check("§3a sebepsiz makine duruşu sebepsiz hedefle alarm doğurur", alarm?.state === "OPEN" && alarm.targetMinutes === 15, JSON.stringify(alarm));

  console.log("\n§4 — makine kapanışı");
  const endedAt = new Date(now.getTime() - 2 * MIN);
  const c = await closeMachineStop({ machineId: m1, stopKey: key, endedAt, source: "MACHINE" });
  check("§4a endSource SIGNAL · kapatan NULL · süre hesaplanır", c.data.endSource === "SIGNAL" && c.data.closedById === null && c.data.durationSec === 28 * 60, `${c.data.endSource} ${c.data.durationSec}`);
  await runLoomAlarmOnce({ now, onlyMachineIds: [m1], enabled: true });
  const alarm2 = await prisma.loomAlarm.findUnique({ where: { stopEventId: d.id }, select: { state: true } });
  check("§4b makine kapanışı alarmı aynı motorla RESOLVED yapar", alarm2?.state === "RESOLVED", alarm2?.state ?? "yok");
  const rep = await closeMachineStop({ machineId: m1, stopKey: key, endedAt, source: "MACHINE" });
  check("§4c aynı bitişin tekrarı replay — satır değişmez", rep.message === STOP_CLOSE_REPLAY_MESSAGE && rep.data.endedAt?.getTime() === endedAt.getTime());
  check("§4d başka bitiş → 409 STOP_END_CONFLICT", (await kod(closeMachineStop({ machineId: m1, stopKey: key, endedAt: new Date(now.getTime() - MIN), source: "MACHINE" }))) === "409:STOP_END_CONFLICT");
  check("§4e anahtarı olmayan kapanış → 404", (await kod(closeMachineStop({ machineId: m1, stopKey: randomUUID(), endedAt, source: "MACHINE" }))) === "404:STOP_NOT_FOUND");
}

async function insanBolumu(): Promise<void> {
  const now = new Date();
  const actor = await testActorId();
  console.log("\n§5 — insan kapanışı korunur");
  const m2 = await makine(2);
  const key = randomUUID();
  const o = await openMachineStop({ machineId: m2, stopKey: key, startedAt: new Date(now.getTime() - 20 * MIN), source: "MACHINE" });
  const human = await closeManualStop(o.data.id, null, actor, "OPERATOR");
  const r = await kod(closeMachineStop({ machineId: m2, stopKey: key, endedAt: new Date(), source: "MACHINE" }));
  const fresh = await prisma.machineStopEvent.findUniqueOrThrow({ where: { id: o.data.id }, select: { endedAt: true, endSource: true, closedById: true } });
  check("§5a insan 'Çalıştı' dedikten sonra makine sinyali → 409 STOP_CLOSED_BY_OPERATOR", r === "409:STOP_CLOSED_BY_OPERATOR", r);
  check("§5b insanın bitişi ve kapatanı değişmez", fresh.endSource === "OPERATOR" && fresh.closedById === actor && fresh.endedAt?.getTime() === human.data.endedAt?.getTime());

  console.log("\n§6 — sed ve geri alma");
  const m3 = await makine(3);
  await openManualStop({ machineId: m3, source: "OPERATOR", startedAt: new Date(now.getTime() - 5 * MIN) }, actor);
  check("§6a insan açık duruşu varken makine açılışı → 409 STOP_ALREADY_OPEN", (await kod(openMachineStop({ machineId: m3, stopKey: randomUUID(), startedAt: new Date(now.getTime() - MIN), source: "MACHINE" }))) === "409:STOP_ALREADY_OPEN");
  const m4 = await makine(4);
  const k4 = randomUUID();
  const o4 = await openMachineStop({ machineId: m4, stopKey: k4, startedAt: new Date(now.getTime() - 10 * MIN), source: "SIMULATED" });
  await revokeStop(o4.data.id, "hayalet sinyal", actor);
  check("§6b geri alınmış makine duruşunun kapanışı → 409 STOP_REVOKED", (await kod(closeMachineStop({ machineId: m4, stopKey: k4, endedAt: new Date(), source: "SIMULATED" }))) === "409:STOP_REVOKED");
  check("§6c geri alınmış duruşun yeniden gönderimi açmaz → 409 STOP_REVOKED", (await kod(openMachineStop({ machineId: m4, stopKey: k4, startedAt: o4.data.startedAt, source: "SIMULATED" }))) === "409:STOP_REVOKED");
}

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (n.endsWith(".ts")) out.push(p);
  }
  return out;
}

function statikBolum(): void {
  console.log("\n§7 — tek boğaz (statik)");
  const kok = join(__dirname, "..");
  const yorumsuz = (f: string) => readFileSync(f, "utf8").replace(/^\s*(\/\/|\*).*$/gm, "");
  const create: string[] = [];
  const kapanis: string[] = [];
  const duzeltme: string[] = [];
  for (const f of tsFiles(join(kok, "src"))) {
    const s = yorumsuz(f);
    for (const _ of s.matchAll(/machineStopEvent\s*\.\s*(create|createMany|upsert)\s*\(/g)) create.push(relative(kok, f));
    for (const t of s.matchAll(/`[^`]*`/g)) {
      if (!(/UPDATE\s+"?machine_stop_events"?/i.test(t[0]) && /"endedAt"\s*=/.test(t[0]))) continue;
      // İki meşru biçim: kapanış claim'i (`"endedAt" IS NULL`) ve WATCHDOG düzeltmesi (D4, `'WATCHDOG'` yüklemi).
      if (/'WATCHDOG'/.test(t[0]) && !/"endedAt"\s+IS\s+NULL/i.test(t[0])) duzeltme.push(relative(kok, f));
      else kapanis.push(relative(kok, f));
    }
  }
  const sahip = "src/services/machine-stop.service.ts";
  check("§7a duruş satırını yaratan tek yer çekirdek (machine-stop.service, bir kez)", create.length === 1 && create[0] === sahip, create.join(", ") || "yok");
  check("§7b kapanış UPDATE'i tek yer (machine-stop.service, bir kez)", kapanis.length === 1 && kapanis[0] === sahip, kapanis.join(", ") || "yok");
  // Düzeltme UPDATE'i servisin satır tavanı yüzünden yardımcıda; yardımcıyı yalnız çekirdek çağırır (§7b3).
  const duzeltmeSahibi = "src/services/helpers/machine-stop-watchdog.helper.ts";
  check("§7b2 WATCHDOG düzeltme UPDATE'i tek yer (machine-stop-watchdog.helper, bir kez)", duzeltme.length === 1 && duzeltme[0] === duzeltmeSahibi, duzeltme.join(", ") || "yok");
  const cagiran = tsFiles(join(kok, "src")).filter((f) => /correctWatchdogCloseTx\(/.test(yorumsuz(f))).map((f) => relative(kok, f)).filter((f) => f !== duzeltmeSahibi);
  check("§7b3 düzeltme yardımcısını yalnız çekirdek çağırır (machine-stop.service)", cagiran.length === 1 && cagiran[0] === sahip, cagiran.join(", ") || "yok");
  const sinyal = yorumsuz(join(kok, "src/services/machine-stop-signal.service.ts"));
  const yazar = /machineStopEvent\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(|\$executeRaw|\$queryRaw/.test(sinyal);
  check("§7c sinyal servisi DB'ye yazmaz, çekirdeği çağırır", !yazar && /openStopCore\(/.test(sinyal) && /closeStopCore\(/.test(sinyal));
  const servis = yorumsuz(join(kok, sahip));
  const insanAc = servis.slice(servis.indexOf("export async function openManualStop"), servis.indexOf("export async function openStopCore"));
  const insanKapa = servis.slice(servis.indexOf("export async function closeManualStop"), servis.indexOf("export async function closeStopCore"));
  check("§7d insan girişi de aynı çekirdekten geçer", /openStopCore\(/.test(insanAc) && /closeStopCore\(/.test(insanKapa));
}

async function cleanup(): Promise<void> {
  try {
    for (const [key, value] of ilk) {
      if (value === undefined) await prisma.systemSetting.deleteMany({ where: { key } });
      else await prisma.systemSetting.update({ where: { key }, data: { value: value as never } });
    }
    invalidateFeatureFlagsCache();
    // Fikstür temizliği (üretim yolu değil): alarm silinir (olaylar kaskatla), insan kararı null'lanır, satır silinir.
    await prisma.loomAlarm.deleteMany({ where: { machineId: { in: ids.machines } } });
    const sid = (await prisma.machineStopEvent.findMany({ where: { machineId: { in: ids.machines } }, select: { id: true } })).map((s) => s.id);
    await prisma.machineStopEvent.updateMany({ where: { id: { in: sid } }, data: { classifiedById: null, reasonSource: null } });
    await prisma.machineStopEvent.deleteMany({ where: { id: { in: sid } } });
    await prisma.machine.deleteMany({ where: { id: { in: ids.machines } } });
    if (ids.station) await prisma.station.deleteMany({ where: { id: ids.station } });
  } catch (e) {
    fail++;
    console.error("❌ temizlik hatası (kalıntı büyür):", (e as Error).message);
  }
}

async function main(): Promise<void> {
  console.log("\n=== Makine kaynaklı duruş — tek boğaz ===");
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: YONETILEN } }, select: { key: true, value: true } });
  for (const k of YONETILEN) ilk.set(k, rows.find((r) => r.key === k)?.value ?? undefined);
  ids.station = (await prisma.station.create({
    data: { name: `TEST-MDB-HOL-${ek}`, code: `TEST-MDB-H-${ek}`.toUpperCase().slice(0, 32), type: "INTERNAL", kind: "WEAVING", isActive: true },
  })).id;
  try {
    await makineBolumu();
    await insanBolumu();
  } catch (e) {
    fail++;
    console.error("❌ beklenmeyen hata:", e);
  }
  statikBolum();
}

main()
  .catch((e) => { fail++; console.error(e); })
  .finally(async () => {
    await cleanup();
    console.log(`\nSonuç: ${pass} geçti, ${fail} kaldı`);
    await prisma.$disconnect();
    await pool.end().catch(() => undefined);
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
