// =============================================================================
// BEKÇİ — Detaylı KK istasyonu: kurşunsuz kalite adımı + ikinci kısayol (Gülkesim S4)
// =============================================================================
// Çalıştır: npx tsx scripts/run-all-tests.ts detayli_kk_istasyonu
//
// NE ÖLÇER: Kurşun(KURSUN AUTO, muayene açık) → DETAYLI KK (özelliksiz, muayene açık,
// makinesiz) → Tambur rotasında tablet zinciri (fabrika cevabı 22, 29, 35-ek):
//   §1 Kurşun tableti: özet appliesKursun, KK2 tamamla KURSUN_APPLIED yazar, adımı kapat → toplar DKK'da
//   §2 DKK tableti: aynı kart DKK adımını açar; özet kurşunsuz (appliesKursun false, özellik yok,
//      muayene açık), sonraki istasyon Tambur; açık kart listesi DKK'ya göre süzülür
//   §3 DKK'da gelen kumaş hatası işaretlenir (hata kaydı DKK adımında) ve silinebilir
//   §4 DKK KK2 tamamla KURSUN_APPLIED YAZMAZ, kurşun özelliği yalnız kurşun adımından
//   §5 DKK adımını kapat → toplar Tambur adımında, iki akış adımı COMPLETED
//   §6 Kurulum betiği (`detayli-kk-kurulum.ts`): kuru koşu 0 yazım · uygulama istasyon + kısayol
//      rotası (Kurşun → DKK → Tambur, sıra taban kısayol +1) · ikinci koşum hep SAME ·
//      kurşunsuz olmayan istasyon / kurşun yeteneksiz taban ÇAKIŞMA, 0 yazım
//
// FİKSTÜR KENDİ KENDİNE (`TEST-DKK-` damgası); `finally`de FK sırasıyla sökülür.
// NEGATİF SONDALAR (2026-11-03, tekserp_gks4_test; pozitif 23/0):
//   (a) betik istasyonu appliesProperty AÇIK yaratınca → §6b ❌ (22/1)
//   (b) betik rota adımlarını DKK → Kurşun → Tambur dizince → §6c ❌ (22/1)
//   (c) adım özetinde appliesKursun hep true → §2b ❌ (22/1); üçü geri alındı
// =============================================================================
import { RollForm, RollOperationType, RollStatus, StationKind, StepStatus, TravelerCardStatus, WorkOrderStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { KursunQcService } from "../src/services/kursun-qc.service";
import { inspectionDefaultForKind } from "../src/services/helpers/quality-station.helper";
import { applyDetayliKkSetup, planDetayliKkSetup, type DetayliKkSetupInput } from "./detayli-kk-kurulum";
import { testActorId } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}
function section(t: string): void { console.log(`\n── ${t}`); }

const STAMP = `${process.pid}${Date.now().toString(36)}`.slice(-10).toUpperCase();
const svc = new KursunQcService();
/** Betiğin yarattığı istasyonun türü = tablet ekran türü (kimlik denetimi; kalite sorusu değil). */
const SCREEN_KIND: StationKind = StationKind.PROCESS_QC;
const created = { itemId: "", defectTypeId: "", stationIds: [] as string[], woIds: [] as string[], rollIds: [] as string[], routeIds: [] as string[] };

async function makeStation(suffix: string, name: string, kind: StationKind, extra: { appliesProperty?: boolean; appliesQuality?: boolean } = {}): Promise<{ id: string; code: string }> {
  const st = await prisma.station.create({
    data: {
      code: `TEST-DKK-${suffix}-${STAMP}`.slice(0, 32), name: `TEST ${name} ${STAMP}`, type: "INTERNAL", kind, department: "KALITE",
      inspectionEnabled: inspectionDefaultForKind(kind), ...extra,
    },
    select: { id: true, code: true },
  });
  created.stationIds.push(st.id);
  return st;
}

async function makeWo(route: string[], rollCount: number): Promise<{ woId: string; card: string; steps: string[]; rollIds: string[] }> {
  const number = `TEST-DKK-${STAMP}-${created.woIds.length + 1}`;
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: number, type: "STOCK_PRODUCTION", status: WorkOrderStatus.IN_PROGRESS, targetItemId: created.itemId,
      steps: { create: route.map((stationId, i) => ({ stationId, stepSequence: i + 1, status: i === 0 ? StepStatus.ACTIVE : StepStatus.PENDING })) },
    },
    select: { id: true, steps: { select: { id: true }, orderBy: { stepSequence: "asc" } } },
  });
  created.woIds.push(wo.id);
  await prisma.travelerCard.create({ data: { cardNumber: number, barcode: number, workOrderId: wo.id, status: TravelerCardStatus.ACTIVE } });
  const steps = wo.steps.map((s) => s.id);
  const rollIds: string[] = [];
  for (let i = 0; i < rollCount; i++) {
    const roll = await prisma.roll.create({
      data: { barcode: null, itemId: created.itemId, initialQty: 100, currentQty: 100, status: RollStatus.IN_PRODUCTION, currentStepId: steps[0], entrySource: "SUBCONTRACTOR_RETURN", form: RollForm.ACIK },
      select: { id: true },
    });
    created.rollIds.push(roll.id);
    rollIds.push(roll.id);
    await prisma.rollMovement.create({ data: { rollId: roll.id, workOrderStepId: steps[0], qtyIn: 100 } });
  }
  return { woId: wo.id, card: number, steps, rollIds };
}

async function opsAt(stepId: string, type: RollOperationType): Promise<number> {
  return prisma.rollOperation.count({ where: { workOrderStepId: stepId, operationType: type } });
}

async function flowSections(actorId: string, kursun: { id: string }, dkk: { id: string; code: string }, tambur: { id: string }): Promise<void> {
  const wo = await makeWo([kursun.id, dkk.id, tambur.id], 2);
  // Gelen kumaş hatası tipi kendi fikstürü (ortamdaki katalogdan bağımsız).
  const defect = await prisma.defectType.create({ data: { code: `TEST-DKK-${STAMP}`, name: `TEST gelen kumaş lekesi ${STAMP}` }, select: { id: true } });
  created.defectTypeId = defect.id;

  section("§1 Kurşun tableti → kurşun yazar, toplar Detaylı KK'ya");
  const s1 = await svc.getByCardBarcode(wo.card, kursun.id);
  check("§1a kurşun özeti: kurşun adımı, appliesKursun, sonraki = Detaylı KK",
    s1.data.workOrderStepId === wo.steps[0] && s1.data.appliesKursun === true && s1.data.nextStepName === `TEST DETAYLI KK ${STAMP}`,
    `${s1.data.appliesKursun} · ${s1.data.nextStepName}`);
  for (const r of s1.data.rolls) await svc.completeQc2({ rollId: r.rollId, stepId: wo.steps[0] }, actorId);
  check("§1b kurşun adımında 2 KURSUN_APPLIED", (await opsAt(wo.steps[0], RollOperationType.KURSUN_APPLIED)) === 2);
  const f1 = await svc.finishStep({ stepId: wo.steps[0] }, actorId);
  const at1 = await prisma.roll.findMany({ where: { id: { in: wo.rollIds } }, select: { currentStepId: true } });
  check("§1c ⭐ adımı kapat → 2 top Detaylı KK adımında", f1.data.movedRollCount === 2 && at1.every((r) => r.currentStepId === wo.steps[1]), `${f1.data.movedRollCount}`);

  section("§2 Detaylı KK tableti → kurşunsuz özet");
  const s2 = await svc.getByCardBarcode(wo.card, dkk.id);
  check("§2a ⭐ aynı kart DKK oturumunda DKK adımını açar", s2.data.workOrderStepId === wo.steps[1] && s2.data.rolls.length === 2, `${s2.data.rolls.length} top`);
  check("§2b ⭐ özet kurşunsuz: appliesKursun false, özellik yok, muayene açık",
    s2.data.appliesKursun === false && (s2.data.properties ?? []).length === 0 && s2.data.inspectionEnabled === true,
    `${s2.data.appliesKursun}/${(s2.data.properties ?? []).length}/${s2.data.inspectionEnabled}`);
  check("§2c sonraki istasyon Tambur", s2.data.nextStepName === `TEST Tambur ${STAMP}`, `${s2.data.nextStepName}`);
  const listed = (await svc.listOpenCards(dkk.id)).data.filter((c) => c.workOrderId === wo.woId);
  const listedK = (await svc.listOpenCards(kursun.id)).data.filter((c) => c.workOrderId === wo.woId);
  check("§2d açık kart listesi: DKK'da görünür (DKK adımı), kurşunda görünmez",
    listed.length === 1 && listed[0].stepId === wo.steps[1] && listedK.length === 0, `${listed.length}/${listedK.length}`);

  section("§3 Detaylı KK'da gelen kumaş hatası işaretlenir");
  const rollA = s2.data.rolls[0].rollId;
  const err = await svc.reportError({ rollId: rollA, stepId: wo.steps[1], startMeter: 12, defectTypeId: defect.id }, actorId);
  const errRow = await prisma.rollError.findUnique({ where: { id: err.data.id }, select: { detectedAtStepId: true, rollId: true } });
  check("§3a ⭐ hata kaydı DKK adımında yazıldı", errRow?.detectedAtStepId === wo.steps[1] && errRow?.rollId === rollA);
  const err2 = await svc.reportError({ rollId: rollA, stepId: wo.steps[1], startMeter: 40, defectTypeId: defect.id }, actorId);
  await svc.deleteError({ errorId: err2.data.id }, actorId);
  check("§3b yanlış işaretlenen hata silinir, ilki kalır",
    (await prisma.rollError.count({ where: { detectedAtStepId: wo.steps[1] } })) === 1);

  section("§4 Detaylı KK tamamla → kurşun yazılmaz");
  for (const r of s2.data.rolls) await svc.completeQc2({ rollId: r.rollId, stepId: wo.steps[1] }, actorId);
  check("§4a DKK adımında 2 QC2_COMPLETED", (await opsAt(wo.steps[1], RollOperationType.QC2_COMPLETED)) === 2);
  check("§4b ⭐ DKK adımında KURSUN_APPLIED YOK", (await opsAt(wo.steps[1], RollOperationType.KURSUN_APPLIED)) === 0);

  section("§5 Detaylı KK adımını kapat → Tambur");
  const f2 = await svc.finishStep({ stepId: wo.steps[1] }, actorId);
  const at2 = await prisma.roll.findMany({ where: { id: { in: wo.rollIds } }, select: { currentStepId: true } });
  const st = await prisma.workOrderStep.findMany({ where: { id: { in: wo.steps } }, select: { id: true, status: true } });
  const statusOf = (id: string) => st.find((s) => s.id === id)?.status;
  check("§5a ⭐ 2 top Tambur adımında", f2.data.movedRollCount === 2 && at2.every((r) => r.currentStepId === wo.steps[2]), `${f2.data.movedRollCount}`);
  check("§5b kurşun + DKK adımları COMPLETED", statusOf(wo.steps[0]) === StepStatus.COMPLETED && statusOf(wo.steps[1]) === StepStatus.COMPLETED,
    `${statusOf(wo.steps[0])}/${statusOf(wo.steps[1])}`);
  check("§5c hata kaydı Tambur kararına taşınır (topla gider)", (await prisma.rollError.count({ where: { rollId: rollA } })) === 1);
}

async function setupSections(actorId: string, kursun: { code: string; id: string }, tambur: { code: string; id: string }, plainQc: { code: string }): Promise<void> {
  section("§6 Kurulum betiği — kuru koşu / uygulama / idempotent / çakışma");
  const base = await prisma.route.create({
    data: { code: `TEST-DKK-B-${STAMP}`.slice(0, 32), name: `TEST DKK TABAN ${STAMP}`, isWorkOrderShortcut: true, shortcutOrder: 7, steps: { create: [{ stationId: kursun.id, sequence: 1 }, { stationId: tambur.id, sequence: 2 }] } },
    select: { id: true },
  });
  created.routeIds.push(base.id);
  const input: DetayliKkSetupInput = {
    station: { code: `TEST-DKK-S-${STAMP}`.slice(0, 32), name: `test dkk betik ${STAMP}` },
    route: { code: `TEST-DKK-R-${STAMP}`.slice(0, 32), name: `test kurşun & dkk & tambur ${STAMP}` },
    kursunStationCode: kursun.code, tamburStationCode: tambur.code,
  };
  const plan = await planDetayliKkSetup(input);
  const wrote = await prisma.station.count({ where: { code: input.station.code } }) + await prisma.route.count({ where: { code: input.route.code } });
  check("§6a kuru koşu: istasyon + rota CREATE, 0 yazım", plan.map((r) => `${r.kind}:${r.action}`).join(",") === "STATION:CREATE,ROUTE:CREATE" && wrote === 0,
    plan.map((r) => `${r.kind}:${r.action}`).join(","));

  const res = await applyDetayliKkSetup(input, actorId);
  const station = await prisma.station.findUnique({ where: { code: input.station.code }, select: { id: true, kind: true, appliesQuality: true, inspectionEnabled: true, appliesProperty: true, _count: { select: { propertyCapabilities: true, machines: true } } } });
  const route = await prisma.route.findUnique({ where: { code: input.route.code }, select: { id: true, isWorkOrderShortcut: true, shortcutOrder: true, steps: { orderBy: { sequence: "asc" }, select: { stationId: true } } } });
  if (station) created.stationIds.push(station.id);
  if (route) created.routeIds.push(route.id);
  check("§6b ⭐ istasyon: PROCESS_QC, akış + muayene açık, özellik yok, makine yok",
    res.conflicts.length === 0 && station?.kind === SCREEN_KIND && station.appliesQuality && station.inspectionEnabled && !station.appliesProperty
      && station._count.propertyCapabilities === 0 && station._count.machines === 0);
  check("§6c ⭐ rota: Kurşun → DKK → Tambur, kısayol, sıra taban +1",
    route?.isWorkOrderShortcut === true && route.shortcutOrder === 8 && route.steps.map((s) => s.stationId).join() === [kursun.id, station?.id, tambur.id].join(),
    `sıra ${route?.shortcutOrder}`);
  const audits = await prisma.systemLog.count({ where: { recordId: { in: [station?.id ?? "", route?.id ?? ""] } } });
  check("§6d audit: iki kayıt için ayak izi", audits === 2, `${audits}`);

  const again = await applyDetayliKkSetup(input, actorId);
  check("§6e ⭐ ikinci koşum: hepsi SAME, yeni kayıt yok", again.records.every((r) => r.action === "SAME") && again.records.length === 2
    && (await prisma.route.count({ where: { code: input.route.code } })) === 1, again.records.map((r) => r.action).join(","));

  const bad = await applyDetayliKkSetup({ ...input, station: { code: plainQc.code, name: "x" }, route: { code: `TEST-DKK-X-${STAMP}`.slice(0, 32), name: `test dkk x ${STAMP}` } }, actorId);
  check("§6f ⭐ özellik uygulayan istasyon kod çakışması: ÇAKIŞMA, rota yazılmadı",
    bad.conflicts.some((r) => r.kind === "STATION" && r.key === plainQc.code) && (await prisma.route.count({ where: { code: `TEST-DKK-X-${STAMP}`.slice(0, 32) } })) === 0);
  const noKursun = await applyDetayliKkSetup({ ...input, kursunStationCode: tambur.code, station: { code: `TEST-DKK-Y-${STAMP}`.slice(0, 32), name: `test dkk y ${STAMP}` } }, actorId);
  check("§6g ⭐ kurşun yeteneksiz taban istasyon: ÇAKIŞMA, istasyon yazılmadı",
    noKursun.conflicts.length > 0 && (await prisma.station.count({ where: { code: `TEST-DKK-Y-${STAMP}`.slice(0, 32) } })) === 0);
}

async function cleanup(): Promise<void> {
  const { rollIds, woIds, stationIds, routeIds, itemId } = created;
  const steps: Array<[string, () => Promise<unknown>]> = [
    ["rollError", () => prisma.rollError.deleteMany({ where: { rollId: { in: rollIds } } })],
    ["rollOperation", () => prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } })],
    ["rollProperty", () => prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } })],
    ["rollMovement", () => prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } })],
    ["roll", () => prisma.roll.deleteMany({ where: { id: { in: rollIds } } })],
    ["travelerCardScan", () => prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: { in: woIds } } } })],
    ["travelerCard", () => prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } })],
    ["workOrderStep", () => prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } })],
    ["workOrder", () => prisma.workOrder.deleteMany({ where: { id: { in: woIds } } })],
    ["routeStep", () => prisma.routeStep.deleteMany({ where: { routeId: { in: routeIds } } })],
    ["route", () => prisma.route.deleteMany({ where: { id: { in: routeIds } } })],
    ["systemLog", () => prisma.systemLog.deleteMany({ where: { recordId: { in: [...woIds, ...rollIds, ...stationIds, ...routeIds] } } })],
    ["stationProperty", () => prisma.stationProperty.deleteMany({ where: { stationId: { in: stationIds } } })],
    ["station", () => prisma.station.deleteMany({ where: { id: { in: stationIds } } })],
    ["item", () => (itemId ? prisma.item.deleteMany({ where: { id: itemId } }) : Promise.resolve())],
    ["defectType", () => (created.defectTypeId ? prisma.defectType.deleteMany({ where: { id: created.defectTypeId } }) : Promise.resolve())],
  ];
  for (const [name, run] of steps) {
    try { await run(); } catch (e) { console.log(`⚠️ temizlik ${name}: ${(e as Error).message.split("\n")[0]}`); }
  }
}

async function main(): Promise<void> {
  const actorId = await testActorId();
  try {
    const item = await prisma.item.create({ data: { code: `TEST-DKK-${STAMP}`, name: `TEST DKK kumaş ${STAMP}`, itemType: "FABRIC" }, select: { id: true } });
    created.itemId = item.id;
    const kursunProp = await prisma.fabricProperty.findFirst({ where: { code: "KURSUN" }, select: { id: true } });
    check("fikstür: KURSUN özelliği var", !!kursunProp);
    const K = await makeStation("K", "Kurşun", StationKind.PROCESS_QC, { appliesQuality: true });
    await prisma.stationProperty.create({ data: { stationId: K.id, propertyId: kursunProp!.id, mode: "AUTO" } });
    const D = await makeStation("D", "DETAYLI KK", StationKind.PROCESS_QC, { appliesProperty: false, appliesQuality: true });
    const T = await makeStation("T", "Tambur", StationKind.TAMBUR);
    const P = await makeStation("P", "Özellikli KK", StationKind.PROCESS_QC, { appliesQuality: true });
    await prisma.stationProperty.create({ data: { stationId: P.id, propertyId: kursunProp!.id, mode: "OPTIONAL" } });
    await flowSections(actorId, K, D, T);
    await setupSections(actorId, K, T, P);
  } finally {
    await cleanup();
  }
}

main()
  .catch((e) => { fail++; console.error(`❌ bekçi çöktü: ${(e as Error).stack ?? e}`); })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
