// =============================================================================
// Bekçi: MAKİNE KARTI — kimlik (D3a) + imzalı duruş ucu (D3b) + sahiplenme (K1)
// =============================================================================
//   §1 kart kaydı: sır bir kez döner (64 hex), DB'de yalnız tohum, okuma yüzeyinde tohum/sır yok,
//      gövde allowlist, tezgah tek karta (409), oturumsuz 401
//   §2 imza kapısı: geçerli imza 201 · bozuk imza · eski damga · nonce tekrarı · başlıksız · gövde
//      değişimi · başka yola taşınan imza → 401; `source` gövdede 400; yabancı tezgah 403; replay 200;
//      kart başına hız sınırı 429
//   §3 kapanış: endSource SIGNAL · aynı bitiş replay · başka bitiş 409 STOP_END_CONFLICT
//   §4 K1: insanın açık duruşu sahiplenilir (açılış insanınki, kart alanları + eşlenen sebep yazılır,
//      audit "sahiplenildi"), tekrar 200 aynı satır, kart kapanışı kapatır
//   §5 K1 kapanış: insan kapattıysa kartın "bitti"si 409 STOP_CLOSED_BY_OPERATOR, kapanış değişmez
//   §6 yenileme/iptal: eski sır 401, yeni sır geçer; iptal sonrası 401 ve bağlar çözülür
//   §7 sır sızıntısı: audit satırlarında sır ve tohum yok
//   §8 statik: kart router'ı verifyToken taşımaz, imza doğrulayıcısını taşır
// Negatif sondalar (kırmızı görüldü, geri alındı): bkz. docs/history/arsiv/2026-10.md (makine duruşu D3).
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
import { closeManualStop, openManualStop } from "../src/services/machine-stop.service";
import { STOP_CLAIM_MESSAGE } from "../src/services/machine-stop-signal.service";
import { collectorSigningInput, signCollectorRequest } from "../src/services/helpers/collector-secret.helper";
import { COLLECTOR_RATE_MAX, resetCollectorAuthStateForTests } from "../src/middlewares/collector-auth.middleware";
import { ensureTestAdmin, testActorId } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}
const MIN = 60_000;
const ek = Date.now().toString(36);
const TYPE = `TEST-MDK-${ek}`.toUpperCase().slice(0, 32);
const ids = { station: "", machines: [] as string[], collectors: [] as string[], presets: [] as string[] };
const YONETILEN = [SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.TEZGAH_ENABLED, SETTING_KEYS.DOKUMA_ENABLED];
const ilk = new Map<string, unknown>();
const anahtarDizini = mkdtempSync(join(tmpdir(), "mdk-halka-"));
const sirlar: string[] = [];

type Yanit = { status: number; body: { data?: Record<string, unknown> & { collector?: Record<string, unknown>; secret?: string }; message?: string; error?: { details?: { code?: string } }; details?: { code?: string } } };
let base = "";
let token = "";

async function api(method: string, path: string, body?: unknown): Promise<Yanit> {
  const r = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Yanit["body"] };
}

interface Imza { id: string; secret: string; path?: string; ts?: number; nonce?: string; signBody?: string; omit?: boolean; sig?: string }

/** Kart isteği — imza protokol belgesindeki biçimle (ham gövde baytı). */
async function kart(path: string, body: unknown, o: Imza): Promise<Yanit & { headers: Record<string, string> }> {
  const raw = JSON.stringify(body);
  const ts = String(o.ts ?? Math.floor(Date.now() / 1000));
  const nonce = o.nonce ?? randomUUID().replace(/-/g, "");
  const input = collectorSigningInput({ method: "POST", path: o.path ?? path, timestamp: ts, nonce, body: Buffer.from(o.signBody ?? raw, "utf8") });
  const headers: Record<string, string> = o.omit ? {} : {
    "x-collector-id": o.id, "x-collector-timestamp": ts, "x-collector-nonce": nonce,
    "x-collector-signature": o.sig ?? signCollectorRequest(Buffer.from(o.secret, "hex"), input),
  };
  const r = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: raw });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Yanit["body"], headers };
}

function hata(r: Yanit): string {
  return `${r.status}:${r.body.error?.details?.code ?? r.body.details?.code ?? ""}`;
}

async function makine(n: number): Promise<string> {
  const m = await prisma.machine.create({ data: { stationId: ids.station, name: `TEST-MDK-T${n}-${ek}`, code: `TEST-MDK-T${n}-${ek}`.toUpperCase().slice(0, 32), isActive: true } });
  ids.machines.push(m.id);
  return m.id;
}

async function kayitBolumu(m: string[]): Promise<{ id: string; secret: string }> {
  console.log("\n§1 — kart kaydı");
  const r = await api("POST", "/api/machine-collectors", { name: `TEST MDK ${ek}`, collectorType: TYPE, machineIds: [m[0], m[1]] });
  const c = r.body.data?.collector ?? {};
  const secret = String(r.body.data?.secret ?? "");
  if (c.id) ids.collectors.push(String(c.id));
  sirlar.push(secret);
  check("§1a kayıt 201 · sır 64 hex · yanıtta tohum yok", r.status === 201 && /^[0-9a-f]{64}$/.test(secret) && !("secretSeed" in c), `${r.status}`);
  const row = await prisma.machineCollector.findUniqueOrThrow({ where: { id: String(c.id) }, select: { secretSeed: true, status: true, collectorType: true } });
  check("§1b DB'de yalnız tohum `<kid>:<64hex>` — sır DB'de yok", /^[0-9a-f]{16}:[0-9a-f]{64}$/.test(row.secretSeed ?? "") && !(row.secretSeed ?? "").includes(secret) && row.status === "APPROVED" && row.collectorType === TYPE);
  const liste = await api("GET", "/api/machine-collectors");
  const detay = await api("GET", `/api/machine-collectors/${String(c.id)}`);
  const metin = JSON.stringify(liste.body) + JSON.stringify(detay.body);
  check("§1c okuma yüzeyinde tohum ve sır yok", liste.status === 200 && detay.status === 200 && !metin.includes("secretSeed") && !metin.includes(secret) && !metin.includes(row.secretSeed!.slice(17)));
  check("§1d tanınmayan alan → 400 (allowlist)", (await api("POST", "/api/machine-collectors", { name: `TEST MDK X ${ek}`, collectorType: TYPE, machineIds: [m[2]], secretSeed: "x" })).status === 400);
  const ikinci = await api("POST", "/api/machine-collectors", { name: `TEST MDK Y ${ek}`, collectorType: TYPE, machineIds: [m[0]] });
  check("§1e bir tezgahın tek kartı olur → 409 MACHINE_ALREADY_LINKED", hata(ikinci) === "409:MACHINE_ALREADY_LINKED", hata(ikinci));
  const t = token;
  token = "";
  check("§1f oturumsuz yönetim isteği → 401", (await api("GET", "/api/machine-collectors")).status === 401);
  token = t;
  return { id: String(c.id), secret };
}

async function imzaBolumu(card: { id: string; secret: string }, m: string[]): Promise<string> {
  console.log("\n§2 — imza kapısı");
  const key = randomUUID();
  const body = { machineId: m[0], stopKey: key, rawStopCode: "E-17", signalKind: "WARP_STOP", startedAt: new Date(Date.now() - 10 * MIN).toISOString() };
  const ok = await kart("/api/machine-signals/stop", body, card);
  const d = ok.body.data ?? {};
  check("§2a geçerli imza → 201, kaynak MACHINE, kart kimliği yazılır, açan yok", ok.status === 201 && d.source === "MACHINE" && d.collectorId === card.id && d.openedById === null && d.rawStopCode === "E-17", `${ok.status} ${String(d.source)}`);
  check("§2b bozuk imza → 401", hata(await kart("/api/machine-signals/stop", body, { ...card, sig: "0".repeat(64) })) === "401:COLLECTOR_AUTH_FAILED");
  check("§2c 10 dk eski damga → 401 COLLECTOR_CLOCK_SKEW", hata(await kart("/api/machine-signals/stop", body, { ...card, ts: Math.floor(Date.now() / 1000) - 600 })) === "401:COLLECTOR_CLOCK_SKEW");
  const tekrar = await fetch(`${base}/api/machine-signals/stop`, { method: "POST", headers: { "Content-Type": "application/json", ...ok.headers }, body: JSON.stringify(body) });
  check("§2d aynı istek (nonce) yeniden → 401 COLLECTOR_NONCE_REPLAY", hata({ status: tekrar.status, body: (await tekrar.json()) as Yanit["body"] }) === "401:COLLECTOR_NONCE_REPLAY");
  check("§2e başlıksız → 401 COLLECTOR_AUTH_HEADERS", hata(await kart("/api/machine-signals/stop", body, { ...card, omit: true })) === "401:COLLECTOR_AUTH_HEADERS");
  check("§2f imzalanandan başka gövde → 401", hata(await kart("/api/machine-signals/stop", body, { ...card, signBody: JSON.stringify({ ...body, rawStopCode: "E-18" }) })) === "401:COLLECTOR_AUTH_FAILED");
  check("§2g başka yol için imza (/end imzası /stop'ta) → 401", hata(await kart("/api/machine-signals/stop", body, { ...card, path: "/api/machine-signals/end" })) === "401:COLLECTOR_AUTH_FAILED");
  const src = await kart("/api/machine-signals/stop", { ...body, stopKey: randomUUID(), source: "OPERATOR" }, card);
  check("§2h gövdede `source` → 400 (kaynak gövdeden alınmaz)", src.status === 400, String(src.status));
  check("§2i karta bağlı olmayan tezgah → 403 MACHINE_NOT_IN_SCOPE", hata(await kart("/api/machine-signals/stop", { ...body, machineId: m[2], stopKey: randomUUID() }, card)) === "403:MACHINE_NOT_IN_SCOPE");
  const rep = await kart("/api/machine-signals/stop", body, card);
  check("§2j aynı stopKey yeni nonce → 200 aynı satır (replay)", rep.status === 200 && rep.body.data?.id === d.id, String(rep.status));
  const coll = await kart("/api/machine-signals/stop", { ...body, rawStopCode: "E-99" }, card);
  check("§2k aynı stopKey başka yük → 409 CLIENT_TOKEN_COLLISION", hata(coll) === "409:CLIENT_TOKEN_COLLISION", hata(coll));
  const sahte = { id: randomUUID(), secret: "00".repeat(32) };
  let son = 0;
  for (let i = 0; i <= COLLECTOR_RATE_MAX; i++) son = (await kart("/api/machine-signals/stop", body, { ...sahte, ts: 1 })).status;
  check(`§2l kart başına hız sınırı (${COLLECTOR_RATE_MAX}/dk) aşılınca → 429`, son === 429, String(son));
  return key;
}

async function kapanisBolumu(card: { id: string; secret: string }, m: string[], key: string): Promise<void> {
  console.log("\n§3 — kapanış");
  const endedAt = new Date(Date.now() - 2 * MIN).toISOString();
  const r = await kart("/api/machine-signals/end", { machineId: m[0], stopKey: key, endedAt }, card);
  check("§3a kart kapanışı → 200, endSource SIGNAL, kapatan yok", r.status === 200 && r.body.data?.endSource === "SIGNAL" && r.body.data?.closedById === null, String(r.status));
  check("§3b aynı bitiş tekrarı → 200", (await kart("/api/machine-signals/end", { machineId: m[0], stopKey: key, endedAt }, card)).status === 200);
  check("§3c başka bitiş → 409 STOP_END_CONFLICT", hata(await kart("/api/machine-signals/end", { machineId: m[0], stopKey: key, endedAt: new Date(Date.now() - MIN).toISOString() }, card)) === "409:STOP_END_CONFLICT");
  check("§3d gövdede tanınmayan alan → 400", (await kart("/api/machine-signals/end", { machineId: m[0], stopKey: key, endedAt, source: "MACHINE" }, card)).status === 400);
}

async function sahiplenmeBolumu(card: { id: string; secret: string }, m: string[]): Promise<void> {
  console.log("\n§4 — K1 sahiplenme");
  const actor = await testActorId();
  const reason = await prisma.reasonPreset.create({ data: { kind: "MACHINE_STOP", code: `TEST_MDK_${ek}`.toUpperCase(), label: "Test kart sebebi", stopLossClass: "UNPLANNED", targetMinutes: 20, isActive: true }, select: { id: true, code: true } });
  ids.presets.push(reason.id);
  await prisma.machineStopCodeMap.create({ data: { collectorType: TYPE, rawStopCode: "E-31", stopReasonId: reason.id } });
  const human = await openManualStop({ machineId: m[1], startedAt: new Date(Date.now() - 15 * MIN), source: "OPERATOR" }, actor);
  const key = randomUUID();
  const body = { machineId: m[1], stopKey: key, rawStopCode: "E-31", startedAt: new Date(Date.now() - 12 * MIN).toISOString() };
  const r = await kart("/api/machine-signals/stop", body, card);
  const d = r.body.data ?? {};
  check("§4a insanın açık duruşu sahiplenilir → 200 aynı satır", r.status === 200 && r.body.message === STOP_CLAIM_MESSAGE && d.id === human.data.id, `${r.status} ${r.body.message}`);
  check("§4b açılış insanınki kalır (başlangıç · açan · kaynak · stopKey)",
    String(d.startedAt) === human.data.startedAt.toISOString() && d.openedById === actor && d.source === "OPERATOR" && d.stopKey === human.data.stopKey);
  check("§4c kart alanları yazılır (kart · ham kod · kart anahtarı)", d.collectorId === card.id && d.rawStopCode === "E-31" && d.signalStopKey === key);
  check("§4d eşlenen sebep sebepsiz duruşa makine kararı olarak yazılır", d.reasonCode === reason.code && d.reasonSource === "MACHINE" && d.classifiedById === null, `${String(d.reasonCode)} ${String(d.reasonSource)}`);
  const log = await prisma.systemLog.findMany({ where: { tableName: "MACHINE_STOP_EVENT", recordId: human.data.id }, select: { changes: true } });
  check("§4e audit'te 'sahiplenildi' satırı", log.some((l) => JSON.stringify(l.changes).includes("sahiplenildi")));
  const rep = await kart("/api/machine-signals/stop", body, card);
  check("§4f sahiplenmenin tekrarı → 200 aynı satır", rep.status === 200 && rep.body.data?.id === human.data.id, String(rep.status));
  const yeni = await kart("/api/machine-signals/stop", { ...body, stopKey: randomUUID() }, card);
  check("§4g sahiplenilmiş duruşa ikinci kart anahtarı → 409 STOP_ALREADY_OPEN", hata(yeni) === "409:STOP_ALREADY_OPEN", hata(yeni));
  const end = await kart("/api/machine-signals/end", { machineId: m[1], stopKey: key, endedAt: new Date(Date.now() - 3 * MIN).toISOString() }, card);
  check("§4h kart kapanışı sahiplenilen duruşu kapatır (SIGNAL, kapatan yok)", end.status === 200 && end.body.data?.endSource === "SIGNAL" && end.body.data?.closedById === null && end.body.data?.id === human.data.id, String(end.status));

  console.log("\n§5 — K1 kapanış: insan önce kapattıysa");
  const h2 = await openManualStop({ machineId: m[1], startedAt: new Date(Date.now() - 2 * MIN), source: "OPERATOR" }, actor);
  const k2 = randomUUID();
  await kart("/api/machine-signals/stop", { machineId: m[1], stopKey: k2, rawStopCode: "E-77", startedAt: new Date(Date.now() - MIN).toISOString() }, card);
  const closed = await closeManualStop(h2.data.id, new Date(), actor, "OPERATOR");
  const r5 = await kart("/api/machine-signals/end", { machineId: m[1], stopKey: k2, endedAt: new Date().toISOString() }, card);
  const fresh = await prisma.machineStopEvent.findUniqueOrThrow({ where: { id: h2.data.id }, select: { endedAt: true, endSource: true, closedById: true, collectorId: true, reasonCode: true } });
  check("§5a sahiplenilmiş ama insanın kapattığı duruşa kart 'bitti' → 409 STOP_CLOSED_BY_OPERATOR", hata(r5) === "409:STOP_CLOSED_BY_OPERATOR", hata(r5));
  check("§5b insanın kapanışı değişmez; eşlemesiz kod sebep yazmaz", fresh.endSource === "OPERATOR" && fresh.closedById === actor && fresh.endedAt?.getTime() === closed.data.endedAt?.getTime() && fresh.collectorId === card.id && fresh.reasonCode === null);
}

async function yenilemeBolumu(card: { id: string; secret: string }, m: string[]): Promise<void> {
  console.log("\n§6 — yenileme ve iptal");
  const r = await api("POST", `/api/machine-collectors/${card.id}/rotate-secret`);
  const yeni = String(r.body.data?.secret ?? "");
  sirlar.push(yeni);
  check("§6a yenileme yeni sır döner", r.status === 200 && /^[0-9a-f]{64}$/.test(yeni) && yeni !== card.secret);
  const body = { machineId: m[0], stopKey: randomUUID(), startedAt: new Date(Date.now() - MIN).toISOString() };
  check("§6b eski sır → 401", hata(await kart("/api/machine-signals/stop", body, card)) === "401:COLLECTOR_AUTH_FAILED");
  check("§6c yeni sır geçer", (await kart("/api/machine-signals/stop", body, { id: card.id, secret: yeni })).status === 201);
  const rv = await api("POST", `/api/machine-collectors/${card.id}/revoke`);
  check("§6d iptal → 200, tezgah bağları çözülür", rv.status === 200 && (await prisma.machineCollectorLink.count({ where: { collectorId: card.id } })) === 0);
  check("§6e iptal edilmiş kart → 401", hata(await kart("/api/machine-signals/end", { machineId: m[0], stopKey: body.stopKey, endedAt: new Date().toISOString() }, { id: card.id, secret: yeni })) === "401:COLLECTOR_AUTH_FAILED");
  check("§6f iptal edilmiş kartın sırrı yenilenemez → 409", hata(await api("POST", `/api/machine-collectors/${card.id}/rotate-secret`)) === "409:COLLECTOR_REVOKED");

  console.log("\n§7 — sır sızıntısı");
  const seed = (await prisma.machineCollector.findUniqueOrThrow({ where: { id: card.id }, select: { secretSeed: true } })).secretSeed ?? "";
  const logs = JSON.stringify(await prisma.systemLog.findMany({ where: { tableName: "MACHINE_COLLECTOR", recordId: card.id } }));
  check("§7a audit satırları var ve sır/tohum içermiyor", logs.length > 10 && sirlar.every((s) => s && !logs.includes(s)) && !logs.includes(seed.slice(17)) && !logs.includes("secretSeed"));
}

function statikBolum(): void {
  console.log("\n§8 — statik");
  const kok = join(__dirname, "..");
  const router = readFileSync(join(kok, "src/routes/machine-signal.routes.ts"), "utf8").replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
  check("§8a kart router'ı verifyToken taşımaz, imza doğrulayıcısını taşır", !/verifyToken/.test(router) && /router\.use\(verifyCollectorSignature/.test(router));
  check("§8b kaynak gövdeden değil, sabit MACHINE", /source:\s*MachineDataSource\.MACHINE/.test(router) && !/b\.source/.test(router));
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
    const sid = (await prisma.machineStopEvent.findMany({ where: { machineId: { in: ids.machines } }, select: { id: true } })).map((s) => s.id);
    await prisma.machineStopEvent.updateMany({ where: { id: { in: sid } }, data: { classifiedById: null, reasonSource: null } });
    await prisma.machineStopEvent.deleteMany({ where: { id: { in: sid } } });
    await prisma.machineStopCodeMap.deleteMany({ where: { collectorType: TYPE } });
    await prisma.machineCollector.deleteMany({ where: { OR: [{ id: { in: ids.collectors } }, { collectorType: TYPE }] } });
    await prisma.machine.deleteMany({ where: { id: { in: ids.machines } } });
    await prisma.reasonPreset.deleteMany({ where: { id: { in: ids.presets } } });
    if (ids.station) await prisma.station.deleteMany({ where: { id: ids.station } });
  } catch (e) {
    fail++;
    console.error("❌ temizlik hatası (kalıntı büyür):", (e as Error).message);
  }
}

async function main(): Promise<void> {
  console.log("\n=== Makine kartı — kimlik + imzalı duruş ucu + sahiplenme ===");
  setShortCredentialKeyDirForTests(anahtarDizini);
  resetCollectorAuthStateForTests();
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: YONETILEN } }, select: { key: true, value: true } });
  for (const k of YONETILEN) ilk.set(k, rows.find((r) => r.key === k)?.value ?? undefined);
  for (const k of YONETILEN) await prisma.systemSetting.upsert({ where: { key: k }, create: { key: k, value: true }, update: { value: true } });
  invalidateFeatureFlagsCache();
  ids.station = (await prisma.station.create({
    data: { name: `TEST-MDK-HOL-${ek}`, code: `TEST-MDK-H-${ek}`.toUpperCase().slice(0, 32), type: "INTERNAL", kind: "WEAVING", isActive: true },
  })).id;
  const server: Server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const cred = await ensureTestAdmin();
    const login = await api("POST", "/api/auth/login", { username: cred.username, password: cred.password });
    token = String(login.body.data?.token ?? "");
    const m = [await makine(1), await makine(2), await makine(3)];
    const card = await kayitBolumu(m);
    const key = await imzaBolumu(card, m);
    await kapanisBolumu(card, m, key);
    await sahiplenmeBolumu(card, m);
    await yenilemeBolumu(card, m);
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
