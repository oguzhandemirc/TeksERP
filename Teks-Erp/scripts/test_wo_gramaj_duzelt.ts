// =============================================================================
// BEKÇİ — TABLET "GRAMAJI DEĞİŞTİR": başlamış iş emrinde kurşun gramajı (kullanıcı kararı 2026-11-06)
// Çalıştır: npx tsx scripts/run-all-tests.ts wo_gramaj_duzelt
// =============================================================================
//   §1 önizleme (`getWorkOrderKursunGramaj`): hedef · seçenekler · kurşunu uygulanmış / kalan canlı top sayısı
//   §2 ⭐ değişim: uygulanmış topun RollOperation gramajı DEĞİŞMEZ · uyarı "N topa eski … kalan M topa" ·
//      İE hareket defterine FIELD_CHANGED `kursunGramaj` (sebep + eski/yeni ad) · aynısı no-op, uyarısız
//   §3 kapı: route `workorder:write ∨ mobile:is-emri-duzelt` · ⭐ yalnız tablet izniyle İE'de OLMAYAN kurşun dışı hedef 403
//      (mevcut hedefin sebepli düzeltmesi 2026-11-09'dan beri serbest — `test_wo_target_tablet_fix`) ·
//      tablet izniyle kapanmış İE 409 WORK_ORDER_PLAN_FROZEN · panel izniyle (workorder:write) bugünkü gibi serbest
// NEGATİF SONDA (2026-11-06): `kursunRollSplit`teki uygulanmış top süzgeci (`id notIn`) kaldırılınca §1/§2 sayıları
//   KIRMIZI; controller'da `kursunOnly` (2026-11-09: `tabletFix`) hep false yapılınca §3 ⭐ 403 KIRMIZI.
// =============================================================================
import type { NextFunction, Request, Response } from "express";
import prisma, { pool } from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { getWorkOrderKursunGramaj, replaceWorkOrderTargetValues } from "../src/services/workorder-target-value.service";
import { putTargetValues } from "../src/controllers/workorder-process.controller";
import { requireAnyPermission } from "../src/middlewares/rbac.middleware";
import { applyKursunOperationTx } from "../src/services/helpers/kursun-operation.helper";
import { KURSUN_PROPERTY_CODE } from "../src/services/helpers/quality-station.helper";
import { KURSUN_GRAMAJ_EVENT_FIELD } from "../src/constants/workorder-event-labels";
import { testActorId } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}
function section(t: string): void { console.log(`\n── ${t} ──`); }

const STAMP = `${process.pid % 10000}${Date.now().toString(36).slice(-4)}`;
const P = `TEST-WGD-${STAMP}`;
const fx = {
  rollIds: [] as string[], woIds: [] as string[], stationIds: [] as string[], machineIds: [] as string[],
  propIds: [] as string[], valueIds: [] as string[], itemIds: [] as string[], kursunCreated: null as string | null,
};

async function setupGramaj(): Promise<{ propId: string; v25: string; v50: string }> {
  let kursun = await prisma.fabricProperty.findUnique({ where: { code: KURSUN_PROPERTY_CODE }, select: { id: true } });
  if (!kursun) {
    kursun = await prisma.fabricProperty.create({ data: { code: KURSUN_PROPERTY_CODE, name: `TEST Kurşunlu ${STAMP}`, valueType: "FLAG" }, select: { id: true } });
    fx.kursunCreated = kursun.id;
  }
  let variant = await prisma.fabricProperty.findFirst({ where: { variantOfPropertyId: kursun.id }, select: { id: true } });
  if (!variant) {
    variant = await prisma.fabricProperty.create({
      data: { code: `${P}-GR`.slice(0, 32), name: `TEST WGD gramaj ${STAMP}`, valueType: "CHOICE", variantOfPropertyId: kursun.id },
      select: { id: true },
    });
    fx.propIds.push(variant.id);
  }
  const mk = async (n: string, sort: number) => {
    const v = await prisma.fabricPropertyValue.create({
      data: { propertyId: variant!.id, code: `WGD${n}-${STAMP}`.slice(0, 32), name: `${n} gr ${STAMP}`, sortOrder: sort },
      select: { id: true },
    });
    fx.valueIds.push(v.id);
    return v.id;
  };
  return { propId: variant.id, v25: await mk("25", 10), v50: await mk("50", 20) };
}

let rollSeq = 0;
async function mkRoll(itemId: string, stepId: string, status: "IN_PRODUCTION" | "SCRAP" = "IN_PRODUCTION"): Promise<string> {
  rollSeq++;
  const roll = await prisma.roll.create({
    data: { itemId, barcode: `${P}-R${rollSeq}`, initialQty: 100, currentQty: 100, status, currentStepId: stepId },
    select: { id: true },
  });
  fx.rollIds.push(roll.id);
  await prisma.rollMovement.create({ data: { rollId: roll.id, workOrderStepId: stepId, qtyIn: 100 } });
  return roll.id;
}

type Captured = { status: number; body: { warnings?: string[] } | null; err: unknown };
async function callPut(workOrderId: string, permissions: string[], userId: string, body: unknown): Promise<Captured> {
  const out: Captured = { status: 0, body: null, err: null };
  const req = { params: { id: workOrderId }, body, user: { userId, permissions } } as unknown as Request;
  const res = { status(c: number) { out.status = c; return this; }, json(b: Captured["body"]) { out.body = b; return this; } } as unknown as Response;
  await putTargetValues(req, res, ((e: unknown) => { out.err = e; }) as NextFunction);
  return out;
}
function gate(permissions: string[]): unknown {
  let got: unknown = "next-yok";
  requireAnyPermission("workorder:write", "mobile:is-emri-duzelt")({ user: { userId: "x", permissions } } as unknown as Request, {} as Response, ((e?: unknown) => { got = e ?? null; }) as NextFunction);
  return got;
}

async function main(): Promise<void> {
  console.log("=== Tablet gramaj düzeltmesi — başlamış iş emri ===");
  const actor = await testActorId();
  const g = await setupGramaj();
  const item = await prisma.item.create({ data: { code: `${P}-ITM`, name: `TEST WGD kumaş ${STAMP}`, itemType: "FABRIC" }, select: { id: true } });
  fx.itemIds.push(item.id);
  const st = await prisma.station.create({
    data: { code: `${P}-K`.slice(0, 32), name: `TEST WGD kurşun ${STAMP}`, type: "INTERNAL", kind: "PROCESS_QC", appliesProperty: true },
    select: { id: true },
  });
  fx.stationIds.push(st.id);
  const m = await prisma.machine.create({ data: { stationId: st.id, code: `${P}-M`.slice(0, 32), name: `TEST WGD makine ${STAMP}` }, select: { id: true } });
  fx.machineIds.push(m.id);
  // Kurşun dışı ÇEŞİT özelliği (brode deseni benzeri): bayrak + tek çeşidi.
  const flag = await prisma.fabricProperty.create({ data: { code: `${P}-DF`.slice(0, 32), name: `TEST WGD desenli ${STAMP}`, valueType: "FLAG" }, select: { id: true } });
  const other = await prisma.fabricProperty.create({
    data: { code: `${P}-OT`.slice(0, 32), name: `TEST WGD desen ${STAMP}`, valueType: "CHOICE", variantOfPropertyId: flag.id, values: { create: [{ code: "X", name: "X" }] } },
    select: { id: true, values: { select: { id: true } } },
  });
  fx.propIds.push(other.id, flag.id);

  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `${P}-WO`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", targetItemId: item.id,
      steps: { create: [{ stationId: st.id, stepSequence: 1, status: "ACTIVE" as const }] },
    },
    select: { id: true, steps: { select: { id: true } } },
  });
  fx.woIds.push(wo.id);
  const stepId = wo.steps[0]!.id;
  await replaceWorkOrderTargetValues(wo.id, [{ propertyId: g.propId, valueId: g.v25 }], actor);
  const done = [await mkRoll(item.id, stepId), await mkRoll(item.id, stepId)];
  for (const r of done) await prisma.$transaction((tx) => applyKursunOperationTx(tx, { rollId: r, stepId, valueId: g.v25, userId: actor, machineId: m.id }));
  for (let i = 0; i < 3; i++) await mkRoll(item.id, stepId);
  await mkRoll(item.id, stepId, "SCRAP"); // ölü top kalan sayısına girmez

  section("§1 önizleme");
  const pre = await getWorkOrderKursunGramaj(wo.id);
  check("hedef 25, özellik kurşun çeşidi", pre.target?.valueId === g.v25 && pre.propertyId === g.propId);
  check("seçeneklerde 25 ve 50 var", pre.options.some((o) => o.id === g.v25) && pre.options.some((o) => o.id === g.v50));
  check("⭐ uygulanmış 2 · kalan canlı 3 (ölü top hariç)", pre.appliedRollCount === 2 && pre.pendingRollCount === 3, `${pre.appliedRollCount}/${pre.pendingRollCount}`);
  check("başlamış İE düzenlenebilir", pre.editable === true);

  section("§2 değişim");
  const r = await callPut(wo.id, ["mobile:is-emri-duzelt"], actor, { items: [{ propertyId: g.propId, valueId: g.v50 }], reason: "Müşteri 50 gr istedi" });
  check("tablet izniyle kurşun gramajı yazılır (200)", r.status === 200 && r.err === null, String((r.err as Error | null)?.message ?? r.status));
  const w = r.body?.warnings ?? [];
  check("⭐ uyarı: 2 topa eski gramaj, kalan 3 topa yeni", w.some((x) => x.includes("2 topa") && x.includes("kalan 3 topa")), JSON.stringify(w));
  const ops = await prisma.rollOperation.findMany({ where: { rollId: { in: done }, revokedAt: null }, select: { propertyValueId: true } });
  check("⭐ uygulanmış topların gramajı DEĞİŞMEDİ (25)", ops.length === 2 && ops.every((o) => o.propertyValueId === g.v25), JSON.stringify(ops));
  const post = await getWorkOrderKursunGramaj(wo.id);
  check("yeni hedef 50", post.target?.valueId === g.v50);
  const ev = await prisma.workOrderEvent.findMany({ where: { workOrderId: wo.id, field: KURSUN_GRAMAJ_EVENT_FIELD }, select: { fromValue: true, toValue: true, reason: true, toLabel: true } });
  check("⭐ İE hareket defteri: FIELD_CHANGED kursunGramaj 25→50 + sebep", ev.length === 2 && ev.some((e) => e.fromValue === g.v25 && e.toValue === g.v50 && e.reason === "Müşteri 50 gr istedi" && e.toLabel === `50 gr ${STAMP}`), JSON.stringify(ev));
  const same = await callPut(wo.id, ["mobile:is-emri-duzelt"], actor, { items: [{ propertyId: g.propId, valueId: g.v50 }] });
  const ev2 = await prisma.workOrderEvent.count({ where: { workOrderId: wo.id, field: KURSUN_GRAMAJ_EVENT_FIELD } });
  check("aynısı no-op: uyarı yok, yeni defter satırı yok", same.status === 200 && !(same.body?.warnings?.length) && ev2 === 2, `${ev2}`);

  section("§3 kapı");
  check("route: mobile:is-emri-duzelt geçer", gate(["mobile:is-emri-duzelt"]) === null);
  check("route: workorder:write geçer", gate(["workorder:write"]) === null);
  const denied = gate(["workorder:read"]);
  check("route: yalnız workorder:read → 403", denied instanceof AppError && denied.statusCode === 403);
  const wide = await callPut(wo.id, ["mobile:is-emri-duzelt"], actor, { items: [{ propertyId: other.id, valueId: other.values[0]!.id }] });
  check("⭐ tablet izniyle İE'de olmayan kurşun dışı hedef → 403", wide.err instanceof AppError && wide.err.statusCode === 403, String((wide.err as Error | null)?.message ?? wide.status));
  const panel = await callPut(wo.id, ["workorder:write"], actor, { items: [{ propertyId: other.id, valueId: other.values[0]!.id }] });
  check("panel izniyle kurşun dışı özellik bugünkü gibi yazılır", panel.status === 200 && panel.err === null);
  await prisma.workOrder.update({ where: { id: wo.id }, data: { status: "COMPLETED" } });
  const frozen = await callPut(wo.id, ["mobile:is-emri-duzelt"], actor, { items: [{ propertyId: g.propId, valueId: g.v25 }] });
  check("tablet izniyle kapanmış İE → 409 WORK_ORDER_PLAN_FROZEN", frozen.err instanceof AppError && frozen.err.statusCode === 409 && frozen.err.details?.code === "WORK_ORDER_PLAN_FROZEN");
  check("kapanmış İE önizlemede düzenlenemez", (await getWorkOrderKursunGramaj(wo.id)).editable === false);
}

async function cleanup(): Promise<void> {
  const del = async (ad: string, f: () => Promise<unknown>) => {
    try { await f(); } catch (e) { fail++; console.log(`❌ temizlik ${ad}: ${(e as Error).message.split("\n")[0]}`); }
  };
  const ids = fx.rollIds;
  await del("rollOperation", () => prisma.rollOperation.deleteMany({ where: { rollId: { in: ids } } }));
  await del("rollMovement", () => prisma.rollMovement.deleteMany({ where: { rollId: { in: ids } } }));
  await del("roll", () => prisma.roll.deleteMany({ where: { id: { in: ids } } }));
  // Hareket defteri silinmeye kapalı (tamper trigger'ı) — öteki bekçiler gibi sessiz geçilir; İE silinince satır kalır.
  await prisma.workOrderEvent.deleteMany({ where: { workOrderId: { in: fx.woIds } } }).catch(() => undefined);
  await del("targetValue", () => prisma.workOrderTargetValue.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("travelerCard", () => prisma.travelerCard.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("step", () => prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("workOrder", () => prisma.workOrder.deleteMany({ where: { id: { in: fx.woIds } } }));
  await del("machine", () => prisma.machine.deleteMany({ where: { id: { in: fx.machineIds } } }));
  await del("station", () => prisma.station.deleteMany({ where: { id: { in: fx.stationIds } } }));
  await del("value", () => prisma.fabricPropertyValue.deleteMany({ where: { OR: [{ id: { in: fx.valueIds } }, { propertyId: { in: fx.propIds } }] } }));
  await del("variant bağı", () => prisma.fabricProperty.updateMany({ where: { id: { in: fx.propIds } }, data: { variantOfPropertyId: null } }));
  await del("property", () => prisma.fabricProperty.deleteMany({ where: { id: { in: fx.propIds } } }));
  if (fx.kursunCreated) { const k = fx.kursunCreated; await del("KURSUN", () => prisma.fabricProperty.deleteMany({ where: { id: k } })); }
  await del("item", () => prisma.item.deleteMany({ where: { id: { in: fx.itemIds } } }));
  const left = await prisma.roll.count({ where: { barcode: { startsWith: P } } });
  check("temizlik: TEST-WGD top kalıntısı yok", left === 0, String(left));
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
