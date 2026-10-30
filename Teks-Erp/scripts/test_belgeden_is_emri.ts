// =============================================================================
// TEST (D4-D2): gelen belgeden iş emri — desen grupları + MEVCUT quickStart (grup başına token) + desen araması
// =============================================================================
//   §1 plan: 2 desenli 6 satırlık APPROVED belge → 2 grup (3+3 top), her grup kendi hedef değeriyle; müşteri partisi
//      `customerBatchKeyOf` (sahip:parti) ile; taslak belge → 409 DELIVERY_NOTE_NOT_APPROVED
//   §2 rota BRODE uygulamıyorsa 400 (mevcut kapsama kuralı); ⭐ grup başına quickStart → 2 iş emri, her biri kendi hedef değeriyle (targetValues); ⭐ aynı grup token'ıyla
//      tekrar → replay (yeni iş emri 0); başka canlı iş emrindeki top → red (mevcut kod), yeni iş emri yok;
//      plan artık topları bağlanamaz + canlı iş emriyle gösterir
//   §3 desensiz satır ayrı grup (patternless, sonda); rota şablonu önerisi = aynı sahibin son şablonu
//   §4 İE özeti: `variantTargets` (desen hedefi) + `deliveryNoteGramaj.customerBatches` (türetilmiş müşteri partisi)
//   §5 desen araması (>12 değer): sunucuda süzme, toplam + cursor tek where, iki sayfa ∪ = toplam; çeşit olmayan özellik 400
//   §6 tek tanım: ready-works müşteri partisi SQL'i `customerBatchKeySql`ten (ikinci kopya yok)
// Negatif sonda: `groupToken` grup başına değil TEK token döndürünce §2 "2 iş emri" + replay maddeleri kırmızı.
// Çalıştır: npx tsx scripts/test_belgeden_is_emri.ts
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import prisma from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { createDeliveryNote } from "../src/services/gelen-belge-note.service";
import { approveDeliveryNote } from "../src/services/gelen-belge-onay.service";
import { buildWorkOrderPlan, type PlanGroup } from "../src/services/gelen-belge-is-emri.service";
import { searchProcessChoiceValues } from "../src/services/helpers/process-choice-catalog.helper";
import { customerBatchKeyOf } from "../src/services/helpers/ship-readiness.helper";
import { getWorkOrderProcessSummary } from "../src/services/workorder-target-value.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { testActorId } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exitCode = 1;
}

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

const TAG = `TST-BIE${Date.now().toString(36).toUpperCase()}Z`;
const SETTINGS = [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL];
const made = { notes: [] as string[], items: [] as string[], customers: [] as string[], props: [] as string[], routes: [] as string[], wos: [] as string[], stations: [] as string[] };
const svc = new WorkOrderService();

/** Panelin `attempt.keyed(group.key)` aynası: token MANTIKSAL DENEME × GRUP başına. */
const tokens = new Map<string, string>();
function groupToken(key: string): string {
  let t = tokens.get(key);
  if (!t) tokens.set(key, (t = randomUUID()));
  return t;
}

async function errorOf(fn: () => Promise<unknown>): Promise<{ status: number; code?: string } | null> {
  try { await fn(); return null; } catch (e) {
    if (e instanceof AppError) return { status: e.statusCode, code: (e.details as { code?: string } | undefined)?.code };
    return { status: 500 };
  }
}

/** Panelin grup başına çağrısı: MEVCUT quickStart + hedef (targetValues) + hedef bayrak (rota kapsaması uyarısı). */
function startGroup(g: PlanGroup, routeTemplateId: string) {
  return svc.quickStart({
    clientToken: groupToken(g.key),
    rollBarcodes: g.rolls.filter((r) => r.attachable).map((r) => r.barcode!),
    routeTemplateId,
    targetValues: g.targets.map((t) => ({ propertyId: t.propertyId, valueId: t.valueId })),
    targetPropertyIds: [...new Set(g.targets.map((t) => t.flagPropertyId))],
  }, undefined);
}

async function run(): Promise<void> {
  const actor = await testActorId();
  for (const [k, v] of [[SETTING_KEYS.EMANET_ENABLED, true], [SETTING_KEYS.GELEN_BELGE_ENABLED, true]] as const) {
    await prisma.systemSetting.upsert({ where: { key: k }, create: { key: k, value: v }, update: { value: v } });
  }
  await prisma.systemSetting.deleteMany({ where: { key: { in: [SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL] } } });

  // Katalog: BRODE bayrağı + 15 değerli desen çeşidi (>12: arama modalının ölçeği).
  const flag = await prisma.fabricProperty.create({ data: { code: `${TAG}-BR`.slice(0, 32), name: `TEST Brode ${TAG}`, valueType: "FLAG" }, select: { id: true } });
  made.props.push(flag.id);
  const desen = await prisma.fabricProperty.create({
    data: {
      code: `${TAG}-BD`.slice(0, 32), name: `TEST Brode deseni ${TAG}`, valueType: "CHOICE", variantOfPropertyId: flag.id,
      values: { create: Array.from({ length: 15 }, (_, i) => ({ code: `${TAG}D${i + 10}`.slice(0, 32), name: `Desen Q${i + 10}`, sortOrder: i })) },
    },
    select: { id: true, values: { select: { id: true, name: true } } },
  });
  made.props.push(desen.id);
  const vA = desen.values.find((v) => v.name === "Desen Q10")!.id;
  const vB = desen.values.find((v) => v.name === "Desen Q11")!.id;
  const owner = await prisma.customer.create({ data: { code: `${TAG}-OWN`, name: `${TAG} sahip` }, select: { id: true } });
  made.customers.push(owner.id);
  const fabric = await prisma.item.create({ data: { code: `${TAG}-KUM`, name: `${TAG} perde`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  made.items.push(fabric.id);
  const station = await prisma.station.create({ data: { code: `${TAG}-STN`.slice(0, 32), name: `${TAG} brode`, type: "INTERNAL" }, select: { id: true } });
  made.stations.push(station.id);
  const route = await prisma.route.create({ data: { name: `${TAG} brode rotası`, steps: { create: [{ stationId: station.id, sequence: 1 }] } }, select: { id: true } });
  made.routes.push(route.id);

  const mkNote = async (lines: Array<{ processText: string; meters: number }>, batchNo: string | null) => {
    const n = await createDeliveryNote({
      sourceKind: "MANUAL", ownerCustomerId: owner.id, senderText: `${TAG} GÖNDEREN`, customerBatchNo: batchNo,
      lines: lines.map((l, i) => ({ senderRollNo: `${TAG}-${made.notes.length}-${i + 1}`, meters: l.meters, itemId: fabric.id, processText: l.processText })),
    }, actor);
    made.notes.push(n.id);
    return n.id;
  };

  console.log("§1 Plan — desen grupları");
  const SIX = [
    { processText: "BRODE DESEN Q10", meters: 100 }, { processText: "BRODE DESEN Q10", meters: 110 }, { processText: "BRODE DESEN Q10", meters: 120 },
    { processText: "BRODE DESEN Q11", meters: 90 }, { processText: "BRODE DESEN Q11", meters: 80 }, { processText: "BRODE DESEN Q11", meters: 70 },
  ];
  const noteId = await mkNote(SIX, "  P-77 ");
  const draftErr = await errorOf(() => buildWorkOrderPlan(noteId));
  check("§1 taslak belge → 409 DELIVERY_NOTE_NOT_APPROVED", draftErr?.status === 409 && draftErr.code === "DELIVERY_NOTE_NOT_APPROVED", JSON.stringify(draftErr));
  const ap = await approveDeliveryNote(noteId, {}, actor);
  check("§1 zemin: onay 6 top doğurdu", ap.summary.entered === 6, JSON.stringify(ap.summary));
  const plan = await buildWorkOrderPlan(noteId);
  const gA = plan.groups.find((g) => g.targets.some((t) => t.valueId === vA));
  const gB = plan.groups.find((g) => g.targets.some((t) => t.valueId === vB));
  check("§1 ⭐ 2 grup (desen Q10 · Q11), desensiz yok", plan.groups.length === 2 && !!gA && !!gB && plan.groups.every((g) => !g.patternless), plan.groups.map((g) => `${g.key}:${g.rolls.length}`).join(" "));
  check("§1 her grup 3 top, hepsi bağlanabilir", gA?.rolls.length === 3 && gB?.rolls.length === 3 && gA.attachableCount === 3 && gB.attachableCount === 3);
  check("§1 grup metresi Σ satır (330 / 240)", gA?.totalMeters === "330.00" && gB?.totalMeters === "240.00", `${gA?.totalMeters}/${gB?.totalMeters}`);
  check("§1 hedef = desen değeri, bayrak = BRODE, kaynak PATTERN", gA?.targets.length === 1 && gA.targets[0]!.flagPropertyId === flag.id && gA.targets[0]!.propertyId === desen.id && gA.targets[0]!.source === "PATTERN");
  check("§1 ⭐ müşteri partisi = customerBatchKeyOf(sahip, trim(parti))", plan.customerBatch?.key === customerBatchKeyOf(owner.id, "P-77") && plan.customerBatch?.batchNo === "P-77", JSON.stringify(plan.customerBatch));
  check("§1 rota önerisi: sahibin önceki iş emri yok → null", plan.suggestedRouteTemplateId === null);
  check("§1 seçilebilir özellikler desen çeşidini 15 değerle taşır", plan.choiceProperties.some((p) => p.propertyId === desen.id && p.optionCount === 15 && p.flagPropertyId === flag.id));

  console.log("§2 Grup başına quickStart — 2 iş emri, replay, çakışan top");
  const woBefore = await prisma.workOrder.count();
  // Rota kapsaması (mevcut kural, özellikte SERT): BRODE uygulayamayan rota → 400, iş emri doğmaz.
  const uncovered = await errorOf(() => svc.quickStart({ clientToken: randomUUID(), rollBarcodes: gA!.rolls.map((r) => r.barcode!), routeTemplateId: route.id, targetPropertyIds: [flag.id], targetValues: [{ propertyId: desen.id, valueId: vA }] }, undefined));
  check("§2 brode uygulamayan rota → 400 (rota kapsaması), iş emri yok", uncovered?.status === 400 && (await prisma.workOrder.count()) === woBefore, JSON.stringify(uncovered));
  await prisma.stationProperty.create({ data: { stationId: station.id, propertyId: flag.id } });
  const rA = await startGroup(gA!, route.id);
  const rB = await startGroup(gB!, route.id);
  for (const r of [rA, rB]) if (r.data?.workOrder) made.wos.push(r.data.workOrder.id);
  const ids = [...new Set([rA.data?.workOrder.id, rB.data?.workOrder.id].filter(Boolean))];
  check("§2 ⭐ iki grup → 2 AYRI iş emri (+2)", ids.length === 2 && (await prisma.workOrder.count()) === woBefore + 2, `ids=${ids.length}`);
  check("§2 her iş emri kendi grubunun 3 topunu bağladı", rA.data?.attached === 3 && rB.data?.attached === 3, `${rA.data?.attached}/${rB.data?.attached}`);
  const tv = async (woId: string | undefined) => (woId ? await prisma.workOrderTargetValue.findMany({ where: { workOrderId: woId, revokedAt: null }, select: { valueId: true } }) : []).map((t) => t.valueId);
  const tA = await tv(rA.data?.workOrder.id), tB = await tv(rB.data?.workOrder.id);
  check("§2 ⭐ her iş emri KENDİ hedef değeriyle (Q10 / Q11)", tA.length === 1 && tA[0] === vA && tB.length === 1 && tB[0] === vB, `${tA}/${tB}`);
  const woMid = await prisma.workOrder.count();
  const again = await startGroup(gA!, route.id);
  check("§2 ⭐ aynı grup token'ıyla tekrar → replay (aynı iş emri, yeni iş emri 0)", again.data?.workOrder.id === rA.data?.workOrder.id && (await prisma.workOrder.count()) === woMid, again.message ?? "");
  // Başka canlı iş emrindeki top: yeni token (yeni deneme) ile A'nın topu → mevcut kod reddeder.
  const stolen = gA!.rolls[0]!.barcode!;
  const steal = await errorOf(() => svc.quickStart({ clientToken: randomUUID(), rollBarcodes: [stolen], routeTemplateId: route.id }, undefined));
  check("§2 ⭐ başka canlı iş emrindeki top → red (400, mevcut quickStart ön doğrulaması), yeni iş emri yok", !!steal && steal.status === 400 && (await prisma.workOrder.count()) === woMid, `status=${steal?.status} (mevcut kod)`);
  const after = await buildWorkOrderPlan(noteId);
  const aRoll = after.groups.flatMap((g) => g.rolls).find((r) => r.barcode === stolen);
  check("§2 plan: bağlanmış top artık bağlanamaz + canlı iş emrini gösterir", aRoll?.attachable === false && aRoll.liveWorkOrder?.id === rA.data?.workOrder.id, JSON.stringify(aRoll?.liveWorkOrder));

  console.log("§3 Desensiz grup + rota önerisi");
  const note2 = await mkNote([{ processText: "BRODE DESEN Q12", meters: 50 }, { processText: "SADECE ÜTÜ", meters: 40 }, { processText: "SADECE ÜTÜ", meters: 30 }], null);
  await approveDeliveryNote(note2, {}, actor);
  const p2 = await buildWorkOrderPlan(note2);
  const last = p2.groups[p2.groups.length - 1];
  check("§3 ⭐ desensiz satırlar AYRI grup (patternless, hedefsiz, 2 top) ve sonda", p2.groups.length === 2 && last?.patternless === true && last.targets.length === 0 && last.rolls.length === 2, p2.groups.map((g) => `${g.patternless ? "desensiz" : g.targets[0]?.valueName}:${g.rolls.length}`).join(" "));
  check("§3 parti nosuz belge → müşteri partisi null", p2.customerBatch === null);
  check("§3 ⭐ rota önerisi = aynı sahibin son iş emrinin şablonu", p2.suggestedRouteTemplateId === route.id, String(p2.suggestedRouteTemplateId));

  console.log("§4 İş emri özeti — desen hedefi + müşteri partisi");
  const sum = (await getWorkOrderProcessSummary(rA.data!.workOrder.id)).data;
  check("§4 ⭐ variantTargets = desen hedefi Q10", sum.variantTargets?.length === 1 && sum.variantTargets[0]!.valueId === vA && sum.variantTargets[0]!.propertyId === desen.id, JSON.stringify(sum.variantTargets));
  const cb = sum.deliveryNoteGramaj?.customerBatches ?? [];
  check("§4 ⭐ türetilmiş müşteri partisi P-77 (3 top, sahip adıyla)", cb.length === 1 && cb[0]!.batchNo === "P-77" && cb[0]!.rollCount === 3 && cb[0]!.key === plan.customerBatch?.key && cb[0]!.ownerName === `${TAG} sahip`, JSON.stringify(cb));

  console.log("§5 Desen araması — sunucu, >12 değer");
  const all = await searchProcessChoiceValues({ propertyId: desen.id, limit: 50 });
  check("§5 aramasız: 15 değer, toplam 15, cursor yok", all.items.length === 15 && all.total === 15 && all.nextCursor === null);
  const q = await searchProcessChoiceValues({ propertyId: desen.id, q: "q2", limit: 50 });
  check("§5 ⭐ 'q2' sunucuda süzülür (Q20–Q24 → 5), toplam aynı where'den", q.items.length === 5 && q.total === 5 && q.items.every((v) => v.name.includes("Q2")), q.items.map((v) => v.name).join(","));
  const p1 = await searchProcessChoiceValues({ propertyId: desen.id, limit: 8 });
  const pg2 = await searchProcessChoiceValues({ propertyId: desen.id, limit: 8, cursor: p1.nextCursor ?? undefined });
  const union = new Set([...p1.items, ...pg2.items].map((v) => v.id));
  check("§5 iki sayfa ∪ = toplam (8 + 7), son sayfada cursor yok", p1.items.length === 8 && pg2.items.length === 7 && union.size === 15 && pg2.nextCursor === null && p1.total === 15);
  const bad = await errorOf(() => searchProcessChoiceValues({ propertyId: flag.id, limit: 10 }));
  check("§5 çeşit olmayan özellik (bayrak) → 400 PROCESS_PROPERTY_INVALID", bad?.status === 400 && bad.code === "PROCESS_PROPERTY_INVALID", JSON.stringify(bad));

  console.log("§6 Müşteri partisi tek tanım");
  const rw = readFileSync(path.join(__dirname, "../src/services/ready-works.service.ts"), "utf8");
  check("§6 ready-works parti anahtarı/üyeliği helper'dan (ikinci SQL kopyası yok)", rw.includes("customerBatchKeySql(\"n\")") && rw.includes("customerBatchMemberSql(\"n\")") && !rw.includes(`"ownerCustomerId"::text || ':'`) && !rw.includes(`COALESCE(n."customerBatchNo", '')`));
}

async function cleanup(): Promise<void> {
  const rollIds = (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: { in: made.notes }, rollId: { not: null } }, select: { rollId: true } })).map((r) => r.rollId!);
  const swallow = () => undefined;
  await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: made.notes } } });
  for (const t of ["rollProperty", "rollOperation", "rollMovement", "rollVariance", "warehouseMovement"] as const) {
    await (prisma[t] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }).deleteMany({ where: { rollId: { in: rollIds } } }).catch(swallow);
  }
  await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { currentStepId: null, batchId: null } }).catch(swallow);
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(swallow);
  for (const id of made.wos) {
    await prisma.workOrderTargetValue.deleteMany({ where: { workOrderId: id } }).catch(swallow);
    await prisma.workOrderTargetProperty.deleteMany({ where: { workOrderId: id } }).catch(swallow);
    await prisma.workOrderEvent.deleteMany({ where: { workOrderId: id } }).catch(swallow);
    await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: id } } }).catch(swallow);
    await prisma.travelerCard.deleteMany({ where: { workOrderId: id } }).catch(swallow);
    await prisma.batch.deleteMany({ where: { workOrderId: id } }).catch(swallow);
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: id } }).catch(swallow);
    await prisma.workOrder.deleteMany({ where: { id } }).catch(swallow);
  }
  await prisma.route.deleteMany({ where: { id: { in: made.routes } } }).catch(swallow);
  await prisma.station.deleteMany({ where: { id: { in: made.stations } } }).catch(swallow);
  const valueIds = (await prisma.fabricPropertyValue.findMany({ where: { propertyId: { in: made.props } }, select: { id: true } })).map((v) => v.id);
  await prisma.deliveryNoteAlias.deleteMany({ where: { targetId: { in: [...made.items, ...made.customers, ...valueIds] } } });
  await prisma.fabricPropertyValue.deleteMany({ where: { propertyId: { in: made.props } } }).catch(swallow);
  await prisma.fabricProperty.deleteMany({ where: { id: { in: [...made.props].reverse() } } }).catch(swallow);
  await prisma.item.deleteMany({ where: { id: { in: made.items } } }).catch(swallow);
  await prisma.customer.deleteMany({ where: { id: { in: made.customers } } }).catch(swallow);
}

async function main(): Promise<void> {
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: SETTINGS } }, select: { key: true, value: true } });
  try {
    await run();
  } catch (e) {
    fail++;
    console.error("HATA:", e);
  } finally {
    stopNotificationJobs();
    for (const k of SETTINGS) {
      const p = prior.find((x) => x.key === k);
      if (p) await prisma.systemSetting.update({ where: { key: k }, data: { value: p.value as never } });
      else await prisma.systemSetting.deleteMany({ where: { key: k } });
    }
    await cleanup().catch((e) => check("temizlik", false, (e as Error).message.replace(/\s+/g, " ").slice(0, 300)));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız === (test verisi temizlendi)`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

if (!engel) void main();
else void prisma.$disconnect();
