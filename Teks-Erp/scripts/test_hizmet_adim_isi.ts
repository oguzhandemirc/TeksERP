// =============================================================================
// BEKÇİ — ADIM HİZMET İŞİ (genel fason F3: süreç türü → hizmet kartı, ayar `finance.serviceBilling.stepWorks`)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_hizmet_adim_isi.ts
//
// NEDEN: boya/apre/çözgü gibi bayrak olmayan süreçler müşterinin emanet kumaşına yapılır ama bugün faturaya
// girmez. F3 adımın süreç türünü hizmet kartına eşler. Yanlış kurulursa: aynı adım hem bayrak hem adım
// satırı olarak İKİ KEZ kesilir, simüle sayaç müşteriye fatura olur, fasona gidip dönmemiş top
// faturalanır ya da ayar kapalıyken bugünkü taslak sessizce değişir.
//
// ÖLÇÜLENLER:
//   §1 Ayar varsayılanı KAPALI (kayıt yok → okuyucu, ayar paketi, bayrak yükü false)
//   §2 Kapalı ayarda bayt-aynı: eşleme VARKEN taslak = adım kaynağı hiç yokmuş gibi (JSON eşit)
//   §3 Boya (iç adım, istasyon varsayılan türü) → tek STEP satırı, metre OUT okuması, kalem eşlenen kart
//   §4 Bayrak önceliği: aynı adım bayrak işi verdi (okumalı) → tek satır (bayrak); okumasız (adımsız) bayrak da bastırır;
//      öncelik TOP BAŞINA — aynı sevkte bayraklı A + bayraksız B → B'nin adım işi kalır
//   §5 SIMULATED okuma girmez: adımın yalnız simüle okuması → iş yok + uyarı
//   §6 Dış (fason) adım: kabulsüz iş yok · doğan top RECEIVED = kabul metresi · iptal makbuz sayılmaz ·
//      makbuzdan kendisi dönen top (NULL kalem) topun metresi bir kez
//   §7 Atlanan adım, geri alınmış hareket, eşlenmemiş tür → iş yok; okumasız kapalı hareket → qtyOut DECLARED;
//      bölünmüş ana top (mevcut 0, qtyOut boş) → giriş metresi; hiç metre yoksa iş yok + uyarı (sessiz düşmez)
//   §8 Faturalı iş tekrar toplanmaz (bağ anahtarı top:kart:adım)
//   §9 Eşleme ucu: küme değişimi + audit · başka karta eşli tür 409 SERVICE_PROCESS_TAKEN · bilinmeyen tür 400 ·
//      pasif karta yeni eşleme 409 ITEM_INACTIVE · eşleme kartın canlı referansı (pasife alma 409) ·
//      kart satırı FOR UPDATE: elle açık tutulan kilit altında PUT bekler (eşzamanlı iki PUT birbirini ezmez)
// Negatif sondalar (2026-11-08) harita satırında.
// =============================================================================
import { randomUUID } from "node:crypto";
import { Currency, ItemLifecycleStatus, ItemType, MachineDataSource, MeterApprovalMode, MeterPhase, MeterVarianceBasis, PriceKind, Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { kartAc, kartlariSil, fiyatKonusuWhere } from "./lib/kart-fikstur";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { testActorId } from "./fixture-test-user";
import { resolveServiceItemsForRolls, simulatedStepWarning, zeroMeterStepWarning, type ServiceResolveOptions } from "../src/services/helpers/service-pricing.helper";
import { collectServiceBillingDraft } from "../src/services/helpers/service-billing.helper";
import { SETTING_KEYS, loadServiceBillingSettings, readFinanceServiceBillingStepWorks, systemSettingService } from "../src/services/system-setting.service";
import { serviceItemService } from "../src/services/service-item.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); } else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}
function section(t: string): void { console.log(`\n── ${t} ──`); }
async function errOf(fn: () => Promise<unknown>): Promise<{ status: number; code: string | null }> {
  try { await fn(); return { status: 200, code: null }; } catch (e) {
    const x = e as { statusCode?: number; details?: { code?: string } };
    return { status: x.statusCode ?? 500, code: x.details?.code ?? null };
  }
}
const eq = (a: Prisma.Decimal.Value | null | undefined, b: number) => a != null && new Prisma.Decimal(a).minus(b).abs().lte(0.001);

const STAMP = randomUUID().slice(0, 8);
const P = `TEST-HAI-${STAMP}`;
const fx = {
  itemIds: [] as string[], propIds: [] as string[], catIds: [] as string[], stationIds: [] as string[], woIds: [] as string[],
  rollIds: [] as string[], receiptIds: [] as string[], customerIds: [] as string[],
};
const STEP_KEY = SETTING_KEYS.FINANCE_SERVICE_BILLING_STEP_WORKS;
let prior: { existed: boolean; value: unknown } = { existed: false, value: null };
const ON: ServiceResolveOptions = { stepWorks: true };

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  console.log("=== Adım hizmet işi — süreç türü eşlemesi (fason F3) ===");
  const row = await prisma.systemSetting.findUnique({ where: { key: STEP_KEY }, select: { value: true } });
  prior = { existed: row !== null, value: row?.value ?? null };
  await prisma.systemSetting.deleteMany({ where: { key: STEP_KEY } });
  const actor = await testActorId();
  const dye = await ensureTestDyeHouse();

  // ── Fikstür ──────────────────────────────────────────────────────────────
  const mkItem = async (suffix: string, itemType: ItemType, price?: string) => {
    const it = await kartAc({ code: `${P}-${suffix}`.slice(0, 32), name: `TEST HAI ${suffix} ${STAMP}`, itemType, unit: "MT" });
    fx.itemIds.push(it.id);
    if (price) await prisma.itemPrice.create({ data: { serviceItemId: it.id, customerId: null, kind: PriceKind.SALE, currency: Currency.TRY, price } });
    return it.id;
  };
  const fabric = await mkItem("KUM", ItemType.FABRIC);
  const BOYA = await mkItem("BOYA", ItemType.SERVICE, "4.0000");
  const APRE = await mkItem("APRE", ItemType.SERVICE, "1.5000");
  const FASON = await mkItem("FSN", ItemType.SERVICE, "6.0000");
  const BRODE = await mkItem("BRODE", ItemType.SERVICE, "5.0000");
  const mkCat = async (suffix: string) => {
    const c = await prisma.subcontractorCategory.create({ data: { code: `${P}-${suffix}`.slice(0, 32), name: `TEST HAI ${suffix} ${STAMP}` }, select: { id: true } });
    fx.catIds.push(c.id);
    return c.id;
  };
  const catBoya = await mkCat("BOYA");
  const catApre = await mkCat("APRE");
  const catFason = await mkCat("FSN");
  const catBos = await mkCat("BOS"); // eşlenmez
  const br = await prisma.fabricProperty.create({ data: { code: `${P}-BR`.slice(0, 32), name: `TEST HAI brode`, valueType: "FLAG", serviceItemId: BRODE }, select: { id: true } });
  fx.propIds.push(br.id);
  const mkStation = async (suffix: string, type: "INTERNAL" | "EXTERNAL", defaultCategoryId: string | null, props: string[] = []) => {
    const s = await prisma.station.create({
      data: { code: `${P}-${suffix}`.slice(0, 32), name: `TEST HAI ${suffix} ${STAMP}`, type, kind: type === "EXTERNAL" ? "SUBCONTRACTOR" : "OTHER", appliesProperty: props.length > 0, defaultCategoryId },
      select: { id: true },
    });
    fx.stationIds.push(s.id);
    if (props.length > 0) await prisma.stationProperty.createMany({ data: props.map((propertyId) => ({ stationId: s.id, propertyId })) });
    return s.id;
  };
  const stBoya = await mkStation("SBOYA", "INTERNAL", catBoya);
  const stApre = await mkStation("SAPRE", "INTERNAL", catApre, [br.id]);
  const stFason = await mkStation("SFSN", "EXTERNAL", null);
  const stBos = await mkStation("SBOS", "INTERNAL", catBos);
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `${P}-WO`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", targetItemId: fabric,
      steps: {
        create: [
          { stationId: stBoya, stepSequence: 1, status: "COMPLETED" as const },
          { stationId: stApre, stepSequence: 2, status: "COMPLETED" as const },
          { stationId: stFason, stepSequence: 3, status: "ACTIVE" as const, requiredCategoryId: catFason },
          { stationId: stBoya, stepSequence: 4, status: "SKIPPED" as const, skipReason: "TEST" },
          { stationId: stBos, stepSequence: 5, status: "COMPLETED" as const },
        ],
      },
    },
    select: { id: true, steps: { orderBy: { stepSequence: "asc" }, select: { id: true } } },
  });
  fx.woIds.push(wo.id);
  const [S1, S2, S3, S4, S5] = wo.steps.map((s) => s.id) as [string, string, string, string, string];
  const cust = await prisma.customer.create({ data: { code: `${P}-C`.slice(0, 32), name: `TEST HAI müşteri ${STAMP}` }, select: { id: true } });
  fx.customerIds.push(cust.id);

  let seq = 0;
  const mkRoll = async (qty: number, extra: Partial<Prisma.RollUncheckedCreateInput> = {}) => {
    seq++;
    const r = await prisma.roll.create({
      data: { itemId: fabric, barcode: `${P}-R${seq}`, initialQty: qty, currentQty: qty, status: "IN_PRODUCTION", ownerCustomerId: cust.id, ...extra },
      select: { id: true },
    });
    fx.rollIds.push(r.id);
    return r.id;
  };
  const move = (rollId: string, stepId: string, qtyOut: number | null, opts: { open?: boolean; revoked?: boolean; qtyIn?: number } = {}) => prisma.rollMovement.create({
    data: {
      rollId, workOrderStepId: stepId, qtyIn: opts.qtyIn ?? 100, qtyOut: opts.open ? null : qtyOut, exitedAt: opts.open ? null : new Date(),
      ...(opts.revoked ? { revokedAt: new Date(), revokeReason: "TEST" } : {}),
    },
  });
  const read = (rollId: string, stepId: string, phase: MeterPhase, meters: number, source: MachineDataSource = MachineDataSource.OPERATOR) =>
    prisma.rollMeterReading.create({ data: { rollId, workOrderStepId: stepId, phase, meters, source, basis: MeterVarianceBasis.DECLARED_IN, approvalMode: MeterApprovalMode.NONE, clientToken: randomUUID() }, select: { id: true } });
  const steps = (rollIds: string[], opt: ServiceResolveOptions = ON) => resolveServiceItemsForRolls({ rollIds, customerId: cust.id, currency: Currency.TRY, options: opt });

  // Eşleme (servis ucu): BOYA ← boya, APRE ← apre, FASON ← fason.
  await serviceItemService.replaceProcesses(BOYA, [catBoya], actor);
  await serviceItemService.replaceProcesses(APRE, [catApre], actor);
  await serviceItemService.replaceProcesses(FASON, [catFason], actor);

  // ── §1 ───────────────────────────────────────────────────────────────────
  section("§1 ayar varsayılanı KAPALI");
  const flags = await systemSettingService.getFeatureFlags();
  check("kayıt yok → okuyucu false, ayar paketi false, bayrak yükü false",
    (await readFinanceServiceBillingStepWorks()) === false && (await loadServiceBillingSettings()).stepWorks === false && flags.data?.financeServiceBillingStepWorks === false);

  // ── §3 boya ──────────────────────────────────────────────────────────────
  const rBoya = await mkRoll(100);
  await move(rBoya, S1, 97);
  const rdBoya = await read(rBoya, S1, MeterPhase.OUT, 98.5);
  await read(rBoya, S1, MeterPhase.IN, 99);

  // ── §2 bayt-aynı ─────────────────────────────────────────────────────────
  section("§2 kapalı ayarda bayt-aynı");
  const settingsOff = await loadServiceBillingSettings();
  const draftOff = await collectServiceBillingDraft({ rollIds: [rBoya], customerId: cust.id, currency: Currency.TRY, settings: settingsOff, dispatchedAt: null });
  const resNone = await steps([rBoya], {});
  check("eşleme varken ayar kapalı: taslak boş (bugün boya faturalanmaz)", draftOff.lines.length === 0 && draftOff.links.length === 0, JSON.stringify(draftOff));
  check("ayar kapalı çözüm = seçeneksiz çözüm (JSON eşit)", JSON.stringify(await steps([rBoya], { stepWorks: false })) === JSON.stringify(resNone));

  section("§3 boya (iç adım) → tek STEP satırı");
  const r3 = await steps([rBoya]);
  const w3 = r3.works.filter((w) => w.source === "STEP");
  check("tek iş, kalem BOYA, adım S1, metre OUT okuması 98.5", w3.length === 1 && w3[0]!.serviceItemId === BOYA && w3[0]!.workOrderStepId === S1 && w3[0]!.meterBasis === "OUT" && eq(w3[0]!.meters, 98.5) && w3[0]!.readingId === rdBoya.id, JSON.stringify(w3));
  check("tek satır, fiyat 4, miktar 98.5", r3.lines.length === 1 && r3.lines[0]!.serviceItemId === BOYA && eq(r3.lines[0]!.unitPrice, 4) && r3.lines[0]!.quantity === "98.500", JSON.stringify(r3.lines));
  const r3in = await steps([rBoya], { ...ON, meterBasis: "IN" });
  check("IN tabanı → giriş okuması 99", r3in.works.length === 1 && r3in.works[0]!.meterBasis === "IN" && eq(r3in.works[0]!.meters, 99));
  const draftOn = await collectServiceBillingDraft({ rollIds: [rBoya], customerId: cust.id, currency: Currency.TRY, settings: { ...settingsOff, stepWorks: true }, dispatchedAt: null });
  check("taslak (ayar açık): 1 SERVICE satırı + 1 bağ (top:BOYA:S1, OUT)", draftOn.lines.length === 1 && draftOn.lines[0]!.serviceItemId === BOYA && draftOn.links.length === 1 && draftOn.links[0]!.workOrderStepId === S1 && draftOn.links[0]!.meterBasis === "OUT", JSON.stringify(draftOn.links));

  // ── §4 bayrak önceliği ───────────────────────────────────────────────────
  section("§4 aynı adım bayrak işi verdiyse tek satır");
  const rFlag = await mkRoll(100);
  await move(rFlag, S2, 95);
  await read(rFlag, S2, MeterPhase.OUT, 96);
  await prisma.rollProperty.create({ data: { rollId: rFlag, propertyId: br.id } });
  const r4 = await steps([rFlag]);
  check("okumalı bayrak: tek iş (PROPERTY, BRODE), adım işi yok", r4.works.length === 1 && r4.works[0]!.source === "PROPERTY" && r4.works[0]!.serviceItemId === BRODE && r4.lines.length === 1, JSON.stringify(r4.works.map((w) => [w.source, w.workOrderStepId])));
  const rFlag2 = await mkRoll(80);
  await move(rFlag2, S2, 80);
  await prisma.rollProperty.create({ data: { rollId: rFlag2, propertyId: br.id } });
  const r4b = await steps([rFlag2]);
  check("okumasız (adımsız DECLARED) bayrak da adım işini bastırır: tek iş PROPERTY", r4b.works.length === 1 && r4b.works[0]!.source === "PROPERTY" && r4b.works[0]!.workOrderStepId === null, JSON.stringify(r4b.works.map((w) => [w.source, w.workOrderStepId])));
  const rNoFlag = await mkRoll(70);
  await move(rNoFlag, S2, 70);
  const r4c = await steps([rNoFlag]);
  check("bayraksız top aynı adımda: APRE adım işi (qtyOut, DECLARED)", r4c.works.length === 1 && r4c.works[0]!.source === "STEP" && r4c.works[0]!.serviceItemId === APRE && r4c.works[0]!.meterBasis === "DECLARED" && eq(r4c.works[0]!.meters, 70), JSON.stringify(r4c.works));
  const r4d = await steps([rFlag, rNoFlag]);
  check("AYNI sevkte bayraklı A + bayraksız B: A'da yalnız bayrak, B'nin APRE adım işi KALIR (öncelik top başına)",
    r4d.works.some((w) => w.rollId === rNoFlag && w.source === "STEP" && w.serviceItemId === APRE) && !r4d.works.some((w) => w.rollId === rFlag && w.source === "STEP"),
    JSON.stringify(r4d.works.map((w) => [w.rollId === rNoFlag ? "B" : "A", w.source, w.workOrderStepId])));

  // ── §5 SIMULATED ─────────────────────────────────────────────────────────
  section("§5 simüle okuma faturaya girmez");
  const rSim = await mkRoll(100);
  await move(rSim, S1, 100);
  await read(rSim, S1, MeterPhase.OUT, 100, MachineDataSource.SIMULATED);
  const r5 = await steps([rSim]);
  check("yalnız simüle okuma: iş yok + uyarı", r5.works.length === 0 && r5.lines.length === 0 && r5.warnings.includes(simulatedStepWarning(1)), JSON.stringify(r5));
  const rSim2 = await mkRoll(100);
  await move(rSim2, S1, 100);
  await read(rSim2, S1, MeterPhase.OUT, 100, MachineDataSource.SIMULATED);
  await read(rSim2, S1, MeterPhase.IN, 91);
  const r5b = await steps([rSim2]);
  check("simüle OUT + gerçek IN: gerçek IN (91) sayılır, simüle değil", r5b.works.length === 1 && r5b.works[0]!.meterBasis === "IN" && eq(r5b.works[0]!.meters, 91), JSON.stringify(r5b.works));

  // ── §6 dış adım ──────────────────────────────────────────────────────────
  section("§6 dış (fason) adım yalnız kabulde");
  const rOut = await mkRoll(200);
  await move(rOut, S3, null, { open: true }); // sevk edildi, dönmedi
  const r6a = await steps([rOut]);
  check("kabulsüz (açık hareket) → iş yok", r6a.works.length === 0, JSON.stringify(r6a.works));
  const mkReceipt = async (cancelled = false) => {
    const rc = await prisma.subcontractorReceipt.create({
      data: { receiptNo: `${P}-SR${fx.receiptIds.length + 1}`, workOrderId: wo.id, stepId: S3, subcontractorId: dye.id, ...(cancelled ? { cancelledAt: new Date(), cancelReason: "TEST" } : {}) },
      select: { id: true },
    });
    fx.receiptIds.push(rc.id);
    return rc.id;
  };
  const rcOk = await mkReceipt();
  const born = await mkRoll(188, { parentReceiptId: rcOk, parentRollId: rOut });
  const r6b = await steps([rOut, born]);
  const w6 = r6b.works.filter((w) => w.source === "STEP");
  check("doğan top: tek iş FASON, RECEIVED = 188, bağ doğan topta", w6.length === 1 && w6[0]!.rollId === born && w6[0]!.serviceItemId === FASON && w6[0]!.meterBasis === "RECEIVED" && eq(w6[0]!.meters, 188), JSON.stringify(w6));
  const rcX = await mkReceipt(true);
  const bornX = await mkRoll(150, { parentReceiptId: rcX });
  check("iptal makbuzdan doğan top → iş yok", (await steps([bornX])).works.length === 0);
  const rSelf = await mkRoll(175);
  const rcSelf = await mkReceipt();
  await prisma.subcontractorReceiptItem.create({ data: { receiptId: rcSelf, newRollId: rSelf, receivedQty: null } });
  const r6d = await steps([rSelf]);
  check("makbuzdan kendisi dönen top (NULL kalem) → RECEIVED = topun metresi 175 bir kez", r6d.works.length === 1 && r6d.works[0]!.meterBasis === "RECEIVED" && eq(r6d.works[0]!.meters, 175), JSON.stringify(r6d.works));

  // ── §7 sayılmayanlar ─────────────────────────────────────────────────────
  section("§7 atlanan / geri alınan / eşlemesiz");
  const rSkip = await mkRoll(100);
  await move(rSkip, S4, 100);
  check("SKIPPED adımın kapanmış hareketi → iş yok", (await steps([rSkip])).works.length === 0);
  const rRev = await mkRoll(100);
  await move(rRev, S1, 100, { revoked: true });
  check("geri alınmış hareket → iş yok", (await steps([rRev])).works.length === 0);
  const rBos = await mkRoll(100);
  await move(rBos, S5, 100);
  const r7 = await steps([rBos]);
  check("eşlenmemiş süreç türü → iş yok, uyarı yok", r7.works.length === 0 && r7.warnings.length === 0, JSON.stringify(r7));
  const rOpen = await mkRoll(100);
  await move(rOpen, S1, null, { open: true });
  check("iç adımda açık (bitmemiş) hareket → iş yok", (await steps([rOpen])).works.length === 0);
  const rSplit = await mkRoll(100, { currentQty: 0 });
  await move(rSplit, S1, null, { qtyIn: 90 });
  const r7s = await steps([rSplit]);
  check("bölünmüş ana top (mevcut 0, qtyOut boş): giriş metresi 90 DECLARED", r7s.works.length === 1 && r7s.works[0]!.meterBasis === "DECLARED" && eq(r7s.works[0]!.meters, 90), JSON.stringify(r7s.works));
  const rZero = await mkRoll(100, { currentQty: 0 });
  await move(rZero, S1, null, { qtyIn: 0 });
  const r7z = await steps([rZero]);
  check("hiç metre yok: iş yok AMA uyarı var (sessiz düşmez)", r7z.works.length === 0 && r7z.warnings.includes(zeroMeterStepWarning(1)), JSON.stringify(r7z));

  // ── §8 faturalı iş ───────────────────────────────────────────────────────
  section("§8 faturalı iş tekrar toplanmaz");
  const r8 = await steps([rBoya], { ...ON, billedKeys: new Set([`${rBoya}:${BOYA}:${S1}`]) });
  check("bağ anahtarı top:BOYA:S1 aktifse iş düşer", r8.works.length === 0 && r8.lines.length === 0, JSON.stringify(r8.works));

  // ── §9 eşleme ucu ────────────────────────────────────────────────────────
  section("§9 eşleme ucu");
  const taken = await errOf(() => serviceItemService.replaceProcesses(APRE, [catApre, catBoya], actor));
  check("başka karta eşli tür → 409 SERVICE_PROCESS_TAKEN", taken.status === 409 && taken.code === "SERVICE_PROCESS_TAKEN", JSON.stringify(taken));
  const unknown = await errOf(() => serviceItemService.replaceProcesses(APRE, [randomUUID()], actor));
  check("bilinmeyen tür → 400 SERVICE_PROCESS_CATEGORY_INVALID", unknown.status === 400 && unknown.code === "SERVICE_PROCESS_CATEGORY_INVALID", JSON.stringify(unknown));
  const noCard = await errOf(() => serviceItemService.processes(randomUUID()));
  check("olmayan kart → 404", noCard.status === 404, JSON.stringify(noCard));
  const auditBefore = await prisma.systemLog.count({ where: { tableName: "SERVICE_ITEM", recordId: APRE } });
  const rep = await serviceItemService.replaceProcesses(APRE, [catApre, catBos], actor);
  const auditAfter = await prisma.systemLog.findFirst({ where: { tableName: "SERVICE_ITEM", recordId: APRE }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { oldData: true, newData: true } });
  check("küme değişimi: iki tür + changed + audit eski/yeni küme",
    rep.changed && rep.data.length === 2 && auditBefore + 1 === (await prisma.systemLog.count({ where: { tableName: "SERVICE_ITEM", recordId: APRE } }))
      && JSON.stringify((auditAfter?.newData as { processCategoryIds?: string[] })?.processCategoryIds) === JSON.stringify([catApre, catBos].sort()),
    JSON.stringify(auditAfter));
  const same = await serviceItemService.replaceProcesses(APRE, [catBos, catApre], actor);
  check("aynı küme → changed=false, audit yok", !same.changed && (await prisma.systemLog.count({ where: { tableName: "SERVICE_ITEM", recordId: APRE } })) === auditBefore + 1);
  const map = (await serviceItemService.processMap()).data.filter((r) => fx.catIds.includes(r.categoryId));
  check("process-map dört eşlemeyi kart adıyla döner", map.length === 4 && map.some((r) => r.categoryId === catBos && r.serviceItemId === APRE));
  const pv = (await serviceItemService.lifecyclePreview(BOYA, ItemLifecycleStatus.ARCHIVED)).data as { canTransition: boolean; references: Array<{ kind: string; count: number }> };
  check("eşleme canlı referans: Pasif önizlemesi kapalı, SERVICE_PROCESS_MAP=1", !pv.canTransition && pv.references.find((r) => r.kind === "SERVICE_PROCESS_MAP")?.count === 1, JSON.stringify(pv.references.filter((r) => r.count > 0)));
  const arch = await errOf(() => serviceItemService.transitionLifecycle(BOYA, ItemLifecycleStatus.ARCHIVED, null, actor));
  check("eşlemeli kart pasife alınamaz → 409 ITEM_HAS_LIVE_REFERENCES", arch.status === 409 && arch.code === "ITEM_HAS_LIVE_REFERENCES", JSON.stringify(arch));
  await prisma.serviceItem.update({ where: { id: APRE }, data: { lifecycleStatus: "ARCHIVED", isActive: false } });
  const inact = await errOf(() => serviceItemService.replaceProcesses(APRE, [catApre, catBos, catFason], actor));
  check("pasif karta YENİ tür → 409 ITEM_INACTIVE", inact.status === 409 && inact.code === "ITEM_INACTIVE", JSON.stringify(inact));
  const shrink = await errOf(() => serviceItemService.replaceProcesses(APRE, [], actor));
  check("pasif karttan tür ÇIKARMAK serbest (200) ve satırlar gider", shrink.status === 200 && (await prisma.serviceItemProcess.count({ where: { serviceItemId: APRE } })) === 0, JSON.stringify(shrink));
  // Yarış: kart satırı elle açık tx'te FOR UPDATE tutulurken PUT beklemeli (kilitsiz olsa "önce" kümesi bayat okunur).
  const holder = await pool.connect();
  let settled = false;
  try {
    await holder.query("BEGIN");
    await holder.query(`SELECT id FROM "service_items" WHERE id = $1::uuid FOR UPDATE`, [BOYA]);
    const pending = serviceItemService.replaceProcesses(BOYA, [catBoya], actor).finally(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 800));
    check("kart satırı kilitliyken eşleme PUT'u BEKLER (FOR UPDATE)", !settled);
    await holder.query("COMMIT");
    const done = await pending;
    check("kilit bırakılınca PUT tamamlanır, küme korunur", settled && done.data.length === 1 && done.data[0]!.categoryId === catBoya, JSON.stringify(done.data));
  } finally {
    if (!settled) await holder.query("ROLLBACK").catch(() => undefined);
    holder.release();
  }
}

async function cleanup(): Promise<void> {
  const del = async (ad: string, f: () => Promise<unknown>) => {
    try { await f(); } catch (e) { fail++; console.log(`❌ temizlik ${ad}: ${(e as Error).message.split("\n")[0]}`); }
  };
  const ids = fx.rollIds;
  await del("meterReading", () => prisma.rollMeterReading.deleteMany({ where: { rollId: { in: ids } } }));
  await del("rollProperty", () => prisma.rollProperty.deleteMany({ where: { rollId: { in: ids } } }));
  await del("rollMovement", () => prisma.rollMovement.deleteMany({ where: { rollId: { in: ids } } }));
  await del("receiptItem", () => prisma.subcontractorReceiptItem.deleteMany({ where: { receiptId: { in: fx.receiptIds } } }));
  await del("roll çocuk", () => prisma.roll.deleteMany({ where: { id: { in: ids }, parentRollId: { not: null } } }));
  await del("roll", () => prisma.roll.deleteMany({ where: { id: { in: ids } } }));
  await del("receipt", () => prisma.subcontractorReceipt.deleteMany({ where: { id: { in: fx.receiptIds } } }));
  await del("step", () => prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("workOrder", () => prisma.workOrder.deleteMany({ where: { id: { in: fx.woIds } } }));
  await del("stationProperty", () => prisma.stationProperty.deleteMany({ where: { stationId: { in: fx.stationIds } } }));
  await del("station", () => prisma.station.deleteMany({ where: { id: { in: fx.stationIds } } }));
  await del("process", () => prisma.serviceItemProcess.deleteMany({ where: { OR: [{ categoryId: { in: fx.catIds } }, { serviceItemId: { in: fx.itemIds } }] } }));
  await del("category", () => prisma.subcontractorCategory.deleteMany({ where: { id: { in: fx.catIds } } }));
  await del("property", () => prisma.fabricProperty.deleteMany({ where: { id: { in: fx.propIds } } }));
  await del("itemPrice", () => prisma.itemPrice.deleteMany({ where: fiyatKonusuWhere(fx.itemIds) }));
  await del("item", () => kartlariSil(fx.itemIds));
  await del("customer", () => prisma.customer.deleteMany({ where: { id: { in: fx.customerIds } } }));
  await del("ayar geri yükle", async () => {
    if (prior.existed) await prisma.systemSetting.upsert({ where: { key: STEP_KEY }, create: { key: STEP_KEY, value: prior.value as never }, update: { value: prior.value as never } });
    else await prisma.systemSetting.deleteMany({ where: { key: STEP_KEY } });
  });
  const left = await prisma.roll.count({ where: { barcode: { startsWith: P } } });
  check("temizlik: TEST-HAI top kalıntısı yok", left === 0, String(left));
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
