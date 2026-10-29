// =============================================================================
// BEKÇİ — Makine duruşu dokumasız rejim kapısı (D4-A1, ister 5.5; DALGA4 §2, 1e K1)
// =============================================================================
// SORU: Rejim `dokuma ∨ (üretim ∧ uretim.makineDurusTakibi)` TEK yüklemden mi okunuyor, ve
//   ① dokuma açık kurulumda duruş listesi ayar KAPALI/AÇIK'ta bayt-aynı mı (snapshot; servis + HTTP),
//   ② dokuma kapalı + ayar kapalı → 403 MODULE_DISABLED (bugünkü dokuma kapısının gövdesi),
//   ③ dokuma kapalı + ayar açık → PROCESS_QC/TAMBUR makinesine aç/kapa 201/200; tezgah 403; RAW_QC 400;
//      liste tezgah duruşunu göstermez, `stationKind` süzgeci sunucuda, bilinmeyen tür 400,
//   ④ üretim kapalıyken ayar açık olsa da 403 (ön koşul),
//   ⑤ vardiya takvimi rejimle koşar (ayar kapalı + dokuma kapalı → "disabled"),
//   ⑥ AST: ayar okuyucusu YALNIZ `machineStopRegime` + panel geri-okumasında (ikinci rejim yüklemi yok);
//      rota/servis/liste tek helper'ı çağırır.
// NEGATİF SONDALAR (2026-10-29, D4-A1):
//   S1 `machineStopRegime`den ayar kolu silindi (`general = false`) → §3 kırmızı.
//   S2 `loom-list.service.ts`e ikinci rejim yüklemi (readMachineStopTrackingEnabled çağrısı) → §6a kırmızı.
// Global durum yazar (SystemSetting): `hedefDbEngeli()` ilk adım; üç ayar satırı birebir geri yüklenir.
// =============================================================================
import type { Server } from "http";
import type { AddressInfo } from "net";
import { randomUUID } from "crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";
import { Prisma, StationKind } from "@prisma/client";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { listMachineStops } from "../src/services/loom-list.service";
import { closeManualStop, openManualStop } from "../src/services/machine-stop.service";
import { runShiftCalendarOnce } from "../src/jobs/shift-calendar.job";
import { ensureTestAdmin, testActorId } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const SRC = join(__dirname, "..", "src");
const ek = `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const KEYS = [SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.MACHINE_STOP_TRACKING_ENABLED] as const;
const saved = new Map<string, { value: Prisma.JsonValue; description: string | null } | null>();
const ids = { stations: [] as string[], machines: [] as string[] };

async function setSetting(key: string, value: boolean): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value, description: "TEST makine duruşu rejimi" }, update: { value } });
}

async function fixtureMachine(kind: StationKind, tag: string): Promise<string> {
  const station = await prisma.station.create({
    data: { name: `TEST-MDR-${tag}-${ek}`, code: `TEST-MDR-${tag}-${ek}`.slice(0, 32), type: "INTERNAL", kind, isActive: true },
  });
  ids.stations.push(station.id);
  const m = await prisma.machine.create({ data: { stationId: station.id, name: `TEST-MDR-M-${tag}-${ek}`, code: `TEST-MDR-M${tag}-${ek}`.slice(0, 32), isActive: true } });
  ids.machines.push(m.id);
  return m.id;
}

type Res = { status: number; body: { success?: boolean; data?: unknown; message?: string; details?: { code?: string; modul?: string } } };

/** Çağrı yerinin kapsayan fonksiyon adı (AST) — "dosya#fonksiyon". */
function callSites(name: string): string[] {
  const out: string[] = [];
  const walkDir = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkDir(join(d, e.name)) : e.name.endsWith(".ts") ? [join(d, e.name)] : []));
  for (const file of walkDir(SRC)) {
    const text = readFileSync(file, "utf8");
    if (!text.includes(name)) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (n: ts.Node): void => {
      if (ts.isIdentifier(n) && n.text === name && !ts.isImportSpecifier(n.parent) && !(ts.isFunctionDeclaration(n.parent) && n.parent.name === n)) {
        let p: ts.Node | undefined = n.parent;
        let fn = "<modül>";
        while (p) {
          if ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) && p.name) { fn = p.name.getText(); break; }
          p = p.parent;
        }
        out.push(`${relative(SRC, file).split("\\").join("/")}#${fn}`);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  for (const key of KEYS) {
    const row = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true, description: true } });
    saved.set(key, row ? { value: row.value, description: row.description } : null);
  }

  const server: Server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let token = "";
  const call = async (method: string, path: string, body?: unknown): Promise<Res & { raw: string }> => {
    const r = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const raw = await r.text();
    let parsed: Res["body"] = {};
    try { parsed = JSON.parse(raw) as Res["body"]; } catch { /* boş gövde */ }
    return { status: r.status, body: parsed, raw };
  };

  try {
    const actor = await testActorId();
    const cred = await ensureTestAdmin();
    const login = await call("POST", "/api/auth/login", { username: cred.username, password: cred.password });
    token = String((login.body.data as { token?: string } | undefined)?.token ?? "");
    check("§0 login", login.status === 200 && token.length > 20, `status=${login.status}`);

    const qc = await fixtureMachine(StationKind.PROCESS_QC, "QC");
    const tambur = await fixtureMachine(StationKind.TAMBUR, "TB");
    const raw = await fixtureMachine(StationKind.RAW_QC, "RQ");
    const loom = await fixtureMachine(StationKind.WEAVING, "WV");

    // ── §1 dokuma AÇIK: ayar OFF/ON bayt-aynı (gizli bulgu korunur: API WEAVING dışı makineye de açtırır) ──
    await setSetting(SETTING_KEYS.PRODUCTION_ENABLED, true);
    await setSetting(SETTING_KEYS.DOKUMA_ENABLED, true);
    await setSetting(SETTING_KEYS.MACHINE_STOP_TRACKING_ENABLED, false);
    const loomStop = await openManualStop({ machineId: loom, startedAt: new Date(Date.now() - 3600_000), clientToken: randomUUID(), source: "SUPERVISOR" }, actor);
    const rawStop = await openManualStop({ machineId: raw, startedAt: new Date(Date.now() - 3600_000), clientToken: randomUUID(), source: "SUPERVISOR" }, actor);
    check("§1a dokuma açık + ayar kapalı: RAW_QC makinesine duruş açılır (bugünkü davranış)", rawStop.success === true && Boolean(rawStop.data?.id));
    const snapArgs = [{ limit: 500 }, { openOnly: true, limit: 500 }, { machineId: loom }, { machineId: raw }] as const;
    const svcOff = JSON.stringify(await Promise.all(snapArgs.map((a) => listMachineStops({ ...a }))));
    const httpOff = [(await call("GET", "/api/machine-stops?limit=500")).raw, (await call("GET", `/api/machine-stops?open=true&machineId=${raw}`)).raw];
    await setSetting(SETTING_KEYS.MACHINE_STOP_TRACKING_ENABLED, true);
    const svcOn = JSON.stringify(await Promise.all(snapArgs.map((a) => listMachineStops({ ...a }))));
    const httpOn = [(await call("GET", "/api/machine-stops?limit=500")).raw, (await call("GET", `/api/machine-stops?open=true&machineId=${raw}`)).raw];
    check("§1b ⭐ servis listesi (4 varyant) ayar OFF/ON bayt-aynı", svcOff === svcOn && svcOff.includes(loomStop.data.id) && svcOff.includes(rawStop.data.id), `${svcOff.length} bayt`);
    check("§1c ⭐ HTTP GET /api/machine-stops ayar OFF/ON bayt-aynı", httpOff.join("|") === httpOn.join("|") && httpOff[0].includes(loomStop.data.id), `${httpOff[0].length} bayt`);
    await closeManualStop(loomStop.data.id, null, actor, "SUPERVISOR");
    await closeManualStop(rawStop.data.id, null, actor, "SUPERVISOR");

    // ── §2 dokuma KAPALI + ayar KAPALI → bugünkü 403 ──
    await setSetting(SETTING_KEYS.DOKUMA_ENABLED, false);
    await setSetting(SETTING_KEYS.MACHINE_STOP_TRACKING_ENABLED, false);
    const g403 = await call("GET", "/api/machine-stops");
    const p403 = await call("POST", "/api/machine-stops", { machineId: qc, clientToken: randomUUID() });
    check("§2a ⭐ GET 403 MODULE_DISABLED (modul dokuma)", g403.status === 403 && g403.body.details?.code === "MODULE_DISABLED" && g403.body.details?.modul === "dokuma", `status=${g403.status} code=${g403.body.details?.code}`);
    check("§2b POST (PROCESS_QC) 403 MODULE_DISABLED — ayar kapalıyken kapı bugünkü", p403.status === 403 && p403.body.details?.code === "MODULE_DISABLED", `status=${p403.status}`);
    check("§2c 403 gövdesi dokuma kapısının bugünkü mesajı", /Dokuma iş emri modülü bu kurulumda kapalı/.test(g403.body.message ?? ""), g403.body.message);
    check("§5a vardiya takvimi: dokuma + ayar kapalı → disabled", (await runShiftCalendarOnce({ onlyDefinitionIds: [] })) === "disabled");

    // ── §3 dokuma KAPALI + ayar AÇIK → genel rejim ──
    await setSetting(SETTING_KEYS.MACHINE_STOP_TRACKING_ENABLED, true);
    check("§5b vardiya takvimi: ayar açık → koşar (disabled değil)", (await runShiftCalendarOnce({ onlyDefinitionIds: [] })) !== "disabled");
    const o1 = await call("POST", "/api/machine-stops", { machineId: qc, clientToken: randomUUID() });
    const qcStopId = String((o1.body.data as { id?: string } | undefined)?.id ?? "");
    check("§3a ⭐ PROCESS_QC makinesi: aç 201", o1.status === 201 && qcStopId.length > 0, `status=${o1.status} ${o1.body.message ?? ""}`);
    const c1 = qcStopId ? await call("POST", `/api/machine-stops/${qcStopId}/close`, {}) : { status: 0, body: {}, raw: "" };
    check("§3b ⭐ PROCESS_QC makinesi: kapa 200", c1.status === 200, `status=${c1.status}`);
    const o2 = await call("POST", "/api/machine-stops", { machineId: tambur, clientToken: randomUUID() });
    const tbStopId = String((o2.body.data as { id?: string } | undefined)?.id ?? "");
    check("§3c TAMBUR makinesi: aç 201", o2.status === 201, `status=${o2.status}`);
    const o3 = await call("POST", "/api/machine-stops", { machineId: raw, clientToken: randomUUID() });
    check("§3d ⭐ desteklenmeyen tür (RAW_QC) → 400 STOP_STATION_KIND_UNSUPPORTED", o3.status === 400 && o3.body.details?.code === "STOP_STATION_KIND_UNSUPPORTED", `status=${o3.status} code=${o3.body.details?.code}`);
    const o4 = await call("POST", "/api/machine-stops", { machineId: loom, clientToken: randomUUID() });
    check("§3e tezgah (WEAVING) dokuma kapalıyken → 403 MODULE_DISABLED", o4.status === 403 && o4.body.details?.code === "MODULE_DISABLED", `status=${o4.status}`);
    const list = await call("GET", "/api/machine-stops?limit=500");
    const listIds = new Set(((list.body.data ?? []) as Array<{ id: string }>).map((r) => r.id));
    check("§3f liste 200: genel rejim duruşu görünür, tezgah duruşu kapsam dışı", list.status === 200 && listIds.has(qcStopId) && !listIds.has(loomStop.data.id), `n=${listIds.size}`);
    const tbOnly = await call("GET", "/api/machine-stops?limit=500&stationKind=TAMBUR");
    const tbRows = (tbOnly.body.data ?? []) as Array<{ id: string }>;
    check("§3g stationKind=TAMBUR süzgeci sunucuda", tbOnly.status === 200 && tbRows.some((r) => r.id === tbStopId) && !tbRows.some((r) => r.id === qcStopId), `n=${tbRows.length}`);
    const bad = await call("GET", "/api/machine-stops?stationKind=XYZ");
    check("§3h bilinmeyen stationKind → 400", bad.status === 400, `status=${bad.status}`);
    if (tbStopId) await call("POST", `/api/machine-stops/${tbStopId}/close`, {});

    // ── §4 üretim KAPALI → ayar açık olsa da 403 (ön koşul) ──
    await setSetting(SETTING_KEYS.PRODUCTION_ENABLED, false);
    const p4 = await call("GET", "/api/machine-stops");
    check("§4 üretim kapalı + ayar açık → 403 MODULE_DISABLED (modul production)", p4.status === 403 && p4.body.details?.modul === "production", `status=${p4.status} modul=${p4.body.details?.modul}`);
    await new Promise<void>((r) => server.close(() => r()));
  } catch (e) {
    await new Promise<void>((r) => server.close(() => r()));
    throw e;
  }

  // ── §6 AST: TEK rejim yüklemi ──
  const sites = callSites("readMachineStopTrackingEnabled").sort();
  const allowed = ["services/helpers/machine-stop-regime.helper.ts#machineStopRegime", "services/system-setting.service.ts#getFeatureFlags"];
  check("§6a ⭐ ayar okuyucusu yalnız machineStopRegime + panel geri-okumasında (ikinci rejim yüklemi yok)", sites.every((s) => allowed.includes(s)) && allowed.every((a) => sites.includes(a)), sites.join(" | "));
  const keySites = callSites("MACHINE_STOP_TRACKING_ENABLED");
  check("§6b ayar anahtarı yalnız system-setting.service'te", keySites.length >= 2 && keySites.every((s) => s.startsWith("services/system-setting.service.ts#")), keySites.join(" | "));
  const route = readFileSync(join(SRC, "routes/machine-stop.routes.ts"), "utf8");
  check("§6c rota kapısı requireMachineStopRegime (requireDokumaEnabled değil) + tablet izni", /router\.use\(verifyToken, requireMachineStopRegime\)/.test(route) && !/requireDokumaEnabled/.test(route) && /MOBILE_DOKUMA = \["mobile:dokuma", "mobile:makine-durus"\]/.test(route));
  check("§6d servis/liste/takvim tek helper'ı çağırır", callSites("assertMachineStopKindAllowed").includes("services/machine-stop.service.ts#openStopCore") &&
    callSites("machineStopScopeWhere").includes("services/loom-list.service.ts#listMachineStops") && callSites("machineStopRegime").includes("jobs/shift-calendar.job.ts#runShiftCalendarOnce"));
}

async function cleanup(): Promise<void> {
  try {
    const stops = await prisma.machineStopEvent.findMany({ where: { machineId: { in: ids.machines } }, select: { id: true } });
    const sid = stops.map((s) => s.id);
    await prisma.machineStopReclass.deleteMany({ where: { stopEventId: { in: sid } } });
    await prisma.machineStopEvent.updateMany({ where: { id: { in: sid } }, data: { classifiedById: null, reasonSource: null } });
    await prisma.machineStopEvent.deleteMany({ where: { id: { in: sid } } });
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
