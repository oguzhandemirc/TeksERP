// =============================================================================
// HİZMET FİYATI ÇÖZÜCÜSÜ — tek kaynak (Gülkesim dalga 2 · H6, karar belgesi §5)
// =============================================================================
// Soru: "bu toplara yapılan iş müşteriye hangi hizmet kalemiyle, kaça kesilir?"
// Zincir: gramaj `listKursunApplications` (process-summary; TABLET + KAĞIT) → yoksa
// iş emri hedefi (uyarıyla) → `value.serviceItemId` → `property.serviceItemId` →
// ana bayrağın (variantOf) eşlemesi. Kurşun DIŞI bayrak işleri (Tambur, etek, brode — H10)
// `listFlagServiceWorks`ten, kalem `property.serviceItemId`ten gelir. Fiyat `resolveItemPricesFor(SALE)`, hizmet
// anına (as-of) çözülür: istisna genelden önce, damgalı eski sürüm eski işe.
// ⚠️ `FinishingRate` BURADA OKUNMAZ: o bizim ödediğimiz terbiye/fason MALİYETİDİR,
// gelir değildir — `test_hizmet_fiyati` AST taraması ikinci kopyayı ve okumayı yasaklar.
// =============================================================================
import { Currency, MachineDataSource, MeterPhase, Prisma, PriceKind } from "@prisma/client";
import prisma from "../../lib/prisma";
import { TERIM } from "../../constants/terim";
import { resolveItemPricesFor } from "../item-price.service";
import { listKursunApplications, readKursunTarget, type KursunApplication } from "./process-summary.helper";
import { listFlagServiceWorks } from "./service-flag-work.helper";

/** `kursun-qc.service` reopenStep damga sebebi — yeniden açılan adım yeni hizmettir. */
const KURSUN_REOPEN_REASON = "KURSUN_REOPEN";

export type ServiceMeterBasis = "OUT" | "IN" | "DECLARED" | "CUT" | "RECEIVED";
export type ServiceGramajSource = "APPLIED" | "WO_TARGET" | "NONE";

/** Tek iş (top × adım) — fatura bağı (H7) bu satırdan doğar. */
export interface ServiceRollWork {
  rollId: string;
  /** Bayrak işinde adım bilinmeyebilir (kesim depoda, ölçümsüz iş) — bağ anahtarı NULLS NOT DISTINCT. */
  workOrderStepId: string | null;
  /** PROPERTY = kurşun dışı bayrak işi (H10). */
  source: KursunApplication["source"] | "PROPERTY";
  valueId: string | null;
  valueName: string;
  gramajFrom: ServiceGramajSource;
  serviceItemId: string | null;
  meters: Prisma.Decimal;
  meterBasis: ServiceMeterBasis;
  readingId: string | null;
  serviceAt: Date;
  unitPrice: Prisma.Decimal | null;
}

/** Hizmet kalemi × birim fiyat grubu (taslak satırı). */
export interface ServiceLine {
  serviceItemId: string;
  code: string;
  name: string;
  unitPrice: string | null;
  currency: Currency;
  quantity: string;
  rollCount: number;
  rollIds: string[];
}

export interface ServiceResolution {
  lines: ServiceLine[];
  works: ServiceRollWork[];
  warnings: string[];
}

/** Gramaj değerinden hizmet kalemi: önce değer, sonra özellik, sonra ana bayrak. */
async function loadValueServiceMap(valueIds: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (valueIds.length === 0) return out;
  const rows = await prisma.fabricPropertyValue.findMany({
    where: { id: { in: valueIds } },
    select: { id: true, serviceItemId: true, property: { select: { serviceItemId: true, variantOf: { select: { serviceItemId: true } } } } },
  });
  for (const r of rows) out.set(r.id, r.serviceItemId ?? r.property.serviceItemId ?? r.property.variantOf?.serviceItemId ?? null);
  return out;
}

/** Aktif, SIMULATED olmayan okumalar: `${rollId}:${stepId}:${phase}` → okuma. */
async function loadReadings(works: Array<{ rollId: string; workOrderStepId: string }>) {
  const out = new Map<string, { id: string; meters: Prisma.Decimal; createdAt: Date }>();
  /** H7 hizmet anı: `${rollId}:${stepId}` → adımın İLK OUT okuması (düzeltme kaydırmaz; son REOPEN'dan sonrası). */
  const firstOut = new Map<string, Date>();
  if (works.length === 0) return { out, firstOut };
  const rows = await prisma.rollMeterReading.findMany({
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
  /** Faturalanan metre tabanı: OUT zinciri OUT → IN → DECLARED; IN zinciri IN → DECLARED; DECLARED yalnız beyan. */
  meterBasis?: "OUT" | "IN" | "DECLARED";
  /** Seçilen okuma yoksa: beyanla yaz + uyar ya da işi taslaktan çıkar (uyarıyla). */
  missingMeter?: "DECLARED_WITH_WARNING" | "BLOCK_LINE";
  /** Verilirse bütün fiyatlar bu ana çözülür (priceDate = DISPATCH_DAY). */
  priceAsOf?: Date;
  /** H8b dönem taslağı (DISPATCH_DAY): işin topu → kendi sevk anı; `priceAsOf`tan önce gelir. */
  priceAsOfByRoll?: Map<string, Date>;
  /** Zaten faturalanmış iş — `${rollId}:${serviceItemId}:${workOrderStepId}`; satıra ve bağa girmez. */
  billedKeys?: Set<string>;
  /** F1: kümede çocuğu olsa da KENDİSİ sevk edilen toplar — bayrak işinde kalan parçasını kendisi taşır. */
  shippedRollIds?: Set<string>;
}

/** Bağ anahtarı — kısmi unique (rollId, serviceItemId, workOrderStepId) ile aynı üçlü. */
export function serviceWorkKey(w: { rollId: string; serviceItemId: string | null; workOrderStepId: string | null }): string {
  return `${w.rollId}:${w.serviceItemId ?? "-"}:${w.workOrderStepId ?? "-"}`;
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

/**
 * Toplara yapılan kurşun ve bayrak tipi (H10) işleri hizmet kalemine ve müşteri fiyatına çözer.
 * Yazmaz; eşleşmeyen top ve fiyatsız kalem `warnings`te görünür (sessiz düşmez).
 */
export async function resolveServiceItemsForRolls(params: {
  rollIds: string[];
  customerId: string | null;
  currency: Currency;
  options?: ServiceResolveOptions;
}): Promise<ServiceResolution> {
  const opt = params.options ?? {};
  const rollIds = [...new Set(params.rollIds)].filter(Boolean);
  const warnings: string[] = [];
  if (rollIds.length === 0) return { lines: [], works: [], warnings };

  const apps = await listKursunApplications({ rollIds });
  // Gramajı bilinmeyen (kâğıt) iş → iş emri hedefi, uyarıyla.
  const targetByWo = new Map<string, Awaited<ReturnType<typeof readKursunTarget>>>();
  for (const wo of new Set(apps.filter((a) => a.valueId === null).map((a) => a.workOrderId))) targetByWo.set(wo, await readKursunTarget(wo));

  const draft = apps.map((a) => {
    const target = a.valueId === null ? targetByWo.get(a.workOrderId) ?? null : null;
    const valueId = a.valueId ?? target?.valueId ?? null;
    const gramajFrom: ServiceGramajSource = a.valueId ? "APPLIED" : target ? "WO_TARGET" : "NONE";
    return { a, valueId, valueName: a.valueId ? a.valueName : target?.valueName ?? a.valueName, gramajFrom };
  });
  const valueMap = await loadValueServiceMap([...new Set(draft.map((d) => d.valueId).filter((v): v is string => v !== null))]);
  const { out: readings, firstOut } = await loadReadings(apps);
  const basis = opt.meterBasis ?? "OUT";

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
    };
  });
  const flagWorks: ServiceRollWork[] = (await listFlagServiceWorks(rollIds, basis, { shippedRollIds: opt.shippedRollIds })).map((f) => ({
    rollId: f.rollId, workOrderStepId: f.workOrderStepId, source: "PROPERTY", valueId: null, valueName: f.propertyName, gramajFrom: "NONE",
    serviceItemId: f.serviceItemId, meters: f.meters, meterBasis: f.meterBasis, readingId: f.readingId, serviceAt: f.serviceAt, unitPrice: null,
  }));
  const works = filterBillableWorks([...allWorks, ...flagWorks], opt, basis, warnings);

  // Fiyat hizmet anına çözülür (geç taslak eski fiyatı korur); aynı an tek sorgu.
  const byAt = new Map<number, ServiceRollWork[]>();
  const priceAt = (w: ServiceRollWork) => (opt.priceAsOfByRoll?.get(w.rollId) ?? opt.priceAsOf ?? w.serviceAt).getTime();
  for (const w of works) if (w.serviceItemId) byAt.set(priceAt(w), [...(byAt.get(priceAt(w)) ?? []), w]);
  for (const [at, group] of byAt) {
    const prices = await resolveItemPricesFor({
      itemIds: group.map((w) => w.serviceItemId!), kind: PriceKind.SALE, currency: params.currency,
      customerId: params.customerId, asOf: new Date(at),
    });
    for (const w of group) w.unitPrice = prices.get(w.serviceItemId!)?.price ?? null;
  }

  const items = await prisma.item.findMany({
    where: { id: { in: [...new Set(works.map((w) => w.serviceItemId).filter((v): v is string => v !== null))] } },
    select: { id: true, code: true, name: true },
  });
  const itemById = new Map(items.map((i) => [i.id, i]));
  const groups = new Map<string, ServiceLine & { sum: Prisma.Decimal }>();
  for (const w of works) {
    if (w.gramajFrom === "WO_TARGET") warnings.push(`Gramajı bilinmeyen iş ${TERIM.terbiyeIsEmri.cekimKucuk.ilgi} hedefinden (${w.valueName}) fiyatlandı — topu kontrol edin.`);
    if (!w.serviceItemId) { warnings.push(`"${w.valueName}" için hizmet kalemi eşlenmemiş — top fiyatlanmadı.`); continue; }
    const item = itemById.get(w.serviceItemId)!;
    if (w.unitPrice === null) warnings.push(`"${item.name}" için ${params.currency} satış fiyatı yok — satır fiyatsız.`);
    const key = `${w.serviceItemId}:${w.unitPrice?.toString() ?? "-"}`;
    const g = groups.get(key) ?? {
      serviceItemId: w.serviceItemId, code: item.code, name: item.name, unitPrice: w.unitPrice?.toString() ?? null,
      currency: params.currency, quantity: "0", rollCount: 0, rollIds: [], sum: new Prisma.Decimal(0),
    };
    g.sum = g.sum.plus(w.meters);
    g.rollCount += 1;
    g.rollIds.push(w.rollId);
    groups.set(key, g);
  }
  const lines = [...groups.values()]
    .map(({ sum, ...l }) => ({ ...l, quantity: sum.toFixed(3) }))
    .sort((x, y) => x.code.localeCompare(y.code, "tr") || (x.unitPrice ?? "").localeCompare(y.unitPrice ?? ""));
  return { lines, works, warnings: [...new Set(warnings)] };
}
