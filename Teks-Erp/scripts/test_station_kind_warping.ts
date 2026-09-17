// =============================================================================
// BEKÇİ — `StationKind.WARPING` (devere): rota adımı DEĞİL, oturum istasyonu DEĞİL, motor gerçeği KAPASİTE
// =============================================================================
// Kullanıcı bulgusu (2026-09-18): "devere makinesini nereden ekleyeceğim göremedim" — tür keşfedilebilirlik için
// var; devere makinesini MOTOR türden değil `Station.producesWarpBeam`den tanır (kalite = istasyon yeteneği kalıbı).
//
//   §1 ROTA KAPISI: rota şablonu create/update ve iş emri create'te WARPING istasyonu → 400 STATION_NOT_ROUTABLE
//   §2 OTURUM YOK: WARPING istasyonu (makineli ve makinesiz) oturum açamaz — tabletin Devere ekranı gezici
//   §3 MOTOR = KAPASİTE: WARPING + producesWarpBeam:true → `listDevereMachines`te VAR; WARPING + false → YOK;
//      OTHER + true → VAR (tür değil yetenek okunur — "Diğer + Levent sarar" bugünkü yol bozulmadı)
//   §4 körlük zemini: aynı fikstürle TAMBUR istasyonu rotaya GİRER ve oturum kapısı seçicidir
//
// Negatif sondalar (kırmızı görüldü):
//   · `NON_ROUTABLE_STATION_KINDS`ten WARPING düşürülünce: §1a/§1b/§1c kırmızı
//   · `SESSIONABLE_STATION_KINDS`e WARPING eklenince: §2a kırmızı (oturum AÇILDI — ekransız fail-open)
//   · `listDevereMachines` `station.kind === WARPING` okumaya çevrilince: §3b/§3c kırmızı
//
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım.
// =============================================================================
import { StationKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";
import { WorkSessionService } from "../src/services/work-session.service";
import { RouteService, ROUTE_SERVICE_CONFIG } from "../src/services/route.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { listDevereMachines } from "../src/services/warp-beam.service";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}
const kod = (e: unknown): string => (e instanceof AppError ? `${e.statusCode} ${String((e.details as { code?: string } | undefined)?.code ?? e.message)}` : String(e));
async function bekle<T>(p: Promise<T>): Promise<{ ok: true; v: T } | { ok: false; e: unknown }> {
  try { return { ok: true, v: await p }; } catch (e) { return { ok: false, e }; }
}

const TAG = `TSW-${Date.now().toString(36)}`; // kısa: istasyon/makine kodu 32 karakter
const stationIds: string[] = [];
const machineIds: string[] = [];
const deviceIds: string[] = [];
const routeIds: string[] = [];
const woIds: string[] = [];

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.log(`⛔ ${engel}`); process.exit(1); }
  console.log("\n=== StationKind.WARPING: rota adımı değil, oturum istasyonu değil, motor = producesWarpBeam ===\n");
  const admin = await ensureTestAdmin();
  const routes = new RouteService(ROUTE_SERVICE_CONFIG);
  const wos = new WorkOrderService();
  const item = await prisma.item.create({ data: { code: TAG, name: `${TAG} kumaş`, itemType: "FABRIC" }, select: { id: true } });

  const mkStation = async (ek: string, kind: StationKind, producesWarpBeam: boolean): Promise<string> => {
    const s = await prisma.station.create({
      data: { name: `${TAG}-${ek}`, code: `${TAG}-${ek}`.slice(0, 32), type: "INTERNAL", kind, isActive: true, producesWarpBeam },
      select: { id: true },
    });
    stationIds.push(s.id);
    return s.id;
  };
  const mkMachine = async (stationId: string, ek: string): Promise<string> => {
    const m = await prisma.machine.create({ data: { stationId, code: `${TAG}-${ek}`.slice(0, 32), name: `${TAG} ${ek}`, isActive: true }, select: { id: true } });
    machineIds.push(m.id);
    return m.id;
  };
  const mkDevice = async (n: number): Promise<string> => {
    const d = await prisma.device.create({ data: { deviceId: `${TAG}-dev-${n}`, name: `${TAG} cihaz ${n}`, status: "APPROVED", kind: "TABLET" }, select: { id: true } });
    deviceIds.push(d.id);
    return d.id;
  };

  try {
    const devereSt = await mkStation("DEVERE", StationKind.WARPING, true);
    const devereM = await mkMachine(devereSt, "D1");
    const devereNoCapSt = await mkStation("DEVERE-YOK", StationKind.WARPING, false);
    const devereNoCapM = await mkMachine(devereNoCapSt, "D2");
    const otherCapSt = await mkStation("DIGER-LEVENT", StationKind.OTHER, true);
    const otherCapM = await mkMachine(otherCapSt, "D3");
    const tamburSt = await mkStation("TAMBUR", StationKind.TAMBUR, false);
    const dev1 = await mkDevice(1);

    // ── §1 rota kapısı ─────────────────────────────────────────────────────
    const r1a = await bekle(routes.create({ name: `${TAG} rota`, steps: { create: [{ stationId: devereSt, sequence: 1 }] } }, admin.id));
    check("§1a rota şablonu create: WARPING adımı → 400 STATION_NOT_ROUTABLE", !r1a.ok && kod(r1a.e).includes("STATION_NOT_ROUTABLE"), r1a.ok ? "geçti" : kod(r1a.e));
    if (r1a.ok) routeIds.push((r1a.v.data as { id: string }).id);
    const r4 = await routes.create({ name: `${TAG} rota-tambur`, steps: { create: [{ stationId: tamburSt, sequence: 1 }] } }, admin.id);
    const routeId = (r4.data as { id: string }).id;
    routeIds.push(routeId);
    const r1b = await bekle(routes.update(routeId, { steps: { create: [{ stationId: devereSt, sequence: 1 }] } }, admin.id));
    check("§1b rota şablonu update: WARPING adımı → 400 STATION_NOT_ROUTABLE", !r1b.ok && kod(r1b.e).includes("STATION_NOT_ROUTABLE"), r1b.ok ? "geçti" : kod(r1b.e));
    const r1c = await bekle(wos.create({ type: "STOCK_PRODUCTION", targetItemId: item.id, steps: [{ stationId: devereSt, notes: null }] }, admin.id));
    check("§1c iş emri create: WARPING adımı → 400 STATION_NOT_ROUTABLE", !r1c.ok && kod(r1c.e).includes("STATION_NOT_ROUTABLE"), r1c.ok ? "geçti" : kod(r1c.e));
    if (r1c.ok) woIds.push((r1c.v.data as { id: string }).id);

    // ── §2 oturum yok ──────────────────────────────────────────────────────
    const s2a = await bekle(WorkSessionService.open({ userId: admin.id, deviceRowId: dev1, machineId: devereM, permissions: ["mobile:devere", "mobile:dokuma"] }));
    check("§2a WARPING istasyonunun makinesinde oturum → 400 (oturum türü değil; Devere ekranı gezici)", !s2a.ok && s2a.e instanceof AppError && s2a.e.statusCode === 400, s2a.ok ? "AÇILDI (fail-open!)" : kod(s2a.e));
    if (s2a.ok) await WorkSessionService.closeForDevice(dev1).catch(() => undefined);
    const s2b = await bekle(WorkSessionService.open({ userId: admin.id, deviceRowId: dev1, stationId: devereSt, permissions: ["mobile:devere", "mobile:dokuma"] }));
    check("§2b WARPING istasyonunda istasyon-modu oturum → 400", !s2b.ok && s2b.e instanceof AppError && s2b.e.statusCode === 400, s2b.ok ? "AÇILDI" : kod(s2b.e));
    if (s2b.ok) await WorkSessionService.closeForDevice(dev1).catch(() => undefined);

    // ── §3 motor = kapasite ────────────────────────────────────────────────
    const ids = new Set((await listDevereMachines()).data.map((m) => m.id));
    check("§3a WARPING + producesWarpBeam:true makinesi devere listesinde VAR", ids.has(devereM));
    check("§3b WARPING + producesWarpBeam:false makinesi listede YOK (tür yetenek yerine geçmez)", !ids.has(devereNoCapM));
    check("§3c OTHER + producesWarpBeam:true makinesi listede VAR (bugünkü 'Diğer + Levent sarar' yolu bozulmadı)", ids.has(otherCapM));

    // ── §4 körlük zemini ───────────────────────────────────────────────────
    check("§4 körlük zemini: aynı fikstürde TAMBUR adımı rotaya GİRDİ (kapı seçici)", routeIds.length === 1, `${routeIds.length} rota`);
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
