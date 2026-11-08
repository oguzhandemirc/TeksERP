// =============================================================================
// BEKÇİ — YENİDEN İŞLEM FATURASI (genel fason F9, patron kararı FK2)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_hizmet_yeniden_islem.ts
//
// NEDEN: bizim hatamızdan dönen iş (yeniden boya) müşteriye ikinci kez kesilmemeli; müşterinin
// talebiyle dönen iş kesilmeli. Sınıf sebebe bağlıdır (`ReasonPreset.billable`) ama fatura anında
// CANLI okunursa katalog düzeltmesi geçmiş faturaları değiştirir — sınıf İE doğarken donar
// (`WorkOrder.reworkBillable`). F3 açığı: faturalanmış adım işinin hareketi geri alınırsa iş
// faturada kalır ama kanıtı yok olur → 409.
//
// ÖLÇÜLENLER:
//   §1 Katalog: billable yalnız WORK_ORDER_REWORK (başka türde 400 REASON_BILLABLE_KIND); liste alanı taşır;
//      PATCH değiştirir; çoğaltma kopyalar; null serbest
//   §2 Donma: İE (servis create) doğarken sebebin billable'ı kolona — bizim hatamız false · müşteri talebi true ·
//      sebepsiz / bilinmeyen kod null
//   §3 Katalog sonradan değişince geçmiş İE ve onun taslağı DEĞİŞMEZ
//   §4 Taslak: BIZIM_HATA (false) İE'nin adım işi → satır/bağ yok + uyarı (sessiz düşmez); müşteri talebi → satır;
//      sınıfsız → satır ve `excludedWorks` anahtarı yok (bayt-aynı); adımsız bayrak işi (DECLARED) işin anındaki
//      hareketin İE'sinden; kurşun biçimli adımlı iş (çözücü düzeyi) aynı İE'den; bayrak işinin kanıtı sınıfa
//      duyarlı: ücretli İE okuması + sonraki bizim-hata İE okuması → ücretli okuma faturada (yutulmaz)
//   §5 Geri alma kapısı: faturalı adım işinin hareketi geri alınırsa / yeniden açılırsa 409 SERVICE_ALREADY_BILLED;
//      faturasız iş serbest; bağ insert'i geri alınmış harekete 409 SERVICE_READING_CHANGED;
//      yarış: hareket FOR SHARE + bağ (açık tx) tutulurken geri alma BEKLER, commit sonrası 409;
//      kapı yalnız ADIM bağında: faturalı bayrak/kurşun bağlı topun hareketi bugünkü gibi geri alınır
// Negatif sondalar harita satırında (`docs/bekci-harita/maliyet.md`).
// =============================================================================
import { randomUUID } from "node:crypto";
import { Currency, ItemType, MachineDataSource, MeterApprovalMode, MeterPhase, MeterVarianceBasis, PriceKind, Prisma, ReasonPresetKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { kartAc, kartlariSil, fiyatKonusuWhere } from "./lib/kart-fikstur";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { testActorId } from "./fixture-test-user";
import { ReasonPresetService } from "../src/services/reason-preset.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { resolveServiceItemsForRolls, type ServiceResolveOptions } from "../src/services/helpers/service-pricing.helper";
import { collectServiceBillingDraft, insertServiceLinksTx } from "../src/services/helpers/service-billing.helper";
import { reworkOurFaultWarning, splitReworkOurFaultWorks } from "../src/services/helpers/rework-billing.helper";
import { reopenClosedMovementsTx, revokeRollMovements } from "../src/services/helpers/roll-movement.helper";
import { loadServiceBillingSettings } from "../src/services/system-setting.service";
import { serviceItemService } from "../src/services/service-item.service";
import { ensureCariAccountTx } from "../src/services/helpers/finance.helper";

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
const unwrap = <T>(r: unknown): T => ((r as { data?: T }).data ?? (r as T));

const STAMP = randomUUID().slice(0, 8);
const P = `TEST-HYI-${STAMP}`;
const fx = {
  itemIds: [] as string[], propIds: [] as string[], catIds: [] as string[], stationIds: [] as string[], woIds: [] as string[],
  rollIds: [] as string[], customerIds: [] as string[], presetIds: [] as string[], invoiceIds: [] as string[],
};
const ON: ServiceResolveOptions = { stepWorks: true };

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  console.log("=== Yeniden işlem faturası (fason F9) ===");
  const actor = await testActorId();
  const wos = new WorkOrderService();

  // ── §1 katalog ──────────────────────────────────────────────────────────
  section("§1 katalog: billable yalnız yeniden işlem sebebinde");
  const ours = await ReasonPresetService.create({ kind: ReasonPresetKind.WORK_ORDER_REWORK, label: `HYI bizim hata ${STAMP}`, billable: false }, actor);
  fx.presetIds.push(ours.id);
  const theirs = await ReasonPresetService.create({ kind: ReasonPresetKind.WORK_ORDER_REWORK, label: `HYI musteri talebi ${STAMP}`, billable: true }, actor);
  fx.presetIds.push(theirs.id);
  const plain = await ReasonPresetService.create({ kind: ReasonPresetKind.WORK_ORDER_REWORK, label: `HYI siniflanmamis ${STAMP}` }, actor);
  fx.presetIds.push(plain.id);
  check("create: false / true / verilmez → null", ours.billable === false && theirs.billable === true && plain.billable === null, JSON.stringify([ours.billable, theirs.billable, plain.billable]));
  const wrong = await errOf(() => ReasonPresetService.create({ kind: ReasonPresetKind.ROLL_SCRAP, label: `HYI fire ${STAMP}`, billable: false }, actor));
  check("başka türde dolu billable → 400 REASON_BILLABLE_KIND", wrong.status === 400 && wrong.code === "REASON_BILLABLE_KIND", JSON.stringify(wrong));
  const scrap = await ReasonPresetService.create({ kind: ReasonPresetKind.ROLL_SCRAP, label: `HYI fire2 ${STAMP}`, billable: null }, actor);
  fx.presetIds.push(scrap.id);
  const wrongPatch = await errOf(() => ReasonPresetService.update(scrap.id, { billable: true }, actor));
  check("başka türde null serbest; PATCH ile dolu → 400 REASON_BILLABLE_KIND", scrap.billable === null && wrongPatch.code === "REASON_BILLABLE_KIND", JSON.stringify(wrongPatch));
  const listed = (await ReasonPresetService.list({ kind: ReasonPresetKind.WORK_ORDER_REWORK })).find((r) => r.id === ours.id);
  check("liste satırı billable taşır", listed?.billable === false, JSON.stringify(listed?.billable));
  const dup = await ReasonPresetService.duplicate(ours.id, `HYI kopya ${STAMP}`, actor);
  fx.presetIds.push(dup.id);
  check("çoğaltma sınıfı kopyalar", dup.billable === false);
  const dbCk = await errOf(() => prisma.reasonPreset.update({ where: { id: scrap.id }, data: { billable: true } }));
  check("DB CHECK ikinci hat: başka türe billable yazılamaz", dbCk.status !== 200, JSON.stringify(dbCk));

  // ── Fikstür ─────────────────────────────────────────────────────────────
  const mkItem = async (suffix: string, itemType: ItemType, price?: string) => {
    const it = await kartAc({ code: `${P}-${suffix}`.slice(0, 32), name: `TEST HYI ${suffix} ${STAMP}`, itemType, unit: "MT" });
    fx.itemIds.push(it.id);
    if (price) await prisma.itemPrice.create({ data: { serviceItemId: it.id, customerId: null, kind: PriceKind.SALE, currency: Currency.TRY, price } });
    return it.id;
  };
  const fabric = await mkItem("KUM", ItemType.FABRIC);
  const BOYA = await mkItem("BOYA", ItemType.SERVICE, "4.0000");
  const BRODE = await mkItem("BRODE", ItemType.SERVICE, "5.0000");
  const cat = await prisma.subcontractorCategory.create({ data: { code: `${P}-CB`.slice(0, 32), name: `TEST HYI boya ${STAMP}` }, select: { id: true } });
  fx.catIds.push(cat.id);
  await serviceItemService.replaceProcesses(BOYA, [cat.id], actor);
  const br = await prisma.fabricProperty.create({ data: { code: `${P}-BR`.slice(0, 32), name: "TEST HYI brode", valueType: "FLAG", serviceItemId: BRODE }, select: { id: true } });
  fx.propIds.push(br.id);
  const st = await prisma.station.create({ data: { code: `${P}-S`.slice(0, 32), name: `TEST HYI boya ${STAMP}`, type: "INTERNAL", kind: "OTHER", defaultCategoryId: cat.id }, select: { id: true } });
  fx.stationIds.push(st.id);
  const cust = await prisma.customer.create({ data: { code: `${P}-C`.slice(0, 32), name: `TEST HYI müşteri ${STAMP}` }, select: { id: true } });
  fx.customerIds.push(cust.id);

  const mkWo = async (parameters: Record<string, unknown> | null, stationId = st.id) => {
    const wo = unwrap<{ id: string }>(await wos.create({ type: "STOCK_PRODUCTION", targetItemId: fabric, parameters, steps: [{ stationId, notes: null }] } as never));
    fx.woIds.push(wo.id);
    const row = await prisma.workOrder.findUniqueOrThrow({ where: { id: wo.id }, select: { reworkBillable: true, steps: { select: { id: true } } } });
    return { id: wo.id, stepId: row.steps[0]!.id, reworkBillable: row.reworkBillable };
  };
  const rework = (code: string | null) => ({ rework: { reasonCode: code, reasonText: null, rolls: [] } });

  // ── §2 donma ────────────────────────────────────────────────────────────
  section("§2 donma: İE doğarken sebebin sınıfı kolona");
  const woOurs = await mkWo(rework(ours.code));
  const woTheirs = await mkWo(rework(theirs.code));
  const woPlain = await mkWo(rework(plain.code));
  const woNone = await mkWo(null);
  const woUnknown = await mkWo(rework("YOK_BOYLE_KOD"));
  check("bizim hatamız → false · müşteri talebi → true · sınıfsız → null",
    woOurs.reworkBillable === false && woTheirs.reworkBillable === true && woPlain.reworkBillable === null,
    JSON.stringify([woOurs.reworkBillable, woTheirs.reworkBillable, woPlain.reworkBillable]));
  check("sebepsiz İE ve bilinmeyen kod → null (bugünkü, reddetmez)", woNone.reworkBillable === null && woUnknown.reworkBillable === null);

  // ── Hareketler ──────────────────────────────────────────────────────────
  let seq = 0;
  const mkRoll = async (qty: number) => {
    seq++;
    const r = await prisma.roll.create({
      data: { itemId: fabric, barcode: `${P}-R${seq}`, initialQty: qty, currentQty: qty, status: "IN_PRODUCTION", ownerCustomerId: cust.id },
      select: { id: true },
    });
    fx.rollIds.push(r.id);
    return r.id;
  };
  const move = (rollId: string, stepId: string, qtyOut: number) => prisma.rollMovement.create({
    data: { rollId, workOrderStepId: stepId, qtyIn: 100, qtyOut, exitedAt: new Date(), enteredAt: new Date(Date.now() - 60_000) },
    select: { id: true },
  });
  const resolve = (rollIds: string[]) => resolveServiceItemsForRolls({ rollIds, customerId: cust.id, currency: Currency.TRY, options: ON });
  const settings = { ...(await loadServiceBillingSettings()), stepWorks: true };
  const draft = (rollIds: string[]) => collectServiceBillingDraft({ rollIds, customerId: cust.id, currency: Currency.TRY, settings, dispatchedAt: null });

  const rOurs = await mkRoll(90);
  await move(rOurs, woOurs.stepId, 88);
  const rTheirs = await mkRoll(80);
  await move(rTheirs, woTheirs.stepId, 79);
  const rPlain = await mkRoll(70);
  await move(rPlain, woPlain.stepId, 70);

  // ── §4 taslak ───────────────────────────────────────────────────────────
  section("§4 taslak: bizim hatamız satırsız, müşteri talebi satırlı");
  const r4a = await resolve([rOurs]);
  const d4a = await draft([rOurs]);
  check("BIZIM_HATA: satır yok, bağ yok", r4a.lines.length === 0 && d4a.lines.length === 0 && d4a.links.length === 0, JSON.stringify(d4a));
  check("BIZIM_HATA: uyarı (sessiz düşmez) + excludedWorks tek iş", r4a.warnings.includes(reworkOurFaultWarning(1)) && r4a.excludedWorks?.length === 1 && r4a.excludedWorks[0]!.rollId === rOurs, JSON.stringify(r4a.warnings));
  const d4b = await draft([rTheirs]);
  check("müşteri talebi: 1 satır (BOYA, 79) + bağ", d4b.lines.length === 1 && d4b.lines[0]!.serviceItemId === BOYA && d4b.lines[0]!.qty.eq(79) && d4b.links.length === 1, JSON.stringify(d4b.lines));
  const r4c = await resolve([rPlain]);
  check("sınıfsız: satır var, uyarı yok, excludedWorks anahtarı yok (bayt-aynı)", r4c.lines.length === 1 && !("excludedWorks" in r4c) && !r4c.warnings.some((w) => w.includes("yeniden işlem")), JSON.stringify(Object.keys(r4c)));
  const r4mix = await resolve([rOurs, rTheirs, rPlain]);
  check("karışık sevk: yalnız bizim hatamız düşer (2 iş satırda, 1 dışlanan)", r4mix.works.length === 2 && r4mix.excludedWorks?.length === 1 && !r4mix.works.some((w) => w.rollId === rOurs));

  // Adımsız bayrak işi: işin anında topun hareketi bizim-hata İE'sinde.
  const rFlag = await mkRoll(60);
  await move(rFlag, woOurs.stepId, 60);
  await prisma.rollProperty.create({ data: { rollId: rFlag, propertyId: br.id } });
  const r4d = await resolve([rFlag]);
  check("adımsız bayrak (DECLARED) işi hareketin İE'sinden → dışlanır, satır yok",
    r4d.lines.length === 0 && r4d.excludedWorks?.some((w) => w.rollId === rFlag && w.workOrderStepId === null && w.source === "PROPERTY") === true,
    JSON.stringify(r4d.excludedWorks?.map((w) => [w.source, w.workOrderStepId])));
  const rFlag2 = await mkRoll(60);
  await move(rFlag2, woTheirs.stepId, 60);
  await prisma.rollProperty.create({ data: { rollId: rFlag2, propertyId: br.id } });
  const r4e = await resolve([rFlag2]);
  check("adımsız bayrak, müşteri talebi İE'si → satır (BRODE)", r4e.lines.some((l) => l.serviceItemId === BRODE) && !r4e.excludedWorks);
  const split = await splitReworkOurFaultWorks([
    { rollId: rTheirs, workOrderStepId: woOurs.stepId, serviceAt: new Date(), source: "TABLET" },
    { rollId: rTheirs, workOrderStepId: woTheirs.stepId, serviceAt: new Date(), source: "TABLET" },
  ]);
  // Bayrak işi top×özellik başına TEK iştir: kanıt seçimi faturasız okumayı ücretli okumaya tercih etmemeli.
  const stBr = await prisma.station.create({ data: { code: `${P}-SB`.slice(0, 32), name: `TEST HYI brode ${STAMP}`, type: "INTERNAL", kind: "OTHER" }, select: { id: true } });
  fx.stationIds.push(stBr.id);
  await prisma.stationProperty.create({ data: { stationId: stBr.id, propertyId: br.id } });
  const woBrPaid = await mkWo(null, stBr.id);
  const woBrOurs = await mkWo(rework(ours.code), stBr.id);
  const reading = (rollId: string, stepId: string, meters: string, at: Date) => prisma.rollMeterReading.create({
    data: { rollId, workOrderStepId: stepId, phase: MeterPhase.OUT, meters, source: MachineDataSource.OPERATOR, basis: MeterVarianceBasis.DECLARED_IN, approvalMode: MeterApprovalMode.NONE, clientToken: randomUUID(), createdById: actor, createdAt: at },
    select: { id: true },
  });
  const rBr = await mkRoll(66);
  await prisma.rollProperty.create({ data: { rollId: rBr, propertyId: br.id } });
  await reading(rBr, woBrPaid.stepId, "65.000", new Date(Date.now() - 120_000));
  await reading(rBr, woBrOurs.stepId, "64.000", new Date(Date.now() - 30_000));
  const r4f = await resolve([rBr]);
  const brWork = r4f.works.find((w) => w.rollId === rBr && w.serviceItemId === BRODE);
  check("bayrak: ücretli İE okuması + sonraki bizim-hata okuması → ücretli okuma faturada (65, ücretli adım), dışlanan yok",
    brWork?.workOrderStepId === woBrPaid.stepId && r4f.lines.some((l) => l.serviceItemId === BRODE && Number(l.quantity) === 65) && !r4f.excludedWorks,
    JSON.stringify({ step: brWork?.workOrderStepId === woBrPaid.stepId, lines: r4f.lines.map((l) => [l.serviceItemId === BRODE, l.quantity]), ex: r4f.excludedWorks?.length }));
  const rBr2 = await mkRoll(55);
  await prisma.rollProperty.create({ data: { rollId: rBr2, propertyId: br.id } });
  await reading(rBr2, woBrOurs.stepId, "54.000", new Date(Date.now() - 30_000));
  const r4g = await resolve([rBr2]);
  check("bayrak: yalnız bizim-hata okuması → iş dışlanır, satır yok",
    !r4g.lines.some((l) => l.serviceItemId === BRODE) && r4g.excludedWorks?.some((w) => w.rollId === rBr2 && w.workOrderStepId === woBrOurs.stepId) === true);
  check("kurşun biçimli (adımlı) iş: adımın İE'si belirler", split.excluded.length === 1 && split.excluded[0]!.workOrderStepId === woOurs.stepId && split.billable.length === 1);

  // ── §3 katalog değişimi geçmişi etkilemez ───────────────────────────────
  section("§3 sınıf sonradan değişince geçmiş hareket etkilenmez");
  await ReasonPresetService.update(ours.id, { billable: true }, actor);
  await ReasonPresetService.update(theirs.id, { billable: false }, actor);
  const after = await prisma.workOrder.findMany({ where: { id: { in: [woOurs.id, woTheirs.id] } }, select: { id: true, reworkBillable: true } });
  check("İE kolonları değişmedi (false / true)", after.find((w) => w.id === woOurs.id)?.reworkBillable === false && after.find((w) => w.id === woTheirs.id)?.reworkBillable === true, JSON.stringify(after));
  const d3a = await draft([rOurs]);
  const d3b = await draft([rTheirs]);
  check("taslaklar aynı: bizim hata hâlâ satırsız, müşteri talebi hâlâ satırlı", d3a.lines.length === 0 && d3b.lines.length === 1);
  const woNew = await mkWo(rework(ours.code));
  check("yeni İE güncel sınıfı dondurur (true)", woNew.reworkBillable === true);

  // ── §5 geri alma kapısı ─────────────────────────────────────────────────
  section("§5 faturalanmış adım işinin hareketi geri alınamaz");
  const cari = await prisma.$transaction((tx) => ensureCariAccountTx(tx, { customerId: cust.id, subcontractorId: null }));
  const inv = await prisma.invoice.create({ data: { docNo: `${P}-F`, type: "SALES", cariId: cari.id, issueDate: new Date() }, select: { id: true, docNo: true } });
  fx.invoiceIds.push(inv.id);
  const linked = await prisma.$transaction((tx) => insertServiceLinksTx(tx, inv.id, d4b.links));
  check("müşteri talebi işi faturaya bağlandı (insertServiceLinksTx, hareket canlı)", linked === 1);
  const undo = await errOf(() => prisma.$transaction((tx) => revokeRollMovements(tx, { rollIds: [rTheirs], reason: "TEST geri al" })));
  const still = await prisma.rollMovement.count({ where: { rollId: rTheirs, revokedAt: null } });
  check("revokeRollMovements → 409 SERVICE_ALREADY_BILLED, hareket yerinde (tx geri döndü)", undo.status === 409 && undo.code === "SERVICE_ALREADY_BILLED" && still === 1, JSON.stringify(undo));
  const reopen = await errOf(() => prisma.$transaction((tx) => reopenClosedMovementsTx(tx, { where: { rollId: rTheirs }, reason: "TEST yeniden aç", notes: null })));
  check("reopenClosedMovementsTx → 409 SERVICE_ALREADY_BILLED", reopen.status === 409 && reopen.code === "SERVICE_ALREADY_BILLED", JSON.stringify(reopen));
  const openOnly = await errOf(() => prisma.$transaction((tx) => revokeRollMovements(tx, { rollIds: [rTheirs], onlyOpen: true, reason: "TEST açık" })));
  check("yalnız açık hareket geri alması kapıya takılmaz", openOnly.status === 200, JSON.stringify(openOnly));
  const freeUndo = await errOf(() => prisma.$transaction((tx) => revokeRollMovements(tx, { rollIds: [rPlain], reason: "TEST faturasız" })));
  check("faturasız işin hareketi serbestçe geri alınır", freeUndo.status === 200 && (await prisma.rollMovement.count({ where: { rollId: rPlain, revokedAt: null } })) === 0, JSON.stringify(freeUndo));
  const staleLinks: typeof d4b.links = [{ ...d4b.links[0]!, rollId: rPlain, workOrderStepId: woPlain.stepId }];
  const stale = await errOf(() => prisma.$transaction((tx) => insertServiceLinksTx(tx, inv.id, staleLinks)));
  check("geri alınmış harekete bağ yazılamaz → 409 SERVICE_READING_CHANGED", stale.status === 409 && stale.code === "SERVICE_READING_CHANGED", JSON.stringify(stale));

  // Daraltma (patron kararı): kapı yalnız ADIM bağında; faturalı bayrak/kurşun bağı geri almayı bugünkü gibi bırakır.
  const KUR = await mkItem("KUR", ItemType.SERVICE, "3.0000");
  const rNonStep = await mkRoll(45);
  await move(rNonStep, woTheirs.stepId, 45);
  for (const item of [BRODE, KUR]) {
    await prisma.serviceBillingLink.create({ data: { invoiceId: inv.id, rollId: rNonStep, workOrderStepId: woTheirs.stepId, serviceItemId: item, billedMeters: 45, meterBasis: "OUT", unitPrice: 3, currency: Currency.TRY, serviceAt: new Date() } });
  }
  const nonStepUndo = await errOf(() => prisma.$transaction((tx) => revokeRollMovements(tx, { rollIds: [rNonStep], reason: "TEST bayrak/kurşun bağı" })));
  check("faturalı bayrak + kurşun bağlı topun hareketi geri alınır (kapı yalnız adım bağında)",
    nonStepUndo.status === 200 && (await prisma.rollMovement.count({ where: { rollId: rNonStep, revokedAt: null } })) === 0, JSON.stringify(nonStepUndo));

  // Yarış: fatura tarafı hareketi FOR SHARE kilitleyip bağı yazar (commit etmeden); geri alma beklemeli ve sonra 409.
  const rRace = await mkRoll(50);
  const mv = await move(rRace, woTheirs.stepId, 50);
  const holder = await pool.connect();
  let settled = false;
  try {
    await holder.query("BEGIN");
    await holder.query(`SELECT id FROM roll_movements WHERE id = $1::uuid FOR SHARE`, [mv.id]);
    await holder.query(
      `INSERT INTO service_billing_links (id, "invoiceId", "rollId", "workOrderStepId", "serviceItemId", "billedMeters", "meterBasis", "unitPrice", currency, "serviceAt", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::uuid, 50, 'DECLARED', 4, 'TRY', now(), now(), now())`, // tz-ok: test fikstürü anı
      [inv.id, rRace, woTheirs.stepId, BOYA],
    );
    const pending = errOf(() => prisma.$transaction((tx) => revokeRollMovements(tx, { rollIds: [rRace], reason: "TEST yarış" }))).finally(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 800));
    check("fatura hareketi kilitliyken geri alma BEKLER", !settled);
    await holder.query("COMMIT");
    const res = await pending;
    check("fatura commit edince geri alma 409 SERVICE_ALREADY_BILLED, hareket canlı", res.code === "SERVICE_ALREADY_BILLED" && (await prisma.rollMovement.count({ where: { rollId: rRace, revokedAt: null } })) === 1, JSON.stringify(res));
  } finally {
    if (!settled) await holder.query("ROLLBACK").catch(() => undefined);
    holder.release();
  }
  void Prisma;
}

async function cleanup(): Promise<void> {
  const del = async (ad: string, f: () => Promise<unknown>) => {
    try { await f(); } catch (e) { fail++; console.log(`❌ temizlik ${ad}: ${(e as Error).message.split("\n").filter(Boolean).slice(-2).join(" | ").slice(0, 300)}`); }
  };
  const ids = fx.rollIds;
  await del("billingLink", () => prisma.serviceBillingLink.deleteMany({ where: { invoiceId: { in: fx.invoiceIds } } }));
  await del("invoice", () => prisma.invoice.deleteMany({ where: { id: { in: fx.invoiceIds } } }));
  await del("meterReading", () => prisma.rollMeterReading.deleteMany({ where: { rollId: { in: ids } } }));
  await del("stationProperty", () => prisma.stationProperty.deleteMany({ where: { stationId: { in: fx.stationIds } } }));
  await del("rollProperty", () => prisma.rollProperty.deleteMany({ where: { rollId: { in: ids } } }));
  await del("rollMovement", () => prisma.rollMovement.deleteMany({ where: { rollId: { in: ids } } }));
  await del("roll", () => prisma.roll.deleteMany({ where: { id: { in: ids } } }));
  // `work_order_events` append-only mühürlü: doğrudan DELETE reddedilir, İE silinince kaskatla gider.
  await del("travelerCardScan", () => prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: { in: fx.woIds } } } }));
  await del("travelerCard", () => prisma.travelerCard.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("batch", () => prisma.batch.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("recordFollow", () => prisma.recordFollow.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("step", () => prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("workOrder", () => prisma.workOrder.deleteMany({ where: { id: { in: fx.woIds } } }));
  await del("station", () => prisma.station.deleteMany({ where: { id: { in: fx.stationIds } } }));
  await del("process", () => prisma.serviceItemProcess.deleteMany({ where: { OR: [{ categoryId: { in: fx.catIds } }, { serviceItemId: { in: fx.itemIds } }] } }));
  await del("category", () => prisma.subcontractorCategory.deleteMany({ where: { id: { in: fx.catIds } } }));
  await del("property", () => prisma.fabricProperty.deleteMany({ where: { id: { in: fx.propIds } } }));
  await del("itemPrice", () => prisma.itemPrice.deleteMany({ where: fiyatKonusuWhere(fx.itemIds) }));
  await del("item", () => kartlariSil(fx.itemIds));
  await del("cari", () => prisma.cariAccount.deleteMany({ where: { customerId: { in: fx.customerIds } } }));
  await del("customer", () => prisma.customer.deleteMany({ where: { id: { in: fx.customerIds } } }));
  await del("reasonPreset", () => prisma.reasonPreset.deleteMany({ where: { id: { in: fx.presetIds } } }));
  const left = await prisma.roll.count({ where: { barcode: { startsWith: P } } });
  check("temizlik: TEST-HYI top kalıntısı yok", left === 0, String(left));
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
