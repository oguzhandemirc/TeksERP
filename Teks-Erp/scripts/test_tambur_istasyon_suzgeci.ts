// Tambur bekleyen listesinde istasyon süzgeci (ister 2.8 — iki tamburlu fabrika).
// Çalıştırma:  npx tsx scripts/test_tambur_istasyon_suzgeci.ts
// Ürettiği kayıtları id'leriyle hatırlar ve sonunda siler.
//
// Doğrulananlar (pending-rolls + open-cards — tablet open-cards'ı okur):
//   §1 stationId=Tambur-2 yalnız Tambur-2'de SIRADAKİ topları/kartları döner; Tambur-1 kendininkileri.
//   §2 Parametresiz liste = iki tamburun birleşimi (bugünkü küme; süzgeç yokken davranış aynı).
//   §3 Kurşun adımındaki (dağıtılmamış kurşun) ve rotasız top HİÇBİR kipte listede değil.
//   §4 Fail-closed: bilinmeyen id 404 STATION_NOT_FOUND · pasif 400 STATION_INACTIVE ·
//      TAMBUR olmayan 400 STATION_NOT_TAMBUR · biçimsiz/çoklu id 400 (controller Zod + errorHandler).

import type { NextFunction, Request, Response } from "express";
import { RollEntrySource, RollStatus, StationKind, StationType, StepStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { TamburService } from "../src/services/tambur.service";
import { TamburController } from "../src/controllers/tambur.controller";
import { errorHandler } from "../src/middlewares/error.middleware";
import { AppError } from "../src/utils/app-error";

const tambur = new TamburService();

const created = {
  rolls: [] as string[],
  cards: [] as string[],
  steps: [] as string[],
  wos: [] as string[],
  stations: [] as string[],
  items: [] as string[],
};

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const tag = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

async function makeStation(name: string, kind: StationKind, isActive = true) {
  const s = await prisma.station.create({
    data: { code: `TEST-${name.slice(0, 3)}${name.slice(-1)}-${tag}`, name: `Test ${name}`, type: StationType.INTERNAL, kind, isActive },
    select: { id: true },
  });
  created.stations.push(s.id);
  return s.id;
}

async function makeWorkOrder(label: string, stationIds: string[]) {
  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `TEST-TIS-${label}-${tag}`, status: "IN_PROGRESS" },
    select: { id: true, workOrderNumber: true },
  });
  created.wos.push(wo.id);
  const card = await prisma.travelerCard.create({
    data: { cardNumber: wo.workOrderNumber, barcode: wo.workOrderNumber, workOrderId: wo.id },
    select: { id: true },
  });
  created.cards.push(card.id);
  const steps: string[] = [];
  for (const [i, stationId] of stationIds.entries()) {
    const st = await prisma.workOrderStep.create({
      data: { workOrderId: wo.id, stationId, stepSequence: i + 1, status: StepStatus.ACTIVE },
      select: { id: true },
    });
    created.steps.push(st.id);
    steps.push(st.id);
  }
  return { woId: wo.id, steps };
}

async function makeRoll(itemId: string, stepId: string | null, qty = 100) {
  const r = await prisma.roll.create({
    data: {
      barcode: null,
      itemId,
      width: 150,
      initialQty: qty,
      currentQty: qty,
      status: RollStatus.IN_PRODUCTION,
      entrySource: RollEntrySource.SUBCONTRACTOR_RETURN,
      currentStepId: stepId,
    },
    select: { id: true },
  });
  created.rolls.push(r.id);
  return r.id;
}

async function pendingIds(stationId: string | null): Promise<Set<string>> {
  const res = await tambur.getPendingRolls(stationId);
  return new Set(res.data!.map((r) => r.id).filter((id) => created.rolls.includes(id)));
}
async function cardSteps(stationId: string | null): Promise<Set<string>> {
  const res = await tambur.listOpenCards(stationId);
  return new Set(res.data!.map((c) => c.stepId).filter((id) => created.steps.includes(id)));
}
const same = (a: Set<string>, b: string[]) => a.size === b.length && b.every((x) => a.has(x));

async function expectAppError(label: string, fn: () => Promise<unknown>, status: number, code: string) {
  try {
    await fn();
    check(label, false, "hata bekleniyordu, liste döndü");
  } catch (e) {
    const ok = e instanceof AppError && e.statusCode === status && (e.details as { code?: string })?.code === code;
    check(label, ok, ok ? `${status} ${code} "${(e as Error).message}"` : String(e));
  }
}

// Controller + errorHandler zinciri: HTTP katmanının vereceği durum kodu.
async function viaController(method: "getPendingRolls" | "listOpenCards", query: Record<string, unknown>) {
  const ctrl = new TamburController();
  let status = 0;
  let body: unknown = null;
  const res = {
    status(s: number) { status = s; return this; },
    json(b: unknown) { body = b; return this; },
    setHeader() { return this; },
    headersSent: false,
  } as unknown as Response;
  const req = { query, method: "GET", originalUrl: "/api/tambur/x", headers: {}, params: {} } as unknown as Request;
  let forwarded: unknown = null;
  await ctrl[method](req, res, ((e: unknown) => { forwarded = e; }) as NextFunction);
  if (forwarded) errorHandler(forwarded as Error, req, res, (() => {}) as NextFunction);
  return { status, body };
}

async function main() {
  console.log("=== Tambur istasyon süzgeci (ister 2.8) ===\n");
  const item = await prisma.item.create({
    data: { code: `TEST-TIS-${tag}`, name: `TEST Tambur süzgeç ${tag}`, itemType: "FABRIC" },
    select: { id: true },
  });
  created.items.push(item.id);

  const t1 = await makeStation("TAMBUR1", StationKind.TAMBUR);
  const t2 = await makeStation("TAMBUR2", StationKind.TAMBUR);
  const kursun = await makeStation("KURSUN", StationKind.PROCESS_QC);
  const passive = await makeStation("TAMBURPASIF", StationKind.TAMBUR, false);

  // Rota A: Kurşun → Tambur-1 · Rota B: Kurşun → Tambur-2
  const a = await makeWorkOrder("A", [kursun, t1]);
  const b = await makeWorkOrder("B", [kursun, t2]);
  const rA = await makeRoll(item.id, a.steps[1]!);
  const rB1 = await makeRoll(item.id, b.steps[1]!);
  const rB2 = await makeRoll(item.id, b.steps[1]!);
  const rKursun = await makeRoll(item.id, b.steps[0]!); // dağıtılmamış kurşun: sıradaki adım Kurşun
  const rNoRoute = await makeRoll(item.id, null); // rotasız

  // §1
  const p1 = await pendingIds(t1);
  const p2 = await pendingIds(t2);
  check("§1a pending stationId=Tambur-1 yalnız Tambur-1 topu", same(p1, [rA]), `${p1.size} top`);
  check("§1b pending stationId=Tambur-2 yalnız Tambur-2 topları", same(p2, [rB1, rB2]), `${p2.size} top`);
  const c1 = await cardSteps(t1);
  const c2 = await cardSteps(t2);
  check("§1c open-cards stationId=Tambur-1 yalnız A'nın tambur adımı", same(c1, [a.steps[1]!]));
  check("§1d open-cards stationId=Tambur-2 yalnız B'nin tambur adımı", same(c2, [b.steps[1]!]));
  const http1 = await viaController("getPendingRolls", { stationId: t2 });
  const httpIds = ((http1.body as { data: { id: string }[] }).data ?? []).map((r) => r.id).filter((id) => created.rolls.includes(id));
  check("§1e controller ?stationId=Tambur-2 → 200 ve yalnız B topları", http1.status === 200 && same(new Set(httpIds), [rB1, rB2]), `status=${http1.status}`);

  // §2
  const p0 = await pendingIds(null);
  const c0 = await cardSteps(null);
  check("§2a pending parametresiz = iki tamburun birleşimi", same(p0, [rA, rB1, rB2]), `${p0.size} top`);
  check("§2b open-cards parametresiz = iki tambur adımı", same(c0, [a.steps[1]!, b.steps[1]!]));
  const http0 = await viaController("listOpenCards", {});
  check("§2c controller parametresiz → 200", http0.status === 200);

  // §3
  const all = [...p0, ...p1, ...p2];
  check("§3a dağıtılmamış kurşun topu hiçbir kipte listede değil", !all.includes(rKursun));
  check("§3b rotasız top hiçbir kipte listede değil", !all.includes(rNoRoute));

  // §4
  const unknownId = "00000000-0000-4000-8000-000000000000";
  await expectAppError("§4a bilinmeyen istasyon → 404", () => tambur.getPendingRolls(unknownId), 404, "STATION_NOT_FOUND");
  await expectAppError("§4b pasif istasyon → 400", () => tambur.getPendingRolls(passive), 400, "STATION_INACTIVE");
  await expectAppError("§4c Tambur olmayan istasyon → 400", () => tambur.getPendingRolls(kursun), 400, "STATION_NOT_TAMBUR");
  await expectAppError("§4d open-cards Tambur olmayan → 400", () => tambur.listOpenCards(kursun), 400, "STATION_NOT_TAMBUR");
  const bad = await viaController("getPendingRolls", { stationId: "abc" });
  check("§4e biçimsiz id → 400 Türkçe", bad.status === 400 && JSON.stringify(bad.body).includes("Geçersiz istasyon ID"), JSON.stringify(bad.body));
  const multi = await viaController("listOpenCards", { stationId: [t1, t2] });
  check("§4f çoklu id sessizce düşmez → 400", multi.status === 400, `status=${multi.status}`);
  const nf = await viaController("listOpenCards", { stationId: unknownId });
  check("§4g controller bilinmeyen id → 404", nf.status === 404, `status=${nf.status}`);

  // §5 açık kart toplam metresi Decimal'den toplanır (Number toplamı 0.1+0.2 = 0.30000000000000004 artığı bırakır).
  const c = await makeWorkOrder("C", [kursun, t1]);
  await makeRoll(item.id, c.steps[1]!, 0.1);
  await makeRoll(item.id, c.steps[1]!, 0.2);
  const cardC = (await tambur.listOpenCards(t1)).data!.find((x) => x.stepId === c.steps[1]);
  check("§5a open-cards totalCurrentQty kayan nokta artığı taşımaz (0.1 + 0.2 = 0.3)", cardC?.totalCurrentQty === 0.3, `toplam=${cardC?.totalCurrentQty}`);
}

async function cleanup() {
  await prisma.roll.deleteMany({ where: { id: { in: created.rolls } } });
  await prisma.travelerCard.deleteMany({ where: { id: { in: created.cards } } });
  await prisma.workOrderStep.deleteMany({ where: { id: { in: created.steps } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: created.wos } } });
  await prisma.station.deleteMany({ where: { id: { in: created.stations } } });
  await prisma.item.deleteMany({ where: { id: { in: created.items } } });
}

main()
  .catch((e) => {
    fail++;
    console.error("❌ beklenmeyen hata:", e);
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch (e) {
      fail++;
      console.error("❌ temizlik başarısız:", e);
    }
    await prisma.$disconnect();
    await pool.end();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
  });
