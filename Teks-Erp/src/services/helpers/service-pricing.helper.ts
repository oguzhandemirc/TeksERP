// =============================================================================
// HİZMET FİYATI ÇÖZÜCÜSÜ — tek kaynak (Gülkesim dalga 2 · H6, karar belgesi §5)
// =============================================================================
// Soru: "bu toplara yapılan iş müşteriye hangi hizmet kalemiyle, kaça kesilir?"
// Zincir: gramaj `listKursunApplications` (process-summary; TABLET + KAĞIT) → yoksa
// iş emri hedefi (uyarıyla) → `value.serviceItemId` → `property.serviceItemId` →
// ana bayrağın (variantOf) eşlemesi. Fiyat `resolveItemPricesFor(SALE)`, hizmet
// anına (as-of) çözülür: istisna genelden önce, damgalı eski sürüm eski işe.
// ⚠️ `FinishingRate` BURADA OKUNMAZ: o bizim ödediğimiz terbiye/fason MALİYETİDİR,
// gelir değildir — `test_hizmet_fiyati` AST taraması ikinci kopyayı ve okumayı yasaklar.
// =============================================================================
import { Currency, MachineDataSource, MeterPhase, Prisma, PriceKind } from "@prisma/client";
import prisma from "../../lib/prisma";
import { TERIM } from "../../constants/terim";
import { resolveItemPricesFor } from "../item-price.service";
import { listKursunApplications, readKursunTarget, type KursunApplication } from "./process-summary.helper";

export type ServiceMeterBasis = "OUT" | "IN" | "DECLARED";
export type ServiceGramajSource = "APPLIED" | "WO_TARGET" | "NONE";

/** Tek iş (top × adım) — fatura bağı (H7) bu satırdan doğar. */
export interface ServiceRollWork {
  rollId: string;
  workOrderStepId: string;
  source: KursunApplication["source"];
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
  if (works.length === 0) return out;
  const rows = await prisma.rollMeterReading.findMany({
    where: {
      revokedAt: null,
      source: { not: MachineDataSource.SIMULATED },
      rollId: { in: [...new Set(works.map((w) => w.rollId))] },
      workOrderStepId: { in: [...new Set(works.map((w) => w.workOrderStepId))] },
    },
    select: { id: true, rollId: true, workOrderStepId: true, phase: true, meters: true, createdAt: true },
  });
  for (const r of rows) out.set(`${r.rollId}:${r.workOrderStepId}:${r.phase}`, { id: r.id, meters: r.meters, createdAt: r.createdAt });
  return out;
}

/**
 * Toplara yapılan kurşun işini hizmet kalemine ve müşteri fiyatına çözer.
 * Yazmaz; eşleşmeyen top ve fiyatsız kalem `warnings`te görünür (sessiz düşmez).
 */
export async function resolveServiceItemsForRolls(params: {
  rollIds: string[];
  customerId: string | null;
  currency: Currency;
}): Promise<ServiceResolution> {
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
  const readings = await loadReadings(apps);

  const works: ServiceRollWork[] = draft.map(({ a, valueId, valueName, gramajFrom }) => {
    const out = readings.get(`${a.rollId}:${a.workOrderStepId}:${MeterPhase.OUT}`);
    const inn = readings.get(`${a.rollId}:${a.workOrderStepId}:${MeterPhase.IN}`);
    const picked = out ? { basis: "OUT" as const, r: out } : inn ? { basis: "IN" as const, r: inn } : null;
    return {
      rollId: a.rollId, workOrderStepId: a.workOrderStepId, source: a.source, valueId, valueName, gramajFrom,
      serviceItemId: valueId ? valueMap.get(valueId) ?? null : null,
      meters: picked ? picked.r.meters : a.meters,
      meterBasis: picked ? picked.basis : "DECLARED",
      readingId: picked ? picked.r.id : null,
      serviceAt: out ? out.createdAt : a.at,
      unitPrice: null,
    };
  });

  // Fiyat hizmet anına çözülür (geç taslak eski fiyatı korur); aynı an tek sorgu.
  const byAt = new Map<number, ServiceRollWork[]>();
  for (const w of works) if (w.serviceItemId) byAt.set(w.serviceAt.getTime(), [...(byAt.get(w.serviceAt.getTime()) ?? []), w]);
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
