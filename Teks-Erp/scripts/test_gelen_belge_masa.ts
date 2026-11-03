// =============================================================================
// BEKÇİ — Gelen belge "Belge masası" bağlamı (Gülkesim S11, K23)
// =============================================================================
// Çalıştır: npx tsx scripts/run-all-tests.ts gelen_belge_masa
//
// NE ÖLÇER (sunucusuz; servis katmanı):
//   §1 `listDeskKursunMachines`: yalnız kurşun istasyonunun (KURSUN AUTO + akış) AKTİF makineleri; pasif makine ve
//      kurşunsuz istasyon makinesi YOK; satır anahtarları opt-in (id, code, name, stationId)
//   §2 `deskRouteSuggestion`: plan ucu zinciriyle (`suggestRoute`) birebir; müşteriye tanımlı tek rota → öneri o rota
//      (CUSTOMER_FIRST'te); sahipsiz çağrı da aynı zincir
//
// FİKSTÜR KENDİ KENDİNE (`TEST-MASA-` damgası); `finally`de FK sırasıyla sökülür.
// NEGATİF SONDALAR (2026-11-03, tekserp_gks11_test; pozitif 9/0):
//   (a) servis `station` süzgecini kaldırınca → §1c ❌ (8/1) · (b) `isActive` süzgecini kaldırınca → §1b ❌ (8/1); geri alındı
// =============================================================================
import { StationKind } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import prisma, { pool } from "../src/lib/prisma";
import { deskRouteSuggestion, listDeskKursunMachines } from "../src/services/gelen-belge-masa.service";
import { suggestRoute } from "../src/services/gelen-belge-rota-onerisi.service";
import { readRouteSuggestionPriority } from "../src/services/system-setting.service";
import { cleanupTestCustomers } from "./fixture-customer-cleanup";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

const STAMP = `${process.pid}${Date.now().toString(36)}`.slice(-10).toUpperCase();
const created = { stationIds: [] as string[], machineIds: [] as string[], routeIds: [] as string[], customerIds: [] as string[] };

async function station(suffix: string, kind: StationKind): Promise<string> {
  const st = await prisma.station.create({
    data: { code: `TEST-MASA-${suffix}-${STAMP}`.slice(0, 32), name: `TEST MASA ${suffix} ${STAMP}`, type: "INTERNAL", kind, department: "KALITE" },
    select: { id: true },
  });
  created.stationIds.push(st.id);
  return st.id;
}

async function machine(stationId: string, suffix: string, isActive: boolean): Promise<string> {
  const m = await prisma.machine.create({ data: { stationId, code: `TM-${suffix}-${STAMP}`.slice(0, 32), name: `TEST MASA ${suffix} ${STAMP}`, isActive }, select: { id: true } });
  created.machineIds.push(m.id);
  return m.id;
}

async function machinesSection(): Promise<void> {
  const kursunProp = await prisma.fabricProperty.findFirst({ where: { code: "KURSUN" }, select: { id: true } });
  check("fikstür: KURSUN özelliği var", !!kursunProp);
  if (!kursunProp) return;
  const k = await station("K", StationKind.PROCESS_QC);
  await prisma.stationProperty.create({ data: { stationId: k, propertyId: kursunProp.id, mode: "AUTO" } });
  const plain = await station("P", StationKind.PROCESS_QC);
  const active = await machine(k, "A", true);
  const passive = await machine(k, "X", false);
  const other = await machine(plain, "O", true);
  const list = await listDeskKursunMachines();
  const ids = new Set(list.map((m) => m.id));
  check("§1a kurşun istasyonunun aktif makinesi listede", ids.has(active));
  check("§1b ⭐ pasif makine listede YOK", !ids.has(passive));
  check("§1c ⭐ kurşunsuz istasyonun makinesi listede YOK", !ids.has(other));
  const row = list.find((m) => m.id === active);
  check("§1d satır anahtarları opt-in (id, code, name, stationId)", !!row && Object.keys(row).sort().join(",") === "code,id,name,stationId", Object.keys(row ?? {}).join(","));
  check("§1e makinenin istasyonu döner", row?.stationId === k);
}

async function suggestionSection(): Promise<void> {
  const cust = await prisma.customer.create({ data: { code: `TEST-MASA-C-${STAMP}`.slice(0, 32), name: `TEST MASA Müşteri ${STAMP}` }, select: { id: true } });
  created.customerIds.push(cust.id);
  const st = created.stationIds[0] ?? (await station("R", StationKind.PROCESS_QC));
  const route = await prisma.route.create({
    data: { name: `TEST MASA Rota ${STAMP}`, customerId: cust.id, steps: { create: [{ stationId: st, sequence: 1 }] } },
    select: { id: true },
  });
  created.routeIds.push(route.id);
  const got = await deskRouteSuggestion(cust.id);
  check("§2a ⭐ masa önerisi plan zinciriyle birebir", isDeepStrictEqual(got, await suggestRoute({ ownerCustomerId: cust.id })));
  if ((await readRouteSuggestionPriority()) === "CUSTOMER_FIRST") {
    check("§2b müşteriye tanımlı tek rota önerilir", got.routeTemplateId === route.id && got.source === "CUSTOMER_ROUTE", `${got.source} ${got.routeTemplateId}`);
  } else console.log("ℹ️ §2b atlandı: fabrika önceliği FACTORY_FIRST");
  check("§2c sahipsiz öneri de aynı zincir", isDeepStrictEqual(await deskRouteSuggestion(null), await suggestRoute({ ownerCustomerId: null })));
}

async function cleanup(): Promise<void> {
  const steps: Array<[string, () => Promise<unknown>]> = [
    ["routeStep", () => prisma.routeStep.deleteMany({ where: { routeId: { in: created.routeIds } } })],
    ["route", () => prisma.route.deleteMany({ where: { id: { in: created.routeIds } } })],
    ["machine", () => prisma.machine.deleteMany({ where: { id: { in: created.machineIds } } })],
    ["stationProperty", () => prisma.stationProperty.deleteMany({ where: { stationId: { in: created.stationIds } } })],
    ["station", () => prisma.station.deleteMany({ where: { id: { in: created.stationIds } } })],
    ["customer", () => cleanupTestCustomers(created.customerIds)],
  ];
  for (const [name, run] of steps) {
    try { await run(); } catch (e) { console.log(`⚠️ temizlik ${name}: ${e instanceof Error ? e.message : String(e)}`); }
  }
}

async function main(): Promise<void> {
  try {
    await machinesSection();
    await suggestionSection();
  } catch (e) {
    check("beklenmeyen hata", false, e instanceof Error ? e.stack ?? e.message : String(e));
  } finally {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  }
}

void main();
