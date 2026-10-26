// =============================================================================
// Bekçi: DURUŞU KİM AÇTI / KİM KAPATTI (dokuma alarmı B3)
// Çalıştır: npx tsx scripts/test_durus_acan_kapatan.ts · HTTP ayağı: npx tsx scripts/bekci-http.ts acan_kapatan
// =============================================================================
// `machine_stop_events.openedById/closedById` yalnız insan yolu yazar (elle açma/kapama). Eski satır NULL kalır =
// "bilinmiyor" (backfill yok, audit'ten türetme yasak); sinyal/watchdog NULL bırakır.
//   §1 elle açma açanı, elle kapama kapatanı yazar; kapama açanı ezmez · DTO adları taşır
//   §2 NULL satır (B3 öncesi / sinyal) DTO'da null — uydurulmaz
//   §3 TEK YAZAR (statik): kolonları `src/`+`scripts/` içinde yalnız `machine-stop.service.ts` yazar; migration doldurmaz
//   §4 HTTP: gövdede `openedById` / `closedById` 400 (strict allowlist), aktör token'dan
// Negatif sondalar (kırmızı görüldü, geri alındı): `openedById: userId` satırı silindi → §1a+§3a · `"closedById" =` SET'ten
// çıkarıldı → §1b+§1c+§3a · açma/kapama şemasında `.strict()` → `.passthrough()` → §4a+§4c · scripts/ altında
// `machineStopEvent.updateMany({data:{openedById}})` → §3b · audit'ten dolduran `UPDATE "machine_stop_events" SET "openedById"` migration'ı → §3c.
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import * as bcrypt from "bcryptjs";
import prisma, { pool } from "../src/lib/prisma";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { closeManualStop, openManualStop } from "../src/services/machine-stop.service";
import { MACHINE_STOP_SELECT } from "../src/services/helpers/machine-stop-context.helper";
import { factoryDayKeyUtcMidnight } from "../src/constants/time";
import { testActorId } from "./fixture-test-user";
import { httpBekciKapisi } from "./lib/http-bekci-kapisi";
import { atlamaDefteri } from "./lib/atlama";

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
const ATLAMA = atlamaDefteri(() => { fail++; });
const ek = Date.now().toString(36);
const ids = { station: "", machines: [] as string[], users: [] as string[] };
const ilk = new Map<string, unknown>();

async function makine(n: number): Promise<string> {
  const m = await prisma.machine.create({ data: { stationId: ids.station, name: `TEST-DAK-T${n}-${ek}`, code: `TEST-DAK-T${n}-${ek}`.toUpperCase().slice(0, 32), isActive: true } });
  ids.machines.push(m.id);
  return m.id;
}

async function dbBolumu(): Promise<void> {
  console.log("\n§1-§2 — elle açma/kapama aktörü (DB)");
  const a = await testActorId();
  const b = await prisma.user.create({
    data: { username: `test-dak-b-${ek}`, fullName: `TEST-DAK Kapatan ${ek}`, passwordHash: await bcrypt.hash(randomUUID(), 4), isActive: true },
    select: { id: true, fullName: true },
  });
  ids.users.push(b.id);
  const m1 = await makine(1);
  const opened = await openManualStop({ machineId: m1, startedAt: new Date(Date.now() - 20 * 60_000) }, a);
  check("§1a elle açma açanı yazar, kapatan boş", opened.data.openedById === a && opened.data.closedById === null && opened.data.openedBy !== null, `${opened.data.openedById}`);
  const closed = await closeManualStop(opened.data.id, null, b.id);
  check("§1b elle kapama kapatanı yazar, açanı ezmez", closed.data.closedById === b.id && closed.data.openedById === a, `${closed.data.closedById}`);
  check("§1c DTO kapatanın adını taşır", closed.data.closedBy?.fullName === b.fullName, closed.data.closedBy?.fullName ?? "null");

  const m2 = await makine(2);
  const startedAt = new Date(Date.now() - 40 * 60_000);
  const legacy = await prisma.machineStopEvent.create({
    data: { machineId: m2, stopKey: randomUUID(), startedAt, endedAt: new Date(), factoryDay: factoryDayKeyUtcMidnight(startedAt), source: "MACHINE" },
    select: MACHINE_STOP_SELECT,
  });
  check("§2 aktörsüz satır (B3 öncesi / sinyal) DTO'da null — uydurulmaz", legacy.openedById === null && legacy.closedById === null && legacy.openedBy === null && legacy.closedBy === null);
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

const KOLON = /"?\b(openedById|closedById)\b"?\s*(:\s*(?!true\b)|=)/;
const YAZAN_SQL = /\b(UPDATE\s+"?machine_stop_events"?|INSERT\s+INTO\s+"?machine_stop_events"?)\s/i;
const PRISMA_YAZ = /machineStopEvent\s*\.\s*(create|createMany|update|updateMany|upsert)\s*\(/g;

/** `(`ten dengeli kapanışa kadar argüman metni. */
function argMetni(s: string, acik: number): string {
  let d = 0;
  for (let i = acik; i < s.length; i++) {
    if (s[i] === "(") d++;
    else if (s[i] === ")" && --d === 0) return s.slice(acik, i + 1);
  }
  return s.slice(acik);
}

/** Dosyada `machine_stop_events`e açan/kapatan YAZAN yer var mı (Prisma çağrısı ya da ham SQL şablonu). */
function durusAktorYazar(metin: string): string[] {
  const s = metin.replace(/^\s*(\/\/|\*).*$/gm, "");
  const bulunan = new Set<string>();
  for (const m of s.matchAll(PRISMA_YAZ)) {
    const arg = argMetni(s, (m.index ?? 0) + m[0].length - 1);
    for (const k of arg.matchAll(new RegExp(KOLON, "g"))) bulunan.add(k[1]!);
  }
  for (const t of s.matchAll(/`[^`]*`/g)) {
    if (!YAZAN_SQL.test(t[0])) continue;
    for (const k of t[0].matchAll(new RegExp(KOLON, "g"))) bulunan.add(k[1]!);
  }
  return [...bulunan].sort();
}

function statikBolum(): void {
  console.log("\n§3 — tek yazar (statik)");
  const kok = join(__dirname, "..");
  const taranan = [...tsFiles(join(kok, "src")), ...tsFiles(join(kok, "scripts")).filter((f) => !/[/\\]test_[^/\\]*\.ts$/.test(f))];
  const yazanlar = new Map<string, string[]>();
  for (const f of taranan) {
    const k = durusAktorYazar(readFileSync(f, "utf8"));
    if (k.length) yazanlar.set(relative(kok, f), k);
  }
  const sahip = "src/services/machine-stop.service.ts";
  const sahipKolon = yazanlar.get(sahip) ?? [];
  check("§3a açanı ve kapatanı machine-stop.service yazar", sahipKolon.includes("openedById") && sahipKolon.includes("closedById"), sahipKolon.join(", ") || "yok");
  const yabanci = [...yazanlar.keys()].filter((f) => f !== sahip);
  check("§3b duruş açan/kapatan kolonlarını başka dosya yazmaz", yabanci.length === 0, yabanci.join(", ") || "yok");

  // Eski satır NULL kalır: migration'da (audit'ten ya da başka kaynaktan) geriye doldurma yok.
  const migKok = join(kok, "prisma", "migrations");
  const dolduran: string[] = [];
  for (const d of readdirSync(migKok)) {
    const p = join(migKok, d, "migration.sql");
    try { statSync(p); } catch { continue; }
    const ifadeler = readFileSync(p, "utf8").replace(/--.*$/gm, "").split(";");
    if (ifadeler.some((q) => YAZAN_SQL.test(q) && /"(openedById|closedById)"/.test(q))) dolduran.push(d);
  }
  check("§3c açan/kapatan geriye doldurulmaz (migration'da UPDATE/INSERT yok)", dolduran.length === 0, dolduran.join(", ") || "yok");
}

const BASE = process.env.TEST_API_URL ?? "http://localhost:4112";
const HTTP_CHECKS = 3;
async function call(token: string, url: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const r = await fetch(`${BASE}${url}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
  });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}

async function httpBolumu(): Promise<void> {
  console.log("\n§4 — gövde kapısı (HTTP)");
  const kapi = await httpBekciKapisi({ base: BASE, kontrolSayisi: HTTP_CHECKS });
  if (kapi.kirmizi) { check("§4 HTTP ayağı ölçülebildi", false, kapi.kirmizi); return; }
  if (!kapi.token) { ATLAMA.atla("§4 HTTP", kapi.atlaSebebi ?? "sunucu yok", HTTP_CHECKS); return; }
  for (const key of [SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.DOKUMA_ENABLED]) {
    const cur = await prisma.systemSetting.findUnique({ where: { key } });
    ilk.set(key, cur ? cur.value : undefined);
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value: true }, update: { value: true } });
  }
  const me = await testActorId();
  const m3 = await makine(3);
  const sahte = ids.users[0]!;
  const tok = randomUUID();
  const r1 = await call(kapi.token, "/api/machine-stops", { machineId: m3, clientToken: tok, openedById: sahte });
  const yazildi = await prisma.machineStopEvent.count({ where: { machineId: m3 } });
  check("§4a gövdede openedById → 400, satır yazılmaz", r1.status === 400 && yazildi === 0, `${r1.status} · ${yazildi}`);
  const r2 = await call(kapi.token, "/api/machine-stops", { machineId: m3, clientToken: randomUUID() });
  const row = await prisma.machineStopEvent.findFirst({ where: { machineId: m3 }, select: { id: true, openedById: true } });
  check("§4b geçerli açma → açan token'ın kişisi", r2.status === 201 && row?.openedById === me, `${r2.status} · ${row?.openedById}`);
  const r3 = await call(kapi.token, `/api/machine-stops/${row?.id}/close`, { closedById: sahte });
  const after = await prisma.machineStopEvent.findUnique({ where: { id: row?.id ?? randomUUID() }, select: { endedAt: true, closedById: true } });
  check("§4c gövdede closedById → 400, duruş açık kalır", r3.status === 400 && after?.endedAt === null && after?.closedById === null, `${r3.status}`);
}

async function cleanup(): Promise<void> {
  try {
    for (const [key, value] of ilk) {
      if (value === undefined) await prisma.systemSetting.deleteMany({ where: { key } });
      else await prisma.systemSetting.update({ where: { key }, data: { value: value as never } });
    }
    const stops = await prisma.machineStopEvent.findMany({ where: { machineId: { in: ids.machines } }, select: { id: true } });
    const sid = stops.map((s) => s.id);
    await prisma.loomAlarm.deleteMany({ where: { stopEventId: { in: sid } } }).catch(() => undefined);
    await prisma.machineStopEvent.deleteMany({ where: { id: { in: sid } } });
    await prisma.machine.deleteMany({ where: { id: { in: ids.machines } } });
    if (ids.station) await prisma.station.deleteMany({ where: { id: ids.station } });
    await prisma.systemLog.deleteMany({ where: { userId: { in: ids.users } } }); // _test DB fikstürü; kullanıcının audit izi
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  } catch (e) {
    fail++;
    console.error("❌ temizlik hatası (kalıntı büyür):", (e as Error).message);
  }
}

async function main(): Promise<void> {
  console.log("\n=== Duruşu açan / kapatan (B3) ===");
  ids.station = (await prisma.station.create({
    data: { name: `TEST-DAK-HOL-${ek}`, code: `TEST-DAK-H-${ek}`.toUpperCase().slice(0, 32), type: "INTERNAL", kind: "WEAVING", isActive: true },
  })).id;
  await dbBolumu();
  statikBolum();
  await httpBolumu();
}

main()
  .catch((e) => {
    fail++;
    console.error("❌ Bekçi hata ile durdu:", e);
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
