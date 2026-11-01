// =============================================================================
// TEST: gelen belge ONAYINDAN SONRA otomatik iş emri (`gelenBelge.autoWorkOrder`, varsayılan KAPALI)
// =============================================================================
//   §0 tek kaynak: quick-start route kapısı ↔ AUTO_WORK_ORDER_PERMISSIONS birebir; onay ucu onay → `withAutoWorkOrders`
//   §1 ⭐ ayar KAPALI (satır yok): onay sonucu bugünküyle aynı (`autoWorkOrders` anahtarı YOK), iş emri 0; ayar okuması false
//   §2 ayar açık, sahibin rotalı önceki iş emri yok → hiçbir grup denenmez, genel neden + onay APPROVED
//   §3 ⭐ net gruplar (Q10 · Q11) → 2 iş emri (kendi hedef değeriyle, belirlenimli token), desensiz grup SKIPPED + neden
//   §4 ⭐ ikinci çağrı / yeniden onay ikinci iş emri doğurmaz; aynı token replay → aynı iş emri
//   §5 ⭐ onaylayanın quick-start izni yok → hepsi SKIPPED + neden, iş emri 0, onay APPROVED
//   §6 ⭐ bir grup düşer (rota BASKI bayrağını uygulamıyor → 400) → o grup FAILED + neden, öteki açılır, onay APPROVED
// Onay ucunun bileşimi (route ile aynı): onay → otomatik iş emri.
// Negatif sonda: token `randomUUID()` → §3 token + §4 replay kırmızı; desensiz atlama kaldırılınca §3 "desensiz SKIPPED" kırmızı.
// Çalıştır: npx tsx scripts/test_gelen_belge_oto_is_emri.ts
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import prisma from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { createDeliveryNote } from "../src/services/gelen-belge-note.service";
import { approveDeliveryNote } from "../src/services/gelen-belge-onay.service";
import { buildWorkOrderPlan } from "../src/services/gelen-belge-is-emri.service";
import { getIncomingDocSettings, updateIncomingDocSettings } from "../src/services/gelen-belge-ayar.service";
import {
  autoOpenWorkOrders, withAutoWorkOrders, autoWorkOrderToken, AUTO_WORK_ORDER_PERMISSIONS, type AutoWorkOrderResult,
} from "../src/services/gelen-belge-oto-is-emri.service";
import type { ApproveInput } from "../src/services/gelen-belge-onay.service";
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

const TAG = `TST-GOI${Date.now().toString(36).toUpperCase()}Z`;
const SETTINGS = [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER];
const made = { notes: [] as string[], items: [] as string[], customers: [] as string[], props: [] as string[], routes: [] as string[], stations: [] as string[] };
const svc = new WorkOrderService();

const approveAndAutoOpen = (id: string, input: ApproveInput, actor: { userId: string; permissions: string[] }) =>
  approveDeliveryNote(id, input, actor.userId).then((r) => withAutoWorkOrders(r, actor));

async function errorOf(fn: () => Promise<unknown>): Promise<{ status: number; code?: string } | null> {
  try { await fn(); return null; } catch (e) {
    if (e instanceof AppError) return { status: e.statusCode, code: (e.details as { code?: string } | undefined)?.code };
    return { status: 500 };
  }
}

const describe = (r: AutoWorkOrderResult | undefined) => (r ? `opened=${r.opened} manual=${r.manual} reason=${r.reason ?? "-"} | ${r.groups.map((g) => `${g.targets.join("+") || "desensiz"}:${g.outcome}${g.reason ? `(${g.reason.slice(0, 60)})` : ""}`).join(" ")}` : "yok");

async function run(): Promise<void> {
  const actorId = await testActorId();
  const full = { userId: actorId, permissions: ["gelen-belge:approve", "workorder:write"] };
  for (const [k, v] of [[SETTING_KEYS.EMANET_ENABLED, true], [SETTING_KEYS.GELEN_BELGE_ENABLED, true]] as const) {
    await prisma.systemSetting.upsert({ where: { key: k }, create: { key: k, value: v }, update: { value: v } });
  }
  await prisma.systemSetting.deleteMany({ where: { key: { in: [SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER] } } });

  console.log("§0 Tek kaynak");
  const woRoutes = readFileSync(path.join(__dirname, "../src/routes/workorder.routes.ts"), "utf8");
  const qs = woRoutes.slice(woRoutes.indexOf('"/quick-start"'), woRoutes.indexOf("controller.quickStart"));
  const literal = `requireAnyPermission(${AUTO_WORK_ORDER_PERMISSIONS.map((p) => `"${p}"`).join(", ")})`;
  check("§0 quick-start kapısı = AUTO_WORK_ORDER_PERMISSIONS (sıra dahil)", qs.includes(literal), qs.replace(/\s+/g, " ").slice(0, 120));
  const gbRoutes = readFileSync(path.join(__dirname, "../src/routes/gelen-belge.routes.ts"), "utf8");
  check("§0 onay ucu: approveDeliveryNote → withAutoWorkOrders (onaydan SONRA)", /approveDeliveryNote\([^\n]*\)\.then\(\(r\) => withAutoWorkOrders\(r, req\.user!\)\)/.test(gbRoutes));

  // Katalog: BRODE bayrağı + desen çeşidi; BASKI bayrağı + çeşidi (rota uygulamaz → §6).
  const flag = await prisma.fabricProperty.create({ data: { code: `${TAG}-BR`.slice(0, 32), name: `TEST Brode ${TAG}`, valueType: "FLAG" }, select: { id: true } });
  made.props.push(flag.id);
  const desen = await prisma.fabricProperty.create({
    data: {
      code: `${TAG}-BD`.slice(0, 32), name: `TEST Brode deseni ${TAG}`, valueType: "CHOICE", variantOfPropertyId: flag.id,
      values: { create: [10, 11, 12].map((n, i) => ({ code: `${TAG}D${n}`.slice(0, 32), name: `Desen Q${n}`, sortOrder: i })) },
    },
    select: { id: true, values: { select: { id: true, name: true } } },
  });
  made.props.push(desen.id);
  const flag2 = await prisma.fabricProperty.create({ data: { code: `${TAG}-BS`.slice(0, 32), name: `TEST Baski ${TAG}`, valueType: "FLAG" }, select: { id: true } });
  made.props.push(flag2.id);
  const baski = await prisma.fabricProperty.create({
    data: {
      code: `${TAG}-BK`.slice(0, 32), name: `TEST Baski cesidi ${TAG}`, valueType: "CHOICE", variantOfPropertyId: flag2.id,
      values: { create: [{ code: `${TAG}K7`.slice(0, 32), name: "Kalip K7", sortOrder: 0 }] },
    },
    select: { id: true, values: { select: { id: true } } },
  });
  made.props.push(baski.id);
  const vA = desen.values.find((v) => v.name === "Desen Q10")!.id;
  const vB = desen.values.find((v) => v.name === "Desen Q11")!.id;
  const owner = await prisma.customer.create({ data: { code: `${TAG}-OWN`, name: `${TAG} sahip` }, select: { id: true } });
  made.customers.push(owner.id);
  const fabric = await prisma.item.create({ data: { code: `${TAG}-KUM`, name: `${TAG} perde`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  made.items.push(fabric.id);
  const station = await prisma.station.create({ data: { code: `${TAG}-STN`.slice(0, 32), name: `${TAG} brode`, type: "INTERNAL" }, select: { id: true } });
  made.stations.push(station.id);
  await prisma.stationProperty.create({ data: { stationId: station.id, propertyId: flag.id } });
  const route = await prisma.route.create({ data: { name: `${TAG} brode rotası`, steps: { create: [{ stationId: station.id, sequence: 1 }] } }, select: { id: true } });
  made.routes.push(route.id);

  const mkNote = async (lines: string[]) => {
    const n = await createDeliveryNote({
      sourceKind: "MANUAL", ownerCustomerId: owner.id, senderText: `${TAG} GÖNDEREN`,
      lines: lines.map((t, i) => ({ senderRollNo: `${TAG}-${made.notes.length}-${i + 1}`, meters: 50 + i, itemId: fabric.id, processText: t })),
    }, actorId);
    made.notes.push(n.id);
    return n.id;
  };
  const woCount = () => prisma.workOrder.count();

  console.log("§1 Ayar KAPALI — bugünkü davranış");
  check("§1 ayar okuması: satır yok → autoWorkOrder false", (await getIncomingDocSettings()).autoWorkOrder === false);
  const n1 = await mkNote(["BRODE DESEN Q10", "BRODE DESEN Q11"]);
  const before1 = await woCount();
  const r1 = await approveAndAutoOpen(n1, {}, full);
  check("§1 ⭐ onay APPROVED, `autoWorkOrders` anahtarı YOK, iş emri 0", r1.note.status === "APPROVED" && !("autoWorkOrders" in r1) && (await woCount()) === before1, Object.keys(r1).join(","));
  check("§1 doğrudan çağrı da null (ayar kapalı)", (await autoOpenWorkOrders(n1, full)) === null);

  console.log("§2 Ayar açık — rota önerisi yok");
  const set = await updateIncomingDocSettings({ autoWorkOrder: true }, actorId);
  check("§2 ayar yazıldı (tek uç) → true", set.autoWorkOrder === true);
  const n2 = await mkNote(["BRODE DESEN Q10"]);
  const before2 = await woCount();
  const r2 = await approveAndAutoOpen(n2, {}, full);
  check("§2 ⭐ rotasız sahip → genel neden, hiçbir grup açılmaz, onay APPROVED", r2.note.status === "APPROVED" && r2.autoWorkOrders?.opened === 0 && /rota/i.test(r2.autoWorkOrders?.reason ?? "") && r2.autoWorkOrders.groups.every((g) => g.outcome === "SKIPPED") && (await woCount()) === before2, describe(r2.autoWorkOrders));
  // Panel yolu (elle, MEVCUT quickStart) — sahibin rotalı ilk iş emri → bundan sonra rota önerisi var.
  const p2 = await buildWorkOrderPlan(n2);
  await svc.quickStart({ rollBarcodes: p2.groups[0]!.rolls.map((r) => r.barcode!), routeTemplateId: route.id, targetValues: [{ propertyId: desen.id, valueId: vA }], targetPropertyIds: [flag.id] }, actorId);

  console.log("§3 Net gruplar → iş emri; desensiz atlanır");
  const n3 = await mkNote(["BRODE DESEN Q10", "BRODE DESEN Q10", "BRODE DESEN Q11", "BRODE DESEN Q11", "SADECE ÜTÜ"]);
  const before3 = await woCount();
  const r3 = await approveAndAutoOpen(n3, {}, full);
  const a3 = r3.autoWorkOrders;
  const opened = a3?.groups.filter((g) => g.outcome === "OPENED") ?? [];
  check("§3 ⭐ onay APPROVED + 2 grup açıldı, 1 elle (desensiz)", r3.note.status === "APPROVED" && a3?.opened === 2 && a3.manual === 1 && (await woCount()) === before3 + 2, describe(a3));
  const pl = a3?.groups.find((g) => g.targets.length === 0);
  check("§3 ⭐ desensiz grup SKIPPED + Türkçe neden", pl?.outcome === "SKIPPED" && /elle/.test(pl.reason ?? ""), JSON.stringify(pl));
  check("§3 açılan gruplar İE numarası + 2'şer top", opened.every((g) => !!g.workOrderNumber && g.attached === 2), opened.map((g) => `${g.workOrderNumber}:${g.attached}`).join(" "));
  const plan3 = await buildWorkOrderPlan(n3);
  let tokenOk = true, targetOk = true;
  for (const g of opened) {
    const wo = await prisma.workOrder.findUnique({ where: { id: g.workOrderId! }, select: { clientToken: true, routeTemplateId: true, targetValues: { where: { revokedAt: null }, select: { valueId: true } } } });
    const pg = plan3.groups.find((x) => x.key === g.key)!;
    if (wo?.clientToken !== autoWorkOrderToken(n3, g.key, pg.rolls.map((r) => r.rollId))) tokenOk = false;
    const want = g.targets[0] === "Desen Q10" ? vA : vB;
    if (wo?.targetValues.length !== 1 || wo.targetValues[0]!.valueId !== want || wo.routeTemplateId !== route.id) targetOk = false;
  }
  check("§3 ⭐ token belirlenimli: uuidv5(belge|grup|top kümesi)", tokenOk);
  check("§3 her iş emri KENDİ hedef değeriyle + önerilen rotayla", targetOk);

  console.log("§4 İkinci çağrı / yeniden onay / replay");
  const mid = await woCount();
  const again = await autoOpenWorkOrders(n3, full);
  check("§4 ⭐ ikinci çağrı: iş emri doğmaz, net gruplar 'bağlanabilir top yok'", again?.opened === 0 && (await woCount()) === mid && again.groups.filter((g) => g.targets.length > 0).every((g) => g.outcome === "SKIPPED" && /Bağlanabilir top yok/.test(g.reason ?? "")), describe(again ?? undefined));
  const reApprove = await errorOf(() => approveAndAutoOpen(n3, {}, full));
  check("§4 onaylıyı yeniden onay → 409, iş emri doğmaz", reApprove?.status === 409 && (await woCount()) === mid, JSON.stringify(reApprove));
  const g0 = opened[0]!;
  const pg0 = plan3.groups.find((x) => x.key === g0.key)!;
  const replay = await svc.quickStart({ clientToken: autoWorkOrderToken(n3, g0.key, pg0.rolls.map((r) => r.rollId)), rollBarcodes: pg0.rolls.map((r) => r.barcode!), routeTemplateId: route.id }, actorId);
  check("§4 ⭐ aynı token → replay (aynı iş emri, yeni 0)", replay.data?.workOrder.id === g0.workOrderId && (await woCount()) === mid, replay.message ?? "");

  console.log("§5 İzinsiz onaylayan");
  const n5 = await mkNote(["BRODE DESEN Q10"]);
  const before5 = await woCount();
  const r5 = await approveAndAutoOpen(n5, {}, { userId: actorId, permissions: ["gelen-belge:approve"] });
  check("§5 ⭐ yetkisiz → hepsi SKIPPED + neden, iş emri 0, onay APPROVED", r5.note.status === "APPROVED" && r5.autoWorkOrders?.opened === 0 && /yetkisi yok/.test(r5.autoWorkOrders.reason ?? "") && r5.autoWorkOrders.groups.every((g) => g.outcome === "SKIPPED") && (await woCount()) === before5, describe(r5.autoWorkOrders));
  const r5b = await autoOpenWorkOrders(n5, { userId: actorId, permissions: ["mobile:hizli-is-emri"] });
  check("§5 mobile:hizli-is-emri yeter (quick-start kapısıyla aynı küme)", r5b?.opened === 1, describe(r5b ?? undefined));

  console.log("§6 Bir grup düşer");
  const n6 = await mkNote(["BRODE DESEN Q12", "BASKI KALIP K7"]);
  const before6 = await woCount();
  const r6 = await approveAndAutoOpen(n6, {}, full);
  const failed = r6.autoWorkOrders?.groups.find((g) => g.outcome === "FAILED");
  check("§6 ⭐ onay APPROVED kalır; 1 açıldı, BASKI grubu FAILED + neden", r6.note.status === "APPROVED" && r6.autoWorkOrders?.opened === 1 && r6.autoWorkOrders.manual === 1 && !!failed && (failed.reason ?? "").length > 0 && failed.targets.includes("Kalip K7") && (await woCount()) === before6 + 1, describe(r6.autoWorkOrders));
  const dbNote = await prisma.customerDeliveryNote.findUnique({ where: { id: n6 }, select: { status: true } });
  check("§6 DB'de başlık APPROVED", dbNote?.status === "APPROVED");
}

async function cleanup(): Promise<void> {
  const rollIds = (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: { in: made.notes }, rollId: { not: null } }, select: { rollId: true } })).map((r) => r.rollId!);
  const wos = (await prisma.workOrder.findMany({ where: { batches: { some: { rolls: { some: { id: { in: rollIds } } } } } }, select: { id: true } })).map((w) => w.id);
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
