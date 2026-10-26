// =============================================================================
// Bekçi: MAKİNE KARTI — İPTAL ÖNİZLEMESİ (backend preview ucu) + KAYIT clientToken REPLAY'i (süreç içi HTTP)
// Çalıştır: npx tsx scripts/test_makine_kart_onizleme.ts
// =============================================================================
//   §1 önizleme `GET /api/machine-collectors/:id/revoke/preview`: bağlı tezgahlar kod sırasında · kartın açık
//      duruşu listelenir (insanın ve başka kartın duruşu listelenmez) · bekleyen geç kapanış (watchdog geçici
//      kapanışı) listelenir · YAZMAZ (kart · bağ · audit değişmez) · iptalden sonra revocable=false +
//      COLLECTOR_REVOKED · 401/404/400 · modül kapalı 403 MODULE_DISABLED
//   §2 kayıt replay'i (dört durum): ① token'lı kayıt sır döner · ② aynı token + aynı yük → TEK kart, sır
//      YENİDEN DÖNMEZ (`secret: null`, `secretWithheld`, `idempotent`), tohum/sır veriliş zamanı değişmez ·
//      ③ başka yük → 409 CLIENT_TOKEN_COLLISION · eşzamanlı aynı token → tek kart, tek sır · ④ iptal edilmiş →
//      409 COLLECTOR_REVOKED · token'sız eski istemci bugünkü yoldan (201 + sır) · bozuk token 400 · tek CREATE audit
//   §3 statik: rota aynı guard'ı taşır; panel iptal penceresi sunucu önizlemesini okur (GET /:id değil)
// Negatif sondalar (kırmızı görüldü, geri alındı): bkz. docs/history/arsiv/2026-10.md (makine kartı önizleme).
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Dokunulan ayarlar FOTOĞRAFINA döndürülür.
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
import { openManualStop } from "../src/services/machine-stop.service";
import { runMachineWatchdogOnce } from "../src/services/machine-watchdog.service";
import { collectorSigningInput, signCollectorRequest } from "../src/services/helpers/collector-secret.helper";
import { resetCollectorAuthStateForTests } from "../src/middlewares/collector-auth.middleware";
import { ensureTestAdmin, testActorId } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}
const MIN = 60_000;
const HOUR = 60 * MIN;
const ek = Date.now().toString(36);
const TYPE = `TEST-MKO-${ek}`.toUpperCase().slice(0, 32);
const ids = { station: "", machines: [] as string[] };
const YONETILEN = [SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.TEZGAH_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.TEZGAH_MAX_OPEN_STOP_HOURS];
const ilk = new Map<string, unknown>();
const anahtarDizini = mkdtempSync(join(tmpdir(), "mko-halka-"));

type Rec = Record<string, unknown>;
type Yanit = { status: number; text: string; body: { data?: Rec & { collector?: Rec; secret?: string | null; secretWithheld?: boolean }; message?: string; idempotent?: boolean; error?: { details?: { code?: string } }; details?: { code?: string } } };
let base = "";
let token = "";

async function api(method: string, path: string, body?: unknown, auth = true): Promise<Yanit> {
  const r = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", ...(auth && token ? { Authorization: `Bearer ${token}` } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let parsed: Yanit["body"] = {};
  try { parsed = JSON.parse(text) as Yanit["body"]; } catch { /* boş gövde */ }
  return { status: r.status, text, body: parsed };
}

function hata(r: Yanit): string {
  return `${r.status}:${r.body.error?.details?.code ?? r.body.details?.code ?? ""}`;
}

async function kart(path: string, body: unknown, c: { id: string; secret: string }): Promise<Yanit> {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID().replace(/-/g, "");
  const input = collectorSigningInput({ method: "POST", path, timestamp: ts, nonce, body: Buffer.from(raw, "utf8") });
  const r = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-collector-id": c.id, "x-collector-timestamp": ts, "x-collector-nonce": nonce, "x-collector-signature": signCollectorRequest(Buffer.from(c.secret, "hex"), input) },
    body: raw,
  });
  const text = await r.text();
  return { status: r.status, text, body: JSON.parse(text || "{}") as Yanit["body"] };
}

async function makine(code: string): Promise<string> {
  const m = await prisma.machine.create({ data: { stationId: ids.station, name: `Tezgah ${code}`, code: `${code}-${ek}`.toUpperCase().slice(0, 32), isActive: true } });
  ids.machines.push(m.id);
  return m.id;
}

async function kayit(name: string, machineIds: string[], clientToken?: string): Promise<Yanit> {
  return api("POST", "/api/machine-collectors", { name, collectorType: TYPE, machineIds, ...(clientToken !== undefined ? { clientToken } : {}) });
}

async function setting(key: string, value: unknown): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
  invalidateFeatureFlagsCache();
}

// ── §1 ───────────────────────────────────────────────────────────────────────
async function onizlemeBolumu(): Promise<void> {
  console.log("\n§1 — iptal önizlemesi");
  // Kod sırası bilerek ters doğar: C, A, B → önizleme A, B, C döner.
  const mC = await makine("MKO-C");
  const mA = await makine("MKO-A");
  const mB = await makine("MKO-B");
  const mD = await makine("MKO-D");
  const r = await kayit(`TEST MKO A ${ek}`, [mC, mA, mB], randomUUID());
  const card = { id: String(r.body.data?.collector?.id), secret: String(r.body.data?.secret) };
  const diger = await kayit(`TEST MKO D ${ek}`, [mD], randomUUID());
  const card2 = { id: String(diger.body.data?.collector?.id), secret: String(diger.body.data?.secret) };
  const acik = await kart("/api/machine-signals/stop", { machineId: mA, stopKey: randomUUID(), startedAt: new Date(Date.now() - MIN).toISOString(), rawStopCode: "E-17" }, card);
  await kart("/api/machine-signals/stop", { machineId: mD, stopKey: randomUUID(), startedAt: new Date(Date.now() - MIN).toISOString() }, card2);
  const insan = await openManualStop({ machineId: mB, startedAt: new Date(Date.now() - MIN), source: "SUPERVISOR" } as never, await testActorId());
  const eski = new Date(Math.floor((Date.now() - 13 * HOUR) / 1000) * 1000);
  const gec = await kart("/api/machine-signals/stop", { machineId: mC, stopKey: randomUUID(), startedAt: eski.toISOString() }, card);
  await runMachineWatchdogOnce({ onlyCollectorIds: [], onlyMachineIds: [mC] });
  const acikId = String(acik.body.data?.id);
  const gecId = String(gec.body.data?.id);
  check("§1 fikstür: kart duruşu (A) + insan duruşu (B) + başka kart duruşu (D) + watchdog geçici kapanışı (C)",
    acik.status === 201 && gec.status === 201 && !!insan.data?.id && (await prisma.machineStopEvent.findUnique({ where: { id: gecId } }))?.endSource === "WATCHDOG");

  const once = await prisma.machineCollector.findUniqueOrThrow({ where: { id: card.id }, select: { updatedAt: true, revokedAt: true } });
  const auditOnce = await prisma.systemLog.count({ where: { recordId: card.id } });
  const p = await api("GET", `/api/machine-collectors/${card.id}/revoke/preview`);
  const d = p.body.data as Rec & { machines: Array<{ machineId: string; machineCode: string; machineName: string }>; openStops: Array<{ stopId: string; machineId: string; machineCode: string; rawStopCode: string | null }>; pendingEnds: Array<{ stopId: string; machineId: string; lateEndedAt: string | null }> };
  const kodlar = (d?.machines ?? []).map((m) => m.machineId);
  check("§1a 200 · bağlı üç tezgah kod sırasında, adıyla", p.status === 200 && kodlar.join(",") === [mA, mB, mC].join(",") && d.machines.every((m) => m.machineName.startsWith("Tezgah ")), `${p.status} ${kodlar.length}`);
  check("§1b ⭐ kartın açık duruşu listelenir (tezgah kodu + ham kod)", (d?.openStops ?? []).some((s) => s.stopId === acikId && s.machineId === mA && s.rawStopCode === "E-17"), JSON.stringify(d?.openStops ?? null).slice(0, 160));
  check("§1c insanın ve başka kartın açık duruşu listelenmez", (d?.openStops ?? []).length === 1 && !(d?.openStops ?? []).some((s) => s.stopId === insan.data?.id || s.machineId === mD));
  check("§1d ⭐ bekleyen geç kapanış (watchdog geçici kapanışı) listelenir — gerçek bitiş henüz yok", (d?.pendingEnds ?? []).length === 1 && d.pendingEnds[0].stopId === gecId && d.pendingEnds[0].lateEndedAt === null);
  check("§1e revocable=true · block=null · yanıtta tohum/sır yok", d?.revocable === true && d?.block === null && !p.text.includes("secretSeed") && !p.text.includes(card.secret));
  const sonra = await prisma.machineCollector.findUniqueOrThrow({ where: { id: card.id }, select: { updatedAt: true, revokedAt: true } });
  check("§1f ⭐ önizleme YAZMAZ (kart · bağ · audit değişmez)",
    sonra.updatedAt.getTime() === once.updatedAt.getTime() && sonra.revokedAt === null && (await prisma.machineCollectorLink.count({ where: { collectorId: card.id } })) === 3
    && (await prisma.systemLog.count({ where: { recordId: card.id } })) === auditOnce);
  check("§1g oturumsuz → 401", (await api("GET", `/api/machine-collectors/${card.id}/revoke/preview`, undefined, false)).status === 401);
  check("§1h bilinmeyen kart → 404", (await api("GET", `/api/machine-collectors/${randomUUID()}/revoke/preview`)).status === 404);
  check("§1i bozuk kimlik → 400", (await api("GET", "/api/machine-collectors/x/revoke/preview")).status === 400);
  await setting(SETTING_KEYS.TEZGAH_ENABLED, false);
  check("§1j tezgah modülü kapalı → 403 MODULE_DISABLED", hata(await api("GET", `/api/machine-collectors/${card.id}/revoke/preview`)) === "403:MODULE_DISABLED");
  await setting(SETTING_KEYS.TEZGAH_ENABLED, true);
  await api("POST", `/api/machine-collectors/${card.id}/revoke`);
  const p2 = await api("GET", `/api/machine-collectors/${card.id}/revoke/preview`);
  const d2 = p2.body.data as Rec & { block: { code: string } | null; machines: unknown[] };
  check("§1k iptalden sonra revocable=false, block COLLECTOR_REVOKED, bağ kalmadı", p2.status === 200 && d2.revocable === false && d2.block?.code === "COLLECTOR_REVOKED" && d2.machines.length === 0);
}

// ── §2 ───────────────────────────────────────────────────────────────────────
async function replayBolumu(): Promise<void> {
  console.log("\n§2 — kayıt clientToken replay'i");
  const m1 = await makine("MKO-R1");
  const m2 = await makine("MKO-R2");
  const m3 = await makine("MKO-R3");
  const T = randomUUID();
  const name = `TEST MKO R ${ek}`;
  const ilkK = await kayit(name, [m1, m2], T);
  const secret = String(ilkK.body.data?.secret ?? "");
  const id = String(ilkK.body.data?.collector?.id ?? "");
  check("§2a ① token'lı kayıt → 201, sır 64 hex", ilkK.status === 201 && /^[0-9a-f]{64}$/.test(secret) && ilkK.body.idempotent === undefined);
  const row0 = await prisma.machineCollector.findUniqueOrThrow({ where: { id }, select: { secretSeed: true, secretIssuedAt: true, clientToken: true } });
  check("§2b token DB'de kayıtla birlikte", row0.clientToken === T);

  const rep = await kayit(name, [m2, m1], T); // aynı küme, başka sıra
  check("§2c ⭐ ② aynı token + aynı yük → TEK kart, aynı kimlik",
    rep.status === 201 && rep.body.data?.collector?.id === id && (await prisma.machineCollector.count({ where: { clientToken: T } })) === 1 && (await prisma.machineCollector.count({ where: { collectorType: TYPE, name } })) === 1,
    `${rep.status} ${String(rep.body.data?.collector?.id)}`);
  check("§2d ⭐ replay sırrı YENİDEN DÖNMEZ: secret null + secretWithheld + idempotent, yanıtta sır/tohum yok",
    rep.body.data?.secret === null && rep.body.data?.secretWithheld === true && rep.body.idempotent === true && !rep.text.includes(secret) && !rep.text.includes("secretSeed") && !rep.text.includes(row0.secretSeed!.slice(17)));
  check("§2e replay cevabı 'sırrı yenileyin' der", /sırrı yenileyin/.test(rep.body.message ?? ""), rep.body.message);
  const row1 = await prisma.machineCollector.findUniqueOrThrow({ where: { id }, select: { secretSeed: true, secretIssuedAt: true } });
  check("§2f replay sırrı döndürmez ama DEĞİŞTİRMEZ de (tohum + veriliş zamanı aynı — kurulu kart düşmez)", row1.secretSeed === row0.secretSeed && row1.secretIssuedAt?.getTime() === row0.secretIssuedAt?.getTime());
  check("§2g ③ aynı token + başka tezgah → 409 CLIENT_TOKEN_COLLISION", hata(await kayit(name, [m1, m3], T)) === "409:CLIENT_TOKEN_COLLISION");
  check("§2h ③ aynı token + başka ad → 409 CLIENT_TOKEN_COLLISION", hata(await kayit(`${name} X`, [m1, m2], T)) === "409:CLIENT_TOKEN_COLLISION");
  check("§2i tek CREATE audit satırı", (await prisma.systemLog.count({ where: { recordId: id, action: "CREATE" } })) === 1);

  const T2 = randomUUID();
  const [a, b] = await Promise.all([kayit(`TEST MKO E ${ek}`, [m3], T2), kayit(`TEST MKO E ${ek}`, [m3], T2)]);
  const sirli = [a, b].filter((x) => typeof x.body.data?.secret === "string").length;
  const sirsiz = [a, b].filter((x) => x.body.data?.secretWithheld === true).length;
  check("§2j eşzamanlı aynı token → tek kart, bir sır + bir sırsız replay", (await prisma.machineCollector.count({ where: { clientToken: T2 } })) === 1 && sirli === 1 && sirsiz === 1, `${a.status}/${b.status} sırlı ${sirli}`);

  await api("POST", `/api/machine-collectors/${id}/revoke`);
  check("§2k ④ kart iptal edilmişse aynı token → 409 COLLECTOR_REVOKED (canlıymış gibi dönmez)", hata(await kayit(name, [m1, m2], T)) === "409:COLLECTOR_REVOKED");
  check("§2l ④ ikinci kart doğmadı", (await prisma.machineCollector.count({ where: { clientToken: T } })) === 1);

  const eskiIstemci = await kayit(`TEST MKO O ${ek}`, [m1]);
  check("§2m token'sız eski istemci bugünkü yoldan: 201 + sır", eskiIstemci.status === 201 && /^[0-9a-f]{64}$/.test(String(eskiIstemci.body.data?.secret)) && eskiIstemci.body.data?.secretWithheld === undefined);
  check("§2n bozuk token → 400", (await kayit(`TEST MKO Z ${ek}`, [m2], "x")).status === 400);
}

// ── §3 ───────────────────────────────────────────────────────────────────────
function statikBolum(): void {
  console.log("\n§3 — statik");
  const route = readFileSync(join(__dirname, "../src/routes/machine-collector.routes.ts"), "utf8");
  check("§3a önizleme rotası aynı guard'ı taşır (router.use verifyToken + tezgah kapısı)", /router\.get\("\/:id\/revoke\/preview", guard,/.test(route) && /router\.use\(verifyToken, requireTezgahEnabled\)/.test(route));
  const dialog = readFileSync(join(__dirname, "../../Electron/src/pages/MachineCollectors/RevokeCollectorDialog.tsx"), "utf8");
  check("§3b panel iptal penceresi sunucu önizlemesini okur (GET /:id değil)", /machineCollectorService\.revokePreview\(/.test(dialog) && !/machineCollectorService\.get\(/.test(dialog));
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
    await prisma.machineCollector.deleteMany({ where: { collectorType: TYPE } });
    await prisma.machine.deleteMany({ where: { id: { in: ids.machines } } });
    if (ids.station) await prisma.station.deleteMany({ where: { id: ids.station } });
  } catch (e) {
    fail++;
    console.error("❌ temizlik hatası (kalıntı büyür):", (e as Error).message);
  }
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(1);
  }
  console.log("\n=== Makine kartı — iptal önizlemesi + kayıt replay'i ===");
  setShortCredentialKeyDirForTests(anahtarDizini);
  resetCollectorAuthStateForTests();
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: YONETILEN } }, select: { key: true, value: true } });
  for (const k of YONETILEN) ilk.set(k, rows.find((r) => r.key === k)?.value ?? undefined);
  for (const k of [SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.TEZGAH_ENABLED, SETTING_KEYS.DOKUMA_ENABLED]) await setting(k, true);
  await setting(SETTING_KEYS.TEZGAH_MAX_OPEN_STOP_HOURS, 12);
  ids.station = (await prisma.station.create({
    data: { name: `TEST-MKO-HOL-${ek}`, code: `TEST-MKO-H-${ek}`.toUpperCase().slice(0, 32), type: "INTERNAL", kind: "WEAVING", isActive: true },
  })).id;
  const server: Server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const cred = await ensureTestAdmin();
    const login = await api("POST", "/api/auth/login", { username: cred.username, password: cred.password });
    token = String((login.body.data as Rec | undefined)?.token ?? "");
    await onizlemeBolumu();
    await replayBolumu();
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
