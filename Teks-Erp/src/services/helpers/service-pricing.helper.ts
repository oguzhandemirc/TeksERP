// =============================================================================
// HİZMET FİYATI ÇÖZÜCÜSÜ — tek kaynak (Gülkesim dalga 2 · H6, karar belgesi §5)
// =============================================================================
// Soru: "bu toplara yapılan iş müşteriye hangi hizmet kalemiyle, kaça kesilir?"
// Zincir: gramaj `listKursunApplications` (process-summary; TABLET + KAĞIT) → yoksa
// iş emri hedefi (uyarıyla) → `value.serviceItemId` → `property.serviceItemId` →
// ana bayrağın (variantOf) eşlemesi. Kurşun DIŞI bayrak işleri (Tambur, etek, brode — H10)
// `listFlagServiceWorks`ten, kalem desen değeri → `property.serviceItemId` (D4-D3) sırasıyla gelir. Ayar açıksa
// süreç türü eşlemeli adım işleri (F3) `listStepServiceWorks`ten; aynı adımı kurşun/bayrak verdiyse adım işi düşer. Fiyat `resolveItemPricesFor(SALE)`, hizmet
// anına (as-of) çözülür: istisna genelden önce, damgalı eski sürüm eski işe.
// ⚠️ `FinishingRate` BURADA OKUNMAZ: o bizim ödediğimiz terbiye/fason MALİYETİDİR,
// gelir değildir — `test_hizmet_fiyati` AST taraması ikinci kopyayı ve okumayı yasaklar.
// =============================================================================
import { Currency, MachineDataSource, MeterPhase, Prisma, PriceKind, type ServiceQtyUnit } from "@prisma/client";
import prisma from "../../lib/prisma";

type Db = Prisma.TransactionClient | typeof prisma;
import { TERIM } from "../../constants/terim";
import { resolveItemPricesFor } from "../item-price.service";
import { listKursunApplications, readKursunTarget, type KursunApplication } from "./process-summary.helper";
import { listFlagServiceWorks } from "./service-flag-work.helper";
import { listStepServiceWorks } from "./service-step-work.helper";
import { loadWeavingRollWorks } from "./service-weaving-work.helper";
import { reworkOurFaultWarning, splitReworkOurFaultWorks } from "./rework-billing.helper";
import { pickServiceItemId } from "./service-item-pick.helper";
import { gramPriceCurrentWarning, gramPriceCustomerLaterWarning, gramPriceEnteredLaterWarning, kursunGramLineLabel, kursunTierLineLabel, loadKursunGramCandidates } from "./kursun-gram-price.helper";
import { loadServiceTierPrices, pickServicePrice, tierKey, tierMissingWarning } from "./service-price-pick.helper";
import { missingQuantityWarning, priceUnitMatches, serviceWorkQuantity, serviceWorkUnit } from "./service-quantity.helper";
import { readFinanceKursunGramPriceBasis, type KursunGramPriceBasis } from "../system-setting.service";
import { markFlagFamily, withPartyScale, type PartyScalableWork } from "./service-party-meter.helper";

/** `kursun-qc.service` reopenStep damga sebebi — yeniden açılan adım yeni hizmettir. */
const KURSUN_REOPEN_REASON = "KURSUN_REOPEN";

export type ServiceMeterBasis = "OUT" | "IN" | "DECLARED" | "CUT" | "RECEIVED" | "WOVEN";
export type ServiceGramajSource = "APPLIED" | "WO_TARGET" | "NONE";

/** Tek iş (top × adım) — fatura bağı (H7) bu satırdan doğar. `meterCompare` yalnız `MAX_DECLARED` tabanında: işin parti payı (beyan / ölçülen / faturalanan); diğer tabanlarda anahtar yok. */
export interface ServiceRollWork extends Pick<PartyScalableWork, "meterCompare"> {
  rollId: string;
  /** Bayrak işinde adım bilinmeyebilir (kesim depoda, ölçümsüz iş) — bağ anahtarı NULLS NOT DISTINCT. */
  workOrderStepId: string | null;
  /** PROPERTY = kurşun dışı bayrak işi (H10) · STEP = süreç türü eşlemeli adım işi (F3) · WEAVING = doğan top (F4). */
  source: KursunApplication["source"] | "PROPERTY" | "STEP" | "WEAVING";
  valueId: string | null;
  valueName: string;
  gramajFrom: ServiceGramajSource;
  serviceItemId: string | null;
  meters: Prisma.Decimal;
  meterBasis: ServiceMeterBasis;
  readingId: string | null;
  serviceAt: Date;
  unitPrice: Prisma.Decimal | null;
  /** Faturalanan birim ve miktar (`service-quantity.helper`); metre işinde `meters`. */
  qtyUnit: ServiceQtyUnit;
  quantity: Prisma.Decimal | null;
  /** Kurşun gram fiyatından ya da kademe fiyatından çözüldüyse fatura satırı açıklaması; yoksa yok (bugün). */
  gramLabel?: string;
  /** Kademe fiyatı seçilirse satır açıklaması ("Kurşun 40 gr", "Brode Papatya"). */
  tierLabel?: string;
}

/** Hizmet kalemi × birim fiyat grubu (taslak satırı). */
export interface ServiceLine {
  serviceItemId: string;
  code: string;
  name: string;
  unitPrice: string | null;
  currency: Currency;
  quantity: string;
  /** Satırın birimi — METER (m) · PIECE (adet) · STITCH (vuruş). */
  unit: ServiceQtyUnit;
  rollCount: number;
  rollIds: string[];
  /** Kurşun gram fiyatlı satırın açıklaması (oie-a); yoksa anahtar yok → kalem adı (bugün). */
  label?: string;
  /** S6 (D4-KUC2 c): metresi elle (OPERATOR) okumadan gelen iş sayısı — faturalanır ama satır İŞARETLİ (0 = işaretsiz). */
  manualMeterRollCount: number;
}

export interface ServiceResolution {
  lines: ServiceLine[];
  works: ServiceRollWork[];
  warnings: string[];
  /** F9: İE'si donmuş `reworkBillable=false` olan (bizim hatamız) işler — satıra/bağa girmez; yalnız varsa anahtar var (bayt-aynı). */
  excludedWorks?: ServiceRollWork[];
}

/** Gramaj değerinden hizmet kalemi: önce değer, sonra özellik, sonra ana bayrak. */
async function loadValueServiceMap(valueIds: string[], db: Db): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (valueIds.length === 0) return out;
  const rows = await db.fabricPropertyValue.findMany({
    where: { id: { in: valueIds } },
    select: { id: true, serviceItemId: true, property: { select: { serviceItemId: true, variantOf: { select: { serviceItemId: true } } } } },
  });
  for (const r of rows) out.set(r.id, pickServiceItemId({ value: r.serviceItemId, property: r.property.serviceItemId, parentFlag: r.property.variantOf?.serviceItemId }));
  return out;
}

/** Aktif, SIMULATED olmayan okumalar: `${rollId}:${stepId}:${phase}` → okuma. */
async function loadReadings(works: Array<{ rollId: string; workOrderStepId: string }>, db: Db) {
  const out = new Map<string, { id: string; meters: Prisma.Decimal; createdAt: Date }>();
  /** H7 hizmet anı: `${rollId}:${stepId}` → adımın İLK OUT okuması (düzeltme kaydırmaz; son REOPEN'dan sonrası). */
  const firstOut = new Map<string, Date>();
  if (works.length === 0) return { out, firstOut };
  const rows = await db.rollMeterReading.findMany({
    where: {
      source: { not: MachineDataSource.SIMULATED },
      rollId: { in: [...new Set(works.map((w) => w.rollId))] },
      workOrderStepId: { in: [...new Set(works.map((w) => w.workOrderStepId))] },
    },
    select: { id: true, rollId: true, workOrderStepId: true, phase: true, meters: true, createdAt: true, revokedAt: true, revokeReason: true },
    orderBy: { createdAt: "asc" },
  });
  const reopenedAt = new Map<string, Date>();
  for (const r of rows) {
    const k = `${r.rollId}:${r.workOrderStepId}`;
    if (r.revokeReason === KURSUN_REOPEN_REASON && r.revokedAt && r.revokedAt > (reopenedAt.get(k) ?? new Date(0))) reopenedAt.set(k, r.revokedAt);
  }
  for (const r of rows) {
    const k = `${r.rollId}:${r.workOrderStepId}`;
    if (r.revokedAt === null) out.set(`${k}:${r.phase}`, { id: r.id, meters: r.meters, createdAt: r.createdAt });
    if (r.phase !== MeterPhase.OUT || firstOut.has(k)) continue;
    // Yeniden açılan adım yeni hizmettir: REOPEN damgasından önceki okumalar hizmet anı sayılmaz.
    const cut = reopenedAt.get(k);
    if (!cut || r.createdAt > cut) firstOut.set(k, r.createdAt);
  }
  return { out, firstOut };
}

/** H7 seçenekleri — verilmezse H6 davranışı (OUT → IN → DECLARED, uyarısız, hizmet anına fiyat). */
export interface ServiceResolveOptions {
  /** Faturalanan metre tabanı: OUT zinciri OUT → IN → DECLARED; IN zinciri IN → DECLARED; DECLARED yalnız beyan;
   *  MAX_DECLARED = OUT zinciriyle keşif + parti metresine (kural 1–2, `meter-compare.helper`) oranla dağıtım. */
  meterBasis?: "OUT" | "IN" | "DECLARED" | "MAX_DECLARED";
  /** Seçilen okuma yoksa: beyanla yaz + uyar ya da işi taslaktan çıkar (uyarıyla). */
  missingMeter?: "DECLARED_WITH_WARNING" | "BLOCK_LINE";
  /** Verilirse bütün fiyatlar bu ana çözülür (priceDate = DISPATCH_DAY). */
  priceAsOf?: Date;
  /** K14: gram fiyatı tabanı; verilmezse fabrika ayarı okunur (`readFinanceKursunGramPriceBasis`). */
  gramPriceBasis?: KursunGramPriceBasis;
  /** H8b dönem taslağı (DISPATCH_DAY): işin topu → kendi sevk anı; `priceAsOf`tan önce gelir. */
  priceAsOfByRoll?: Map<string, Date>;
  /** Zaten faturalanmış iş — `${rollId}:${serviceItemId}:${workOrderStepId}`; satıra ve bağa girmez. */
  billedKeys?: Set<string>;
  /** F1: kümede çocuğu olsa da KENDİSİ sevk edilen toplar — bayrak işinde kalan parçasını kendisi taşır. */
  shippedRollIds?: Set<string>;
  /** Brode fiyat birimi ayarı; verilmezse METER (bugünkü davranış). */
  brodeUnit?: ServiceQtyUnit;
  /** F3 `finance.serviceBilling.stepWorks`: adım işi kaynağı; verilmezse kapalı (bugünkü çıktı bayt-aynı). */
  stepWorks?: boolean;
  /** F4 `finance.serviceBilling.weavingWorks`: dokuma işi kaynağı (doğan top); verilmezse kapalı (bayt-aynı). */
  weavingWorks?: boolean;
}

/** Bağ anahtarı — kısmi unique (rollId, serviceItemId, workOrderStepId) ile aynı üçlü. */
export function serviceWorkKey(w: { rollId: string; serviceItemId: string | null; workOrderStepId: string | null }): string {
  return `${w.rollId}:${w.serviceItemId ?? "-"}:${w.workOrderStepId ?? "-"}`;
}

/** K4 uyarı metni — bekçi aynı cümleyi arar. */
export function simulatedCutWarning(count: number): string {
  return `${count} Tambur kesiminin metresi simüle ölçüm — süpervizör düzeltmesi gerekli; faturaya alınmadı.`;
}

/** S6 uyarı metni (B2 simüle uyarısının kanalı: `warnings` → önizleme + taslak notu); bekçi aynı cümleyi arar. */
export function manualMeterWarning(lineName: string, count: number): string {
  return `"${lineName}" satırında ${count} işin metresi elle ölçüm (operatör girişi) — faturaya alındı, kontrol edin.`;
}

/** S6: elle (OPERATOR) okunmuş TAMBUR kesim metresi (CUT) — kurşun okumaları işaretlenmez (bugünkü uyarı yüzeyi). */
async function loadManualReadingIds(works: ServiceRollWork[], db: Db): Promise<Set<string>> {
  const ids = [...new Set(works.filter((w) => w.meterBasis === "CUT").map((w) => w.readingId).filter((v): v is string => v !== null))];
  if (ids.length === 0) return new Set();
  const rows = await db.rollMeterReading.findMany({ where: { id: { in: ids }, source: MachineDataSource.OPERATOR }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

/** H7: faturalanmış iş düşer; ölçümsüz iş ayara göre uyarıyla yazılır ya da taslaktan çıkar. */
function filterBillableWorks(all: ServiceRollWork[], opt: ServiceResolveOptions, basis: string, warnings: string[]): ServiceRollWork[] {
  const works = all.filter((w) => !(opt.billedKeys && w.serviceItemId && opt.billedKeys.has(serviceWorkKey(w))));
  if (!opt.missingMeter || basis === "DECLARED") return works;
  const unmeasured = works.filter((w) => w.serviceItemId && w.meterBasis === "DECLARED");
  if (unmeasured.length === 0) return works;
  const block = opt.missingMeter === "BLOCK_LINE";
  warnings.push(block
    ? `${unmeasured.length} işin sayaç okuması yok — faturaya alınmadı (okuma girilince faturalanır).`
    : `${unmeasured.length} işin sayaç okuması yok — bildirilen metreyle faturalandı, kontrol edin.`);
  return block ? works.filter((w) => !unmeasured.includes(w)) : works;
}

/** Metresi bulunamayan adım işi (okuma, çıkış/giriş ve top metresi 0) — sessiz düşmez. */
export function zeroMeterStepWarning(count: number): string {
  return `${count} adım işinin metresi bulunamadı (okuma ve top metresi 0) — faturaya alınmadı, topu kontrol edin.`;
}

/** F3 uyarı metni — bekçi aynı cümleyi arar. */
export function simulatedStepWarning(count: number): string {
  return `${count} adım işinin metresi yalnız simüle ölçüm — süpervizör düzeltmesi gerekli; faturaya alınmadı.`;
}

/** Kurşun dışı bayrak işleri (H10) iş satırına; K4 (D4-B2): simüle kesim metresi düşer, uyarı taslakta/önizlemede görünür. */
async function loadFlagWorks(rollIds: string[], basis: "OUT" | "IN" | "DECLARED", ctx: { shippedRollIds?: Set<string>; brodeUnit: ServiceQtyUnit; db: Db; warnings: string[]; partyScaleWith?: ServiceRollWork[] }): Promise<{ works: ServiceRollWork[]; claims: Array<{ rollId: string; propertyId: string }> }> {
  const flag = await listFlagServiceWorks(rollIds, basis, { shippedRollIds: ctx.shippedRollIds, db: ctx.db });
  if (flag.simulatedCutRollIds.length > 0) ctx.warnings.push(simulatedCutWarning(flag.simulatedCutRollIds.length));
  // Adımsız bayrak işi (CUT/DECLARED) özelliğiyle adım işini bastırır (F3 bayrak önceliği).
  const claims = flag.works.filter((f) => f.workOrderStepId === null).map((f) => ({ rollId: f.rollId, propertyId: f.propertyId }));
  // MAX_DECLARED: kurşun işleriyle birlikte parti metresine ölçeklenir (varsayılan tabanlarda `partyScaleWith` yok).
  const works = await withPartyScale(ctx.partyScaleWith, flag.works.map((f): ServiceRollWork => {
    const qtyUnit = serviceWorkUnit(f.propertyCode, ctx.brodeUnit);
    return markFlagFamily<ServiceRollWork>({
      rollId: f.rollId, workOrderStepId: f.workOrderStepId, source: "PROPERTY", valueId: f.valueId, valueName: f.propertyName, gramajFrom: "NONE",
      ...(f.valueName ? { tierLabel: `${f.propertyName} ${f.valueName}` } : {}),
      serviceItemId: f.serviceItemId, meters: f.meters, meterBasis: f.meterBasis, readingId: f.readingId, serviceAt: f.serviceAt, unitPrice: null,
      qtyUnit, quantity: serviceWorkQuantity(f, qtyUnit),
    }, f.propertyId);
  }), { brodeUnit: ctx.brodeUnit, db: ctx.db, loadReadings });
  return { works, claims };
}

/** F3 adım işleri iş satırına (metre birimi, kademesiz); kurşun/bayrak işinin adımı ve adımsız bayrak özelliği önceliklidir. */
async function loadStepWorks(rollIds: string[], basis: "OUT" | "IN" | "DECLARED", ctx: { claimed: ServiceRollWork[]; flagClaims: Array<{ rollId: string; propertyId: string }>; db: Db; warnings: string[] }): Promise<ServiceRollWork[]> {
  // Öncelik top başına (top:adım) — aynı sevkteki başka topun bayrağı bu topun adım işini bastırmaz.
  const claimedWorks = ctx.claimed.flatMap((w) => (w.workOrderStepId ? [{ rollId: w.rollId, workOrderStepId: w.workOrderStepId }] : []));
  const step = await listStepServiceWorks(rollIds, basis, { db: ctx.db, claimedWorks, flagClaims: ctx.flagClaims });
  if (step.simulatedCount > 0) ctx.warnings.push(simulatedStepWarning(step.simulatedCount));
  if (step.zeroMeterCount > 0) ctx.warnings.push(zeroMeterStepWarning(step.zeroMeterCount));
  return step.works.map((s): ServiceRollWork => ({
    rollId: s.rollId, workOrderStepId: s.workOrderStepId, source: "STEP", valueId: null, valueName: s.categoryName, gramajFrom: "NONE",
    serviceItemId: s.serviceItemId, meters: s.meters, meterBasis: s.meterBasis, readingId: s.readingId, serviceAt: s.serviceAt, unitPrice: null,
    qtyUnit: "METER", quantity: s.meters,
  }));
}

/** Fiyat hizmet anına çözülür (geç taslak eski fiyatı korur); aynı an tek sorgu. Birim uyuşmazsa fiyat yok. */
/** İşin fiyat anı — kalem tarifesi ve (K14 SERVICE_DATE) gram fiyatı sürümü AYNI anı okur. */
function servicePriceAt(opt: ServiceResolveOptions): (w: ServiceRollWork) => number {
  return (w) => (opt.priceAsOfByRoll?.get(w.rollId) ?? opt.priceAsOf ?? w.serviceAt).getTime();
}

/**
 * Fiyat hizmet anına çözülür (geç taslak eski fiyatı korur): kalem fiyatı + kademe tablosu (aynı an, tek sorgu
 * kümesi) + kurşun gram adayı → sıra `pickServicePrice`te. Birim uyuşmayan tarife satırı yok sayılır. Döner: K5
 * kademesi tabloda olmayan işler (kalem başına uyarı).
 */
async function applyServicePrices(
  works: ServiceRollWork[],
  ctx: { opt: ServiceResolveOptions; currency: Currency; customerId: string | null; db: Db; warnings: string[] },
): Promise<Set<ServiceRollWork>> {
  const priceAt = servicePriceAt(ctx.opt);
  const priced = works.filter((w) => w.serviceItemId !== null);
  const basis = ctx.opt.gramPriceBasis ?? await readFinanceKursunGramPriceBasis(ctx.db);
  const gram = await loadKursunGramCandidates(priced, { currency: ctx.currency, customerId: ctx.customerId, db: ctx.db, basis, priceAt });
  const byAt = new Map<number, ServiceRollWork[]>();
  for (const w of priced) byAt.set(priceAt(w), [...(byAt.get(priceAt(w)) ?? []), w]);
  const tierMissing = new Set<ServiceRollWork>();
  let gramPriced = 0;
  let late = 0;
  let customerLater = 0;
  for (const [at, group] of byAt) {
    const itemIds = group.map((w) => w.serviceItemId!);
    const prices = await resolveItemPricesFor({ itemIds, kind: PriceKind.SALE, currency: ctx.currency, customerId: ctx.customerId, asOf: new Date(at), db: ctx.db });
    const tiers = await loadServiceTierPrices({ itemIds, currency: ctx.currency, customerId: ctx.customerId, at: new Date(at), db: ctx.db });
    for (const w of group) {
      const hit = prices.get(w.serviceItemId!);
      const slot = w.valueId ? tiers.byKey.get(tierKey(w.serviceItemId!, w.valueId)) : undefined;
      const unitOk = (r: { priceUnit: ServiceQtyUnit | null } | undefined) => !!r && priceUnitMatches(r.priceUnit, w.qtyUnit);
      const pick = pickServicePrice({
        customerTier: unitOk(slot?.customer) ? slot!.customer!.price : null,
        generalTier: unitOk(slot?.general) ? slot!.general!.price : null,
        gram: gram.get(w) ?? null,
        item: hit && priceUnitMatches(hit.priceUnit, w.qtyUnit) ? hit.price : null,
        itemHasTiers: tiers.itemsWithTiers.has(w.serviceItemId!),
        valueInTable: !!slot,
      });
      w.unitPrice = pick.unitPrice;
      if (pick.tierMissing) tierMissing.add(w);
      if (pick.gram) {
        w.gramLabel = kursunGramLineLabel(w.valueName, pick.gram.amount);
        gramPriced++;
        if (pick.gram.late) late++;
        if (pick.gram.customerLater) customerLater++;
      } else if (pick.source === "CUSTOMER_TIER" || pick.source === "TIER") {
        w.gramLabel = w.source === "PROPERTY" ? w.tierLabel : kursunTierLineLabel(w.valueName);
      }
    }
  }
  if (basis === "INVOICE_DATE" && gramPriced > 0) ctx.warnings.push(gramPriceCurrentWarning(gramPriced));
  if (late > 0) ctx.warnings.push(gramPriceEnteredLaterWarning(late));
  if (customerLater > 0) ctx.warnings.push(gramPriceCustomerLaterWarning(customerLater));
  return tierMissing;
}

/** İşlerin hizmet kartları (kod + ad) — satır grubunun başlığı. */
async function loadServiceItemsById(works: ServiceRollWork[], db: Db): Promise<Map<string, { id: string; code: string; name: string }>> {
  const items = await db.serviceItem.findMany({
    where: { id: { in: [...new Set(works.map((w) => w.serviceItemId).filter((v): v is string => v !== null))] } },
    select: { id: true, code: true, name: true },
  });
  return new Map(items.map((i) => [i.id, i]));
}

/**
 * Toplara yapılan kurşun ve bayrak tipi (H10) işleri hizmet kalemine ve müşteri fiyatına çözer.
 * Yazmaz; eşleşmeyen top ve fiyatsız kalem `warnings`te görünür (sessiz düşmez).
 */
export async function resolveServiceItemsForRolls(params: {
  rollIds: string[];
  customerId: string | null;
  currency: Currency;
  options?: ServiceResolveOptions;
  /** K3b: fatura tx'i — kapı okuması tx'in kendi bağlantısında (havuzda ikinci bağlantı beklemez). */
  db?: Db;
}): Promise<ServiceResolution> {
  const db = params.db ?? prisma;
  const opt = params.options ?? {};
  const rollIds = [...new Set(params.rollIds)].filter(Boolean);
  const warnings: string[] = [];
  if (rollIds.length === 0) return { lines: [], works: [], warnings };

  const apps = await listKursunApplications({ rollIds }, db);
  // Gramajı bilinmeyen (kâğıt) iş → iş emri hedefi, uyarıyla.
  const targetByWo = new Map<string, Awaited<ReturnType<typeof readKursunTarget>>>();
  for (const wo of new Set(apps.filter((a) => a.valueId === null).map((a) => a.workOrderId))) targetByWo.set(wo, await readKursunTarget(wo, db));

  const draft = apps.map((a) => {
    const target = a.valueId === null ? targetByWo.get(a.workOrderId) ?? null : null;
    const valueId = a.valueId ?? target?.valueId ?? null;
    const gramajFrom: ServiceGramajSource = a.valueId ? "APPLIED" : target ? "WO_TARGET" : "NONE";
    return { a, valueId, valueName: a.valueId ? a.valueName : target?.valueName ?? a.valueName, gramajFrom };
  });
  const valueMap = await loadValueServiceMap([...new Set(draft.map((d) => d.valueId).filter((v): v is string => v !== null))], db);
  const { out: readings, firstOut } = await loadReadings(apps, db);
  const basis: "OUT" | "IN" | "DECLARED" = opt.meterBasis === undefined || opt.meterBasis === "MAX_DECLARED" ? "OUT" : opt.meterBasis;

  const allWorks: ServiceRollWork[] = draft.map(({ a, valueId, valueName, gramajFrom }) => {
    const out = basis === "OUT" ? readings.get(`${a.rollId}:${a.workOrderStepId}:${MeterPhase.OUT}`) : undefined;
    const inn = basis !== "DECLARED" ? readings.get(`${a.rollId}:${a.workOrderStepId}:${MeterPhase.IN}`) : undefined;
    const picked = out ? { basis: "OUT" as const, r: out } : inn ? { basis: "IN" as const, r: inn } : null;
    return {
      rollId: a.rollId, workOrderStepId: a.workOrderStepId, source: a.source, valueId, valueName, gramajFrom,
      serviceItemId: valueId ? valueMap.get(valueId) ?? null : null,
      meters: picked ? picked.r.meters : a.meters,
      meterBasis: picked ? picked.basis : "DECLARED",
      readingId: picked ? picked.r.id : null,
      serviceAt: firstOut.get(`${a.rollId}:${a.workOrderStepId}`) ?? a.at,
      unitPrice: null,
      qtyUnit: "METER" as const,
      quantity: picked ? picked.r.meters : a.meters,
    };
  });
  const flag = await loadFlagWorks(rollIds, basis, { shippedRollIds: opt.shippedRollIds, brodeUnit: opt.brodeUnit ?? "METER", db, warnings, partyScaleWith: opt.meterBasis === "MAX_DECLARED" ? allWorks : undefined });
  const stepWorks = opt.stepWorks ? await loadStepWorks(rollIds, basis, { claimed: [...allWorks, ...flag.works], flagClaims: flag.claims, db, warnings }) : [];
  const weavingWorks = opt.weavingWorks ? await loadWeavingRollWorks(rollIds, { keyOf: serviceWorkKey, claimed: [...allWorks, ...flag.works, ...stepWorks], db, warnings }) : [];
  // F9: bizim hatamızdan yeniden işlem İE'sinin işi (adım · bayrak · kurşun) faturaya girmez, uyarıyla görünür.
  const rework = await splitReworkOurFaultWorks([...allWorks, ...flag.works, ...stepWorks], db);
  if (rework.excluded.length > 0) warnings.push(reworkOurFaultWarning(rework.excluded.length));
  const billable = filterBillableWorks([...rework.billable, ...weavingWorks], opt, basis, warnings);
  // Adet/vuruşu eksik iş faturaya alınmaz (uydurma miktar yok); birim başına tek uyarı.
  const unknown = billable.filter((w) => w.serviceItemId && w.quantity === null);
  for (const u of new Set(unknown.map((w) => w.qtyUnit))) warnings.push(missingQuantityWarning(u, unknown.filter((w) => w.qtyUnit === u).length));
  const works = billable.filter((w) => !unknown.includes(w));

  const tierMissing = await applyServicePrices(works, { opt, currency: params.currency, customerId: params.customerId, db, warnings });

  const itemById = await loadServiceItemsById(works, db);
  const manualReadings = await loadManualReadingIds(works, db);
  const groups = new Map<string, ServiceLine & { sum: Prisma.Decimal }>();
  const tierMissingByName = new Map<string, number>();
  for (const w of works) {
    if (w.gramajFrom === "WO_TARGET") warnings.push(`Gramajı bilinmeyen iş ${TERIM.terbiyeIsEmri.cekimKucuk.ilgi} hedefinden (${w.valueName}) fiyatlandı — topu kontrol edin.`);
    if (!w.serviceItemId) { warnings.push(`"${w.valueName}" için hizmet kalemi eşlenmemiş — top fiyatlanmadı.`); continue; }
    const item = itemById.get(w.serviceItemId)!;
    if (tierMissing.has(w)) tierMissingByName.set(item.name, (tierMissingByName.get(item.name) ?? 0) + 1);
    else if (w.unitPrice === null) warnings.push(w.qtyUnit === "METER"
      ? `"${item.name}" için ${params.currency} satış fiyatı yok — satır fiyatsız.`
      : `"${item.name}" için ${params.currency} satış fiyatı yok ya da birimi seçilen brode fiyat birimiyle aynı değil — satır fiyatsız.`);
    const key = `${w.serviceItemId}:${w.unitPrice?.toString() ?? "-"}:${w.qtyUnit}:${w.gramLabel ?? ""}`;
    const g = groups.get(key) ?? {
      serviceItemId: w.serviceItemId, code: item.code, name: item.name, ...(w.gramLabel ? { label: w.gramLabel } : {}), unitPrice: w.unitPrice?.toString() ?? null,
      currency: params.currency, quantity: "0", unit: w.qtyUnit, rollCount: 0, rollIds: [], manualMeterRollCount: 0, sum: new Prisma.Decimal(0),
    };
    g.sum = g.sum.plus(w.quantity!);
    if (w.readingId && manualReadings.has(w.readingId)) g.manualMeterRollCount += 1;
    g.rollCount += 1;
    g.rollIds.push(w.rollId);
    groups.set(key, g);
  }
  const lines = [...groups.values()]
    .map(({ sum, ...l }) => ({ ...l, quantity: sum.toFixed(3) }))
    .sort((x, y) => x.code.localeCompare(y.code, "tr") || (x.unitPrice ?? "").localeCompare(y.unitPrice ?? ""));
  for (const [name, n] of tierMissingByName) warnings.push(tierMissingWarning(name, n));
  for (const l of lines) if (l.manualMeterRollCount > 0) warnings.push(manualMeterWarning(l.name, l.manualMeterRollCount));
  return { lines, works, warnings: [...new Set(warnings)], ...(rework.excluded.length > 0 ? { excludedWorks: rework.excluded } : {}) };
}
