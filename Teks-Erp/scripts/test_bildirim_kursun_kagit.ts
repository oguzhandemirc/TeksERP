// =============================================================================
// BEKÇİ — BİLDİRİM S6b: kurşun kâğıt (bypass) yolu GERÇEK servis çağrısıyla
// Çalıştır: npx tsx scripts/run-all-tests.ts test_bildirim_kursun_kagit
// =============================================================================
// NEDEN: `test_bildirim_bosluk` §K kâğıt yolunu AST + doğrudan emitter çağrısıyla ölçer; servis metodunun gerçekten
// yaydığını (doğru tx, doğru adım, doğru koşul) yalnız uçtan uca çağrı kanıtlar. Ölçülenler:
//   §G `setGramaj`: hedefe eşit gramaj satır yazmaz; farklı gramaj tek `kursun.gramaj-sapmasi` (topNo "Kâğıt dağıtım").
//   §A `assign`: gramajla atama hedeften farklıysa tek satır, eşitse satır yok, gramajsız atama satır yazmaz.
//   §C `completeFromDistribution` (son adım rotası): tamamlamada verilen farklı gramaj tek satır, eşit gramaj satır yok.
// NEGATİF SONDA (2026-11-15): üç metotta yayma çağrısı ayrı ayrı `if (false)` yapıldı → completeFromDistribution §Ca ❌,
//   setGramaj §Gb/§Gc ❌, assign §Aa ❌. Üçü de geri alındı (kopya + md5).
// =============================================================================
import { Prisma, RollForm, RollStatus, StationKind, StepStatus, TravelerCardStatus, WorkOrderStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { testActorId } from "./fixture-test-user";
import { KursunBypassService } from "../src/services/kursun-bypass.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { inspectionDefaultForKind, KURSUN_PROPERTY_CODE } from "../src/services/helpers/quality-station.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}

const svc = new KursunBypassService();
const ek = `${process.pid}${Date.now().toString(36).slice(-4)}`;
const KIND = "kursun.gramaj-sapmasi";
const iz = { wo: [] as string[], roll: [] as string[], station: [] as string[], machine: [] as string[], value: [] as string[], variant: null as string | null, item: null as string | null };

interface Ortam { itemId: string; stationId: string; machineId: string; tamburStationId: string; variantId: string; hedef: string; farkli: string; userId: string }
interface Is { woId: string; stepId: string; rollIds: string[] }

async function kur(): Promise<Ortam> {
  const item = await prisma.item.create({ data: { code: `TKK-${ek}`, name: `TEST-KK Kumaş ${ek}`, itemType: "FABRIC" }, select: { id: true } });
  iz.item = item.id;
  const userId = await testActorId();
  const tambur = await prisma.station.findFirstOrThrow({ where: { code: "TAMBUR_1" }, select: { id: true } });
  const base = await prisma.fabricProperty.findFirstOrThrow({ where: { code: KURSUN_PROPERTY_CODE }, select: { id: true } });
  let variant = await prisma.fabricProperty.findFirst({ where: { variantOfPropertyId: base.id, isActive: true }, select: { id: true } });
  if (!variant) {
    variant = await prisma.fabricProperty.create({ data: { code: `TKK-V-${ek}`.slice(0, 32), name: `TEST-KK Gramaj ${ek}`, variantOfPropertyId: base.id }, select: { id: true } });
    iz.variant = variant.id;
  }
  const deger = async (n: string) => (await prisma.fabricPropertyValue.create({ data: { propertyId: variant.id, code: `TKK${n}-${ek}`.slice(0, 32), name: `${n} gr TEST` }, select: { id: true } })).id;
  const hedef = await deger("120");
  const farkli = await deger("140");
  iz.value.push(hedef, farkli);
  const st = await prisma.station.create({
    data: { code: `TKK-S-${ek}`.slice(0, 32), name: `TEST-KK Kurşun ${ek}`, type: "INTERNAL", kind: StationKind.PROCESS_QC, department: "KALITE", inspectionEnabled: inspectionDefaultForKind(StationKind.PROCESS_QC) },
    select: { id: true },
  });
  iz.station.push(st.id);
  // mode AUTO: bypass'ta tablet salt-okunur → `assign` OPTIONAL kurşun satırını reddeder (test_kursun_bypass emsali).
  await prisma.stationProperty.create({ data: { stationId: st.id, propertyId: base.id, mode: "AUTO" } });
  const m = await prisma.machine.create({ data: { stationId: st.id, code: `TKK-M-${ek}`.slice(0, 32), name: `TEST-KK Makine ${ek}`, isActive: true }, select: { id: true } });
  iz.machine.push(m.id);
  return { itemId: item.id, stationId: st.id, machineId: m.id, tamburStationId: tambur.id, variantId: variant.id, hedef, farkli, userId };
}

/** İE + kurşun adımı (son adım ya da Tambur'dan önce) + kart + açık hareketli iki barkodsuz top + kurşun hedefi. */
async function isKur(o: Ortam, n: number, sonAdim: boolean): Promise<Is> {
  const no = `TEST-KK-${ek}-${n}`;
  const steps: Array<{ stationId: string; stepSequence: number; status: StepStatus }> = [{ stationId: o.stationId, stepSequence: 1, status: StepStatus.ACTIVE }];
  if (!sonAdim) steps.push({ stationId: o.tamburStationId, stepSequence: 2, status: StepStatus.PENDING });
  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: no, type: "STOCK_PRODUCTION", status: WorkOrderStatus.IN_PROGRESS, targetItemId: o.itemId, steps: { create: steps } },
    select: { id: true, steps: { select: { id: true, stepSequence: true } } },
  });
  iz.wo.push(wo.id);
  const stepId = wo.steps.find((s) => s.stepSequence === 1)!.id;
  await prisma.workOrderTargetValue.create({ data: { workOrderId: wo.id, propertyId: o.variantId, valueId: o.hedef } });
  const batch = await prisma.batch.create({ data: { batchNumber: `TEST-KKP-${ek}-${n}`, workOrderId: wo.id }, select: { id: true } });
  await prisma.travelerCard.create({ data: { cardNumber: no, barcode: no, workOrderId: wo.id, status: TravelerCardStatus.ACTIVE } });
  const rollIds: string[] = [];
  for (const qty of [100, 150]) {
    const r = await prisma.roll.create({
      data: { barcode: null, itemId: o.itemId, batchId: batch.id, initialQty: qty, currentQty: qty, status: RollStatus.IN_PRODUCTION, currentStepId: stepId, entrySource: "SUBCONTRACTOR_RETURN", form: RollForm.ACIK },
      select: { id: true },
    });
    iz.roll.push(r.id);
    rollIds.push(r.id);
    await prisma.rollMovement.create({ data: { rollId: r.id, workOrderStepId: stepId, qtyIn: qty } });
  }
  return { woId: wo.id, stepId, rollIds };
}

const satirlar = (woId: string) => prisma.notificationOutbox.findMany({ where: { kind: KIND, subjectId: woId }, select: { payload: true } });
const yukUygun = (r: Array<{ payload: Prisma.JsonValue }>): boolean => {
  const p = (r[0]?.payload ?? {}) as Record<string, unknown>;
  return r.length === 1 && p.topNo === "Kâğıt dağıtım" && p.gramaj === "140 gr TEST" && p.hedef === "120 gr TEST";
};

async function bolumG(o: Ortam): Promise<void> {
  console.log("\n§G setGramaj");
  const is = await isKur(o, 1, false);
  const a = await svc.assign({ workOrderId: is.woId, machineId: o.machineId }, o.userId);
  check("§Ga gramajsız atama satır yazmaz", (await satirlar(is.woId)).length === 0);
  await svc.setGramaj(a.data.assignmentId, o.hedef, o.userId);
  check("§Ga2 hedefe eşit gramaj satır yazmaz", (await satirlar(is.woId)).length === 0);
  await svc.setGramaj(a.data.assignmentId, o.farkli, o.userId);
  const r = await satirlar(is.woId);
  check("§Gb ⭐ hedeften farklı gramaj → tek satır, top yerine \"Kâğıt dağıtım\"", yukUygun(r), JSON.stringify(r.map((x) => x.payload)));
  await svc.setGramaj(a.data.assignmentId, o.farkli, o.userId);
  check("§Gc aynı gramajı yeniden kaydetmek ikinci satır yazmaz", (await satirlar(is.woId)).length === 1);
}

async function bolumA(o: Ortam): Promise<void> {
  console.log("\n§A assign");
  const farkli = await isKur(o, 2, false);
  await svc.assign({ workOrderId: farkli.woId, machineId: o.machineId, propertyValueId: o.farkli }, o.userId);
  const r = await satirlar(farkli.woId);
  check("§Aa ⭐ farklı gramajla atama → tek satır", yukUygun(r), JSON.stringify(r.map((x) => x.payload)));
  const esit = await isKur(o, 3, false);
  await svc.assign({ workOrderId: esit.woId, machineId: o.machineId, propertyValueId: o.hedef }, o.userId);
  check("§Ab hedefe eşit gramajla atama satır yazmaz", (await satirlar(esit.woId)).length === 0);
}

async function bolumC(o: Ortam): Promise<void> {
  console.log("\n§C completeFromDistribution (son adım)");
  const farkli = await isKur(o, 4, true);
  const a1 = await svc.assign({ workOrderId: farkli.woId, machineId: o.machineId }, o.userId);
  const d1 = await svc.completeFromDistribution(a1.data.assignmentId, { rollIds: farkli.rollIds, propertyValueId: o.farkli }, o.userId);
  const r = await satirlar(farkli.woId);
  check("§Ca ⭐ tamamlamada farklı gramaj → tek satır", d1.data.alreadyDone === false && yukUygun(r), JSON.stringify(r.map((x) => x.payload)));
  const esit = await isKur(o, 5, true);
  const a2 = await svc.assign({ workOrderId: esit.woId, machineId: o.machineId }, o.userId);
  await svc.completeFromDistribution(a2.data.assignmentId, { rollIds: esit.rollIds, propertyValueId: o.hedef }, o.userId);
  check("§Cb tamamlamada hedefe eşit gramaj satır yazmaz", (await satirlar(esit.woId)).length === 0);
}

/** Söküm (FK sırası: outbox → atama → top izleri → İE → makine → istasyon → değer → çeşit → kumaş). */
async function teardown(): Promise<void> {
  const cocuk = await prisma.roll.findMany({ where: { parentRollId: { in: iz.roll } }, select: { id: true } });
  const roll = [...iz.roll, ...cocuk.map((c) => c.id)];
  const atama = (await prisma.kursunBypassAssignment.findMany({ where: { workOrderId: { in: iz.wo } }, select: { id: true } })).map((a) => a.id);
  await prisma.notificationOutbox.deleteMany({ where: { subjectId: { in: [...iz.wo, ...roll] } } });
  await prisma.kursunBypassAssignment.deleteMany({ where: { id: { in: atama } } });
  await prisma.rollError.deleteMany({ where: { rollId: { in: roll } } });
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: roll } } });
  await prisma.rollProperty.deleteMany({ where: { rollId: { in: roll } } });
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: roll } } });
  await prisma.roll.deleteMany({ where: { id: { in: roll } } });
  await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: iz.wo } } });
  await prisma.batch.deleteMany({ where: { workOrderId: { in: iz.wo } } });
  await prisma.workOrderTargetValue.deleteMany({ where: { workOrderId: { in: iz.wo } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: iz.wo } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: iz.wo } } });
  await prisma.systemLog.deleteMany({ where: { recordId: { in: [...iz.wo, ...roll, ...atama] } } });
  await prisma.machine.deleteMany({ where: { id: { in: iz.machine } } });
  await prisma.stationProperty.deleteMany({ where: { stationId: { in: iz.station } } });
  await prisma.station.deleteMany({ where: { id: { in: iz.station } } });
  await prisma.fabricPropertyValue.deleteMany({ where: { id: { in: iz.value } } });
  if (iz.variant) await prisma.fabricProperty.deleteMany({ where: { id: iz.variant } });
  if (iz.item) await prisma.item.deleteMany({ where: { id: iz.item } });
}

async function ayarYaz(key: string, value: boolean): Promise<Prisma.JsonValue | null> {
  const ilk = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  return ilk ? ilk.value : null;
}

async function ayarGeri(key: string, ilk: Prisma.JsonValue | null): Promise<void> {
  if (ilk === null) await prisma.systemSetting.deleteMany({ where: { key } });
  else await prisma.systemSetting.update({ where: { key }, data: { value: ilk as Prisma.InputJsonValue } });
}

async function main(): Promise<void> {
  console.log("=== Bildirim S6b — kurşun kâğıt yolu (gerçek servis) ===");
  const engel = hedefDbEngeli();
  if (engel) throw new Error(`DURDURULDU — ${engel}`);
  const kutu = await ayarYaz(SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED, true);
  const bypass = await ayarYaz(SETTING_KEYS.KURSUN_BYPASS_ENABLED, true);
  try {
    const o = await kur();
    await bolumG(o);
    await bolumA(o);
    await bolumC(o);
  } finally {
    await teardown().catch((e: unknown) => { fail++; console.error("❌ TEMİZLİK HATASI:", e instanceof Error ? e.message : e); });
    await ayarGeri(SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED, kutu);
    await ayarGeri(SETTING_KEYS.KURSUN_BYPASS_ENABLED, bypass);
  }
}

main()
  .catch((e) => { fail++; console.error("❌ beklenmeyen hata:", e); })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
