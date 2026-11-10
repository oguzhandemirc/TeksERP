// =============================================================================
// İŞ EMRİ SARFİYATI — okuma yüzeyi (panel İE detayı "Sarfiyat" kartı; 2026-11-10 GK sarf K5)
// =============================================================================
// Soru: "bu iş emrinde şu ana kadar ne kadar poşet / kurşun ipi harcadık, kaça mal oldu?"
// Kaynak YALNIZ sarf defteri (`consumable_movements`): canlı tüketim satırları (ters kaydı olanlar hariç) —
// üretim izi İE'nin adımındaysa (kurşun/kuşak) ya da tambur çıktı topu İE'nin adımında doğduysa (PER_ROLL).
// Maliyet `consumable-cost.helper` (ağırlıklı ortalama, bilinmeyen null); maliyet/fiyat alanları yalnız
// `canCost` iken yanıta GİRER (OPT-IN). Kurşun gramı ayrı stok değildir: kumaş metresi × gramaj (gr/m).
// Müşteri tutarı (gram fiyatı × gram) yalnız finans açıkken, TL fiyatla ve BUGÜNKÜ gram fiyatıyla (tahmin).
// =============================================================================
import { ConsumableMovementKind, ConsumableNormBasis, Prisma, RollOperationType } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { consumptionCostsTry } from "./helpers/consumable-cost.helper";
import { consumableNormHistory, isCostRateValidAt, pickNormsForValue } from "./helpers/cost-rate-validity.helper";
import { pickServiceItemId } from "./helpers/service-item-pick.helper";
import { suggestFxRate } from "./helpers/maliyet-bridge.helper";
import { costPresentation, toPresentationAmount } from "./helpers/cost-presentation.helper";
import { readCostPresentationCurrency, readFinanceEnabled, resolveConsumableStockEnabled } from "./system-setting.service";

type Dec = Prisma.Decimal;
const D0 = () => new Prisma.Decimal(0);
const money = (v: Dec | null) => (v === null ? null : v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2));

const ROW_SELECT = {
  id: true,
  itemId: true,
  qty: true,
  createdAt: true,
  rollOperationId: true,
  rollOperation: {
    select: {
      operationType: true,
      workOrderStepId: true,
      propertyValueId: true,
      propertyValue: { select: { amount: true, serviceItemId: true, property: { select: { serviceItemId: true } } } },
    },
  },
} satisfies Prisma.ConsumableMovementSelect;
type Row = Prisma.ConsumableMovementGetPayload<{ select: typeof ROW_SELECT }>;

export interface ConsumableUsageRow {
  itemId: string;
  code: string;
  name: string;
  unit: string;
  qty: string;
  /** Kurşun ipi satırında kumaş metresi × gramaj → kg (≈); diğerlerinde null. */
  kursunKg: string | null;
  /** Yalnız maliyet izninde: TL tutar (bilinmiyorsa null) ve ağırlıklı ortalama birim fiyat. */
  costTry?: string | null;
  unitCostTry?: string | null;
}

/** Kurşun satırının kumaş metresi: tüketim ÷ o anda geçerli PER_METER norm (aynı seçici; norm yoksa null). */
async function kursunMetersOf(rows: Row[]): Promise<Map<string, Dec>> {
  const kursun = rows.filter((r) => r.rollOperation?.operationType === RollOperationType.KURSUN_APPLIED && r.rollOperation.propertyValue);
  const serviceOf = (r: Row) => pickServiceItemId({ value: r.rollOperation!.propertyValue!.serviceItemId, property: r.rollOperation!.propertyValue!.property.serviceItemId });
  const services = [...new Set(kursun.map(serviceOf).filter((v): v is string => v !== null))];
  const history = await consumableNormHistory(prisma, services);
  const out = new Map<string, Dec>();
  for (const r of kursun) {
    const svc = serviceOf(r);
    const valid = history.filter((n) => n.serviceItemId === svc && isCostRateValidAt(n, r.createdAt));
    const norm = pickNormsForValue(valid, r.rollOperation!.propertyValueId).find((n) => n.consumableItemId === r.itemId && n.basis === ConsumableNormBasis.PER_METER && n.qtyPerM.gt(0));
    if (norm) out.set(r.id, r.qty.div(norm.qtyPerM));
  }
  return out;
}

/** Müşteriye kurşun tutarı (TL, bugünkü gram fiyatı): iz başına metre × gramaj × gram fiyatı; fiyatsız iz → null. */
async function customerKursunTry(rows: Row[], meters: Map<string, Dec>, customerId: string | null): Promise<Dec | null> {
  const perOp = new Map<string, { meters: Dec; valueId: string; stepId: string }>();
  for (const r of rows) {
    const m = meters.get(r.id);
    if (!m || !r.rollOperationId || perOp.has(r.rollOperationId)) continue;
    perOp.set(r.rollOperationId, { meters: m, valueId: r.rollOperation!.propertyValueId!, stepId: r.rollOperation!.workOrderStepId });
  }
  if (perOp.size === 0) return null;
  // Finans köprüsü (cari gram fiyatı) dinamik: finans kapalı kurulumda modül yüklenmez, sorgu atılmaz.
  const { loadKursunGramPricing, pickKursunGramPrice } = await import("./helpers/kursun-gram-price.helper");
  const ops = [...perOp.values()];
  const pricing = await loadKursunGramPricing({ valueIds: [...new Set(ops.map((o) => o.valueId))], stepIds: [...new Set(ops.map((o) => o.stepId))], customerId, currency: "TRY" });
  let total = D0();
  for (const o of ops) {
    const hit = pickKursunGramPrice(pricing, { valueId: o.valueId, workOrderStepId: o.stepId });
    if (!hit) return null;
    total = total.plus(o.meters.mul(hit.unitPrice));
  }
  return total;
}

export async function workOrderConsumableUsage(workOrderId: string, opts: { canCost: boolean }) {
  const wo = await prisma.workOrder.findUnique({ where: { id: workOrderId }, select: { id: true, customerId: true } });
  if (!wo) throw AppError.notFound("İş emri bulunamadı.", { code: "WORK_ORDER_NOT_FOUND" });
  const enabled = await resolveConsumableStockEnabled();
  const rows = await prisma.consumableMovement.findMany({
    where: {
      kind: ConsumableMovementKind.CONSUMPTION_OUT,
      reversedBy: null,
      OR: [{ rollOperation: { step: { workOrderId } } }, { birthRoll: { producedInStep: { workOrderId } } }],
    },
    select: ROW_SELECT,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const items = await prisma.item.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.itemId))] } }, select: { id: true, code: true, name: true, unit: true } });
  const meters = await kursunMetersOf(rows);
  const costs = opts.canCost ? await consumptionCostsTry(rows) : [];

  const agg = new Map<string, { qty: Dec; gram: Dec | null; cost: Dec | null }>();
  let kursunCost: Dec | null = D0();
  rows.forEach((r, i) => {
    const a = agg.get(r.itemId) ?? { qty: D0(), gram: null, cost: D0() };
    a.qty = a.qty.plus(r.qty);
    const m = meters.get(r.id);
    const amount = r.rollOperation?.propertyValue?.amount;
    if (m && amount) a.gram = (a.gram ?? D0()).plus(m.mul(amount));
    if (opts.canCost) {
      const c = costs[i]!.costTry;
      a.cost = a.cost && c ? a.cost.plus(c) : null;
      if (r.rollOperation?.operationType === RollOperationType.KURSUN_APPLIED) kursunCost = kursunCost && c ? kursunCost.plus(c) : null;
    }
    agg.set(r.itemId, a);
  });

  const out: ConsumableUsageRow[] = items
    .map((it) => {
      const a = agg.get(it.id)!;
      const base: ConsumableUsageRow = { itemId: it.id, code: it.code, name: it.name, unit: it.unit, qty: a.qty.toFixed(3), kursunKg: a.gram ? a.gram.div(1000).toFixed(2) : null };
      if (!opts.canCost) return base;
      return { ...base, costTry: money(a.cost), unitCostTry: a.cost && a.qty.gt(0) ? a.cost.div(a.qty).toDecimalPlaces(4).toFixed(4) : null };
    })
    .sort((x, y) => x.name.localeCompare(y.name, "tr"));
  if (!opts.canCost) return { enabled, rows: out };

  const totalCost = [...agg.values()].reduce<Dec | null>((s, a) => (s && a.cost ? s.plus(a.cost) : null), D0());
  const hasKursun = rows.some((r) => meters.has(r.id));
  const customerTry = hasKursun && (await readFinanceEnabled()) ? await customerKursunTry(rows, meters, wo.customerId) : null;
  const setting = await readCostPresentationCurrency();
  const p = costPresentation(setting, setting === "TRY" ? null : await suggestFxRate(setting, new Date()), "ONIZLEME");
  return {
    enabled,
    rows: out,
    totalCostTry: rows.length > 0 ? money(totalCost) : null,
    customer: hasKursun ? { amountTry: money(customerTry), diffTry: customerTry && kursunCost ? money(customerTry.minus(kursunCost)) : null } : null,
    ...(p && totalCost ? { sunum: { doviz: p.currency, kur: p.rate?.toString() ?? null, toplam: toPresentationAmount(totalCost, p) } } : {}),
  };
}
