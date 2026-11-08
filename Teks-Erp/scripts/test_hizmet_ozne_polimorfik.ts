// =============================================================================
// BEKÇİ — HİZMET ÖZNESİ POLİMORFİK (genel fason F4: levent sarımı + dokuma işi, ayar `finance.serviceBilling.weavingWorks`)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_hizmet_ozne_polimorfik.ts
//
// NEDEN: müşteri ipliğiyle sardığımız levent ve dokuduğumuz top bugün faturaya girmez. F4 hizmet bağının öznesini
// levente açar (WARP_BEAM) ve dokuma işini doğan topa bağlar. Yanlış kurulursa: bağ iki özneyi birden taşır (CHECK),
// iptal edilen çıkışın sarımı müşteriye kesilir, aynı levent iki faturaya girer, onaylı fatura sessizce bağsız kalır
// ya da ayar kapalıyken bugünkü taslak değişir.
//
// ÖLÇÜLENLER:
//   §1 Ayar varsayılanı KAPALI (okuyucu, ayar paketi, bayrak yükü) · eski satır (subjectKind verilmeden) ROLL doğar
//   §2 DB seddi: ROLL+warpBeamId / WARP_BEAM+rollId / ikisi boş → CHECK; aynı levent×kart iki aktif bağ → unique
//   §3 Kapalı ayarda bayt-aynı: eşleme + sahibine çıkmış levent + dokuma topu VARKEN dönem önizlemesi işsiz, `serviceWorks` anahtarı yok;
//      dokuma topu seçeneksiz çözümle JSON eşit
//   §4 Dokuma işi: indirme yolu (tezgah istasyonu türü) → WEAVING/WOVEN, doğuş metresi, adımsız bağ · tezgahsız (iş seçimi) topta tek
//      eşlenmiş dokuma türü · belirsizlikte iş yok + uyarı · dokumasız top iş vermez
//   §5 Levent işi: aktif SHIP_TO_OWNER → yalnız dönem taslağında; satır "(1 levent)", qty = sarım metresi; bağ WARP_BEAM/WOUND;
//      tekrar toplanmaz · çıkışı olmayan levent iş değil · makinesiz (bizde sarılmamış) levent uyarıyla düşer ·
//      sevk taslağı kaynağı (`shipment-auto-draft`) sarım helper'ını ithal etmez
//   §6 İptal: `cancel-preview` bağı listeler · iptal damgalar (silmez, sebep CONSIGNMENT_CANCEL) · damgalı satır kalan taslak onayı 409 ·
//      onaylı faturadaki bağ → 409 CONSIGNMENT_BEAM_INVOICED (bağ yerinde) · önizlemeden sonra iptal edilen çıkış → 409 SERVICE_PREVIEW_STALE
//   §7 Kilit: levent satırı F5 claim aynasıyla (UPDATE) tutulurken dönem taslağı BEKLER · kârlılık okuyucusu levent bağını sahibiyle okur
// Negatif sondalar (2026-11-08) harita satırında.
// =============================================================================
import { randomUUID } from "node:crypto";
import { Currency, ItemType, PriceKind, Prisma, ServiceBillingSubject, ServiceMeterBasis, StationKind } from "@prisma/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import { kartAc, kartlariSil, fiyatKonusuWhere } from "./lib/kart-fikstur";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { testActorId } from "./fixture-test-user";
import { resolveServiceItemsForRolls } from "../src/services/helpers/service-pricing.helper";
import { weavingUnmappedWarning } from "../src/services/helpers/service-weaving-work.helper";
import { collectPeriodServiceBilling, collectServiceBillingDraft } from "../src/services/helpers/service-billing.helper";
import { windingUnmappedWarning } from "../src/services/helpers/service-winding-work.helper";
import { CONSIGNMENT_CANCEL_REVOKE_REASON, listWindingLinksForBeams, revokeWindingLinksForConsignmentTx } from "../src/services/helpers/service-winding-link.helper";
import { createServicePeriodDraft, previewServicePeriodDraft } from "../src/services/service-period-invoice.service";
import { invoiceService } from "../src/services/invoice.service";
import { ensureCariAccountTx } from "../src/services/helpers/finance.helper";
import { readServiceRevenueInvoices } from "../src/services/helpers/profitability-finance.helper";
import { SETTING_KEYS, loadServiceBillingSettings, readFinanceServiceBillingWeavingWorks, systemSettingService } from "../src/services/system-setting.service";
import { serviceItemService } from "../src/services/service-item.service";
import { factoryYmd } from "../src/constants/time";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); } else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}
function section(t: string): void { console.log(`\n── ${t} ──`); }
async function errOf(fn: () => Promise<unknown>): Promise<{ status: number; code: string | null; msg: string }> {
  try { await fn(); return { status: 200, code: null, msg: "" }; } catch (e) {
    const x = e as { statusCode?: number; details?: { code?: string }; message?: string; code?: string; meta?: unknown };
    return { status: x.statusCode ?? 500, code: x.details?.code ?? x.code ?? null, msg: (x.message ?? "").split("\n").slice(-2).join(" ") };
  }
}
const eq = (a: Prisma.Decimal.Value | null | undefined, b: number) => a != null && new Prisma.Decimal(a).minus(b).abs().lte(0.001);

const STAMP = randomUUID().slice(0, 8);
const P = `TEST-HOP-${STAMP}`;
const fx = {
  itemIds: [] as string[], catIds: [] as string[], stationIds: [] as string[], machineIds: [] as string[], rollIds: [] as string[],
  customerIds: [] as string[], beamIds: [] as string[], specIds: [] as string[], dispatchIds: [] as string[], woIds: [] as string[],
  runIds: [] as string[], doffIds: [] as string[], yarnIds: [] as string[],
};
const KEYS = [
  SETTING_KEYS.FINANCE_ENABLED, SETTING_KEYS.FINANCE_SERVICE_BILLING_ENABLED, SETTING_KEYS.FINANCE_SERVICE_BILLING_WEAVING_WORKS,
  SETTING_KEYS.FINANCE_SERVICE_BILLING_TRIGGER,
];
const prior = new Map<string, { existed: boolean; value: unknown }>();
const setSetting = (key: string, value: unknown) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  console.log("=== Hizmet öznesi polimorfik — levent sarımı + dokuma işi (fason F4) ===");
  for (const k of KEYS) {
    const row = await prisma.systemSetting.findUnique({ where: { key: k }, select: { value: true } });
    prior.set(k, { existed: row !== null, value: row?.value ?? null });
  }
  await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.FINANCE_SERVICE_BILLING_WEAVING_WORKS } });
  await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.FINANCE_SERVICE_BILLING_TRIGGER } });
  await setSetting(SETTING_KEYS.FINANCE_ENABLED, true);
  await setSetting(SETTING_KEYS.FINANCE_SERVICE_BILLING_ENABLED, true);
  const actor = await testActorId();

  // ── Fikstür ──────────────────────────────────────────────────────────────
  const mkItem = async (suffix: string, itemType: ItemType, price?: string) => {
    const it = await kartAc({ code: `${P}-${suffix}`.slice(0, 32), name: `TEST HOP ${suffix} ${STAMP}`, itemType, unit: itemType === ItemType.YARN ? "KG" : "MT" });
    fx.itemIds.push(it.id);
    if (price) await prisma.itemPrice.create({ data: { serviceItemId: it.id, customerId: null, kind: PriceKind.SALE, currency: Currency.TRY, price } });
    return it.id;
  };
  const fabric = await mkItem("KUM", ItemType.FABRIC);
  const yarn = await mkItem("IPL", ItemType.YARN);
  const SARIM = await mkItem("SARIM", ItemType.SERVICE, "0.5000");
  const DOKUMA = await mkItem("DOKUMA", ItemType.SERVICE, "3.0000");
  const DOKUMA2 = await mkItem("DOKUMA2", ItemType.SERVICE, "3.5000");
  const mkCat = async (suffix: string) => {
    const c = await prisma.subcontractorCategory.create({ data: { code: `${P}-${suffix}`.slice(0, 32), name: `TEST HOP ${suffix} ${STAMP}` }, select: { id: true } });
    fx.catIds.push(c.id);
    return c.id;
  };
  const catSarim = await mkCat("SARIM");
  const catDokuma = await mkCat("DOKUMA");
  const catDokuma2 = await mkCat("DOKUMA2");
  const mkStation = async (suffix: string, kind: StationKind, defaultCategoryId: string | null, extra: Partial<Prisma.StationUncheckedCreateInput> = {}) => {
    const s = await prisma.station.create({ data: { code: `${P}-${suffix}`.slice(0, 32), name: `TEST HOP ${suffix} ${STAMP}`, type: "INTERNAL", kind, defaultCategoryId, ...extra }, select: { id: true } });
    fx.stationIds.push(s.id);
    const m = await prisma.machine.create({ data: { stationId: s.id, code: `${P}-M${suffix}`.slice(0, 32), name: `TEST HOP makine ${suffix}` }, select: { id: true } });
    fx.machineIds.push(m.id);
    return { stationId: s.id, machineId: m.id };
  };
  const devere = await mkStation("DEV", StationKind.WARPING, catSarim, { producesWarpBeam: true, allowAsWorkOrderStep: false });
  const loom = await mkStation("TZG", StationKind.WEAVING, catDokuma, { allowAsWorkOrderStep: false });
  const cust = await prisma.customer.create({ data: { code: `${P}-C`.slice(0, 32), name: `TEST HOP müşteri ${STAMP}` }, select: { id: true } });
  fx.customerIds.push(cust.id);
  const cari = await prisma.$transaction((tx) => ensureCariAccountTx(tx, { customerId: cust.id, subcontractorId: null }));
  const period = factoryYmd().slice(0, 7);
  await serviceItemService.replaceProcesses(SARIM, [catSarim], actor);
  await serviceItemService.replaceProcesses(DOKUMA, [catDokuma], actor);

  // Dokuma topları: indirme yolu (tezgah) · iş seçimi yolu (tezgahsız) · dokumasız.
  const wo = await prisma.weavingOrder.create({ data: { weavingOrderNumber: `${P}-DI`, itemId: fabric, executionKind: "IN_HOUSE", status: "IN_PROGRESS" }, select: { id: true } });
  fx.woIds.push(wo.id);
  const run = await prisma.machineRun.create({ data: { machineId: loom.machineId, weavingOrderId: wo.id, startedAt: new Date(Date.now() - 3600_000) }, select: { id: true } });
  fx.runIds.push(run.id);
  const doff = await prisma.doffEvent.create({ data: { machineId: loom.machineId, machineRunId: run.id, doffedAt: new Date(), pieceCount: 1, counterSource: "OPERATOR", code: `${P}-DF`.slice(0, 32) }, select: { id: true } });
  fx.doffIds.push(doff.id);
  let seq = 0;
  const mkRoll = async (qty: number, extra: Partial<Prisma.RollUncheckedCreateInput> = {}) => {
    seq++;
    const r = await prisma.roll.create({ data: { itemId: fabric, barcode: `${P}-R${seq}`, initialQty: qty, currentQty: qty, status: "STOCK", ownerCustomerId: cust.id, ...extra }, select: { id: true } });
    fx.rollIds.push(r.id);
    return r.id;
  };
  const rDoff = await mkRoll(120, { doffEventId: doff.id });
  const rOrder = await mkRoll(80, { weavingOrderId: wo.id });
  const rPlain = await mkRoll(50);

  // Levent: bizde sarıldı (devere makinesi) → sahibine çıkış belgesi + SHIP_TO_OWNER.
  const spec = await prisma.warpSpec.create({ data: { code: `${P}-CK`.slice(0, 32), name: `${P} çözgü`, yarnItemId: yarn, endsCount: 3000 }, select: { id: true } });
  fx.specIds.push(spec.id);
  let bseq = 0;
  const mkBeam = async (lengthM: number, opts: { machineId: string | null; ship: boolean }) => {
    bseq++;
    const b = await prisma.warpBeam.create({
      data: { beamNo: `${P}-L${bseq}`.slice(0, 32), warpSpecId: spec.id, plannedLengthM: lengthM, status: "READY", ownerCustomerId: cust.id,
        ...(opts.machineId ? {} : { originKind: "SUBCONTRACT" as const, subcontractorId: await subcontractorId() }) },
      select: { id: true, beamNo: true },
    });
    fx.beamIds.push(b.id);
    await prisma.warpBeamEvent.create({ data: { beamId: b.id, kind: "WOUND", fromStatus: "PLANNED", toStatus: "READY", lengthM, machineId: opts.machineId, endsCount: 3000, denier: 150, theoreticalKg: 1, kgSource: "THEORETICAL", createdAt: new Date(Date.now() - 60_000) } });
    return { ...b, dispatch: opts.ship ? await shipToOwner(b.id, lengthM) : null };
  };
  let subId: string | null = null;
  const subcontractorId = async () => {
    if (subId) return subId;
    const { ensureTestDyeHouse } = await import("./fixture-subcontractor");
    subId = (await ensureTestDyeHouse()).id;
    return subId;
  };
  let dseq = 0;
  async function shipToOwner(beamId: string, lengthM: number): Promise<{ id: string; itemId: string; eventId: string }> {
    dseq++;
    const d = await prisma.consignmentDispatch.create({ data: { dispatchNo: `${P}-EC${dseq}`.slice(0, 64), ownerCustomerId: cust.id, items: { create: [{ kind: "WARP_BEAM", warpBeamId: beamId, lengthM }] } }, select: { id: true, items: { select: { id: true } } } });
    fx.dispatchIds.push(d.id);
    await prisma.warpBeam.update({ where: { id: beamId }, data: { status: "SHIPPED_TO_OWNER" } });
    const ev = await prisma.warpBeamEvent.create({ data: { beamId, kind: "SHIP_TO_OWNER", fromStatus: "READY", toStatus: "SHIPPED_TO_OWNER", lengthM, consignmentItemId: d.items[0]!.id }, select: { id: true } });
    return { id: d.id, itemId: d.items[0]!.id, eventId: ev.id };
  }
  /** F5 iptalinin aynası (sözleşme): belge claim → levent SHIPPED_TO_OWNER→READY claim + ters olay → F4 damgası. */
  const cancelDispatch = (beamId: string, d: { id: string; itemId: string; eventId: string }) => prisma.$transaction(async (tx) => {
    const c = await tx.consignmentDispatch.updateMany({ where: { id: d.id, cancelledAt: null }, data: { cancelledAt: new Date(), cancelledById: actor, cancelReason: "TEST" } });
    if (c.count === 0) throw new Error("claim");
    await tx.warpBeam.updateMany({ where: { id: beamId, status: "SHIPPED_TO_OWNER" }, data: { status: "READY" } });
    await tx.warpBeamEvent.create({ data: { beamId, kind: "SHIP_TO_OWNER_CANCEL", fromStatus: "SHIPPED_TO_OWNER", toStatus: "READY", reversesEventId: d.eventId, consignmentItemId: d.itemId, lengthM: 1 } });
    return revokeWindingLinksForConsignmentTx(tx, { warpBeamIds: [beamId], userId: actor });
  });
  const b1 = await mkBeam(500, { machineId: devere.machineId, ship: true });
  const bReady = await mkBeam(300, { machineId: devere.machineId, ship: false });

  // ── §1 ───────────────────────────────────────────────────────────────────
  section("§1 ayar varsayılanı KAPALI · eski satır ROLL");
  const flags = await systemSettingService.getFeatureFlags();
  check("kayıt yok → okuyucu false, ayar paketi false, bayrak yükü false",
    (await readFinanceServiceBillingWeavingWorks()) === false && (await loadServiceBillingSettings()).weavingWorks === false && flags.data?.financeServiceBillingWeavingWorks === false);
  const tmpInv = await invoiceService.createDraft({ type: "SALES", customerId: cust.id, currency: Currency.TRY, lines: [{ lineType: "TEXT", itemId: null, description: "TEST HOP sonda", qty: 1, unit: "m", unitPrice: 0 }] as never, clientToken: randomUUID() }, actor);
  const invId = tmpInv.data!.id;
  const base = { invoiceId: invId, serviceItemId: SARIM, billedMeters: 1, meterBasis: ServiceMeterBasis.WOUND, unitPrice: 1, currency: Currency.TRY, serviceAt: new Date() };
  const legacy = await prisma.serviceBillingLink.create({ data: { invoiceId: invId, rollId: rPlain, serviceItemId: DOKUMA, billedMeters: 1, meterBasis: ServiceMeterBasis.DECLARED, unitPrice: 1, currency: Currency.TRY, serviceAt: new Date() }, select: { id: true, subjectKind: true } });
  check("subjectKind verilmeyen (eski yazıcı) satır ROLL doğar", legacy.subjectKind === ServiceBillingSubject.ROLL);
  await prisma.serviceBillingLink.delete({ where: { id: legacy.id } });

  // ── §2 ───────────────────────────────────────────────────────────────────
  section("§2 DB seddi — özne CHECK + aktif bağ unique");
  const ck1 = await errOf(() => prisma.serviceBillingLink.create({ data: { ...base, subjectKind: "ROLL", rollId: null, warpBeamId: b1.id } }));
  check("ROLL öznesi + warpBeamId (rollId boş) → CHECK reddi", ck1.status === 500 && /service_billing_links_subject_ck/.test(ck1.msg), ck1.msg);
  const ck2 = await errOf(() => prisma.serviceBillingLink.create({ data: { ...base, subjectKind: "WARP_BEAM", rollId: rPlain, warpBeamId: b1.id } }));
  check("WARP_BEAM öznesi + rollId → CHECK reddi", ck2.status === 500 && /service_billing_links_subject_ck/.test(ck2.msg), ck2.msg);
  const ck3 = await errOf(() => prisma.serviceBillingLink.create({ data: { ...base, subjectKind: "WARP_BEAM", rollId: null, warpBeamId: null } }));
  check("WARP_BEAM öznesi + iki kolon boş → CHECK reddi", ck3.status === 500 && /service_billing_links_subject_ck/.test(ck3.msg), ck3.msg);
  const ok1 = await prisma.serviceBillingLink.create({ data: { ...base, subjectKind: "WARP_BEAM", warpBeamId: bReady.id }, select: { id: true } });
  const uq = await errOf(() => prisma.serviceBillingLink.create({ data: { ...base, subjectKind: "WARP_BEAM", warpBeamId: bReady.id } }));
  check("aynı levent × kart ikinci AKTİF bağ → unique reddi (P2002)", uq.code === "P2002", JSON.stringify(uq));
  await prisma.serviceBillingLink.delete({ where: { id: ok1.id } });
  await invoiceService.deleteDraft(invId, actor);

  // ── §3 ───────────────────────────────────────────────────────────────────
  section("§3 kapalı ayarda bayt-aynı");
  const pvOff = await previewServicePeriodDraft({ cariId: cari.id, period });
  check("dönem önizlemesi: levent çıkışı + dokuma topu VARKEN iş yok, `serviceWorks` anahtarı yok",
    pvOff.workCount === 0 && pvOff.lines.length === 0 && !("serviceWorks" in pvOff), JSON.stringify({ w: pvOff.workCount, l: pvOff.lines.length, k: Object.keys(pvOff) }));
  const offRes = await resolveServiceItemsForRolls({ rollIds: [rDoff, rOrder], customerId: cust.id, currency: Currency.TRY, options: { weavingWorks: false } });
  const noneRes = await resolveServiceItemsForRolls({ rollIds: [rDoff, rOrder], customerId: cust.id, currency: Currency.TRY });
  check("ayar kapalı çözüm = seçeneksiz çözüm (JSON eşit, iş yok)", JSON.stringify(offRes) === JSON.stringify(noneRes) && offRes.works.length === 0);

  // ── §4 ───────────────────────────────────────────────────────────────────
  section("§4 dokuma işi — doğan top");
  const sOn = { ...(await loadServiceBillingSettings()), weavingWorks: true };
  const dw = await collectServiceBillingDraft({ rollIds: [rDoff, rOrder, rPlain], customerId: cust.id, currency: Currency.TRY, settings: sOn, dispatchedAt: null });
  const wDoff = dw.links.find((l) => l.rollId === rDoff);
  const wOrder = dw.links.find((l) => l.rollId === rOrder);
  check("indirme yolu → bağ WOVEN, doğuş metresi 120, adımsız, kart = tezgah istasyonu türünün kartı",
    !!wDoff && wDoff.meterBasis === "WOVEN" && eq(wDoff.billedMeters, 120) && wDoff.workOrderStepId === null && wDoff.serviceItemId === DOKUMA && !wDoff.warpBeamId, JSON.stringify(wDoff));
  check("tezgahsız (iş seçimi) top → tek eşlenmiş dokuma türü (80 m)", !!wOrder && eq(wOrder.billedMeters, 80) && wOrder.serviceItemId === DOKUMA, JSON.stringify(wOrder));
  check("dokumasız top iş vermez", !dw.links.some((l) => l.rollId === rPlain));
  check("satır tek kart, 200 m × 3", dw.lines.length === 1 && eq(dw.lines[0]!.qty, 200) && eq(dw.lines[0]!.unitPrice, 3), JSON.stringify(dw.lines));
  const row = dw.works.find((w) => w.subjectId === rDoff);
  check("kırılım satırı: WEAVING · ROLL · barkod · WOVEN", !!row && row.source === "WEAVING" && row.subjectKind === "ROLL" && row.subjectCode === `${P}-R1` && row.meterBasis === "WOVEN" && row.qty === "120.000", JSON.stringify(row));
  // Belirsiz: ikinci eşlenmiş dokuma istasyonu → tezgahsız top iş vermez + uyarı (sessiz düşmez).
  const loom2 = await mkStation("TZG2", StationKind.WEAVING, catDokuma2, { allowAsWorkOrderStep: false });
  await serviceItemService.replaceProcesses(DOKUMA2, [catDokuma2], actor);
  const amb = await collectServiceBillingDraft({ rollIds: [rDoff, rOrder], customerId: cust.id, currency: Currency.TRY, settings: sOn, dispatchedAt: null });
  check("belirsiz dokuma türü → tezgahsız top düşer + uyarı; indirme yolu etkilenmez",
    !amb.links.some((l) => l.rollId === rOrder) && amb.links.some((l) => l.rollId === rDoff) && amb.warnings.includes(weavingUnmappedWarning(1)), JSON.stringify(amb.warnings));
  await serviceItemService.replaceProcesses(DOKUMA2, [], actor);
  void loom2;

  // ── §5 ───────────────────────────────────────────────────────────────────
  section("§5 levent sarım işi — yalnız dönem taslağı");
  await setSetting(SETTING_KEYS.FINANCE_SERVICE_BILLING_WEAVING_WORKS, true);
  const bForeign = await mkBeam(200, { machineId: null, ship: true });
  const pv = await previewServicePeriodDraft({ cariId: cari.id, period });
  const beamLine = pv.lines.find((l) => l.serviceItemId === SARIM);
  check("önizleme: sarım satırı '(1 levent)', 500 m × 0,5", !!beamLine && /\(1 levent\)/.test(beamLine.description) && beamLine.qty === "500.000" && eq(beamLine.unitPrice, 0.5), JSON.stringify(pv.lines));
  const wrow = pv.serviceWorks?.find((w) => w.source === "WINDING");
  check("kırılım: WINDING · WARP_BEAM · levent no · WOUND · adımsız", !!wrow && wrow.subjectKind === "WARP_BEAM" && wrow.subjectId === b1.id && wrow.subjectCode === b1.beamNo && wrow.meterBasis === "WOUND" && wrow.workOrderStepId === null, JSON.stringify(wrow));
  check("çıkışı olmayan levent iş değil", !pv.serviceWorks?.some((w) => w.subjectId === bReady.id));
  check("bizde sarılmamış (makinesiz) levent düşer + uyarı", !pv.serviceWorks?.some((w) => w.subjectId === bForeign.id) && pv.warnings.includes(windingUnmappedWarning(1)), JSON.stringify(pv.warnings));
  const autoDraftSrc = readFileSync(path.join(__dirname, "../src/services/helpers/shipment-auto-draft.helper.ts"), "utf8");
  check("sevk taslağı kaynağı sarım helper'ını ithal etmez (levent satırı sevk taslağına çıkmaz)", !/service-winding/.test(autoDraftSrc));
  const d1 = await createServicePeriodDraft({ cariId: cari.id, period, clientToken: randomUUID() }, actor);
  const d1Id = d1.data!.id;
  const link1 = await prisma.serviceBillingLink.findFirst({ where: { invoiceId: d1Id, warpBeamId: b1.id }, select: { id: true, subjectKind: true, rollId: true, meterBasis: true, billedMeters: true, workOrderStepId: true } });
  check("taslak: bağ WARP_BEAM · rollId null · WOUND · 500 m · adımsız",
    !!link1 && link1.subjectKind === "WARP_BEAM" && link1.rollId === null && link1.meterBasis === "WOUND" && eq(link1.billedMeters, 500) && link1.workOrderStepId === null, JSON.stringify(link1));
  const pv2 = await previewServicePeriodDraft({ cariId: cari.id, period });
  check("faturalı levent tekrar toplanmaz (alreadyBilled ≥1, sarım satırı yok)", !pv2.lines.some((l) => l.serviceItemId === SARIM) && pv2.alreadyBilledWorkCount >= 1, JSON.stringify({ l: pv2.lines, a: pv2.alreadyBilledWorkCount }));

  // ── §6 ───────────────────────────────────────────────────────────────────
  section("§6 çıkış iptali — damga, onay kapısı, faturalı engeli, bayat önizleme");
  const listed = await listWindingLinksForBeams(prisma, [b1.id]);
  check("cancel-preview bağı listeler (fatura no + DRAFT)", listed.length === 1 && listed[0]!.invoiceId === d1Id && listed[0]!.invoiceStatus === "DRAFT", JSON.stringify(listed));
  const revoked = await cancelDispatch(b1.id, b1.dispatch!);
  const after = await prisma.serviceBillingLink.findUnique({ where: { id: link1!.id }, select: { revokedAt: true, revokeReason: true, revokedById: true } });
  check("iptal bağı DAMGALAR (silmez), sebep CONSIGNMENT_CANCEL", revoked === 1 && !!after?.revokedAt && after.revokeReason === CONSIGNMENT_CANCEL_REVOKE_REASON && after.revokedById === actor, JSON.stringify(after));
  const conf = await errOf(() => invoiceService.confirm(d1Id, actor));
  check("damgalı sarım satırı taslakta kaldı → onay 409 SERVICE_LINES_MISMATCH", conf.status === 409 && conf.code === "SERVICE_LINES_MISMATCH", JSON.stringify(conf));
  check("onay reddi taslağı DRAFT bırakır", (await prisma.invoice.findUnique({ where: { id: d1Id }, select: { status: true } }))?.status === "DRAFT");
  const pv3 = await previewServicePeriodDraft({ cariId: cari.id, period });
  check("iptal edilen çıkışın leventi iş değil", !pv3.serviceWorks?.some((w) => w.subjectId === b1.id));
  await invoiceService.deleteDraft(d1Id, actor);
  // Onaylı faturadaki bağ: iptal 409, bağ yerinde.
  const b2 = await mkBeam(400, { machineId: devere.machineId, ship: true });
  const d2 = await createServicePeriodDraft({ cariId: cari.id, period, clientToken: randomUUID() }, actor);
  await invoiceService.confirm(d2.data!.id, actor);
  const blocked = await errOf(() => cancelDispatch(b2.id, b2.dispatch!));
  const l2 = await prisma.serviceBillingLink.findFirst({ where: { warpBeamId: b2.id }, select: { revokedAt: true } });
  const d2Disp = await prisma.consignmentDispatch.findUnique({ where: { id: b2.dispatch!.id }, select: { cancelledAt: true } });
  check("onaylı faturadaki levent → 409 CONSIGNMENT_BEAM_INVOICED; bağ aktif, belge iptal edilmedi (tx geri)",
    blocked.status === 409 && blocked.code === "CONSIGNMENT_BEAM_INVOICED" && l2?.revokedAt === null && d2Disp?.cancelledAt === null, JSON.stringify(blocked));
  await invoiceService.cancel(d2.data!.id, "TEST HOP iptal", actor);
  // Bayat önizleme: bağ girdisi toplandıktan sonra çıkış iptal edilirse fatura tx'i 409.
  const b3 = await mkBeam(250, { machineId: devere.machineId, ship: true });
  const bounds = { from: new Date(Date.now() - 86400_000), to: new Date(Date.now() + 60_000) };
  const staleDraft = await collectPeriodServiceBilling({ customerId: cust.id, currency: Currency.TRY, settings: await loadServiceBillingSettings(), ...bounds });
  const b3Links = staleDraft.links.filter((l) => l.warpBeamId === b3.id);
  await cancelDispatch(b3.id, b3.dispatch!);
  const stale = await errOf(() => invoiceService.createDraft({
    type: "SALES", customerId: cust.id, currency: Currency.TRY, clientToken: randomUUID(), serviceLinks: b3Links,
    lines: [{ lineType: "SERVICE", itemId: null, serviceItemId: SARIM, description: "Sarım", qty: 250, unit: "m", unitPrice: 0.5 }] as never,
  }, actor));
  check("önizlemeden sonra iptal edilen çıkış → 409 SERVICE_PREVIEW_STALE", b3Links.length === 1 && stale.status === 409 && stale.code === "SERVICE_PREVIEW_STALE", JSON.stringify(stale));

  // ── §7 ───────────────────────────────────────────────────────────────────
  section("§7 kilit + kârlılık");
  const b4 = await mkBeam(600, { machineId: devere.machineId, ship: true });
  const holder = await pool.connect();
  let settled = false;
  let d4Id: string | null = null;
  try {
    await holder.query("BEGIN");
    // F5 claim'inin aynası: status UPDATE = FOR NO KEY UPDATE (FK denetiminin KEY SHARE'iyle çakışmaz → yalnız açık levent kilidi bekletir).
    await holder.query(`UPDATE "warp_beams" SET status = status WHERE id = $1::uuid`, [b4.id]);
    const pending = createServicePeriodDraft({ cariId: cari.id, period, clientToken: randomUUID() }, actor).then((r) => { d4Id = r.data!.id; }).finally(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 800));
    check("levent satırı F5 claim'iyle tutulurken dönem taslağı BEKLER (levent FOR UPDATE)", !settled);
    await holder.query("COMMIT");
    await pending;
    check("kilit bırakılınca taslak doğar", settled && d4Id !== null);
  } finally {
    if (!settled) await holder.query("ROLLBACK").catch(() => undefined);
    holder.release();
  }
  const rev = await readServiceRevenueInvoices(new Date(Date.now() - 86400_000), new Date(Date.now() + 86400_000));
  const beamRow = rev.find((i) => i.id === d4Id)?.links.find((l) => l.warpBeamId === b4.id);
  check("kârlılık okuyucusu levent bağını okur (rollId null, sahip = leventin sahibi)", !!beamRow && beamRow.rollId === null && beamRow.ownerCustomerId === cust.id && eq(beamRow.billedMeters, 600), JSON.stringify(beamRow));
}

async function cleanup(): Promise<void> {
  const del = async (ad: string, f: () => Promise<unknown>) => {
    try { await f(); } catch (e) { fail++; console.log(`❌ temizlik ${ad}: ${(e as Error).message.split("\n").slice(-1)[0]}`); }
  };
  for (const [key, prev] of prior) {
    await del(`ayar ${key}`, () => prev.existed
      ? prisma.systemSetting.upsert({ where: { key }, create: { key, value: prev.value as never }, update: { value: prev.value as never } })
      : prisma.systemSetting.deleteMany({ where: { key } }));
  }
  const invIds = (await prisma.invoice.findMany({ where: { cari: { customerId: { in: fx.customerIds } } }, select: { id: true } })).map((i) => i.id);
  await del("link", () => prisma.serviceBillingLink.deleteMany({ where: { OR: [{ invoiceId: { in: invIds } }, { rollId: { in: fx.rollIds } }, { warpBeamId: { in: fx.beamIds } }] } }));
  await del("cariTx", () => prisma.cariTransaction.deleteMany({ where: { invoiceId: { in: invIds } } }));
  await del("invoiceLine", () => prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: invIds } } }));
  await del("invoice", () => prisma.invoice.deleteMany({ where: { id: { in: invIds } } }));
  const cariIds = (await prisma.cariAccount.findMany({ where: { customerId: { in: fx.customerIds } }, select: { id: true } })).map((c) => c.id);
  await del("cariBalance", () => prisma.cariBalance.deleteMany({ where: { cariId: { in: cariIds } } }));
  await del("cariTx2", () => prisma.cariTransaction.deleteMany({ where: { cariId: { in: cariIds } } }));
  await del("cari", () => prisma.cariAccount.deleteMany({ where: { id: { in: cariIds } } }));
  await del("beamEvent ters", () => prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: fx.beamIds }, reversesEventId: { not: null } } }));
  await del("beamEvent", () => prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: fx.beamIds } } }));
  await del("consignmentItem", () => prisma.consignmentDispatchItem.deleteMany({ where: { dispatchId: { in: fx.dispatchIds } } }));
  await del("consignment", () => prisma.consignmentDispatch.deleteMany({ where: { id: { in: fx.dispatchIds } } }));
  await del("beam", () => prisma.warpBeam.deleteMany({ where: { id: { in: fx.beamIds } } }));
  await del("warpSpec", () => prisma.warpSpec.deleteMany({ where: { id: { in: fx.specIds } } }));
  await del("roll", () => prisma.roll.deleteMany({ where: { id: { in: fx.rollIds } } }));
  await del("doff", () => prisma.doffEvent.deleteMany({ where: { id: { in: fx.doffIds } } }));
  await del("run", () => prisma.machineRun.deleteMany({ where: { id: { in: fx.runIds } } }));
  await del("weavingOrder", () => prisma.weavingOrder.deleteMany({ where: { id: { in: fx.woIds } } }));
  await del("machine", () => prisma.machine.deleteMany({ where: { id: { in: fx.machineIds } } }));
  await del("station", () => prisma.station.deleteMany({ where: { id: { in: fx.stationIds } } }));
  await del("process", () => prisma.serviceItemProcess.deleteMany({ where: { OR: [{ categoryId: { in: fx.catIds } }, { serviceItemId: { in: fx.itemIds } }] } }));
  await del("category", () => prisma.subcontractorCategory.deleteMany({ where: { id: { in: fx.catIds } } }));
  await del("itemPrice", () => prisma.itemPrice.deleteMany({ where: fiyatKonusuWhere(fx.itemIds) }));
  await del("item", () => kartlariSil(fx.itemIds));
  await del("customer", () => prisma.customer.deleteMany({ where: { id: { in: fx.customerIds } } }));
  const left = await prisma.roll.count({ where: { barcode: { startsWith: P } } }) + await prisma.warpBeam.count({ where: { beamNo: { startsWith: P } } });
  check("temizlik: TEST-HOP top/levent kalıntısı yok", left === 0, String(left));
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
