// =============================================================================
// BEKÇİ — `StationKind.WEAVING`: OTURUM istasyonu ama ROTA ADIMI DEĞİL (dokuma ⓪)
// Çalıştır: npx tsx scripts/run-all-tests.ts station_kind_weaving
// =============================================================================
// Tezgah kendi varlığıdır (dokuma.md); top KK1'de doğar. Ama tablet oturumu
// istasyon tabanlıdır ⇒ tezgah bir WEAVING istasyonudur. Bu enum değeri iki kapı
// getirir ve ikisi burada ölçülür:
//   §1 OTURUM: WEAVING istasyonu + makine ile oturum `mobile:dokuma` izniyle AÇILIR;
//      `mobile:tambur` ile 403 (STATION_KIND_PERM satırı yoksa fail-OPEN olurdu)
//   §2 MAKİNE ZORUNLU: makinesiz WEAVING istasyonunda istasyon-modu oturum 400
//      `STATION_MACHINE_ONLY` (tezgah = makine; SHIPPING'in tersi)
//   §3 ROTA KAPISI: rota şablonu create/update ve iş emri create'te WEAVING istasyonu
//      400 `STATION_NOT_ROUTABLE` — tek helper `assertStationsRoutable`, iki çağıran
//   §4 körlük zemini: aynı fikstürle TAMBUR istasyonu rotaya GİRER (kapı seçici)
// Negatif sondalar (2026-09-14, cp+sha256 ile geri):
//   · `SESSIONABLE_STATION_KINDS`ten WEAVING düşürülünce: §1a/§1b/§2 kırmızı (oturum hiç açılamaz)
//   · `STATION_KIND_PERM.WEAVING` silinince: §1b kırmızı (mobile:tambur ile AÇILDI — fail-open)
//   · `MACHINE_ONLY_STATION_KINDS` boşaltılınca: §2 kırmızı
//   · `NON_ROUTABLE_STATION_KINDS` boşaltılınca: §3a/§3b/§3c/§4 kırmızı
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım.
// =============================================================================
import { StationKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";
import { WorkSessionService } from "../src/services/work-session.service";
import { RouteService, ROUTE_SERVICE_CONFIG } from "../src/services/route.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}
function kod(e: unknown): string {
  return e instanceof AppError ? String((e.details as { code?: string } | undefined)?.code ?? e.statusCode) : String((e as Error)?.message ?? e).slice(0, 80);
}
async function bekle<T>(p: Promise<T>): Promise<{ ok: true; v: T } | { ok: false; e: unknown }> {
  try { return { ok: true, v: await p }; } catch (e) { return { ok: false, e }; }
}

const TAG = `TEST-SKW-${Date.now()}`;
const stationIds: string[] = [];
const machineIds: string[] = [];
const deviceIds: string[] = [];
const routeIds: string[] = [];
const woIds: string[] = [];

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.log(`⛔ ${engel}`); process.exit(1); }
  console.log("\n=== StationKind.WEAVING: oturum istasyonu, rota adımı değil ===\n");
  const admin = await ensureTestAdmin();
  const routes = new RouteService(ROUTE_SERVICE_CONFIG);
  const wos = new WorkOrderService();
  const item = await prisma.item.create({ data: { code: TAG, name: `${TAG} kumaş`, itemType: "FABRIC" }, select: { id: true } });

  const mkStation = async (ek: string, kind: StationKind): Promise<string> => {
    const s = await prisma.station.create({ data: { name: `${TAG}-${ek}`, code: `${TAG}-${ek}`.slice(0, 32), type: "INTERNAL", kind, isActive: true }, select: { id: true } });
    stationIds.push(s.id);
    return s.id;
  };
  const mkDevice = async (n: number): Promise<string> => {
    const d = await prisma.device.create({ data: { deviceId: `${TAG}-dev-${n}`, name: `${TAG} cihaz ${n}`, status: "APPROVED", kind: "TABLET" }, select: { id: true } });
    deviceIds.push(d.id);
    return d.id;
  };

  try {
    const tezgahSt = await mkStation("TEZGAH", StationKind.WEAVING);
    const tezgah = await prisma.machine.create({ data: { stationId: tezgahSt, code: `${TAG}-T1`.slice(0, 32), name: `${TAG} tezgah 1`, isActive: true }, select: { id: true } });
    machineIds.push(tezgah.id);
    const bosTezgahSt = await mkStation("TEZGAH-BOS", StationKind.WEAVING);
    const tamburSt = await mkStation("TAMBUR", StationKind.TAMBUR);
    const dev1 = await mkDevice(1);
    const dev2 = await mkDevice(2);

    // ── §1 oturum ──────────────────────────────────────────────────────────
    const s1 = await bekle(WorkSessionService.open({ userId: admin.id, deviceRowId: dev1, machineId: tezgah.id, permissions: ["mobile:dokuma"] }));
    check("§1a WEAVING istasyonu + makine: `mobile:dokuma` ile oturum AÇILDI", s1.ok, s1.ok ? "açık" : kod(s1.e));
    await WorkSessionService.closeForDevice(dev1).catch(() => undefined);
    const s1b = await bekle(WorkSessionService.open({ userId: admin.id, deviceRowId: dev1, machineId: tezgah.id, permissions: ["mobile:tambur"] }));
    check("§1b `mobile:tambur` ile tezgah oturumu 403 (izin satırı yoksa fail-open olurdu)", !s1b.ok && s1b.e instanceof AppError && s1b.e.statusCode === 403, s1b.ok ? "AÇILDI (fail-open!)" : kod(s1b.e));
    if (s1b.ok) await WorkSessionService.closeForDevice(dev1).catch(() => undefined);

    // ── §2 makine zorunlu ──────────────────────────────────────────────────
    const s2 = await bekle(WorkSessionService.open({ userId: admin.id, deviceRowId: dev2, stationId: bosTezgahSt, permissions: ["mobile:dokuma"] }));
    check("§2 makinesiz WEAVING istasyonunda istasyon-modu oturum → 400 STATION_MACHINE_ONLY", !s2.ok && kod(s2.e) === "STATION_MACHINE_ONLY", s2.ok ? "AÇILDI" : kod(s2.e));
    if (s2.ok) await WorkSessionService.closeForDevice(dev2).catch(() => undefined);

    // ── §3 rota kapısı ─────────────────────────────────────────────────────
    const r3a = await bekle(routes.create({ name: `${TAG} rota`, steps: { create: [{ stationId: tezgahSt, sequence: 1 }] } }, admin.id));
    check("§3a rota şablonu create: WEAVING adımı → 400 STATION_NOT_ROUTABLE", !r3a.ok && kod(r3a.e) === "STATION_NOT_ROUTABLE", r3a.ok ? "geçti" : kod(r3a.e));
    if (r3a.ok) routeIds.push((r3a.v.data as { id: string }).id);
    const r4 = await routes.create({ name: `${TAG} rota-tambur`, steps: { create: [{ stationId: tamburSt, sequence: 1 }] } }, admin.id);
    const routeId = (r4.data as { id: string }).id;
    routeIds.push(routeId);
    const r3b = await bekle(routes.update(routeId, { steps: { create: [{ stationId: tezgahSt, sequence: 1 }] } }, admin.id));
    check("§3b rota şablonu update: WEAVING adımı → 400 STATION_NOT_ROUTABLE", !r3b.ok && kod(r3b.e) === "STATION_NOT_ROUTABLE", r3b.ok ? "geçti" : kod(r3b.e));
    const r3c = await bekle(wos.create({ type: "STOCK_PRODUCTION", targetItemId: item.id, steps: [{ stationId: tezgahSt, notes: null }] }, admin.id));
    check("§3c iş emri create: WEAVING adımı → 400 STATION_NOT_ROUTABLE", !r3c.ok && kod(r3c.e) === "STATION_NOT_ROUTABLE", r3c.ok ? "geçti" : kod(r3c.e));
    if (r3c.ok) woIds.push((r3c.v.data as { id: string }).id);

    // ── §4 körlük zemini ───────────────────────────────────────────────────
    const r4c = await bekle(wos.create({ type: "STOCK_PRODUCTION", targetItemId: item.id, steps: [{ stationId: tamburSt, notes: null }] }, admin.id));
    if (r4c.ok) woIds.push((r4c.v.data as { id: string }).id);
    check("§4 körlük zemini: aynı fikstürde TAMBUR adımı rotaya GİRER (kapı seçici, her şeyi reddetmiyor)", r4c.ok && routeIds.length === 1, r4c.ok ? "girdi" : kod(r4c.e));
  } finally {
    await prisma.workSession.deleteMany({ where: { deviceId: { in: deviceIds } } }).catch(() => undefined);
    await prisma.device.deleteMany({ where: { id: { in: deviceIds } } }).catch(() => undefined);
    const cards = await prisma.travelerCard.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
    await prisma.travelerCardScan.deleteMany({ where: { cardId: { in: cards.map((c) => c.id) } } }).catch(() => undefined);
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => undefined);
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...woIds, ...routeIds, ...stationIds] } } }).catch(() => undefined);
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => undefined);
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } }).catch(() => undefined);
    await prisma.routeStep.deleteMany({ where: { routeId: { in: routeIds } } }).catch(() => undefined);
    await prisma.route.deleteMany({ where: { id: { in: routeIds } } }).catch(() => undefined);
    await prisma.machine.deleteMany({ where: { id: { in: machineIds } } }).catch(() => undefined);
    await prisma.station.deleteMany({ where: { id: { in: stationIds } } }).catch(() => undefined);
    await prisma.item.deleteMany({ where: { id: item.id } }).catch(() => undefined);
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("❌ bekçi çöktü:", e);
  await prisma.$disconnect().catch(() => undefined);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
