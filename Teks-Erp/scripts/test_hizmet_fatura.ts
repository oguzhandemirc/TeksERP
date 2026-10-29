// =============================================================================
// BEKÇİ — HİZMET FATURA TASLAĞI (Gülkesim dalga 2 · H7, karar belgesi §5, §8 H7, §12-7)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_hizmet_fatura.ts
//
// NEDEN: hizmet veren fabrika müşterinin kendi (emanet) kumaşına yaptığı işi
// metreyle keser. Aynı iş iki faturaya girerse müşteriye çift kesilir; fatura
// iptal edilip iş yeniden faturalanamazsa para kaybolur; faturalı işin metresi
// sonradan düzeltilirse fatura dayanaksız kalır.
//
// ÖLÇÜLENLER:
//   §1 Ayarlar: PERIOD_END seçilebilir (H8) · tanınmayan değer 400 · varsayılanlar = bugün
//   §2 10 emanet top ⇒ 1 taslak, 10 bağ, Σ billedMeters = Σ aktif OUT ±0,001; emanet ürün satırı yok; not brütü söyler
//   §3 Düzeltilmiş okuma: serviceAt = adımın İLK OUT anı (düzeltme kaydırmaz)
//   §4 Replay (kanca ikinci kez) ⇒ 1 taslak, 10 bağ
//   §5 Faturalı okuma düzeltmesi / gramaj düzeltmesi / adım reopen damgası 409 SERVICE_ALREADY_BILLED
//   §6 Sevk geri alma: aktif bağda 409 + önizleme taslağı listeler
//   §7 DRAFT sil ⇒ bağ 0 (Cascade); yeniden ⇒ tutar aynı
//   §8 DRAFT iptal ⇒ damga; yeniden faturalanır · CONFIRMED iptal ⇒ damga; yeniden faturalanır
//   §9 NULL adımlı çift bağ ⇒ kısmi unique seddi (P2002) · insertServiceLinksTx 409
//   §10 SIMULATED okuma: BLOCK_LINE ⇒ 0 bağ + uyarı; okuma SIMULATED ise bağ readingId'si ona işaret etmez
//   §11 Kapalıyken: emanet ürün satırı + bugünkü uyarı, 0 bağ; not TAM eşit, toplayıcı anahtarları
//       H7 öncesiyle aynı (kanca bayt-aynı). Sevk kancasının KAPALI PARİTE ailesi test_auto_draft_shipment
//       §1/§4'tedir; hizmet bayrağının paritesi kurşun fixture'ı istediği için burada ölçülür (atıf orada).
//   §13 H8 PERIOD_END: sevk kancası + panel sevk önizlemesi hizmet satırı/bağı 0 (neden uyarısıyla)
//   §14 2 sevk ⇒ 1 dönem taslağı (shipmentId yok) · §15 token replay ⇒ aynı taslak
//   §16 aynı iş iki yoldan 409 · faturalı iş dönemden düşer · PER_SHIPMENT bugünkü gibi
//   §17 2 paralel ⇒ 1 kazanan · §18 kapanmış dönem 409, bozuk/ileri dönem 400
//   §19 dönem taslağına bağlı sevk geri alma 409 · taslak iptali ⇒ geri alma 200
//   §20 H8b müşteri tetiği: fabrika PER_SHIPMENT + müşteri PERIOD_END ⇒ sevkte bağ yok, dönem toplar · fabrika
//       PERIOD_END + müşteri PER_SHIPMENT ⇒ sevkte bağ var, dönem açık + uyarı, yalnız faturasız kalan işi toplar · NULL ⇒
//       fabrika ayarı · geçersiz 400 · fason cari 400 NOT_CUSTOMER · audit
//   §22 F1 önizleme/oluşturma yarışı: tetik (müşteri · fabrika) değişti ya da iş başka faturaya bağlandı ⇒ 409
//       SERVICE_PREVIEW_STALE + sıfır yazım · normal yol bağları önizlemeyle bayt-aynı · eşzamanlı iki oluşturma ⇒ 1 + 409 ·
//       düzenlemede bağsız emanet hizmet satırı ⇒ 409 SERVICE_LINE_UNLINKED
//   §21 H8b DISPATCH_DAY dönem taslağı: her iş KENDİ sevk anının fiyatıyla (son sevk günü herkese uygulanmaz); ata
//       işi en erken sevk edilen çocuğun anına (yayılım döngüsü kapatılınca 40 m @7 ⇒ kırmızı, 68/1; geri alındı)
// Negatif sondalar (2026-10-29, BEKCI-HARITASI sonda sütunu): kısmi unique düşürülünce §9a kırmızı ·
// iptal damgası kaldırılınca §8 kırmızı · düzeltme 409 kapısı kaldırılınca §5 kırmızı · kapalı yola
// shipmentGross sızdırılınca §11/§11b/§11c kırmızı (27/3; geri alındı).
// =============================================================================
import { randomUUID } from "node:crypto";
import { Currency, InvoiceStatus, ItemType, MachineDataSource, MeterApprovalMode, MeterPhase, MeterVarianceBasis, PriceKind, Prisma, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { shippingService } from "../src/services/shipping.service";
import { invoiceService } from "../src/services/invoice.service";
import { InventoryService } from "../src/services/inventory.service";
import { ensureDefaultWarehouse } from "../src/jobs/default-warehouse.job";
import { SETTING_KEYS, loadServiceBillingSettings, systemSettingService } from "../src/services/system-setting.service";
import { PERIOD_END_SERVICE_WARNING, autoDraftInvoiceAfterDispatch, collectShipmentInvoiceDraftLines } from "../src/services/helpers/shipment-auto-draft.helper";
import { CUSTOMER_PER_SHIPMENT_PERIOD_WARNING, createServicePeriodDraft, previewServicePeriodDraft } from "../src/services/service-period-invoice.service";
import { ensureCariAccountTx } from "../src/services/helpers/finance.helper";
import { periodDayKey } from "../src/services/helpers/period-guard.helper";
import { bypassReplayQueue } from "../src/services/helpers/token-replay.helper";
import { factoryYmd } from "../src/constants/time";
import { applyKursunOperationTx } from "../src/services/helpers/kursun-operation.helper";
import { writeMeterReadingTx, revokeStepMeterReadingsTx } from "../src/services/helpers/kursun-meter.helper";
import { insertServiceLinksTx } from "../src/services/helpers/service-billing.helper";
import { KURSUN_PROPERTY_CODE } from "../src/services/helpers/quality-station.helper";
import { testActorId } from "./fixture-test-user";
import { cariService } from "../src/services/cari.service";
import { TamburService } from "../src/services/tambur.service";
import { resolveCustomerServiceBillingTrigger } from "../src/services/helpers/service-billing.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); } else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}
function section(t: string): void { console.log(`\n── ${t} ──`); }
async function errOf(fn: () => Promise<unknown>): Promise<{ status: number; code: string | null; prisma: string | null }> {
  try { await fn(); return { status: 200, code: null, prisma: null }; } catch (e) {
    const x = e as { statusCode?: number; details?: { code?: string }; code?: string };
    return { status: x.statusCode ?? 500, code: x.details?.code ?? null, prisma: typeof x.code === "string" ? x.code : null };
  }
}

const STAMP = randomUUID().slice(0, 8);
const P = `TEST-HZFT-${STAMP}`;
const inventory = new InventoryService();
const fx = {
  itemIds: [] as string[], propIds: [] as string[], valueIds: [] as string[], woIds: [] as string[], rollIds: [] as string[],
  stationIds: [] as string[], machineIds: [] as string[], shipmentIds: [] as string[], customerId: null as string | null, kursunCreated: null as string | null,
  customer2Id: null as string | null, extraCustomerIds: [] as string[], subcontractorIds: [] as string[],
};
const KEYS = [
  SETTING_KEYS.FINANCE_ENABLED, SETTING_KEYS.FINANCE_AUTO_DRAFT_FROM_SHIPMENT_ENABLED, SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED,
  SETTING_KEYS.FINANCE_SERVICE_BILLING_ENABLED, SETTING_KEYS.FINANCE_SERVICE_BILLING_METER_BASIS, SETTING_KEYS.FINANCE_SERVICE_BILLING_MISSING_METER,
  SETTING_KEYS.FINANCE_SERVICE_BILLING_TRIGGER, SETTING_KEYS.FINANCE_SERVICE_BILLING_PRICE_DATE,
];
const prior = new Map<string, { existed: boolean; value: unknown }>();
async function setSetting(key: string, value: unknown): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
}

async function main(): Promise<void> {
  console.log("=== Hizmet fatura taslağı — bağ · replay · ters yol · düzeltme kapısı (H7) ===");
  for (const k of KEYS) {
    const row = await prisma.systemSetting.findUnique({ where: { key: k }, select: { value: true } });
    prior.set(k, { existed: row !== null, value: row?.value ?? null });
  }
  const actor = await testActorId();
  const wh = await ensureDefaultWarehouse();
  if (!wh) throw new Error("Varsayılan depo yok");

  // ── §1 Ayarlar ───────────────────────────────────────────────────────────
  section("§1 ayarlar: varsayılan = bugün, tanınmayan 400");
  for (const k of KEYS.slice(3)) await prisma.systemSetting.deleteMany({ where: { key: k } });
  const ff = await loadServiceBillingSettings();
  check("varsayılanlar: kapalı · OUT · DECLARED_WITH_WARNING · PER_SHIPMENT · SERVICE_DAY",
    ff.enabled === false && ff.meterBasis === "OUT" && ff.missingMeter === "DECLARED_WITH_WARNING"
    && ff.trigger === "PER_SHIPMENT" && ff.priceDate === "SERVICE_DAY", JSON.stringify(ff));
  const pe = await errOf(() => systemSettingService.setFeatureFlags({ financeServiceBillingTrigger: "PERIOD_END" } as never, actor));
  check("PERIOD_END seçilebilir (H8 dönem sonu ucu var)", pe.status === 200 && (await loadServiceBillingSettings()).trigger === "PERIOD_END", JSON.stringify(pe));
  await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.FINANCE_SERVICE_BILLING_TRIGGER } });
  const junk = await errOf(() => systemSettingService.setFeatureFlags({ financeServiceBillingMeterBasis: "WEIGHT" } as never, actor));
  check("tanınmayan metre tabanı 400", junk.status === 400, JSON.stringify(junk));

  await setSetting(SETTING_KEYS.FINANCE_ENABLED, true);
  await setSetting(SETTING_KEYS.FINANCE_AUTO_DRAFT_FROM_SHIPMENT_ENABLED, true);
  await setSetting(SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED, false);
  await setSetting(SETTING_KEYS.FINANCE_SERVICE_BILLING_ENABLED, true);

  // ── Fikstür: gramaj çeşidi → SERVICE kalemi; kurşun adımı ─────────────────
  let kursun = await prisma.fabricProperty.findUnique({ where: { code: KURSUN_PROPERTY_CODE }, select: { id: true } });
  if (!kursun) {
    kursun = await prisma.fabricProperty.create({ data: { code: KURSUN_PROPERTY_CODE, name: `TEST Kurşunlu ${STAMP}`, valueType: "FLAG" }, select: { id: true } });
    fx.kursunCreated = kursun.id;
  }
  const variant = await prisma.fabricProperty.create({
    data: { code: `${P}-GR`.slice(0, 32), name: `TEST HZFT gramaj ${STAMP}`, valueType: "CHOICE", variantOfPropertyId: kursun.id },
    select: { id: true },
  });
  fx.propIds.push(variant.id);
  const mkItem = async (suffix: string, itemType: ItemType) => {
    const it = await prisma.item.create({ data: { code: `${P}-${suffix}`.slice(0, 32), name: `TEST HZFT ${suffix} ${STAMP}`, itemType, unit: "MT" }, select: { id: true } });
    fx.itemIds.push(it.id);
    return it.id;
  };
  const fabric = await mkItem("KUM", ItemType.FABRIC);
  const K2 = await mkItem("K2", ItemType.SERVICE);
  const K3 = await mkItem("K3", ItemType.SERVICE);
  const mkVal = async (n: string, sort: number, serviceItemId: string) => {
    const v = await prisma.fabricPropertyValue.create({ data: { propertyId: variant.id, code: `HT${n}-${STAMP}`.slice(0, 32).toUpperCase(), name: `${n} gr`, sortOrder: sort, serviceItemId }, select: { id: true } });
    fx.valueIds.push(v.id);
    return v.id;
  };
  const V2 = await mkVal("45", 20, K2);
  const V3 = await mkVal("90", 30, K3);
  await prisma.itemPrice.create({ data: { itemId: K2, customerId: null, kind: PriceKind.SALE, currency: Currency.TRY, price: "8.0000" } });
  await prisma.itemPrice.create({ data: { itemId: K3, customerId: null, kind: PriceKind.SALE, currency: Currency.TRY, price: "11.0000" } });
  const cust = await prisma.customer.create({ data: { code: `${P}-C`.slice(0, 32), name: `TEST HZFT müşteri ${STAMP}` }, select: { id: true } });
  fx.customerId = cust.id;
  const st = await prisma.station.create({ data: { code: `${P}-K`.slice(0, 32), name: `TEST HZFT kurşun ${STAMP}`, type: "INTERNAL", kind: "PROCESS_QC", appliesProperty: true }, select: { id: true } });
  fx.stationIds.push(st.id);
  const m = await prisma.machine.create({ data: { stationId: st.id, code: `${P}-M`.slice(0, 32), name: `TEST HZFT makine ${STAMP}` }, select: { id: true } });
  fx.machineIds.push(m.id);
  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `${P}-WO`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", targetItemId: fabric, steps: { create: [{ stationId: st.id, stepSequence: 1, status: "ACTIVE" as const }] } },
    select: { id: true, steps: { select: { id: true } } },
  });
  fx.woIds.push(wo.id);
  const S1 = wo.steps[0]!.id;

  const reading = (rollId: string, meters: string, source: MachineDataSource = MachineDataSource.OPERATOR) => prisma.rollMeterReading.create({
    data: { rollId, workOrderStepId: S1, phase: MeterPhase.OUT, meters, source, basis: MeterVarianceBasis.DECLARED_IN, approvalMode: MeterApprovalMode.NONE, clientToken: randomUUID(), createdById: actor },
    select: { id: true, createdAt: true, meters: true },
  });
  /** Emanet top: depoda doğar, kurşun işi (K2) + hareket metresi + (istenirse) OUT okuması. */
  const mkWorkedRoll = async (qty: number, outMeters: string | null, source?: MachineDataSource, owner: string = cust.id): Promise<string> => {
    const res = await inventory.createInitialEntry({ itemId: fabric, initialQty: qty }, undefined, undefined, false, { forcedStatus: RollStatus.WAREHOUSE, warehouseId: wh.id });
    const id = (res.data as { id: string }).id;
    fx.rollIds.push(id);
    await prisma.roll.update({ where: { id }, data: { ownerCustomerId: owner } });
    await prisma.rollMovement.create({ data: { rollId: id, workOrderStepId: S1, qtyIn: qty, qtyOut: qty, exitedAt: new Date() } });
    await prisma.$transaction((tx) => applyKursunOperationTx(tx, { rollId: id, stepId: S1, valueId: V2, userId: actor, machineId: m.id }));
    if (outMeters !== null) await reading(id, outMeters, source);
    return id;
  };
  const ship = async (rollIds: string[], customerId: string = cust.id) => {
    const res = (await shippingService.createShipmentFromRolls({ rollIds, customerId, clientToken: randomUUID() })) as { data: { id: string; dispatched: boolean } };
    fx.shipmentIds.push(res.data.id);
    return res.data;
  };
  const invoicesOf = (shipmentId: string) => prisma.invoice.findMany({ where: { shipmentId }, select: { id: true, docNo: true, status: true, grandTotal: true, notes: true, lines: { select: { itemId: true, qty: true, unitPrice: true } } }, orderBy: { createdAt: "asc" } });
  const activeLinks = (invoiceId: string) => prisma.serviceBillingLink.findMany({ where: { invoiceId, revokedAt: null }, select: { id: true, rollId: true, billedMeters: true, readingId: true, serviceAt: true, meterBasis: true, workOrderStepId: true, serviceItemId: true } });

  // ── §2/§3 10 top ─────────────────────────────────────────────────────────
  section("§2 10 emanet top ⇒ 1 taslak, 10 bağ, Σ = Σ aktif OUT");
  const rolls: string[] = [];
  for (let i = 0; i < 10; i++) rolls.push(await mkWorkedRoll(100 + i, (98 + i * 1.125).toFixed(3)));
  // Düzeltme: ilk okuma t1, sonra damga + yeni okuma — hizmet anı t1 kalmalı.
  const r0 = rolls[0]!;
  const first = await prisma.rollMeterReading.findFirstOrThrow({ where: { rollId: r0, revokedAt: null }, select: { id: true, createdAt: true } });
  await new Promise((r) => setTimeout(r, 30));
  await prisma.$transaction((tx) => writeMeterReadingTx(tx, {
    rollId: r0, stepId: S1, phase: MeterPhase.OUT, userId: actor, machineId: null, reason: "KURSUN_METER_CORRECTION",
    input: { meters: 97.5, source: MachineDataSource.OPERATOR, clientToken: randomUUID() },
  }));
  const t0 = Date.now();
  const shA = await ship(rolls);
  const draftMs = Date.now() - t0;
  console.log(`   ℹ️ 10 toplu sevk + taslak süresi: ${draftMs} ms (as-of fiyat sorgusu hizmet anı başına)`);
  let invA = await invoicesOf(shA.id);
  check("sevk DISPATCHED + tek taslak", shA.dispatched && invA.length === 1, `${invA.length} fatura`);
  const inv1 = invA[0]!;
  const links1 = await activeLinks(inv1.id);
  const activeOut = await prisma.rollMeterReading.aggregate({ where: { rollId: { in: rolls }, workOrderStepId: S1, phase: MeterPhase.OUT, revokedAt: null }, _sum: { meters: true } });
  const sumLinks = links1.reduce((a, l) => a.plus(l.billedMeters), new Prisma.Decimal(0));
  check("10 bağ", links1.length === 10, String(links1.length));
  check("Σ billedMeters = Σ aktif OUT ±0,001", sumLinks.minus(activeOut._sum.meters ?? 0).abs().lte(0.001), `${sumLinks.toFixed(3)} vs ${activeOut._sum.meters?.toString()}`);
  check("emanet ürün satırı yok; tek hizmet satırı (K2 × 8)", inv1.lines.length === 1 && inv1.lines[0]!.itemId === K2 && Number(inv1.lines[0]!.unitPrice) === 8 && new Prisma.Decimal(inv1.lines[0]!.qty).minus(sumLinks).abs().lte(0.001), JSON.stringify(inv1.lines));
  check("taslak notu sevk brütünü söyler", (inv1.notes ?? "").includes("Sevk brütü: 10 top"), inv1.notes ?? "");
  section("§3 düzeltme hizmet anını kaydırmaz");
  const l0 = links1.find((l) => l.rollId === r0);
  check("serviceAt = ilk OUT anı", l0?.serviceAt.getTime() === first.createdAt.getTime(), `${l0?.serviceAt.toISOString()} vs ${first.createdAt.toISOString()}`);
  check("billedMeters = düzeltilmiş (aktif) okuma 97.5", Number(l0?.billedMeters) === 97.5);

  // ── §4 Replay ────────────────────────────────────────────────────────────
  section("§4 aynı sevk taslağı replay ⇒ 1 taslak");
  await autoDraftInvoiceAfterDispatch(shA.id, actor);
  await autoDraftInvoiceAfterDispatch(shA.id, actor);
  invA = await invoicesOf(shA.id);
  const allLinks = await prisma.serviceBillingLink.count({ where: { rollId: { in: rolls }, revokedAt: null } });
  check("replay ×2 ⇒ 1 aktif taslak, 10 aktif bağ", invA.filter((i) => i.status !== InvoiceStatus.CANCELLED).length === 1 && allLinks === 10, `${invA.length} fatura, ${allLinks} bağ`);

  // ── §5 Düzeltme kapıları ─────────────────────────────────────────────────
  section("§5 faturalı işin düzeltmesi 409 SERVICE_ALREADY_BILLED");
  const r1 = rolls[1]!;
  const before = await prisma.rollMeterReading.count({ where: { rollId: r1 } });
  const corr = await errOf(() => prisma.$transaction((tx) => writeMeterReadingTx(tx, {
    rollId: r1, stepId: S1, phase: MeterPhase.OUT, userId: actor, machineId: null, reason: "KURSUN_METER_CORRECTION",
    input: { meters: 50, source: MachineDataSource.OPERATOR, clientToken: randomUUID() },
  })));
  check("okuma düzeltmesi 409 SERVICE_ALREADY_BILLED + 0 yeni satır", corr.status === 409 && corr.code === "SERVICE_ALREADY_BILLED" && (await prisma.rollMeterReading.count({ where: { rollId: r1 } })) === before, JSON.stringify(corr));
  const gram = await errOf(() => prisma.$transaction((tx) => applyKursunOperationTx(tx, { rollId: r1, stepId: S1, valueId: V3, userId: actor, machineId: m.id })));
  check("gramaj düzeltmesi 409 SERVICE_ALREADY_BILLED", gram.status === 409 && gram.code === "SERVICE_ALREADY_BILLED", JSON.stringify(gram));
  const reopen = await errOf(() => prisma.$transaction((tx) => revokeStepMeterReadingsTx(tx, { rollIds: [r1], stepId: S1, userId: actor, reason: "KURSUN_REOPEN" })));
  check("reopen damgası 409 SERVICE_ALREADY_BILLED", reopen.status === 409 && reopen.code === "SERVICE_ALREADY_BILLED", JSON.stringify(reopen));

  // ── §6 Sevk geri alma ────────────────────────────────────────────────────
  section("§6 sevk geri alma aktif bağda 409");
  const undo = await errOf(() => shippingService.undoDispatch(shA.id, "test geri alma", actor));
  check("undoDispatch 409 SERVICE_ALREADY_BILLED", undo.status === 409 && undo.code === "SERVICE_ALREADY_BILLED", JSON.stringify(undo));
  const pv = (await shippingService.getUndoDispatchPreview(shA.id)).data as { canUndo: boolean; serviceBilledInvoices: string[] };
  check("önizleme taslağı listeler", !pv.canUndo && pv.serviceBilledInvoices.includes(inv1.docNo), JSON.stringify(pv.serviceBilledInvoices));

  // ── §7 DRAFT sil + yeniden ───────────────────────────────────────────────
  section("§7 DRAFT sil ⇒ Cascade; yeniden ⇒ tutar aynı");
  await invoiceService.deleteDraft(inv1.id, actor);
  check("silinen taslağın bağı 0 (Cascade)", (await prisma.serviceBillingLink.count({ where: { invoiceId: inv1.id } })) === 0);
  await autoDraftInvoiceAfterDispatch(shA.id, actor);
  const inv2 = (await invoicesOf(shA.id)).find((i) => i.status === InvoiceStatus.DRAFT);
  check("yeniden taslak: tutar aynı, 10 bağ", !!inv2 && new Prisma.Decimal(inv2.grandTotal).equals(inv1.grandTotal) && (await activeLinks(inv2.id)).length === 10, `${inv2?.grandTotal.toString()} vs ${inv1.grandTotal.toString()}`);

  // ── §8 İptal ters yolu ───────────────────────────────────────────────────
  section("§8 DRAFT ve CONFIRMED iptali ⇒ damga + yeniden faturalanır");
  await invoiceService.cancel(inv2!.id, "test iptal", actor);
  const stamped2 = await prisma.serviceBillingLink.count({ where: { invoiceId: inv2!.id, revokedAt: { not: null }, revokeReason: "INVOICE_CANCEL" } });
  check("DRAFT iptali: 10 bağ damgalı (silinmez)", stamped2 === 10, String(stamped2));
  await autoDraftInvoiceAfterDispatch(shA.id, actor);
  const inv3 = (await invoicesOf(shA.id)).find((i) => i.status === InvoiceStatus.DRAFT);
  check("DRAFT iptali sonrası yeniden faturalandı (10 aktif bağ)", !!inv3 && (await activeLinks(inv3.id)).length === 10);
  if (inv3) {
    await invoiceService.confirm(inv3.id, actor);
    await invoiceService.cancel(inv3.id, "test storno", actor);
    const stamped3 = await prisma.serviceBillingLink.count({ where: { invoiceId: inv3.id, revokedAt: { not: null } } });
    check("CONFIRMED iptali: 10 bağ damgalı", stamped3 === 10, String(stamped3));
    await autoDraftInvoiceAfterDispatch(shA.id, actor);
    const inv4 = (await invoicesOf(shA.id)).find((i) => i.status === InvoiceStatus.DRAFT);
    check("CONFIRMED iptali sonrası yeniden faturalandı", !!inv4 && (await activeLinks(inv4.id)).length === 10);
  }

  // ── §9 NULL adımlı çift bağ ──────────────────────────────────────────────
  section("§9 NULL adımlı çift bağ seddi");
  const live = (await invoicesOf(shA.id)).find((i) => i.status === InvoiceStatus.DRAFT)!;
  const extra = rolls[2]!;
  const nullLink = { rollId: extra, workOrderStepId: null, serviceItemId: K3, readingId: null, billedMeters: new Prisma.Decimal(5), meterBasis: "DECLARED" as const, unitPrice: new Prisma.Decimal(1), currency: Currency.TRY, serviceAt: new Date() };
  await prisma.serviceBillingLink.create({ data: { ...nullLink, invoiceId: live.id } });
  const dup = await errOf(() => prisma.serviceBillingLink.create({ data: { ...nullLink, invoiceId: live.id } }));
  check("§9a ikinci NULL adımlı aktif bağ DB seddine çarpar (P2002)", dup.prisma === "P2002", JSON.stringify(dup));
  const viaHelper = await errOf(() => prisma.$transaction((tx) => insertServiceLinksTx(tx, live.id, [nullLink])));
  check("§9b insertServiceLinksTx 409 SERVICE_ALREADY_BILLED", viaHelper.status === 409 && viaHelper.code === "SERVICE_ALREADY_BILLED", JSON.stringify(viaHelper));
  // Sonda bağı SİLİNMEZ, damgalanır (defter ters yolu; fiziksel silme yalnız cleanup'ta).
  await prisma.serviceBillingLink.updateMany({
    where: { invoiceId: live.id, workOrderStepId: null, revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: "test §9 sonda bağı" },
  });

  // ── §10 SIMULATED ────────────────────────────────────────────────────────
  section("§10 SIMULATED okuma faturaya girmez");
  await setSetting(SETTING_KEYS.FINANCE_SERVICE_BILLING_MISSING_METER, "BLOCK_LINE");
  const sim = await mkWorkedRoll(70, "1.234", MachineDataSource.SIMULATED);
  const shC = await ship([sim]);
  const invC = await invoicesOf(shC.id);
  const linksC = await prisma.serviceBillingLink.count({ where: { rollId: sim } });
  check("BLOCK_LINE: SIMULATED-only top ⇒ 0 bağ, taslak yok ya da hizmetsiz", linksC === 0 && invC.every((i) => i.lines.every((l) => l.itemId !== K2)), `${linksC} bağ, ${invC.length} fatura`);
  await setSetting(SETTING_KEYS.FINANCE_SERVICE_BILLING_MISSING_METER, "DECLARED_WITH_WARNING");
  const sim2 = await mkWorkedRoll(60, "2.5", MachineDataSource.SIMULATED);
  const shC2 = await ship([sim2]);
  const invC2 = await invoicesOf(shC2.id);
  const l2 = await prisma.serviceBillingLink.findMany({ where: { rollId: sim2 }, select: { readingId: true, meterBasis: true, billedMeters: true } });
  check("DECLARED_WITH_WARNING: bağ beyan metresiyle (60), SIMULATED okumaya işaret etmez + uyarı",
    l2.length === 1 && l2[0]!.readingId === null && l2[0]!.meterBasis === "DECLARED" && Number(l2[0]!.billedMeters) === 60 && (invC2[0]?.notes ?? "").includes("sayaç okuması yok"), JSON.stringify(l2));

  // ── §12 Panel yolu: bağ ↔ satır tutarlılığı + sevk geri alma serileşmesi ─
  section("§12 panel taslağı: bağ yalnız faturada satırı olan işe");
  const pr = [await mkWorkedRoll(50, "49.5"), await mkWorkedRoll(51, "50.25")];
  const shP = await ship(pr);
  const hookDraft = (await invoicesOf(shP.id)).find((i) => i.status === InvoiceStatus.DRAFT)!;
  const svcQty = new Prisma.Decimal(hookDraft.lines.find((l) => l.itemId === K2)!.qty);
  await invoiceService.deleteDraft(hookDraft.id, actor);
  const panelInput = (lines: Array<{ itemId: string | null; qty: Prisma.Decimal.Value }>) => ({
    type: "SALES" as const, customerId: cust.id, shipmentId: shP.id, currency: Currency.TRY, clientToken: randomUUID(),
    lines: lines.map((l) => ({ itemId: l.itemId, description: l.itemId ? "Kurşun hizmeti" : "Elle satır", qty: l.qty, unit: "m", unitPrice: 8 })),
  });
  const noSvc = await invoiceService.createDraft(panelInput([{ itemId: null, qty: 1 }]), actor);
  check("§12a hizmet satırı silinmiş panel taslağı ⇒ 0 bağ (iş faturasız kalır)", (await prisma.serviceBillingLink.count({ where: { invoiceId: noSvc.data!.id } })) === 0);
  await invoiceService.deleteDraft(noSvc.data!.id, actor);
  const mism = await errOf(() => invoiceService.createDraft(panelInput([{ itemId: K2, qty: svcQty.plus(5) }]), actor));
  check("§12b miktarı değiştirilmiş hizmet satırı ⇒ 409 SERVICE_LINES_MISMATCH", mism.status === 409 && mism.code === "SERVICE_LINES_MISMATCH", JSON.stringify(mism));
  const okP = await invoiceService.createDraft(panelInput([{ itemId: K2, qty: svcQty }]), actor);
  const pid = okP.data!.id;
  check("§12c önizlemedeki miktarla ⇒ 2 bağ", (await activeLinks(pid)).length === 2);
  const upMism = await errOf(() => invoiceService.updateDraft(pid, { lines: [{ itemId: K2, description: "x", qty: svcQty.minus(1), unit: "m", unitPrice: 8 }] }, actor));
  check("§12d düzenlemede miktar değişimi ⇒ 409, bağlar yerinde", upMism.status === 409 && upMism.code === "SERVICE_LINES_MISMATCH" && (await activeLinks(pid)).length === 2, JSON.stringify(upMism));
  await invoiceService.updateDraft(pid, { lines: [{ itemId: null, description: "Elle satır", qty: 1, unit: "m", unitPrice: 8 }] }, actor);
  const revokedP = await prisma.serviceBillingLink.count({ where: { invoiceId: pid, revokedAt: { not: null }, revokeReason: "Hizmet satırı taslaktan çıkarıldı" } });
  check("§12e düzenlemede hizmet satırı çıkarıldı ⇒ 2 bağ damgalı, 0 aktif", revokedP === 2 && (await activeLinks(pid)).length === 0, String(revokedP));
  await invoiceService.deleteDraft(pid, actor);
  section("§12f sevk geri alındıktan sonra bağlı taslak 409 (kilit + taze durum)");
  const undoP = await errOf(() => shippingService.undoDispatch(shP.id, "test geri alma", actor));
  check("bağsız sevk geri alınır", undoP.status === 200, JSON.stringify(undoP));
  const fakeLinks = pr.map((rollId) => ({ rollId, workOrderStepId: S1, serviceItemId: K2, readingId: null, billedMeters: new Prisma.Decimal(10), meterBasis: "DECLARED" as const, unitPrice: new Prisma.Decimal(8), currency: Currency.TRY, serviceAt: new Date() }));
  const afterUndo = await errOf(() => invoiceService.createDraft({ ...panelInput([{ itemId: K2, qty: 20 }]), serviceLinks: fakeLinks }, actor));
  check("geri alınmış sevke bağlı taslak ⇒ 409 SHIPMENT_NOT_DISPATCHED, 0 bağ", afterUndo.status === 409 && afterUndo.code === "SHIPMENT_NOT_DISPATCHED" && (await prisma.serviceBillingLink.count({ where: { rollId: { in: pr }, revokedAt: null } })) === 0, JSON.stringify(afterUndo));


  // ── §13–§18 H8 dönem sonu ────────────────────────────────────────────────
  section("§13 PERIOD_END: sevk kancası hizmet satırı/bağı 0");
  const cust2 = await prisma.customer.create({ data: { code: `${P}-D`.slice(0, 32), name: `TEST HZFT dönem ${STAMP}` }, select: { id: true } });
  fx.customer2Id = cust2.id;
  const cari2 = await prisma.$transaction((tx) => ensureCariAccountTx(tx, { customerId: cust2.id, subcontractorId: null }));
  const period = factoryYmd().slice(0, 7);
  const linksOn = (rollIds: string[]) => prisma.serviceBillingLink.findMany({ where: { rollId: { in: rollIds }, revokedAt: null }, select: { invoiceId: true, rollId: true } });
  await setSetting(SETTING_KEYS.FINANCE_SERVICE_BILLING_TRIGGER, "PERIOD_END");
  const pa = await mkWorkedRoll(50, "49.500", undefined, cust2.id);
  const pb = await mkWorkedRoll(60, "59.250", undefined, cust2.id);
  const s1 = await ship([pa], cust2.id);
  const s2 = await ship([pb], cust2.id);
  const hookInv = [...(await invoicesOf(s1.id)), ...(await invoicesOf(s2.id))];
  check("PERIOD_END: sevk kancası hizmet satırı 0, bağ 0", hookInv.every((i) => i.lines.every((l) => l.itemId !== K2)) && (await linksOn([pa, pb])).length === 0, `${hookInv.length} taslak`);
  const peLines = await collectShipmentInvoiceDraftLines(s1.id, cust2.id, Currency.TRY);
  check("PERIOD_END: panel sevk önizlemesi hizmet satırı 0 + neden uyarısı", (peLines.serviceLinks ?? []).length === 0 && peLines.lines.length === 0 && peLines.warnings.includes(PERIOD_END_SERVICE_WARNING), JSON.stringify(peLines.warnings));

  section("§14 2 sevk ⇒ 1 dönem taslağı (shipmentId yok)");
  const dpv = await previewServicePeriodDraft({ cariId: cari2.id, period });
  check("önizleme: 2 sevk, 2 iş, 108,750 m, 870,00", dpv.shipmentCount === 2 && dpv.workCount === 2 && dpv.totalMeters === "108.750" && dpv.subtotal === "870.00" && dpv.periodClosed === null, JSON.stringify({ s: dpv.shipmentCount, w: dpv.workCount, m: dpv.totalMeters, t: dpv.subtotal }));
  const tok1 = randomUUID();
  const d1 = await createServicePeriodDraft({ cariId: cari2.id, period, clientToken: tok1 }, actor);
  const pInv = await prisma.invoice.findUniqueOrThrow({ where: { id: d1.data!.id }, select: { shipmentId: true, status: true, lines: { select: { itemId: true, qty: true } } } });
  const pl = await linksOn([pa, pb]);
  check("1 taslak, 2 bağ aynı faturada, tek K2 satırı 108,75 m, shipmentId boş",
    pInv.shipmentId === null && pInv.status === InvoiceStatus.DRAFT && pl.length === 2 && pl.every((l) => l.invoiceId === d1.data!.id)
    && pInv.lines.length === 1 && pInv.lines[0]!.itemId === K2 && Number(pInv.lines[0]!.qty) === 108.75, JSON.stringify(pInv.lines));

  section("§15 token replay ⇒ aynı taslak");
  const cariInvCount = () => prisma.invoice.count({ where: { cariId: cari2.id } });
  const before15 = await cariInvCount();
  const d1b = await createServicePeriodDraft({ cariId: cari2.id, period, clientToken: tok1 }, actor);
  check("aynı token ⇒ aynı id, yeni fatura yok, bağ 2", d1b.data!.id === d1.data!.id && (await cariInvCount()) === before15 && (await linksOn([pa, pb])).length === 2);
  const otherPeriod = await errOf(() => createServicePeriodDraft({ cariId: cari2.id, period: "2020-01", clientToken: tok1 }, actor));
  check("aynı token başka dönem ⇒ 409 CLIENT_TOKEN_COLLISION", otherPeriod.status === 409 && otherPeriod.code === "CLIENT_TOKEN_COLLISION", JSON.stringify(otherPeriod));

  section("§16 aynı iş iki yoldan ⇒ 409; faturalı iş dönemden düşer");
  const again = await errOf(() => createServicePeriodDraft({ cariId: cari2.id, period, clientToken: randomUUID() }, actor));
  check("dönemin bütün işleri faturalı ⇒ 409 SERVICE_ALREADY_BILLED", again.status === 409 && again.code === "SERVICE_ALREADY_BILLED", JSON.stringify(again));
  await setSetting(SETTING_KEYS.FINANCE_SERVICE_BILLING_TRIGGER, "PER_SHIPMENT");
  const pc = await mkWorkedRoll(40, "39.000", undefined, cust2.id);
  const s3 = await ship([pc], cust2.id);
  const s3Inv = await invoicesOf(s3.id);
  check("PER_SHIPMENT: sevk kancası bugünkü gibi hizmet bağı kurar", s3Inv.length === 1 && (await linksOn([pc])).every((l) => l.invoiceId === s3Inv[0]!.id) && (await linksOn([pc])).length === 1);
  await setSetting(SETTING_KEYS.FINANCE_SERVICE_BILLING_TRIGGER, "PERIOD_END");
  const pd = await mkWorkedRoll(30, "29.000", undefined, cust2.id);
  const s4 = await ship([pd], cust2.id);
  await setSetting(SETTING_KEYS.FINANCE_SERVICE_BILLING_TRIGGER, "PER_SHIPMENT");
  const stale = await collectShipmentInvoiceDraftLines(s4.id, cust2.id, Currency.TRY);
  await setSetting(SETTING_KEYS.FINANCE_SERVICE_BILLING_TRIGGER, "PERIOD_END");
  // Çift yol §: aktif bağı olan iş toplayıcıdan düşmezse bu çağrı 409'a çarpar (negatif sonda burada kırmızı).
  const d2 = await createServicePeriodDraft({ cariId: cari2.id, period, clientToken: randomUUID() }, actor)
    .catch((e: { message?: string; details?: { code?: string } }) => `${e.details?.code}: ${e.message}`);
  const d2Links = typeof d2 === "string" ? [] : await prisma.serviceBillingLink.findMany({ where: { invoiceId: d2.data!.id, revokedAt: null }, select: { rollId: true } });
  check("dönem taslağı yalnız faturasız işi alır (sevk taslağındaki ve önceki dönem taslağındaki iş düşer)",
    d2Links.length === 1 && d2Links[0]!.rollId === pd, typeof d2 === "string" ? d2 : JSON.stringify(d2Links));
  const twoWay = await errOf(() => invoiceService.createDraft({
    type: "SALES", customerId: cust2.id, shipmentId: s4.id, currency: Currency.TRY,
    lines: stale.lines.map((l) => ({ ...l, qty: l.qty, unitPrice: l.unitPrice })), serviceLinks: stale.serviceLinks ?? [],
  } as never, actor));
  check("dönemde faturalı iş sevk taslağından ⇒ 409 SERVICE_ALREADY_BILLED, bağ 1",
    twoWay.status === 409 && twoWay.code === "SERVICE_ALREADY_BILLED" && (await linksOn([pd])).length === 1 && (stale.serviceLinks ?? []).length === 1, JSON.stringify(twoWay));

  section("§17 2 paralel ⇒ 1 kazanan");
  const pRace = await mkWorkedRoll(20, "19.000", undefined, cust2.id);
  await ship([pRace], cust2.id);
  const race = await Promise.allSettled([
    createServicePeriodDraft({ cariId: cari2.id, period, clientToken: randomUUID() }, actor),
    createServicePeriodDraft({ cariId: cari2.id, period, clientToken: randomUUID() }, actor),
  ]);
  const won = race.filter((r) => r.status === "fulfilled").length;
  const lost = race.filter((r) => r.status === "rejected" && (r.reason as { details?: { code?: string } }).details?.code === "SERVICE_ALREADY_BILLED").length;
  check("farklı token ×2 ⇒ 1 kazanan + 1×409, bağ 1", won === 1 && lost === 1 && (await linksOn([pRace])).length === 1, `${won}/${lost}`);
  const pf = await mkWorkedRoll(20, "18.500", undefined, cust2.id);
  await ship([pf], cust2.id);
  const tokSame = randomUUID();
  const same = await Promise.all([
    bypassReplayQueue(() => createServicePeriodDraft({ cariId: cari2.id, period, clientToken: tokSame }, actor)),
    bypassReplayQueue(() => createServicePeriodDraft({ cariId: cari2.id, period, clientToken: tokSame }, actor)),
  ].map((p) => p.then((r) => r.data!.id, (e: { details?: { code?: string } }) => `ERR:${e.details?.code}`)));
  check("aynı token ×2 paralel ⇒ tek taslak", same[0] === same[1] && !same[0]!.startsWith("ERR") && (await prisma.invoice.count({ where: { clientToken: tokSame } })) === 1, JSON.stringify(same));

  section("§18 kapanmış dönem ⇒ 409; bozuk/ileri dönem ⇒ 400");
  const pg = await mkWorkedRoll(15, "14.000", undefined, cust2.id);
  await ship([pg], cust2.id);
  const close = await prisma.cariPeriodClose.create({ data: { cariId: cari2.id, currency: Currency.TRY, periodEnd: periodDayKey(new Date()), closingBalance: 0, txnCount: 0 }, select: { id: true } });
  const closedErr = await errOf(() => createServicePeriodDraft({ cariId: cari2.id, period, clientToken: randomUUID() }, actor));
  const closedPv = await previewServicePeriodDraft({ cariId: cari2.id, period });
  check("kapalı dönem ⇒ 409 SERVICE_PERIOD_CLOSED, bağ 0, önizleme söyler", closedErr.status === 409 && closedErr.code === "SERVICE_PERIOD_CLOSED" && (await linksOn([pg])).length === 0 && closedPv.periodClosed !== null, JSON.stringify(closedErr));
  await prisma.cariPeriodClose.delete({ where: { id: close.id } });
  const bad = await errOf(() => previewServicePeriodDraft({ cariId: cari2.id, period: "2026-13" }));
  const fut = await errOf(() => previewServicePeriodDraft({ cariId: cari2.id, period: `${Number(period.slice(0, 4)) + 1}-01` }));
  check("bozuk dönem 400 SERVICE_PERIOD_INVALID · ileri dönem 400 SERVICE_PERIOD_FUTURE", bad.code === "SERVICE_PERIOD_INVALID" && fut.code === "SERVICE_PERIOD_FUTURE", JSON.stringify([bad, fut]));

  section("§19 dönem taslağına bağlı sevk geri alınamaz; taslak iptali ⇒ geri alınır");
  const pu = await mkWorkedRoll(25, "24.000", undefined, cust2.id);
  const s5 = await ship([pu], cust2.id);
  const d5 = await createServicePeriodDraft({ cariId: cari2.id, period, clientToken: randomUUID() }, actor);
  const d5DocNo = (await prisma.invoice.findUniqueOrThrow({ where: { id: d5.data!.id }, select: { docNo: true } })).docNo;
  // Dönem taslağı shipmentId taşımaz: kapı topun ata zincirinden bulmazsa geri alma 200 döner (negatif sonda burada kırmızı).
  const undoPe = await errOf(() => shippingService.undoDispatch(s5.id, "test geri alma", actor));
  check("dönem taslağına bağlı sevk geri alma ⇒ 409 SERVICE_ALREADY_BILLED", undoPe.status === 409 && undoPe.code === "SERVICE_ALREADY_BILLED", JSON.stringify(undoPe));
  const pvPe = (await shippingService.getUndoDispatchPreview(s5.id)).data as { canUndo: boolean; serviceBilledInvoices: string[] };
  check("önizleme dönem taslağını listeler", !pvPe.canUndo && pvPe.serviceBilledInvoices.includes(d5DocNo), JSON.stringify(pvPe.serviceBilledInvoices));
  await invoiceService.cancel(d5.data!.id, "test iptal", actor);
  const undoPeOk = await errOf(() => shippingService.undoDispatch(s5.id, "test geri alma", actor));
  check("dönem taslağı iptal edilince geri alma 200", undoPeOk.status === 200 && (await linksOn([pu])).length === 0, JSON.stringify(undoPeOk));
  await setSetting(SETTING_KEYS.FINANCE_SERVICE_BILLING_TRIGGER, "PER_SHIPMENT");

  // ── §20 H8b müşteri tetiği ─────────────────────────────────────────────
  section("§20 müşteri tetiği: fabrika ayarını iki yönde ezer; NULL = fabrika");
  const cust3 = await prisma.customer.create({ data: { code: `${P}-E`.slice(0, 32), name: `TEST HZFT tetik ${STAMP}` }, select: { id: true } });
  fx.extraCustomerIds.push(cust3.id);
  const cari3 = await prisma.$transaction((tx) => ensureCariAccountTx(tx, { customerId: cust3.id, subcontractorId: null }));
  const badTrig = await errOf(() => cariService.update(cari3.id, { serviceBillingTrigger: "WEEKLY" }, actor));
  const badMsg = await cariService.update(cari3.id, { serviceBillingTrigger: "WEEKLY" }, actor).catch((e: Error) => e.message);
  check("geçersiz tetik ⇒ 400 SERVICE_BILLING_TRIGGER_INVALID (Türkçe), kolon NULL kalır",
    badTrig.status === 400 && badTrig.code === "SERVICE_BILLING_TRIGGER_INVALID" && String(badMsg).includes("geçersiz")
    && (await prisma.cariAccount.findUniqueOrThrow({ where: { id: cari3.id }, select: { serviceBillingTrigger: true } })).serviceBillingTrigger === null, JSON.stringify(badTrig));
  const dbSeal = await errOf(() => prisma.cariAccount.update({ where: { id: cari3.id }, data: { serviceBillingTrigger: "WEEKLY" } }));
  check("DB CHECK seddi: servisi atlayan yazım reddedilir", dbSeal.status !== 200, JSON.stringify(dbSeal));
  await cariService.update(cari3.id, { serviceBillingTrigger: "PERIOD_END" }, actor);
  let trigLog = null as null | { newData: unknown; oldData: unknown };
  for (let i = 0; i < 20 && !trigLog; i++) {
    trigLog = await prisma.systemLog.findFirst({ where: { tableName: "CARI_ACCOUNT", recordId: cari3.id, action: "UPDATE" }, orderBy: { createdAt: "desc" }, select: { newData: true, oldData: true } });
    if (!trigLog) await new Promise((r) => setTimeout(r, 100));
  }
  check("yazım audit'li: yeni değer + eski NULL", (trigLog?.newData as { serviceBillingTrigger?: string } | null)?.serviceBillingTrigger === "PERIOD_END"
    && (trigLog?.oldData as { serviceBillingTrigger?: string | null } | null)?.serviceBillingTrigger === null, JSON.stringify(trigLog));
  const row3 = (await cariService.findById(cari3.id)).data!;
  check("cari okuması tetiği taşır (panel formu ezmesin)", row3.serviceBillingTrigger === "PERIOD_END", String(row3.serviceBillingTrigger));

  // (a) fabrika PER_SHIPMENT + müşteri PERIOD_END
  await setSetting(SETTING_KEYS.FINANCE_SERVICE_BILLING_TRIGGER, "PER_SHIPMENT");
  const qa = await mkWorkedRoll(30, "29.500", undefined, cust3.id);
  const sqa = await ship([qa], cust3.id);
  const qaInv = await invoicesOf(sqa.id);
  const qaLines = await collectShipmentInvoiceDraftLines(sqa.id, cust3.id, Currency.TRY);
  check("fabrika PER_SHIPMENT + müşteri PERIOD_END ⇒ sevkte hizmet satırı/bağı 0 + neden uyarısı",
    qaInv.every((i) => i.lines.every((l) => l.itemId !== K2)) && (await linksOn([qa])).length === 0
    && (qaLines.serviceLinks ?? []).length === 0 && qaLines.warnings.includes(PERIOD_END_SERVICE_WARNING), `${qaInv.length} taslak`);
  const qaPv = await previewServicePeriodDraft({ cariId: cari3.id, period });
  const qaD = await createServicePeriodDraft({ cariId: cari3.id, period, clientToken: randomUUID() }, actor);
  check("… dönem taslağı onu toplar (1 iş, bağ dönem taslağında)", qaPv.workCount === 1 && (await linksOn([qa])).every((l) => l.invoiceId === qaD.data!.id) && (await linksOn([qa])).length === 1, JSON.stringify({ w: qaPv.workCount }));

  // (b) fabrika PERIOD_END + müşteri PER_SHIPMENT — müşteri PERIOD_END iken sevk edilmiş (faturasız) iş önce hazırlanır
  const qx = await mkWorkedRoll(12, "11.500", undefined, cust3.id);
  await ship([qx], cust3.id);
  await cariService.update(cari3.id, { serviceBillingTrigger: "PER_SHIPMENT" }, actor);
  await setSetting(SETTING_KEYS.FINANCE_SERVICE_BILLING_TRIGGER, "PERIOD_END");
  const qb = await mkWorkedRoll(20, "19.500", undefined, cust3.id);
  const sqb = await ship([qb], cust3.id);
  const qbInv = await invoicesOf(sqb.id);
  check("fabrika PERIOD_END + müşteri PER_SHIPMENT ⇒ sevk kancası hizmet bağı kurar",
    qbInv.length === 1 && (await linksOn([qb])).length === 1 && (await linksOn([qb])).every((l) => l.invoiceId === qbInv[0]!.id), `${qbInv.length} taslak`);
  // Dönem ucu "Her sevkte" müşteride de açık: tetik sonradan değiştiyse faturasız kalan işi toplayan tek yol; sevkte faturalanan düşer.
  const qbPv = await previewServicePeriodDraft({ cariId: cari3.id, period });
  check("… dönem önizlemesi açık + uyarır: yalnız faturasız kalmış iş (qx) toplanır, sevkte faturalanan (qb) düşer",
    qbPv.workCount === 1 && qbPv.warnings.includes(CUSTOMER_PER_SHIPMENT_PERIOD_WARNING), JSON.stringify({ w: qbPv.workCount, warn: qbPv.warnings }));
  const qbD = await createServicePeriodDraft({ cariId: cari3.id, period, clientToken: randomUUID() }, actor);
  check("… dönem taslağı qx'i bağlar, qb bağı sevk taslağında kalır (çift fatura yok)",
    (await linksOn([qx])).length === 1 && (await linksOn([qx])).every((l) => l.invoiceId === qbD.data!.id)
    && (await linksOn([qb])).length === 1 && (await linksOn([qb])).every((l) => l.invoiceId === qbInv[0]!.id), qbD.data!.id);
  const sub = await prisma.subcontractor.create({ data: { code: `${P}-SB`.slice(0, 32), name: `TEST HZFT fasoncu ${STAMP}` }, select: { id: true } });
  fx.subcontractorIds.push(sub.id);
  const subCari = await prisma.$transaction((tx) => ensureCariAccountTx(tx, { customerId: null, subcontractorId: sub.id }));
  const nc = await errOf(() => cariService.update(subCari.id, { serviceBillingTrigger: "PER_SHIPMENT" }, actor));
  check("müşteri dışı (fason) cari ⇒ 400 SERVICE_BILLING_TRIGGER_NOT_CUSTOMER", nc.status === 400 && nc.code === "SERVICE_BILLING_TRIGGER_NOT_CUSTOMER", JSON.stringify(nc));

  // (c) NULL ⇒ fabrika ayarı
  await cariService.update(cari3.id, { serviceBillingTrigger: null }, actor);
  const eff = await resolveCustomerServiceBillingTrigger(cust3.id, await loadServiceBillingSettings());
  const qc = await mkWorkedRoll(10, "9.500", undefined, cust3.id);
  await ship([qc], cust3.id);
  check("NULL ⇒ fabrika ayarı (PERIOD_END): kaynak FACTORY, sevkte bağ 0", eff.trigger === "PERIOD_END" && eff.source === "FACTORY" && (await linksOn([qc])).length === 0, JSON.stringify(eff));
  const effNo = await resolveCustomerServiceBillingTrigger(randomUUID(), { trigger: "PER_SHIPMENT" });
  check("carisiz müşteri ⇒ fabrika ayarı", effNo.trigger === "PER_SHIPMENT" && effNo.source === "FACTORY", JSON.stringify(effNo));

  // ── §21 H8b DISPATCH_DAY ──────────────────────────────────────────────
  section("§21 DISPATCH_DAY: dönem taslağında her iş kendi sevk anının fiyatıyla");
  const cust4 = await prisma.customer.create({ data: { code: `${P}-F`.slice(0, 32), name: `TEST HZFT sevk günü ${STAMP}` }, select: { id: true } });
  fx.extraCustomerIds.push(cust4.id);
  const cari4 = await prisma.$transaction((tx) => ensureCariAccountTx(tx, { customerId: cust4.id, subcontractorId: null }));
  await setSetting(SETTING_KEYS.FINANCE_SERVICE_BILLING_TRIGGER, "PERIOD_END");
  await setSetting(SETTING_KEYS.FINANCE_SERVICE_BILLING_PRICE_DATE, "DISPATCH_DAY");
  const ra = await mkWorkedRoll(30, "30.000", undefined, cust4.id);
  const rb = await mkWorkedRoll(20, "20.000", undefined, cust4.id);
  const sa = await ship([ra], cust4.id);
  const sb = await ship([rb], cust4.id);
  // Fiyat değişimi iki sevk arasında: A eski (5), B yeni (7) fiyat döneminde sevk edildi (aynı dönem içinde).
  const nowMs = Date.now();
  const tA = new Date(nowMs - 20 * 60_000), tSwitch = new Date(nowMs - 15 * 60_000), tB = new Date(nowMs - 10 * 60_000);
  await prisma.shipment.update({ where: { id: sa.id }, data: { dispatchedAt: tA } });
  await prisma.shipment.update({ where: { id: sb.id }, data: { dispatchedAt: tB } });
  await prisma.itemPrice.create({ data: { itemId: K2, customerId: cust4.id, kind: PriceKind.SALE, currency: Currency.TRY, price: "5.0000", createdAt: new Date(nowMs - 60 * 60_000), revokedAt: tSwitch, revokeReason: "test fiyat değişimi" } });
  await prisma.itemPrice.create({ data: { itemId: K2, customerId: cust4.id, kind: PriceKind.SALE, currency: Currency.TRY, price: "7.0000", createdAt: tSwitch } });
  const dd = await previewServicePeriodDraft({ cariId: cari4.id, period });
  const ddPrices = dd.lines.map((l) => `${l.qty}@${l.unitPrice}`).sort();
  // Negatif sonda: dönemin son sevk anı herkese uygulanınca iki satır 50 m @7 olur ⇒ burada kırmızı.
  check("2 sevk, 2 iş: 30 m @5 (A'nın sevk anı) + 20 m @7 (B'nin sevk anı), ara toplam 290,00",
    JSON.stringify(ddPrices) === JSON.stringify(["20.000@7.0000", "30.000@5.0000"]) && dd.subtotal === "290.00", JSON.stringify({ ddPrices, t: dd.subtotal }));
  const ddD = await createServicePeriodDraft({ cariId: cari4.id, period, clientToken: randomUUID() }, actor);
  const ddLinks = await prisma.serviceBillingLink.findMany({ where: { invoiceId: ddD.data!.id, revokedAt: null }, select: { rollId: true, unitPrice: true } });
  check("bağların birim fiyatı iş başına donar (A 5, B 7)",
    ddLinks.length === 2 && Number(ddLinks.find((l) => l.rollId === ra)?.unitPrice) === 5 && Number(ddLinks.find((l) => l.rollId === rb)?.unitPrice) === 7, JSON.stringify(ddLinks));
  // Ata işi: iş atada (kurşun + OUT okuması), ata tamburda iki çocuğa bölünür, çocuklar iki ayrı fiyat gününde sevk edilir.
  // Ata işi en ERKEN sevk edilen çocuğun anına çözülür (5); yayılım bozulursa dönemin son sevki (7) uygulanır ⇒ kırmızı.
  const grade = await prisma.qualityGrade.findFirst({ where: { role: "FIRST", isActive: true }, select: { code: true } });
  if (!grade) throw new Error("FIRST rollü kalite yok — seed'siz DB");
  const anc = await mkWorkedRoll(40, "40.000", undefined, cust4.id);
  const cutChild = async (len: number): Promise<string> => {
    const r = await new TamburService().cutWarehouseRoll(anc, { cutLength: len, rawDestination: "WAREHOUSE", qualityGrade: grade.code });
    const id = (r.data as { childRoll?: { id: string } }).childRoll?.id;
    if (!id) throw new Error("kesim çocuk dönmedi");
    fx.rollIds.unshift(id);
    return id;
  };
  const ch1 = await cutChild(15);
  const ch2 = await cutChild(10);
  const sc2 = await ship([ch2], cust4.id);
  const sc1 = await ship([ch1], cust4.id);
  await prisma.shipment.update({ where: { id: sc1.id }, data: { dispatchedAt: new Date(nowMs - 19 * 60_000) } });
  await prisma.shipment.update({ where: { id: sc2.id }, data: { dispatchedAt: new Date(nowMs - 9 * 60_000) } });
  const anPv = await previewServicePeriodDraft({ cariId: cari4.id, period });
  const anPrices = anPv.lines.map((l) => `${l.qty}@${l.unitPrice}`).sort();
  check("ata işi (40 m) en erken sevk edilen çocuğun anının fiyatıyla: 40 m @5",
    JSON.stringify(anPrices) === JSON.stringify(["40.000@5.0000"]), JSON.stringify(anPrices));
  await setSetting(SETTING_KEYS.FINANCE_SERVICE_BILLING_PRICE_DATE, "SERVICE_DAY");
  await setSetting(SETTING_KEYS.FINANCE_SERVICE_BILLING_TRIGGER, "PER_SHIPMENT");

  // ── §22 F1 önizleme/oluşturma yarışı ──────────────────────────────────
  section("§22 F1: önizleme → (tetik/bağ değişir) → oluştur ⇒ 409 SERVICE_PREVIEW_STALE, sıfır yazım");
  const cust5 = await prisma.customer.create({ data: { code: `${P}-G`.slice(0, 32), name: `TEST HZFT önizleme ${STAMP}` }, select: { id: true } });
  fx.extraCustomerIds.push(cust5.id);
  const cari5 = await prisma.$transaction((tx) => ensureCariAccountTx(tx, { customerId: cust5.id, subcontractorId: null }));
  /** Sevk + kancanın taslağı silinir; panelin önizlemesi döner (panel gövdesi = önizleme satırları, bağ taşımaz). */
  const previewed = async (metres: string[]) => {
    const rs: string[] = [];
    for (const m of metres) rs.push(await mkWorkedRoll(Math.ceil(Number(m)) + 1, m, undefined, cust5.id));
    const sh = await ship(rs, cust5.id);
    for (const i of await invoicesOf(sh.id)) await invoiceService.deleteDraft(i.id, actor);
    const pv = await collectShipmentInvoiceDraftLines(sh.id, cust5.id, Currency.TRY);
    const body = () => ({ type: "SALES" as const, customerId: cust5.id, shipmentId: sh.id, currency: Currency.TRY, clientToken: randomUUID(),
      lines: pv.lines.map((l) => ({ itemId: l.itemId, description: l.description, qty: l.qty, unit: l.unit, unitPrice: l.unitPrice, vatRate: l.vatRate })) });
    const writes = async () => ({ inv: (await invoicesOf(sh.id)).filter((i) => i.status !== InvoiceStatus.CANCELLED).length, links: (await linksOn(rs)).length });
    return { rs, sh, pv, body, writes };
  };
  const linkShape = (l: { rollId: string; workOrderStepId: string | null; serviceItemId: string; readingId: string | null; billedMeters: Prisma.Decimal.Value; meterBasis: string; unitPrice: Prisma.Decimal.Value }) =>
    `${l.rollId}|${l.workOrderStepId}|${l.serviceItemId}|${l.readingId}|${new Prisma.Decimal(l.billedMeters).toFixed(3)}|${l.meterBasis}|${new Prisma.Decimal(l.unitPrice).toFixed(4)}`;

  const n0 = await previewed(["21.000", "22.500"]);
  const ok0 = await invoiceService.createDraft(n0.body(), actor);
  const ok0Links = await prisma.serviceBillingLink.findMany({ where: { invoiceId: ok0.data!.id, revokedAt: null }, select: { rollId: true, workOrderStepId: true, serviceItemId: true, readingId: true, billedMeters: true, meterBasis: true, unitPrice: true } });
  check("§22a normal yol: bağlar önizlemenin bağlarıyla bayt-aynı (2 bağ)",
    ok0Links.length === 2 && JSON.stringify(ok0Links.map(linkShape).sort()) === JSON.stringify((n0.pv.serviceLinks ?? []).map(linkShape).sort()), JSON.stringify(ok0Links.map(linkShape)));

  const n1 = await previewed(["31.000"]);
  await cariService.update(cari5.id, { serviceBillingTrigger: "PERIOD_END" }, actor);
  const st1 = await errOf(() => invoiceService.createDraft(n1.body(), actor));
  const w1 = await n1.writes();
  check("§22b müşteri tetiği PERIOD_END'e döndü ⇒ 409 SERVICE_PREVIEW_STALE, fatura 0, bağ 0",
    st1.status === 409 && st1.code === "SERVICE_PREVIEW_STALE" && w1.inv === 0 && w1.links === 0, JSON.stringify({ st1, w1 }));
  await cariService.update(cari5.id, { serviceBillingTrigger: null }, actor);

  const n2 = await previewed(["32.000"]);
  await setSetting(SETTING_KEYS.FINANCE_SERVICE_BILLING_TRIGGER, "PERIOD_END");
  const st2 = await errOf(() => invoiceService.createDraft(n2.body(), actor));
  const w2 = await n2.writes();
  check("§22c fabrika tetiği PERIOD_END'e döndü ⇒ 409 SERVICE_PREVIEW_STALE, fatura 0, bağ 0",
    st2.status === 409 && st2.code === "SERVICE_PREVIEW_STALE" && w2.inv === 0 && w2.links === 0, JSON.stringify({ st2, w2 }));
  await setSetting(SETTING_KEYS.FINANCE_SERVICE_BILLING_TRIGGER, "PER_SHIPMENT");

  const n3 = await previewed(["33.000"]);
  const pd3 = await createServicePeriodDraft({ cariId: cari5.id, period, clientToken: randomUUID() }, actor);
  const st3 = await errOf(() => invoiceService.createDraft(n3.body(), actor));
  const w3 = await n3.writes();
  const l3 = await linksOn(n3.rs);
  check("§22d iş arada başka faturaya (dönem taslağı) bağlandı ⇒ 409 SERVICE_PREVIEW_STALE, sevk faturası 0, bağ yalnız dönem taslağında",
    st3.status === 409 && st3.code === "SERVICE_PREVIEW_STALE" && w3.inv === 0 && l3.length === 1 && l3[0]!.invoiceId === pd3.data!.id, JSON.stringify({ st3, w3 }));
  await invoiceService.cancel(pd3.data!.id, "test iptal", actor);

  const n4 = await previewed(["34.000", "35.000"]);
  const race4 = await Promise.allSettled([invoiceService.createDraft(n4.body(), actor), invoiceService.createDraft(n4.body(), actor)]);
  const won4 = race4.filter((r) => r.status === "fulfilled").length;
  const lost4 = race4.filter((r) => r.status === "rejected" && (r.reason as { statusCode?: number }).statusCode === 409);
  const w4 = await n4.writes();
  check("§22e eşzamanlı iki oluşturma ⇒ 1 fatura + 1×409, bağ 2",
    won4 === 1 && lost4.length === 1 && w4.inv === 1 && w4.links === 2,
    JSON.stringify({ won4, lost: lost4.map((r) => (r as PromiseRejectedResult).reason?.details?.code), w4 }));

  const n5 = await previewed(["36.000"]);
  const noSvc5 = await invoiceService.createDraft({ ...n5.body(), lines: [{ itemId: null, description: "Elle satır", qty: 1, unit: "m", unitPrice: 8 }] }, actor);
  const svc5 = n5.pv.lines.find((l) => l.itemId === K2)!;
  const up5 = await errOf(() => invoiceService.updateDraft(noSvc5.data!.id, { lines: [{ itemId: K2, description: svc5.description, qty: svc5.qty, unit: "m", unitPrice: 8 }] }, actor));
  const lines5 = await prisma.invoiceLine.findMany({ where: { invoiceId: noSvc5.data!.id }, select: { itemId: true } });
  check("§22f düzenlemede bağsız emanet hizmet satırı ⇒ 409 SERVICE_LINE_UNLINKED, satır/bağ değişmez",
    up5.status === 409 && up5.code === "SERVICE_LINE_UNLINKED" && lines5.length === 1 && lines5[0]!.itemId === null && (await linksOn(n5.rs)).length === 0, JSON.stringify(up5));
  const ok5 = await errOf(() => invoiceService.updateDraft(noSvc5.data!.id, { lines: [{ itemId: null, description: "Elle satır 2", qty: 2, unit: "m", unitPrice: 8 }] }, actor));
  check("§22g hizmetsiz düzenleme bugünkü gibi 200", ok5.status === 200, JSON.stringify(ok5));

  // ── §11 Kapalı ───────────────────────────────────────────────────────────
  section("§11 kapalıyken bugünkü davranış");
  await setSetting(SETTING_KEYS.FINANCE_SERVICE_BILLING_ENABLED, false);
  const off = await mkWorkedRoll(40, "39.5");
  const shD = await ship([off]);
  const invD = await invoicesOf(shD.id);
  check("kapalı: emanet ürün satırı + bugünkü uyarı, 0 bağ",
    invD.length === 1 && invD[0]!.lines.length === 1 && invD[0]!.lines[0]!.itemId === fabric && (invD[0]!.notes ?? "").includes("EMANET malı") && !(invD[0]!.notes ?? "").includes("Sevk brütü")
    && (await prisma.serviceBillingLink.count({ where: { rollId: off } })) === 0, invD[0]?.notes ?? "");
  // Bayt-aynı: not H7 öncesi kalıbın TAM eşiti (includes değil) ve toplayıcı yanıtında H7 alanı YOK.
  const offRoll = await prisma.roll.findUniqueOrThrow({ where: { id: off }, select: { barcode: true } });
  const offShip = await prisma.shipment.findUniqueOrThrow({ where: { id: shD.id }, select: { shipmentNo: true } });
  const expectedNotes = `${offShip.shipmentNo} sevkiyatından üretildi. ⚠ 1 top müşterinin EMANET malı (${offRoll.barcode}) — mal satışı değil işçilik faturalanır; taslak satırlarını elle düzeltin.`;
  check("§11b kapalı: taslak notu H7 öncesi metnin TAM eşiti", invD[0]?.notes === expectedNotes, `${invD[0]?.notes} ≠ ${expectedNotes}`);
  const offLines = await collectShipmentInvoiceDraftLines(shD.id, cust.id, Currency.TRY);
  check("§11c kapalı: toplayıcı yanıtının anahtarları H7 öncesiyle aynı (serviceLinks/shipmentGross yok)",
    JSON.stringify(Object.keys(offLines).sort()) === JSON.stringify(["lines", "orderConflicts", "orderPriced", "warnings"]), JSON.stringify(Object.keys(offLines)));
}

async function cleanup(): Promise<void> {
  const del = async (ad: string, f: () => Promise<unknown>) => {
    try { await f(); } catch (e) { fail++; console.log(`❌ temizlik ${ad}: ${(e as Error).message.split("\n")[0]}`); }
  };
  for (const [key, prev] of prior) {
    await del(`ayar ${key}`, () => prev.existed
      ? prisma.systemSetting.upsert({ where: { key }, create: { key, value: prev.value as never }, update: { value: prev.value as never } })
      : prisma.systemSetting.deleteMany({ where: { key } }));
  }
  const ids = fx.rollIds;
  const custIds = [fx.customerId, fx.customer2Id, ...fx.extraCustomerIds].filter((v): v is string => v !== null);
  const invIds = (await prisma.invoice.findMany({ where: { OR: [{ shipmentId: { in: fx.shipmentIds } }, { cari: { customerId: { in: custIds } } }] }, select: { id: true } })).map((i) => i.id);
  await del("link", () => prisma.serviceBillingLink.deleteMany({ where: { OR: [{ invoiceId: { in: invIds } }, { rollId: { in: ids } }] } }));
  await del("cariTx", () => prisma.cariTransaction.deleteMany({ where: { invoiceId: { in: invIds } } }));
  await del("invoiceLine", () => prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: invIds } } }));
  await del("printedDoc", () => prisma.printedDocument.deleteMany({ where: { sourceId: { in: [...invIds, ...fx.shipmentIds] } } }));
  await del("invoice", () => prisma.invoice.deleteMany({ where: { id: { in: invIds } } }));
  if (custIds.length > 0) {
    const cari = (await prisma.cariAccount.findMany({ where: { customerId: { in: custIds } }, select: { id: true } })).map((c) => c.id);
    await del("cariPeriodClose", () => prisma.cariPeriodClose.deleteMany({ where: { cariId: { in: cari } } }));
    await del("cariBalance", () => prisma.cariBalance.deleteMany({ where: { cariId: { in: cari } } }));
    await del("cariTx2", () => prisma.cariTransaction.deleteMany({ where: { cariId: { in: cari } } }));
    await del("cariLog", () => prisma.systemLog.deleteMany({ where: { recordId: { in: cari } } }));
    await del("cari", () => prisma.cariAccount.deleteMany({ where: { id: { in: cari } } }));
  }
  if (fx.subcontractorIds.length > 0) {
    const subCari = (await prisma.cariAccount.findMany({ where: { subcontractorId: { in: fx.subcontractorIds } }, select: { id: true } })).map((c) => c.id);
    await del("subCariLog", () => prisma.systemLog.deleteMany({ where: { recordId: { in: subCari } } }));
    await del("subCari", () => prisma.cariAccount.deleteMany({ where: { id: { in: subCari } } }));
    await del("subcontractor", () => prisma.subcontractor.deleteMany({ where: { id: { in: fx.subcontractorIds } } }));
  }
  await del("sackAlloc", () => prisma.sackAllocation.deleteMany({ where: { sack: { shipmentId: { in: fx.shipmentIds } } } }));
  await del("meterAck", () => prisma.rollMeterAck.deleteMany({ where: { reading: { rollId: { in: ids } } } }));
  await del("meterReading", () => prisma.rollMeterReading.deleteMany({ where: { rollId: { in: ids } } }));
  await del("rollReturn", () => prisma.rollReturn.deleteMany({ where: { rollId: { in: ids } } }));
  await del("roll unlink", () => prisma.roll.updateMany({ where: { id: { in: ids } }, data: { sackId: null, shipmentId: null } }));
  await del("whMove", () => prisma.warehouseMovement.deleteMany({ where: { rollId: { in: ids } } }));
  await del("rollOperation", () => prisma.rollOperation.deleteMany({ where: { rollId: { in: ids } } }));
  await del("rollMovement", () => prisma.rollMovement.deleteMany({ where: { rollId: { in: ids } } }));
  await del("rollVariance", () => prisma.rollVariance.deleteMany({ where: { rollId: { in: ids } } }));
  await del("roll", () => prisma.roll.deleteMany({ where: { id: { in: ids } } }));
  await del("shipmentEvent", () => prisma.shipmentEvent.deleteMany({ where: { shipmentId: { in: fx.shipmentIds } } }));
  await del("shipment", () => prisma.shipment.deleteMany({ where: { id: { in: fx.shipmentIds } } }));
  await del("sack", () => prisma.sack.deleteMany({ where: { customerId: { in: custIds } } }));
  await del("step", () => prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("workOrder", () => prisma.workOrder.deleteMany({ where: { id: { in: fx.woIds } } }));
  await del("machine", () => prisma.machine.deleteMany({ where: { id: { in: fx.machineIds } } }));
  await del("station", () => prisma.station.deleteMany({ where: { id: { in: fx.stationIds } } }));
  await del("value", () => prisma.fabricPropertyValue.deleteMany({ where: { id: { in: fx.valueIds } } }));
  await del("variant bağı", () => prisma.fabricProperty.updateMany({ where: { id: { in: fx.propIds } }, data: { variantOfPropertyId: null } }));
  await del("property", () => prisma.fabricProperty.deleteMany({ where: { id: { in: fx.propIds } } }));
  if (fx.kursunCreated) { const k = fx.kursunCreated; await del("KURSUN", () => prisma.fabricProperty.deleteMany({ where: { id: k } })); }
  await del("itemPrice", () => prisma.itemPrice.deleteMany({ where: { itemId: { in: fx.itemIds } } }));
  await del("item", () => prisma.item.deleteMany({ where: { id: { in: fx.itemIds } } }));
  await del("customer", () => prisma.customer.deleteMany({ where: { id: { in: custIds } } }));
  await del("systemLog", () => prisma.systemLog.deleteMany({ where: { recordId: { in: [...fx.shipmentIds, ...invIds] } } }));
  const left = await prisma.roll.count({ where: { id: { in: ids } } });
  check("temizlik: TEST-HZFT top kalıntısı yok", left === 0, String(left));
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
