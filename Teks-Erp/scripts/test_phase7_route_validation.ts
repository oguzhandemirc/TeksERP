// =============================================================================
// TEST: Faz 7 — RouteService nested step ref + sequence guard
// Çalıştır: npx tsx scripts/test_phase7_route_validation.ts
// =============================================================================
// Rota şablonu (bare BaseController) adım referanslarını (stationId vb.) isActive
// + sequence doğrulamıyordu → pasif istasyon şablona sızabiliyordu (soft-delete
// giriş guard'ı eksik, ~5 audit turunda flaglandı). RouteService bunu kapatır.
// =============================================================================

import prisma from "../src/lib/prisma";
import { RouteService } from "../src/services/route.service";
import { AppError } from "../src/utils/app-error";

let pass = 0,
  fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}
function need<T>(v: T | null | undefined, what: string): T {
  if (v == null) throw new Error(`Fixture bulunamadı: ${what}`);
  return v;
}
const is400 = (e: unknown) => e instanceof AppError && e.statusCode === 400;

const routes = new RouteService({ modelName: "route", tableName: "ROUTE", nestedCreateFields: ["steps"] });
let ADMIN = "",
  ACTIVE_STATION = "",
  PASSIVE_STATION = "";
const routeNames: string[] = [];

async function setup(): Promise<void> {
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin").id;
  ACTIVE_STATION = need(
    await prisma.station.findFirst({ where: { isActive: true }, select: { id: true } }),
    "aktif istasyon"
  ).id;
  const ts = Date.now().toString().slice(-6);
  const passive = await prisma.station.create({
    data: { code: `TST-P7-ST-${ts}`, name: "Pasif Test İst.", type: "INTERNAL", isActive: false },
  });
  PASSIVE_STATION = passive.id;
}

async function mkRoute(name: string, steps: Array<{ stationId: string; sequence: number }>): Promise<unknown> {
  routeNames.push(name);
  return routes.create({ name, steps }, ADMIN);
}

async function run(): Promise<void> {
  console.log("\n=== RouteService nested ref + sequence guard ===");

  let badStation: unknown;
  try {
    await mkRoute(`TST-P7-RT-BADST-${Date.now()}`, [{ stationId: PASSIVE_STATION, sequence: 1 }]);
  } catch (e) {
    badStation = e;
  }
  check("pasif istasyonlu adım → 400", is400(badStation));

  const ok = (await mkRoute(`TST-P7-RT-OK-${Date.now()}`, [{ stationId: ACTIVE_STATION, sequence: 1 }])) as {
    success?: boolean;
  };
  check("aktif istasyonlu adım → success", ok.success === true);

  let badSeq: unknown;
  try {
    await mkRoute(`TST-P7-RT-SEQ0-${Date.now()}`, [{ stationId: ACTIVE_STATION, sequence: 0 }]);
  } catch (e) {
    badSeq = e;
  }
  check("sequence=0 → 400", is400(badSeq));

  let dupSeq: unknown;
  try {
    await mkRoute(`TST-P7-RT-DUP-${Date.now()}`, [
      { stationId: ACTIVE_STATION, sequence: 1 },
      { stationId: ACTIVE_STATION, sequence: 1 },
    ]);
  } catch (e) {
    dupSeq = e;
  }
  check("tekrarlı sequence → 400", is400(dupSeq));
}

async function cleanup(): Promise<void> {
  const rs = await prisma.route.findMany({ where: { name: { in: routeNames } }, select: { id: true } });
  const ids = rs.map((r) => r.id);
  await prisma.routeStep.deleteMany({ where: { routeId: { in: ids } } });
  await prisma.route.deleteMany({ where: { id: { in: ids } } });
  if (PASSIVE_STATION) await prisma.station.deleteMany({ where: { id: PASSIVE_STATION } });
}

async function main(): Promise<void> {
  await setup();
  try {
    await run();
  } finally {
    await cleanup();
    console.log("(test verisi temizlendi)");
  }
  console.log("──────────────────────────────────────────");
  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
