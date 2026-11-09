// =============================================================================
// BEKÇİ — TABLET "HEDEF DEĞERİ DEĞİŞTİR": `PUT /api/work-orders/:id/target-values` tablet düzeltme kuralları (2026-11-09)
// Çalıştır: npx tsx scripts/run-all-tests.ts wo_target_tablet_fix
// =============================================================================
//   §1 saf eşleme (`workorder-target-value-step.helper`): sıradaki ilk yetenekli adım · bayrak (variantOf) eşlemesi ·
//      eşlenemeyen → ilk adım (fail-closed) · kurşun gramajı adım kilidinden muaf
//   §2 ⭐ başarı (yalnız tablet izni): değer değişir · İE hareket defteri FIELD_CHANGED `targetValue` (TARGET_VALUE_CHANGE +
//      sebep + kod + "Özellik: değer" etiketleri) · refakat kartı contentDirty · audit satırında sebep
//   §3 sebep zorunlu (yok / kısa → 400, değer değişmez)
//   §4 kapsam: İE'de olmayan hedef ekleme 403 · kaldırma (valueId null) 403
//   §5 ⭐ değerin adımı başladıysa 409 TARGET_VALUE_STEP_STARTED · eşlenemeyen değer ilk adım başlayınca 409, başlamadan 200
//   §6 ⭐ tx İÇİ kilit: ön kontrolden sonra, İE kilidi beklenirken adım başlarsa 409 (yarış, elle açık tx)
//   §7 kapanmış İE 409 WORK_ORDER_PLAN_FROZEN
//   §8 panel izni: `correction` yoksa bugünkü gibi serbest · `correction: true` ile aynı kilit (409)
//   §9 ⭐ İE detayı `targetValues[].edit` yazma kapısıyla AYNI sonucu verir + seçenekler (aktif değerler)
// NEGATİF SONDA (2026-11-09, taban 32/0): tx içi `assertTabletFixScope` kaldırılınca §6 2 ❌ · adım kilidi hep açık
//   (`locked = false`) → §5/§6/§8/§9 6 ❌ · controller `correction`ı yok sayınca §8 1 ❌; üçü de geri alındı.
// =============================================================================
import type { NextFunction, Request, Response } from "express";
import prisma, { pool } from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { putTargetValues } from "../src/controllers/workorder-process.controller";
import { findById } from "../src/services/workorder/detail";
import { resolveTargetValueStep, targetValueEditLock, type TargetStepLite } from "../src/services/helpers/workorder-target-value-step.helper";
import { TARGET_VALUE_STEP_STARTED } from "../src/services/workorder-target-value.service";
import { TARGET_VALUE_EVENT_FIELD } from "../src/constants/workorder-event-labels";
import { testActorId } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}
function section(t: string): void { console.log(`\n── ${t} ──`); }

const STAMP = `${process.pid % 10000}${Date.now().toString(36).slice(-4)}`;
const P = `TEST-WTF-${STAMP}`;
const fx = { woIds: [] as string[], stationIds: [] as string[], itemIds: [] as string[], propIds: [] as string[] };
const TABLET = ["mobile:is-emri-duzelt"];
const REASON = "Müşteri deseni değiştirdi";

type Captured = { status: number; body: unknown; err: unknown };
async function callPut(workOrderId: string, userId: string, body: unknown, permissions: string[] = TABLET): Promise<Captured> {
  const out: Captured = { status: 0, body: null, err: null };
  const req = { params: { id: workOrderId }, body, user: { userId, permissions } } as unknown as Request;
  const res = { status(c: number) { out.status = c; return this; }, json(b: unknown) { out.body = b; return this; } } as unknown as Response;
  await putTargetValues(req, res, ((e: unknown) => { out.err = e; }) as NextFunction);
  return out;
}
const errStatus = (c: Captured): number | null => (c.err instanceof AppError ? c.err.statusCode : null);
const errCode = (c: Captured): string | undefined => (c.err instanceof AppError ? (c.err.details as { code?: string } | undefined)?.code : undefined);
const errText = (c: Captured): string => String((c.err as Error | null)?.message ?? c.status);

async function waitForLockWaiter(timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (Number(rows[0]?.n ?? 0) > 0) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

function sectionPure(): void {
  section("§1 saf eşleme");
  const st = (id: string, seq: number, status: string, caps: string[]): TargetStepLite =>
    ({ id, stepSequence: seq, status, station: { name: id, propertyCapabilities: caps.map((propertyId) => ({ propertyId })) } });
  const steps = [st("C", 3, "PENDING", ["F"]), st("A", 1, "ACTIVE", []), st("B", 2, "PENDING", ["F"])];
  check("sıradaki ilk yetenekli adım (B, C değil)", resolveTargetValueStep(steps, { propertyId: "V", variantOfPropertyId: "F" })?.id === "B");
  check("özelliğin kendisi de eşler", resolveTargetValueStep([st("X", 1, "PENDING", ["V"])], { propertyId: "V" })?.id === "X");
  const lockB = targetValueEditLock(steps, { propertyId: "V", variantOfPropertyId: "F" });
  check("adımı PENDING → açık", lockB.stepId === "B" && !lockB.locked);
  const un = targetValueEditLock(steps, { propertyId: "U", variantOfPropertyId: "G" });
  check("⭐ eşlenemeyen + ilk adım başladı → kilitli (fail-closed)", un.stepId === null && un.locked && !!un.reason);
  check("eşlenemeyen + ilk adım bekliyor → açık", !targetValueEditLock([st("A", 1, "PENDING", [])], { propertyId: "U" }).locked);
  check("kurşun gramajı adım başlasa da açık (ayrı kural)", !targetValueEditLock([st("K", 1, "ACTIVE", ["F"])], { propertyId: "V", variantOfPropertyId: "F", isKursun: true }).locked);
}

async function main(): Promise<void> {
  console.log("=== Tablet Hedef Değeri Değiştir ===");
  sectionPure();
  const actor = await testActorId();
  const item = await prisma.item.create({ data: { code: `${P}-ITM`, name: `TEST WTF kumaş ${STAMP}`, itemType: "FABRIC" }, select: { id: true } });
  fx.itemIds.push(item.id);
  const mkFlag = async (sfx: string) => {
    const f = await prisma.fabricProperty.create({ data: { code: `${P}-${sfx}`.slice(0, 32), name: `TEST WTF ${sfx} ${STAMP}`, valueType: "FLAG" }, select: { id: true } });
    fx.propIds.push(f.id);
    return f.id;
  };
  const mkVariant = async (sfx: string, flagId: string) => {
    const v = await prisma.fabricProperty.create({
      data: {
        code: `${P}-${sfx}`.slice(0, 32), name: `Desen ${sfx}`, valueType: "CHOICE", variantOfPropertyId: flagId,
        values: { create: [{ code: "X", name: "Zebra", sortOrder: 1 }, { code: "Y", name: "Jasmin", sortOrder: 2 }, { code: "Z", name: "Pasif", sortOrder: 3, isActive: false }] },
      },
      select: { id: true, values: { select: { id: true, code: true } } },
    });
    fx.propIds.unshift(v.id);
    const val = (c: string) => v.values.find((x) => x.code === c)!.id;
    return { id: v.id, X: val("X"), Y: val("Y") };
  };
  const flagD = await mkFlag("FD");
  const flagU = await mkFlag("FU");
  const D = await mkVariant("D", flagD);
  const U = await mkVariant("U", flagU);
  const mkSt = async (sfx: string, kind: "PROCESS_QC" | "TAMBUR", caps: string[]) => {
    const s = await prisma.station.create({ data: { code: `${P}-${sfx}`.slice(0, 32), name: `TEST WTF ${sfx} ${STAMP}`, type: "INTERNAL", kind }, select: { id: true } });
    fx.stationIds.push(s.id);
    for (const propertyId of caps) await prisma.stationProperty.create({ data: { stationId: s.id, propertyId } });
    return s.id;
  };
  const stQc = await mkSt("QC", "PROCESS_QC", []);
  const stBrode = await mkSt("BR", "PROCESS_QC", [flagD]);
  const stTambur = await mkSt("TB", "TAMBUR", []);

  let seq = 0;
  const mkWo = async (targets: Array<{ propertyId: string; valueId: string }>) => {
    seq++;
    const number = `${P}-WO${seq}`;
    const wo = await prisma.workOrder.create({
      data: {
        workOrderNumber: number, type: "STOCK_PRODUCTION", status: "PLANNED", targetItemId: item.id,
        steps: { create: [{ stationId: stQc, stepSequence: 1 }, { stationId: stBrode, stepSequence: 2 }, { stationId: stTambur, stepSequence: 3 }] },
        targetValues: { create: targets },
      },
      select: { id: true, steps: { select: { id: true, stationId: true } } },
    });
    fx.woIds.push(wo.id);
    await prisma.travelerCard.create({ data: { workOrderId: wo.id, cardNumber: number, barcode: number } });
    const stepOf = (sid: string) => wo.steps.find((s) => s.stationId === sid)!.id;
    return { id: wo.id, qcStep: stepOf(stQc), brodeStep: stepOf(stBrode) };
  };
  const valueOf = async (woId: string, propertyId: string) =>
    (await prisma.workOrderTargetValue.findFirst({ where: { workOrderId: woId, propertyId, revokedAt: null }, select: { valueId: true } }))?.valueId ?? null;
  const events = (woId: string) => prisma.workOrderEvent.findMany({
    where: { workOrderId: woId, type: "FIELD_CHANGED", field: TARGET_VALUE_EVENT_FIELD },
    select: { fromValue: true, toValue: true, fromLabel: true, toLabel: true, trigger: true, reason: true, reasonCode: true, createdById: true },
  });

  section("§2 başarı — yalnız tablet izni");
  const a = await mkWo([{ propertyId: D.id, valueId: D.X }]);
  // İlk adım (QC) başladı ama değerin adımı (Brode) beklemede → düzeltilebilir.
  await prisma.workOrderStep.update({ where: { id: a.qcStep }, data: { status: "ACTIVE" } });
  const ok = await callPut(a.id, actor, { items: [{ propertyId: D.id, valueId: D.Y }], reason: REASON, reasonCode: "MUSTERI_DEGISTIRDI", correction: true });
  check("200", ok.status === 200 && ok.err === null, errText(ok));
  check("⭐ hedef Jasmin oldu", (await valueOf(a.id, D.id)) === D.Y);
  const ev = await events(a.id);
  check("⭐ İE hareket defteri: targetValue X→Y, TARGET_VALUE_CHANGE, sebep + kod + yazar + etiket",
    ev.length === 1 && ev[0]!.fromValue === D.X && ev[0]!.toValue === D.Y && ev[0]!.trigger === "TARGET_VALUE_CHANGE"
      && ev[0]!.reason === REASON && ev[0]!.reasonCode === "MUSTERI_DEGISTIRDI" && ev[0]!.createdById === actor
      && ev[0]!.fromLabel === "Desen D: Zebra" && ev[0]!.toLabel === "Desen D: Jasmin",
    JSON.stringify(ev));
  const card = await prisma.travelerCard.findUniqueOrThrow({ where: { workOrderId: a.id }, select: { contentDirty: true } });
  check("⭐ refakat kartı güncel değil (contentDirty)", card.contentDirty === true);
  const logs = await prisma.systemLog.findMany({ where: { tableName: "WORK_ORDER_TARGET_VALUE", action: "CREATE" }, select: { newData: true }, orderBy: { createdAt: "desc" }, take: 20 });
  check("audit CREATE satırında sebep", logs.some((l) => { const n = l.newData as { workOrderId?: string; reason?: string } | null; return n?.workOrderId === a.id && n.reason === REASON; }));
  const same = await callPut(a.id, actor, { items: [{ propertyId: D.id, valueId: D.Y }], reason: REASON });
  check("aynı değer no-op: yeni defter satırı yok", same.status === 200 && (await events(a.id)).length === 1, errText(same));

  section("§3 sebep");
  const noReason = await callPut(a.id, actor, { items: [{ propertyId: D.id, valueId: D.X }] });
  check("sebepsiz → 400", errStatus(noReason) === 400, errText(noReason));
  const shortReason = await callPut(a.id, actor, { items: [{ propertyId: D.id, valueId: D.X }], reason: "x" });
  check("kısa sebep → 400, değer değişmedi", errStatus(shortReason) === 400 && (await valueOf(a.id, D.id)) === D.Y, errText(shortReason));
  const badCode = await callPut(a.id, actor, { items: [{ propertyId: D.id, valueId: D.X }], reason: REASON, reasonCode: "YOK_BOYLE_KOD" });
  check("tanınmayan sebep kodu → 400", errStatus(badCode) === 400, errText(badCode));

  section("§4 kapsam");
  const add = await callPut(a.id, actor, { items: [{ propertyId: U.id, valueId: U.X }], reason: REASON });
  check("İE'de olmayan hedef ekleme → 403", errStatus(add) === 403 && (await valueOf(a.id, U.id)) === null, errText(add));
  const remove = await callPut(a.id, actor, { items: [{ propertyId: D.id, valueId: null }], reason: REASON });
  check("kaldırma → 403, değer duruyor", errStatus(remove) === 403 && (await valueOf(a.id, D.id)) === D.Y, errText(remove));
  const empty = await callPut(a.id, actor, { items: [], reason: REASON });
  check("boş liste (eski 'hepsini kaldır') → 403", errStatus(empty) === 403 && (await valueOf(a.id, D.id)) === D.Y, errText(empty));

  section("§5 adım kilidi");
  await prisma.workOrderStep.update({ where: { id: a.brodeStep }, data: { status: "ACTIVE" } });
  const locked = await callPut(a.id, actor, { items: [{ propertyId: D.id, valueId: D.X }], reason: REASON });
  check("⭐ değerin adımı başladı → 409 TARGET_VALUE_STEP_STARTED", errStatus(locked) === 409 && errCode(locked) === TARGET_VALUE_STEP_STARTED, errText(locked));
  check("değer ve defter değişmedi", (await valueOf(a.id, D.id)) === D.Y && (await events(a.id)).length === 1);
  const u1 = await mkWo([{ propertyId: U.id, valueId: U.X }]);
  const unOk = await callPut(u1.id, actor, { items: [{ propertyId: U.id, valueId: U.Y }], reason: REASON });
  check("eşlenemeyen değer, ilk adım beklemede → 200", unOk.status === 200 && (await valueOf(u1.id, U.id)) === U.Y, errText(unOk));
  await prisma.workOrderStep.update({ where: { id: u1.qcStep }, data: { status: "ACTIVE" } });
  const unLocked = await callPut(u1.id, actor, { items: [{ propertyId: U.id, valueId: U.X }], reason: REASON });
  check("⭐ eşlenemeyen değer, ilk adım başladı → 409 (fail-closed)", errStatus(unLocked) === 409 && (await valueOf(u1.id, U.id)) === U.Y, errText(unLocked));

  section("§6 tx içi kilit (yarış)");
  const c = await mkWo([{ propertyId: D.id, valueId: D.X }]);
  let raced: Captured | null = null;
  let waited = false;
  await prisma.$transaction(async (tx) => {
    // İE satır kilidi elde: servis ön kontrolü geçer (Brode PENDING), `touchWorkOrderTx`te bekler.
    await tx.workOrder.updateMany({ where: { id: c.id }, data: { updatedAt: new Date() } });
    const pending = callPut(c.id, actor, { items: [{ propertyId: D.id, valueId: D.Y }], reason: REASON });
    waited = await waitForLockWaiter(5000);
    await tx.workOrderStep.update({ where: { id: c.brodeStep }, data: { status: "ACTIVE" } });
    void pending.then((r) => { raced = r; });
  }, { timeout: 15000 });
  for (let i = 0; i < 200 && raced === null; i++) await new Promise((r) => setTimeout(r, 25));
  const r6 = raced as Captured | null;
  check("servis kilitte bekledi (yarış kuruldu)", waited);
  check("⭐ kilit beklenirken adım başladı → 409", r6 !== null && errStatus(r6) === 409, r6 ? errText(r6) : "yanıt yok");
  check("değer ve defter değişmedi", (await valueOf(c.id, D.id)) === D.X && (await events(c.id)).length === 0);

  section("§7 kapanmış İE");
  const d = await mkWo([{ propertyId: D.id, valueId: D.X }]);
  await prisma.workOrder.update({ where: { id: d.id }, data: { status: "COMPLETED" } });
  const frozen = await callPut(d.id, actor, { items: [{ propertyId: D.id, valueId: D.Y }], reason: REASON });
  check("kapanmış İE → 409 WORK_ORDER_PLAN_FROZEN", errStatus(frozen) === 409 && errCode(frozen) === "WORK_ORDER_PLAN_FROZEN", errText(frozen));

  section("§8 panel izni");
  const e = await mkWo([{ propertyId: D.id, valueId: D.X }]);
  await prisma.workOrderStep.update({ where: { id: e.brodeStep }, data: { status: "ACTIVE" } });
  const corr = await callPut(e.id, actor, { items: [{ propertyId: D.id, valueId: D.Y }], reason: REASON, correction: true }, ["workorder:write"]);
  check("⭐ panel izni + correction:true → aynı kilit (409)", errStatus(corr) === 409 && (await valueOf(e.id, D.id)) === D.X, errText(corr));
  const panel = await callPut(e.id, actor, { items: [{ propertyId: D.id, valueId: D.Y }] }, ["workorder:write"]);
  check("panel izni, correction yok → bugünkü gibi serbest (200)", panel.status === 200 && (await valueOf(e.id, D.id)) === D.Y, errText(panel));

  section("§9 İE detayı");
  const det = (await findById(a.id)).data as { targetValues?: Array<{ propertyId: string; edit?: { stepId: string | null; locked: boolean }; property?: { values?: Array<{ id: string }> } }> } | null;
  const tvA = det?.targetValues?.find((t) => t.propertyId === D.id);
  check("⭐ detay: Brode adımına eşlendi + kilitli (yazma kapısıyla aynı)", tvA?.edit?.stepId === a.brodeStep && tvA.edit.locked === true, JSON.stringify(tvA?.edit));
  check("detay: seçenekler yalnız aktif değerler (2)", tvA?.property?.values?.length === 2 && tvA.property.values.some((v) => v.id === D.X), JSON.stringify(tvA?.property?.values));
  const detC = (await findById(u1.id)).data as { targetValues?: Array<{ propertyId: string; edit?: { stepId: string | null; locked: boolean } }> } | null;
  const tvU = detC?.targetValues?.find((t) => t.propertyId === U.id);
  check("detay: eşlenemeyen değer stepId null + kilitli", tvU?.edit?.stepId === null && tvU.edit.locked === true, JSON.stringify(tvU?.edit));
}

async function cleanup(): Promise<void> {
  const del = async (ad: string, f: () => Promise<unknown>) => {
    try { await f(); } catch (e) { fail++; console.log(`❌ temizlik ${ad}: ${(e as Error).message.split("\n")[0]}`); }
  };
  // Hareket defteri silinmeye kapalı (tamper trigger'ı) — öteki bekçiler gibi sessiz geçilir.
  await prisma.workOrderEvent.deleteMany({ where: { workOrderId: { in: fx.woIds } } }).catch(() => undefined);
  await del("targetValue", () => prisma.workOrderTargetValue.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("travelerCard", () => prisma.travelerCard.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("step", () => prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("workOrder", () => prisma.workOrder.deleteMany({ where: { id: { in: fx.woIds } } }));
  await del("stationProperty", () => prisma.stationProperty.deleteMany({ where: { stationId: { in: fx.stationIds } } }));
  await del("station", () => prisma.station.deleteMany({ where: { id: { in: fx.stationIds } } }));
  await del("value", () => prisma.fabricPropertyValue.deleteMany({ where: { propertyId: { in: fx.propIds } } }));
  await del("variant bağı", () => prisma.fabricProperty.updateMany({ where: { id: { in: fx.propIds } }, data: { variantOfPropertyId: null } }));
  await del("property", () => prisma.fabricProperty.deleteMany({ where: { id: { in: fx.propIds } } }));
  await del("item", () => prisma.item.deleteMany({ where: { id: { in: fx.itemIds } } }));
  const left = await prisma.workOrder.count({ where: { workOrderNumber: { startsWith: P } } });
  check("temizlik: TEST-WTF iş emri kalıntısı yok", left === 0, String(left));
}

main()
  .catch((e) => { fail++; console.error(e); })
  .finally(async () => {
    await cleanup().catch((e) => { fail++; console.error(e); });
    if (pass + fail === 0) { fail++; console.log("❌ hiçbir kontrol koşmadı"); }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end().catch(() => {});
  });
