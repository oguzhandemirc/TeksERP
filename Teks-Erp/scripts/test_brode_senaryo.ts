// =============================================================================
// BEKÇİ — İÇ/DIŞ BRODE UÇTAN UCA SENARYO + BRODE KURULUM BETİĞİ (Gülkesim dalga 4 · D4-D4)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_brode_senaryo.ts
//
// NEDEN: brode zinciri beş dilimin (D1 öneri · D2 belgeden iş emri · D3 desen kalemi · T2 Tambur-2 ·
// H10 hizmet satırı) dikişidir; her dilimin bekçisi kendi parçasını ölçer, dikiş yalnız burada
// ölçülür. Dikişte bir halka koparsa (istasyonda desen yeteneği yok, kabul deseni yazmıyor,
// Tambur-2 çocuğu ata zincirini taşımıyor) müşteriye yanlış kalem/metre kesilir — S7: brode
// ücreti METRE, müşteri ya da desen bazında.
//
// Katalog `scripts/brode-kurulum.ts` ile KURULUR (betiğin --apply yolu da böylece ölçülür).
// ÖLÇÜLENLER:
//   §1 Kurulum betiği: kuru koşu 0 yazım + yaratılacak HER kaydı listeler (kalem · bayrak · çeşit ·
//      desenler · 3 istasyon · 3 yetenek · 2 rota); uygulama planla birebir; ikinci koşum hepsi AYNI;
//      çakışan veri (tipi farklı istasyon) → --apply 0 yazım
//   §2 İÇ YOL: gelen belge (2 desen, 3 satır) → plan desen grupları → grup başına quickStart (iç rota) →
//      Brode istasyonunda tablet desen düğmesi (completeQc2 valueCode) → Tambur-2 (T2 süzgeci) kesim →
//      hizmet taslağı: desen A kendi kalemiyle, desen B brode kalemi müşteri fiyatıyla; metre = CUT
//      kesilen, tutar el hesabına eşit
//   §3 DIŞ YOL: gelen belge → quickStart (dış rota) → fason sevk → kabul (ayar AÇIK: doğan top hedef
//      deseni taşır) → Tambur-2 kesim → taslak: brode metre = kabul edilen (RECEIVED), kalem desen
//      kalemi; tutar el hesabına eşit
//   (Dış brode fason adımı "özellik uygular" fason kategorisi ister; kategorisiz adımda kabul hedef
//    bayrağı topa yazmaz — kurulum betiği kategoriyi kurar, firma–kategori bağı paneldedir.)
// Negatif sondalar (2026-10-31): iç istasyonun desen yeteneği (StationProperty × desen) silinince §2
// 5 ❌ · kuru koşu yazım dalına girince §1 4 ❌ · fason adımı kategorisiz kurulunca §3 3 ❌.
// =============================================================================
import { randomUUID } from "node:crypto";
import { Currency, PriceKind, Prisma, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { createDeliveryNote } from "../src/services/gelen-belge-note.service";
import { approveDeliveryNote } from "../src/services/gelen-belge-onay.service";
import { buildWorkOrderPlan, type PlanGroup } from "../src/services/gelen-belge-is-emri.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { KursunQcService } from "../src/services/kursun-qc.service";
import { TamburService } from "../src/services/tambur.service";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { SETTING_KEYS, loadServiceBillingSettings } from "../src/services/system-setting.service";
import { collectServiceBillingDraft } from "../src/services/helpers/service-billing.helper";
import { ensureDefaultWarehouse } from "../src/jobs/default-warehouse.job";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { testActorId } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { applyBrodeSetup, parseBrodeSetupInput, planBrodeSetup, writeBrodeSetup, type BrodeSetupInput, type SetupRecord } from "./brode-kurulum";

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
const eq = (a: Prisma.Decimal.Value | null | undefined, b: number) => a != null && new Prisma.Decimal(a).minus(b).abs().lte(0.001);

const TAG = `TST-BRS${Date.now().toString(36).toUpperCase()}`;
const SETTINGS = [
  SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL,
  SETTING_KEYS.FINANCE_SERVICE_BILLING_ENABLED, SETTING_KEYS.FINANCE_SERVICE_BILLING_METER_BASIS, SETTING_KEYS.FINANCE_SERVICE_BILLING_MISSING_METER,
  SETTING_KEYS.FINANCE_SERVICE_BILLING_PRICE_DATE, SETTING_KEYS.FASON_RECEIPT_APPLY_TARGET_VARIANT, SETTING_KEYS.TAMBUR_SIMULATED_METER_ENABLED,
];
const made = { notes: [] as string[], items: [] as string[], customers: [] as string[], props: [] as string[], routes: [] as string[], wos: [] as string[], stations: [] as string[], rolls: [] as string[], categories: [] as string[] };
const woSvc = new WorkOrderService();
const qc = new KursunQcService();
const tambur = new TamburService();
const sub = new SubcontractorService();

/** Brode kataloğu: TAG'li kodlarla (ortak test DB'de çakışmasın); Gülkesim'de varsayılan kodlar. */
const code = (s: string) => `${TAG}-${s}`.slice(0, 32);
const SETUP: BrodeSetupInput = {
  serviceItem: { code: code("HZB"), name: `${TAG} Brode hizmeti` },
  flag: { code: code("BR"), name: `${TAG} Brode` },
  patternProperty: { code: code("BRD"), name: `${TAG} Brode deseni` },
  patternServiceItems: [{ code: code("HZA"), name: `${TAG} Brode desen A hizmeti` }],
  patterns: [
    { code: code("DA"), name: "Desen Lale", serviceItemCode: code("HZA") },
    { code: code("DB"), name: "Desen Papatya" },
  ],
  internalStation: { code: code("SB"), name: `${TAG} Brode` },
  externalStation: { code: code("SF"), name: `${TAG} Brode fason` },
  externalCategory: { code: code("FK"), name: `${TAG} Brode fason kategorisi` },
  tamburStation: { code: code("T2"), name: `${TAG} Tambur-2` },
  internalRoute: { code: code("RI"), name: `${TAG} Brode iç → Tambur-2` },
  externalRoute: { code: code("RD"), name: `${TAG} Brode dış → Tambur-2` },
};

async function errorOf(fn: () => Promise<unknown>): Promise<{ status: number; code?: string; msg?: string } | null> {
  try { await fn(); return null; } catch (e) {
    const err = e as { statusCode?: number; details?: { code?: string }; message?: string };
    return { status: err.statusCode ?? 500, code: err.details?.code, msg: err.message };
  }
}

function startGroup(g: PlanGroup, routeTemplateId: string) {
  return woSvc.quickStart({
    clientToken: randomUUID(),
    rollBarcodes: g.rolls.filter((r) => r.attachable).map((r) => r.barcode!),
    routeTemplateId,
    targetValues: g.targets.map((t) => ({ propertyId: t.propertyId, valueId: t.valueId })),
    targetPropertyIds: [...new Set(g.targets.map((t) => t.flagPropertyId))],
  }, undefined);
}

async function run(): Promise<void> {
  const actor = await testActorId();
  for (const [k, v] of [
    [SETTING_KEYS.EMANET_ENABLED, true], [SETTING_KEYS.GELEN_BELGE_ENABLED, true], [SETTING_KEYS.FINANCE_SERVICE_BILLING_ENABLED, true],
    [SETTING_KEYS.FASON_RECEIPT_APPLY_TARGET_VARIANT, true],
  ] as const) await prisma.systemSetting.upsert({ where: { key: k }, create: { key: k, value: v }, update: { value: v } });
  await prisma.systemSetting.deleteMany({ where: { key: { in: [
    SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, SETTING_KEYS.FINANCE_SERVICE_BILLING_METER_BASIS,
    SETTING_KEYS.FINANCE_SERVICE_BILLING_MISSING_METER, SETTING_KEYS.FINANCE_SERVICE_BILLING_PRICE_DATE, SETTING_KEYS.TAMBUR_SIMULATED_METER_ENABLED,
  ] } } });
  const wh = await ensureDefaultWarehouse();
  if (!wh) throw new Error("Varsayılan depo yok");
  const grade = await prisma.qualityGrade.findFirst({ where: { role: "FIRST", isActive: true }, select: { code: true } });
  if (!grade) throw new Error("FIRST rollü kalite yok — seed'siz DB");

  // ── §1 ───────────────────────────────────────────────────────────────────
  console.log("§1 Kurulum betiği — kuru koşu, uygulama, ikinci koşum, çakışma");
  const countAll = async () => [await prisma.item.count(), await prisma.fabricProperty.count(), await prisma.fabricPropertyValue.count(), await prisma.subcontractorCategory.count(), await prisma.station.count(), await prisma.stationProperty.count(), await prisma.route.count()].join("/");
  const before = await countAll();
  const plan = await planBrodeSetup(SETUP);
  const kinds = (rs: SetupRecord[], k: SetupRecord["kind"]) => rs.filter((r) => r.kind === k && r.action === "CREATE").length;
  check("§1 ⭐ kuru koşu 0 yazım (tablo sayıları aynı)", (await countAll()) === before, `${before} → ${await countAll()}`);
  check("§1 ⭐ kuru koşu yaratılacak HER kaydı listeler: 2 kalem · 2 özellik · 2 desen · fason kategorisi · 3 istasyon · 3 yetenek · 2 rota",
    kinds(plan, "ITEM") === 2 && kinds(plan, "FABRIC_PROPERTY") === 2 && kinds(plan, "FABRIC_PROPERTY_VALUE") === 2 && kinds(plan, "STATION") === 3
      && kinds(plan, "SUBCONTRACTOR_CATEGORY") === 1 && kinds(plan, "STATION_PROPERTY") === 3 && kinds(plan, "ROUTE") === 2 && plan.length === 15 && plan.every((r) => r.action === "CREATE" && r.id === null),
    plan.map((r) => `${r.action}:${r.kind}:${r.key}`).join(" | "));
  const applied = await applyBrodeSetup(SETUP, actor);
  const id = (k: string) => applied.records.find((r) => r.key === k)?.id ?? "";
  made.items.push(id(SETUP.serviceItem.code), id(SETUP.patternServiceItems[0]!.code));
  made.props.push(id(SETUP.flag.code), id(SETUP.patternProperty.code));
  made.stations.push(id(SETUP.internalStation.code), id(SETUP.externalStation.code), id(SETUP.tamburStation.code));
  made.routes.push(id(SETUP.internalRoute.code), id(SETUP.externalRoute.code));
  made.categories.push(id(SETUP.externalCategory.code));
  check("§1 ⭐ uygulama planla birebir (aynı 15 kayıt, hepsi kimlikli)",
    applied.conflicts.length === 0 && applied.records.length === plan.length && applied.records.every((r, i) => r.key === plan[i]!.key && r.action === "CREATE" && !!r.id));
  const again = await planBrodeSetup(SETUP);
  check("§1 ikinci koşum: hepsi AYNI (idempotent)", again.length === 15 && again.every((r) => r.action === "SAME"), again.filter((r) => r.action !== "SAME").map((r) => r.key).join(","));
  const audits = await prisma.systemLog.count({ where: { recordId: { in: made.stations } } });
  check("§1 uygulama audit ayak izi bırakır (istasyonlar)", audits >= 3, String(audits));
  // Çakışma: aynı koda sahip istasyon başka türdeyse --apply HİÇ yazmaz.
  const clash = await prisma.station.create({ data: { code: code("XX"), name: `${TAG} çakışan`, type: "INTERNAL", kind: "OTHER" }, select: { id: true } });
  made.stations.push(clash.id);
  const clashInput: BrodeSetupInput = { ...SETUP, internalStation: { code: code("XX"), name: "x" }, internalRoute: { code: code("RX"), name: `${TAG} rx` } };
  const pre = await countAll();
  const res = await applyBrodeSetup(clashInput, actor);
  check("§1 ⭐ çakışan istasyon (OTHER) → CONFLICT listelenir, 0 yazım", res.conflicts.some((r) => r.kind === "STATION" && r.key === code("XX")) && (await countAll()) === pre, res.conflicts.map((r) => r.detail).join(";"));
  // Plan ile yazım arasında doğan çakışma: yazım tx'i, çakışmadan ÖNCE yazdığı yeni deseni de geri sarar.
  const midInput: BrodeSetupInput = { ...clashInput, patterns: [...SETUP.patterns, { code: code("DX"), name: `${TAG} dx` }] };
  const mid = await writeBrodeSetup(midInput, actor);
  check("§1 ⭐ yazım anında çakışma → tx geri sarılır (önceki yeni desen dahil 0 yazım), çakışma döner",
    mid.conflicts.some((r) => r.key === code("XX")) && (await countAll()) === pre, `${pre} → ${await countAll()}`);
  const insp = await prisma.station.findMany({ where: { id: { in: [id(SETUP.internalStation.code), id(SETUP.tamburStation.code)] } }, select: { id: true, inspectionEnabled: true } });
  const inspOf = (k: string) => insp.find((r) => r.id === id(k))?.inspectionEnabled;
  check("§1 muayene: iç Brode kapalı (desen düğmesi), Tambur-2 açık (panel varsayılanı)",
    inspOf(SETUP.internalStation.code) === false && inspOf(SETUP.tamburStation.code) === true, JSON.stringify(insp));
  const badInput = parseBrodeSetupInput({ patterns: [{ code: "", name: "x" }], bilinmeyen: 1 });
  check("§1 --girdi fail-closed: boş kod + bilinmeyen alan reddedilir", typeof badInput === "string", String(badInput));

  const BR = id(SETUP.flag.code), BRD = id(SETUP.patternProperty.code);
  const HZB = id(SETUP.serviceItem.code), HZA = id(SETUP.patternServiceItems[0]!.code);
  const ST_BRODE = id(SETUP.internalStation.code), ST_T2 = id(SETUP.tamburStation.code);
  const R_IC = id(SETUP.internalRoute.code), R_DIS = id(SETUP.externalRoute.code);
  const vals = await prisma.fabricPropertyValue.findMany({ where: { propertyId: BRD }, select: { id: true, code: true } });
  const vA = vals.find((v) => v.code === code("DA"))!.id, vB = vals.find((v) => v.code === code("DB"))!.id;

  // Fiyat (para kararı, kurulumda YOK): brode kalemi genel 5, bu müşteriye 6; desen A kalemi 7.
  const owner = await prisma.customer.create({ data: { code: `${TAG}-OWN`, name: `${TAG} sahip` }, select: { id: true } });
  made.customers.push(owner.id);
  await prisma.itemPrice.createMany({ data: [
    { itemId: HZB, customerId: null, kind: PriceKind.SALE, currency: Currency.TRY, price: "5.0000" },
    { itemId: HZB, customerId: owner.id, kind: PriceKind.SALE, currency: Currency.TRY, price: "6.0000" },
    { itemId: HZA, customerId: null, kind: PriceKind.SALE, currency: Currency.TRY, price: "7.0000" },
  ] });
  const fabric = await prisma.item.create({ data: { code: `${TAG}-KUM`, name: `${TAG} perde`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  made.items.push(fabric.id);
  const settings = await loadServiceBillingSettings();
  const draft = (rollIds: string[]) => collectServiceBillingDraft({ rollIds, customerId: owner.id, currency: Currency.TRY, settings, dispatchedAt: null });
  const mkNote = async (lines: Array<{ processText: string; meters: number }>) => {
    const n = await createDeliveryNote({
      sourceKind: "MANUAL", ownerCustomerId: owner.id, senderText: `${TAG} GÖNDEREN`, customerBatchNo: `P-${made.notes.length + 1}`,
      lines: lines.map((l, i) => ({ senderRollNo: `${TAG}-${made.notes.length}-${i + 1}`, meters: l.meters, itemId: fabric.id, processText: l.processText })),
    }, actor);
    made.notes.push(n.id);
    await approveDeliveryNote(n.id, {}, actor);
    return n.id;
  };
  const rollOf = async (barcode: string) => (await prisma.roll.findUnique({ where: { barcode }, select: { id: true, currentStepId: true, status: true, currentQty: true } }))!;
  /** Tambur-2 (T2 süzgeci): istasyonun bekleyen listesinde görünür + kesim; çocuk id'leri döner. */
  const tamburCut = async (rollId: string, cuts: number[]) => {
    const pending = (await tambur.getPendingRolls(ST_T2)).data.map((r) => r.id);
    const f = await tambur.finalize({ rollId, decisions: [], cuts: cuts.map((length) => ({ length, qualityGrade: grade.code, relatedErrorIds: [] })) }, actor);
    const kids = f.data!.splitRolls.map((r) => r.id);
    made.rolls.push(...kids);
    return { listed: pending.includes(rollId), kids };
  };

  // ── §2 ───────────────────────────────────────────────────────────────────
  console.log("§2 İç yol — belge → iş emri → Brode tableti → Tambur-2 → hizmet taslağı");
  const n1 = await mkNote([{ processText: "BRODE DESEN LALE", meters: 100 }, { processText: "BRODE DESEN LALE", meters: 120 }, { processText: "BRODE DESEN PAPATYA", meters: 80 }]);
  const p1 = await buildWorkOrderPlan(n1);
  const gA = p1.groups.find((g) => g.targets.some((t) => t.valueId === vA));
  const gB = p1.groups.find((g) => g.targets.some((t) => t.valueId === vB));
  check("§2 plan: 2 desen grubu (Lale 2 top 220 m · Papatya 1 top 80 m)", p1.groups.length === 2 && gA?.rolls.length === 2 && gB?.rolls.length === 1 && gA.totalMeters === "220.00" && gB.totalMeters === "80.00",
    p1.groups.map((g) => `${g.key}:${g.rolls.length}:${g.totalMeters}`).join(" "));
  const wA = await startGroup(gA!, R_IC);
  const wB = await startGroup(gB!, R_IC);
  for (const w of [wA, wB]) if (w.data?.workOrder) made.wos.push(w.data.workOrder.id);
  check("§2 grup başına iç rota iş emri (2), toplar bağlandı (2 + 1)", wA.data?.attached === 2 && wB.data?.attached === 1, `${wA.data?.attached}/${wB.data?.attached}`);
  const innerKids: string[] = [];
  const cutsByBarcode: Record<string, number[]> = {};
  for (const [g, valueCode] of [[gA!, code("DA")], [gB!, code("DB")]] as const) {
    const stepId = (await prisma.workOrderStep.findFirst({ where: { workOrderId: (g === gA ? wA : wB).data!.workOrder.id, stationId: ST_BRODE }, select: { id: true } }))!.id;
    for (const r of g.rolls) {
      const roll = await rollOf(r.barcode!);
      const e = await errorOf(() => qc.completeQc2({ rollId: roll.id, stepId, properties: [{ propertyId: BR }, { propertyId: BRD, valueCode }] }, actor));
      if (e) check(`§2 tablet desen düğmesi (${r.barcode})`, false, JSON.stringify(e));
    }
    await qc.finishStep({ stepId }, actor);
    for (const r of g.rolls) {
      const roll = await rollOf(r.barcode!);
      const m = Number(roll.currentQty);
      const cuts = [Math.round(m * 0.6), m - Math.round(m * 0.6)];
      cutsByBarcode[r.barcode!] = cuts;
      const t = await tamburCut(roll.id, cuts);
      if (!t.listed) check(`§2 Tambur-2 bekleyen listesinde (${r.barcode})`, false);
      innerKids.push(...t.kids);
    }
  }
  const patternOnRolls = await prisma.rollProperty.findMany({ where: { rollId: { in: innerKids }, propertyId: BRD, revokedAt: null }, select: { valueId: true } });
  check("§2 ⭐ Tambur-2 çocukları deseni taşır (her çocukta bir desen satırı)", patternOnRolls.length === innerKids.length && innerKids.length === 6, `${patternOnRolls.length}/${innerKids.length}`);
  const d2 = await draft(innerKids);
  const lineA = d2.lines.find((l) => l.itemId === HZA), lineB = d2.lines.find((l) => l.itemId === HZB);
  check("§2 ⭐ desen Lale → desen kalemi, 220 m × 7 (CUT)", eq(lineA?.qty, 220) && eq(lineA?.unitPrice, 7), JSON.stringify(lineA));
  check("§2 ⭐ desen Papatya (kalemsiz) → brode kalemi, 80 m × 6 (müşteri fiyatı)", eq(lineB?.qty, 80) && eq(lineB?.unitPrice, 6), JSON.stringify(lineB));
  check("§2 bağlar çocuklarda, taban CUT, iki kalemden başka satır yok", d2.links.length === 6 && d2.links.every((l) => l.meterBasis === "CUT" && innerKids.includes(l.rollId)) && d2.lines.length === 2,
    d2.links.map((l) => `${l.meterBasis}:${l.billedMeters}`).join(","));
  const total2 = d2.lines.reduce((s, l) => s.plus(new Prisma.Decimal(l.qty).times(l.unitPrice)), new Prisma.Decimal(0));
  check("§2 ⭐ tutar el hesabı: 220×7 + 80×6 = 2020", eq(total2, 2020), total2.toString());

  // ── §3 ───────────────────────────────────────────────────────────────────
  console.log("§3 Dış yol — belge → iş emri → fason sevk/kabul → Tambur-2 → hizmet taslağı");
  const dye = await ensureTestDyeHouse();
  // Firma ↔ kategori bağı kurulumda YOK (firma panelden seçilir); senaryoda test firması bağlanır.
  await prisma.subcontractorToCategory.create({ data: { subcontractorId: dye.id, categoryId: id(SETUP.externalCategory.code) } });
  const n2 = await mkNote([{ processText: "BRODE DESEN LALE", meters: 150 }]);
  const p2 = await buildWorkOrderPlan(n2);
  const g2 = p2.groups[0]!;
  const w2 = await startGroup(g2, R_DIS);
  if (w2.data?.workOrder) made.wos.push(w2.data.workOrder.id);
  check("§3 dış rota iş emri, desen hedefi Lale", w2.data?.attached === 1 && g2.targets[0]?.valueId === vA, JSON.stringify(g2.targets));
  const steps2 = await prisma.workOrderStep.findMany({ where: { workOrderId: w2.data!.workOrder.id }, orderBy: { stepSequence: "asc" }, select: { id: true } });
  const src = await rollOf(g2.rolls[0]!.barcode!);
  await sub.dispatch({ workOrderId: w2.data!.workOrder.id, stepId: steps2[0]!.id, subcontractorId: dye.id, rollIds: [src.id] }, actor);
  const rc = await sub.receive({ workOrderId: w2.data!.workOrder.id, stepId: steps2[0]!.id, subcontractorId: dye.id, clientToken: randomUUID(), returns: [{ rollId: src.id, receivedQty: 150 }], newRolls: [{ qty: 147 }] }, actor);
  const born = await prisma.roll.findMany({ where: { parentReceiptId: (rc.data as { id: string }).id }, select: { id: true, ownerCustomerId: true, status: true, currentStepId: true } });
  made.rolls.push(...born.map((b) => b.id));
  const bornPattern = born[0] ? await prisma.rollProperty.findFirst({ where: { rollId: born[0].id, propertyId: BRD, revokedAt: null }, select: { valueId: true } }) : null;
  check("§3 ⭐ kabulde doğan top: sahip kalıttı + hedef desen Lale (ayar AÇIK)", born.length === 1 && born[0]!.ownerCustomerId === owner.id && bornPattern?.valueId === vA, JSON.stringify({ born, bornPattern }));
  const t3 = await tamburCut(born[0]!.id, [100, 47]);
  check("§3 doğan top Tambur-2 bekleyen listesinde (T2 süzgeci)", t3.listed, JSON.stringify(born[0]));
  const d3 = await draft(t3.kids);
  const l3 = d3.lines.find((l) => l.itemId === HZA);
  check("§3 ⭐ dış brode: desen kalemi, metre = kabul edilen 147 (RECEIVED, doğan topta)", eq(l3?.qty, 147) && eq(l3?.unitPrice, 7) && d3.links.some((l) => l.meterBasis === "RECEIVED" && l.rollId === born[0]!.id),
    JSON.stringify({ lines: d3.lines, links: d3.links.map((l) => `${l.meterBasis}:${l.billedMeters}:${l.rollId === born[0]!.id ? "doğan" : "?"}`) }));
  check("§3 ⭐ tutar el hesabı: 147 × 7 = 1029, brode kalemi satırı yok", d3.lines.length === 1 && eq(new Prisma.Decimal(l3?.qty ?? 0).times(l3?.unitPrice ?? 0), 1029), JSON.stringify(d3.lines));
}

async function cleanup(): Promise<void> {
  const swallow = () => undefined;
  const noteRolls = (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: { in: made.notes }, rollId: { not: null } }, select: { rollId: true } })).map((r) => r.rollId!);
  const rollIds = [...new Set([...made.rolls, ...noteRolls])];
  const receipts = (await prisma.subcontractorReceipt.findMany({ where: { workOrderId: { in: made.wos } }, select: { id: true } }).catch(() => [])).map((r) => r.id);
  await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: made.notes } } }).catch(swallow);
  for (const t of ["serviceBillingLink", "rollMeterReading", "rollProperty", "rollOperation", "rollMovement", "rollError", "rollVariance", "warehouseMovement", "rollStatusEvent"] as const) {
    await (prisma[t] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }).deleteMany({ where: { rollId: { in: rollIds } } }).catch(swallow);
  }
  await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { currentStepId: null, batchId: null, parentRollId: null, parentReceiptId: null } }).catch(swallow);
  await prisma.subcontractorReceiptItem.deleteMany({ where: { receiptId: { in: receipts } } }).catch(swallow);
  await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: receipts } } }).catch(swallow);
  await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatch: { workOrderId: { in: made.wos } } } }).catch(swallow);
  await prisma.subcontractorDispatch.deleteMany({ where: { workOrderId: { in: made.wos } } }).catch(swallow);
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(swallow);
  for (const wid of made.wos) {
    await prisma.workOrderTargetValue.deleteMany({ where: { workOrderId: wid } }).catch(swallow);
    await prisma.workOrderTargetProperty.deleteMany({ where: { workOrderId: wid } }).catch(swallow);
    await prisma.workOrderEvent.deleteMany({ where: { workOrderId: wid } }).catch(swallow);
    await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: wid } } }).catch(swallow);
    await prisma.travelerCard.deleteMany({ where: { workOrderId: wid } }).catch(swallow);
    await prisma.batch.deleteMany({ where: { workOrderId: wid } }).catch(swallow);
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: wid } }).catch(swallow);
    await prisma.workOrder.deleteMany({ where: { id: wid } }).catch(swallow);
  }
  await prisma.route.deleteMany({ where: { id: { in: made.routes } } }).catch(swallow);
  await prisma.station.deleteMany({ where: { id: { in: made.stations } } }).catch(swallow);
  await prisma.subcontractorCategory.deleteMany({ where: { id: { in: made.categories } } }).catch(swallow);
  const valueIds = (await prisma.fabricPropertyValue.findMany({ where: { propertyId: { in: made.props } }, select: { id: true } })).map((v) => v.id);
  await prisma.deliveryNoteAlias.deleteMany({ where: { targetId: { in: [...made.items, ...made.customers, ...valueIds] } } }).catch(swallow);
  await prisma.fabricPropertyValue.deleteMany({ where: { propertyId: { in: made.props } } }).catch(swallow);
  await prisma.fabricProperty.deleteMany({ where: { id: { in: [...made.props].reverse() } } }).catch(swallow);
  await prisma.itemPrice.deleteMany({ where: { itemId: { in: made.items } } }).catch(swallow);
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
    await pool.end().catch(() => undefined);
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

if (!engel) void main();
else void prisma.$disconnect();
