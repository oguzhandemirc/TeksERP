// =============================================================================
// TEST: gelen belge → iş emri ROTA ÖNERİSİ zinciri (`suggestRoute`; plan ucu + otomatik iş emri TEK kaynak)
// =============================================================================
//   §0 tek kaynak: plan `suggestRoute` çağırır (eski sorgu yok), create kapısı `routeTemplateProblem`dan, iki yeni
//      anahtar ham ayar ucuna kapalı, Zod iki alanı taşır
//   §1 ⭐ ayar BOŞ = bugünkü: okuyucular null / CUSTOMER_FIRST; önceki iş emri yoksa öneri yok; varsa bugünkü
//      sorgunun (sahibin rotalı son iş emri) BİREBİR aynı rotası (kaynak LAST_WORK_ORDER)
//   §2 ⭐ müşteriye tanımlı TEK rota (`Route.customerId`) → CUSTOMER_ROUTE; önceki iş emri varsa o önce gelir
//   §3 ⭐ müşteriye tanımlı İKİ rota → belirsiz: atlanır + neden; pasif müşteri rotası aday sayılmaz
//   §4 ⭐ fabrika varsayılanı (tek uç yazar) → yeni müşteride FACTORY_DEFAULT; otomatik iş emri o rotayla AÇILIR
//   §5 ⭐ FACTORY_FIRST: geçmişi olan müşteride de fabrika rotası; varsayılan boşsa müşteri zinciri
//   §6 ⭐ pasif/adımsız/olmayan rota yazımı 400 GELEN_BELGE_DEFAULT_ROUTE_INVALID; kayıtlı rota sonradan pasifse
//      FAIL-CLOSED: öneri yok (başka kaynağa düşmez), otomatik iş emri hepsini atlar + neden, iş emri 0
//   §7 kapsama aynı kapıdan: fabrika rotası grubun bayrağını uygulamıyorsa grup FAILED (quickStart → create 400)
// Negatif sonda: `fromFactoryDefault` "stop" yerine "miss" dönerse §6 fail-closed kırmızı; CUSTOMER_ROUTE'ta
// `rows.length === 1` şartı `>= 1` olursa §3 kırmızı; FACTORY_FIRST dalı silinirse §5 kırmızı.
// Çalıştır: npx tsx scripts/test_gelen_belge_rota_onerisi.ts
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import prisma from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { createDeliveryNote } from "../src/services/gelen-belge-note.service";
import { approveDeliveryNote } from "../src/services/gelen-belge-onay.service";
import { buildWorkOrderPlan } from "../src/services/gelen-belge-is-emri.service";
import { suggestRoute } from "../src/services/gelen-belge-rota-onerisi.service";
import { getIncomingDocSettings, updateIncomingDocSettings, INCOMING_DOC_DEDICATED_SETTING_KEYS } from "../src/services/gelen-belge-ayar.service";
import { withAutoWorkOrders } from "../src/services/gelen-belge-oto-is-emri.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { SETTING_KEYS, readIncomingDocDefaultRouteId, readRouteSuggestionPriority } from "../src/services/system-setting.service";
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

const TAG = `TST-GRO${Date.now().toString(36).toUpperCase()}Z`;
const SETTINGS = [
  SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL,
  SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER, SETTING_KEYS.GELEN_BELGE_DEFAULT_ROUTE_ID, SETTING_KEYS.GELEN_BELGE_ROUTE_PRIORITY,
];
const made = { notes: [] as string[], items: [] as string[], customers: [] as string[], props: [] as string[], routes: [] as string[], stations: [] as string[] };
const svc = new WorkOrderService();

async function errorOf(fn: () => Promise<unknown>): Promise<{ status: number; code?: string; message?: string } | null> {
  try { await fn(); return null; } catch (e) {
    if (e instanceof AppError) return { status: e.statusCode, code: (e.details as { code?: string } | undefined)?.code, message: e.message };
    return { status: 500, message: (e as Error).message };
  }
}

/** Bugünkü (değişiklik öncesi) öneri sorgusunun birebir kopyası — §1 "boş ayar = bugünkü" ölçüsü. */
async function legacySuggestion(ownerCustomerId: string): Promise<string | null> {
  const last = await prisma.workOrder.findFirst({
    where: { routeTemplateId: { not: null }, routeTemplate: { isActive: true }, batches: { some: { rolls: { some: { ownerCustomerId } } } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { routeTemplateId: true },
  });
  return last?.routeTemplateId ?? null;
}

async function run(): Promise<void> {
  const actorId = await testActorId();
  const full = { userId: actorId, permissions: ["gelen-belge:approve", "workorder:write"] };
  for (const [k, v] of [[SETTING_KEYS.EMANET_ENABLED, true], [SETTING_KEYS.GELEN_BELGE_ENABLED, true]] as const) {
    await prisma.systemSetting.upsert({ where: { key: k }, create: { key: k, value: v }, update: { value: v } });
  }
  await prisma.systemSetting.deleteMany({ where: { key: { in: SETTINGS.slice(2) } } });

  console.log("§0 Tek kaynak");
  const src = (f: string) => readFileSync(path.join(__dirname, "../src", f), "utf8");
  const planSrc = src("services/gelen-belge-is-emri.service.ts");
  check("§0 plan servisi `suggestRoute` çağırır, kendi iş emri sorgusu yok", /suggestRoute\(\{ ownerCustomerId: note\.ownerCustomerId \}\)/.test(planSrc) && !/prisma\.workOrder\.findFirst/.test(planSrc));
  const autoSrc = src("services/gelen-belge-oto-is-emri.service.ts");
  check("§0 otomatik iş emri rotayı planın önerisinden alır", autoSrc.includes("plan.suggestedRouteTemplateId") && !autoSrc.includes("prisma."));
  const woSrc = src("services/workorder.service.ts");
  check("§0 create kapıları `routeTemplateProblem`dan (literal kural kopyası yok)", (woSrc.match(/routeTemplateProblem\(/g) ?? []).length === 2 && !woSrc.includes('"Pasif bir rota şablonu kullanılamaz"'));
  check("§0 iki yeni anahtar ham ayar ucuna kapalı", INCOMING_DOC_DEDICATED_SETTING_KEYS.has(SETTING_KEYS.GELEN_BELGE_DEFAULT_ROUTE_ID) && INCOMING_DOC_DEDICATED_SETTING_KEYS.has(SETTING_KEYS.GELEN_BELGE_ROUTE_PRIORITY));
  const gbRoutes = src("routes/gelen-belge.routes.ts");
  check("§0 Zod gövdesi iki alanı taşır", gbRoutes.includes("defaultRouteTemplateId: Id.nullable().optional()") && /routeSuggestionPriority: z\.enum\(\["CUSTOMER_FIRST", "FACTORY_FIRST"\]/.test(gbRoutes));

  // Katalog: BRODE bayrağı + desen; brode istasyonlu rotalar; bayraksız istasyonlu rota (§7).
  const flag = await prisma.fabricProperty.create({ data: { code: `${TAG}-BR`.slice(0, 32), name: `TEST Brode ${TAG}`, valueType: "FLAG" }, select: { id: true } });
  made.props.push(flag.id);
  const desen = await prisma.fabricProperty.create({
    data: { code: `${TAG}-BD`.slice(0, 32), name: `TEST Brode deseni ${TAG}`, valueType: "CHOICE", variantOfPropertyId: flag.id, values: { create: [{ code: `${TAG}D10`.slice(0, 32), name: "Desen Q10", sortOrder: 0 }] } },
    select: { id: true, values: { select: { id: true } } },
  });
  made.props.push(desen.id);
  const vA = desen.values[0]!.id;
  const fabric = await prisma.item.create({ data: { code: `${TAG}-KUM`, name: `${TAG} perde`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  made.items.push(fabric.id);
  const station = await prisma.station.create({ data: { code: `${TAG}-STN`.slice(0, 32), name: `${TAG} brode`, type: "INTERNAL" }, select: { id: true } });
  made.stations.push(station.id);
  await prisma.stationProperty.create({ data: { stationId: station.id, propertyId: flag.id } });
  const plain = await prisma.station.create({ data: { code: `${TAG}-STP`.slice(0, 32), name: `${TAG} düz`, type: "INTERNAL" }, select: { id: true } });
  made.stations.push(plain.id);
  const mkRoute = async (name: string, opts: { customerId?: string; isActive?: boolean; stationId?: string | null } = {}) => {
    const r = await prisma.route.create({
      data: { name: `${TAG} ${name}`, customerId: opts.customerId ?? null, isActive: opts.isActive ?? true, ...(opts.stationId === null ? {} : { steps: { create: [{ stationId: opts.stationId ?? station.id, sequence: 1 }] } }) },
      select: { id: true },
    });
    made.routes.push(r.id);
    return r.id;
  };
  const mkCustomer = async (k: string) => {
    const c = await prisma.customer.create({ data: { code: `${TAG}-${k}`, name: `${TAG} ${k}` }, select: { id: true } });
    made.customers.push(c.id);
    return c.id;
  };
  const mkNote = async (owner: string, lines: string[]) => {
    const n = await createDeliveryNote({
      sourceKind: "MANUAL", ownerCustomerId: owner, senderText: `${TAG} GÖNDEREN`,
      lines: lines.map((t, i) => ({ senderRollNo: `${TAG}-${made.notes.length}-${i + 1}`, meters: 50 + i, itemId: fabric.id, processText: t })),
    }, actorId);
    made.notes.push(n.id);
    return n.id;
  };
  /** Sahibe rotalı bir iş emri aç (elle yol) → "müşteri geçmişi" kaynağı doğar. */
  const giveHistory = async (owner: string, routeId: string) => {
    const n = await mkNote(owner, ["BRODE DESEN Q10"]);
    await approveDeliveryNote(n, {}, actorId);
    const p = await buildWorkOrderPlan(n);
    await svc.quickStart({ rollBarcodes: p.groups[0]!.rolls.map((r) => r.barcode!), routeTemplateId: routeId, targetValues: [{ propertyId: desen.id, valueId: vA }], targetPropertyIds: [flag.id] }, actorId);
  };

  const histRoute = await mkRoute("geçmiş rotası");
  const ownerHist = await mkCustomer("HIST");
  await giveHistory(ownerHist, histRoute);
  const ownerNew = await mkCustomer("YENI");

  console.log("§1 Ayar BOŞ = bugünkü davranış");
  check("§1 okuyucular: rota null, öncelik CUSTOMER_FIRST", (await readIncomingDocDefaultRouteId()) === null && (await readRouteSuggestionPriority()) === "CUSTOMER_FIRST");
  const s0 = await getIncomingDocSettings();
  check("§1 ayar görünümü: defaultRoute null + CUSTOMER_FIRST", s0.defaultRoute === null && s0.routeSuggestionPriority === "CUSTOMER_FIRST" && s0.defaultRouteSuggestionPriority === "CUSTOMER_FIRST");
  const s1 = await suggestRoute({ ownerCustomerId: ownerNew });
  check("§1 ⭐ yeni müşteri, kaynak yok → öneri yok + üç neden", s1.routeTemplateId === null && s1.source === null && s1.notes.length === 3 && (await legacySuggestion(ownerNew)) === null, s1.notes.join(" | "));
  const s1b = await suggestRoute({ ownerCustomerId: ownerHist });
  check("§1 ⭐ geçmişli müşteri → bugünkü sorgunun BİREBİR rotası (LAST_WORK_ORDER)", s1b.routeTemplateId === (await legacySuggestion(ownerHist)) && s1b.routeTemplateId === histRoute && s1b.source === "LAST_WORK_ORDER");
  const plan1 = await buildWorkOrderPlan(made.notes[0]!);
  check("§1 plan ucu aynı öneriyi + kaynağı taşır", plan1.suggestedRouteTemplateId === histRoute && plan1.suggestedRouteSource === "LAST_WORK_ORDER" && Array.isArray(plan1.routeSuggestionNotes));

  console.log("§2 Müşteriye tanımlı tek rota");
  const ownerOne = await mkCustomer("TEK");
  const oneRoute = await mkRoute("müşteri rotası", { customerId: ownerOne });
  const s2 = await suggestRoute({ ownerCustomerId: ownerOne });
  check("§2 ⭐ tek müşteri rotası → CUSTOMER_ROUTE + önceki kaynağın nedeni", s2.routeTemplateId === oneRoute && s2.source === "CUSTOMER_ROUTE" && s2.notes.length === 1 && /önceki/.test(s2.notes[0]!), s2.notes.join(" | "));
  await mkRoute("geçmişlinin müşteri rotası", { customerId: ownerHist });
  const s2b = await suggestRoute({ ownerCustomerId: ownerHist });
  check("§2 geçmiş + müşteri rotası → CUSTOMER_FIRST'te geçmiş önce", s2b.routeTemplateId === histRoute && s2b.source === "LAST_WORK_ORDER");

  console.log("§3 Belirsiz aday");
  const ownerTwo = await mkCustomer("IKI");
  await mkRoute("iki-A", { customerId: ownerTwo });
  await mkRoute("iki-B", { customerId: ownerTwo });
  const s3 = await suggestRoute({ ownerCustomerId: ownerTwo });
  check("§3 ⭐ iki müşteri rotası → öneri yok, 'birden çok' nedeni", s3.routeTemplateId === null && s3.notes.some((n) => /birden çok/.test(n)), s3.notes.join(" | "));
  const ownerPassive = await mkCustomer("PAS");
  const passiveCust = await mkRoute("pasif müşteri rotası", { customerId: ownerPassive, isActive: false });
  const activeCust = await mkRoute("aktif müşteri rotası", { customerId: ownerPassive });
  await mkRoute("adımsız müşteri rotası", { customerId: ownerPassive, stationId: null });
  const s3b = await suggestRoute({ ownerCustomerId: ownerPassive });
  check("§3 pasif ve adımsız müşteri rotası aday sayılmaz → tek aktif CUSTOMER_ROUTE", s3b.routeTemplateId === activeCust && s3b.routeTemplateId !== passiveCust && s3b.source === "CUSTOMER_ROUTE");

  console.log("§4 Fabrika varsayılanı");
  const factory = await mkRoute("fabrika rotası");
  const set4 = await updateIncomingDocSettings({ defaultRouteTemplateId: factory, autoWorkOrder: true }, actorId);
  check("§4 tek uç yazdı → görünüm rota adı + problem yok", set4.defaultRoute?.id === factory && set4.defaultRoute.problem === null);
  const s4 = await suggestRoute({ ownerCustomerId: ownerNew });
  check("§4 ⭐ yeni müşteri → FACTORY_DEFAULT + iki önceki nedeni", s4.routeTemplateId === factory && s4.source === "FACTORY_DEFAULT" && s4.notes.length === 2);
  const s4b = await suggestRoute({ ownerCustomerId: ownerTwo });
  check("§4 belirsiz müşteri → fabrika rotasına düşer, 'birden çok' notu kalır", s4b.routeTemplateId === factory && s4b.notes.some((n) => /birden çok/.test(n)));
  const n4 = await mkNote(ownerNew, ["BRODE DESEN Q10"]);
  const r4 = await withAutoWorkOrders(await approveDeliveryNote(n4, {}, actorId), full);
  const g4 = r4.autoWorkOrders?.groups[0];
  const wo4 = g4?.workOrderId ? await prisma.workOrder.findUnique({ where: { id: g4.workOrderId }, select: { routeTemplateId: true } }) : null;
  check("§4 ⭐ yeni müşteride otomatik iş emri fabrika rotasıyla AÇILDI", r4.autoWorkOrders?.opened === 1 && wo4?.routeTemplateId === factory, JSON.stringify(r4.autoWorkOrders?.groups.map((g) => [g.outcome, g.reason])));

  console.log("§5 FACTORY_FIRST");
  await updateIncomingDocSettings({ routeSuggestionPriority: "FACTORY_FIRST" }, actorId);
  const s5 = await suggestRoute({ ownerCustomerId: ownerHist });
  check("§5 ⭐ geçmişli müşteride de fabrika rotası", s5.routeTemplateId === factory && s5.source === "FACTORY_DEFAULT" && s5.notes.length === 0);
  await updateIncomingDocSettings({ defaultRouteTemplateId: null }, actorId);
  const s5b = await suggestRoute({ ownerCustomerId: ownerHist });
  check("§5 varsayılan boş + FACTORY_FIRST → müşteri zinciri (geçmiş)", s5b.routeTemplateId === histRoute && s5b.source === "LAST_WORK_ORDER" && /ayarlanmamış/.test(s5b.notes[0] ?? ""));
  const bad = await errorOf(() => updateIncomingDocSettings({ routeSuggestionPriority: "HER_ZAMAN" as never }, actorId));
  check("§5 tanınmayan öncelik 400", bad?.status === 400, JSON.stringify(bad));

  console.log("§6 Pasif şablon — fail-closed");
  const inactive = await mkRoute("pasif fabrika", { isActive: false });
  const e6a = await errorOf(() => updateIncomingDocSettings({ defaultRouteTemplateId: inactive }, actorId));
  check("§6 ⭐ pasif rota yazımı 400 GELEN_BELGE_DEFAULT_ROUTE_INVALID", e6a?.status === 400 && e6a.code === "GELEN_BELGE_DEFAULT_ROUTE_INVALID", JSON.stringify(e6a));
  const stepless = await mkRoute("adımsız fabrika", { stationId: null });
  const e6b = await errorOf(() => updateIncomingDocSettings({ defaultRouteTemplateId: stepless }, actorId));
  check("§6 adımsız rota yazımı 400", e6b?.status === 400 && e6b.code === "GELEN_BELGE_DEFAULT_ROUTE_INVALID");
  const e6c = await errorOf(() => updateIncomingDocSettings({ defaultRouteTemplateId: "00000000-0000-4000-8000-000000000000" }, actorId));
  check("§6 olmayan rota yazımı 400", e6c?.status === 400 && e6c.code === "GELEN_BELGE_DEFAULT_ROUTE_INVALID");
  check("§6 reddedilen yazım ayarı DEĞİŞTİRMEDİ", (await readIncomingDocDefaultRouteId()) === null);
  const goneLater = await mkRoute("sonradan pasif");
  await updateIncomingDocSettings({ defaultRouteTemplateId: goneLater }, actorId);
  await prisma.route.update({ where: { id: goneLater }, data: { isActive: false } });
  const v6 = await getIncomingDocSettings();
  check("§6 ayar görünümü kayıtlı rotanın sorununu söyler", v6.defaultRoute?.id === goneLater && /Pasif/.test(v6.defaultRoute.problem ?? ""));
  const s6 = await suggestRoute({ ownerCustomerId: ownerHist });
  check("§6 ⭐ FACTORY_FIRST + pasif kayıtlı rota → öneri YOK (geçmişe düşmez) + neden", s6.routeTemplateId === null && /kullanılamıyor/.test(s6.notes.at(-1) ?? ""), s6.notes.join(" | "));
  await updateIncomingDocSettings({ routeSuggestionPriority: "CUSTOMER_FIRST" }, actorId);
  const ownerNew2 = await mkCustomer("YENI2");
  const n6 = await mkNote(ownerNew2, ["BRODE DESEN Q10"]);
  const before6 = await prisma.workOrder.count();
  const r6 = await withAutoWorkOrders(await approveDeliveryNote(n6, {}, actorId), full);
  check("§6 ⭐ onay anında pasif fabrika rotası → hepsi SKIPPED + neden, iş emri 0, onay APPROVED", r6.note.status === "APPROVED" && r6.autoWorkOrders?.opened === 0 && /kullanılamıyor/.test(r6.autoWorkOrders.reason ?? "") && r6.autoWorkOrders.groups.every((g) => g.outcome === "SKIPPED") && (await prisma.workOrder.count()) === before6, r6.autoWorkOrders?.reason ?? "");

  console.log("§7 Kapsama aynı kapıdan");
  const noFlag = await mkRoute("bayraksız fabrika", { stationId: plain.id });
  await updateIncomingDocSettings({ defaultRouteTemplateId: noFlag }, actorId);
  const ownerNew3 = await mkCustomer("YENI3");
  const n7 = await mkNote(ownerNew3, ["BRODE DESEN Q10"]);
  const r7 = await withAutoWorkOrders(await approveDeliveryNote(n7, {}, actorId), full);
  const g7 = r7.autoWorkOrders?.groups[0];
  check("§7 fabrika rotası brode bayrağını uygulamıyor → grup FAILED (create'in kapsama kapısı) + neden", g7?.outcome === "FAILED" && (g7.reason ?? "").length > 0 && r7.note.status === "APPROVED", g7?.reason ?? "");
}

async function cleanup(): Promise<void> {
  const rollIds = (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: { in: made.notes }, rollId: { not: null } }, select: { rollId: true } })).map((r) => r.rollId!);
  const wos = (await prisma.workOrder.findMany({ where: { OR: [{ batches: { some: { rolls: { some: { id: { in: rollIds } } } } } }, { routeTemplateId: { in: made.routes } }] }, select: { id: true } })).map((w) => w.id);
  const swallow = () => undefined;
  await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: made.notes } } });
  for (const t of ["rollProperty", "rollOperation", "rollMovement", "rollVariance", "warehouseMovement"] as const) {
    await (prisma[t] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }).deleteMany({ where: { rollId: { in: rollIds } } }).catch(swallow);
  }
  await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { currentStepId: null, batchId: null } }).catch(swallow);
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(swallow);
  for (const id of wos) {
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
  await prisma.stationProperty.deleteMany({ where: { stationId: { in: made.stations } } }).catch(swallow);
  await prisma.station.deleteMany({ where: { id: { in: made.stations } } }).catch(swallow);
  const valueIds = (await prisma.fabricPropertyValue.findMany({ where: { propertyId: { in: made.props } }, select: { id: true } })).map((v) => v.id);
  await prisma.deliveryNoteAlias.deleteMany({ where: { targetId: { in: [...made.items, ...made.customers, ...valueIds] } } });
  await prisma.fabricPropertyValue.deleteMany({ where: { propertyId: { in: made.props } } }).catch(swallow);
  await prisma.fabricProperty.deleteMany({ where: { id: { in: [...made.props].reverse() } } }).catch(swallow);
  await prisma.item.deleteMany({ where: { id: { in: made.items } } }).catch(swallow);
  await prisma.customer.deleteMany({ where: { id: { in: made.customers } } }).catch(swallow);
  const left = await prisma.route.count({ where: { id: { in: made.routes } } });
  if (left > 0) check("temizlik: test rotaları silindi", false, `${left} kaldı`);
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
