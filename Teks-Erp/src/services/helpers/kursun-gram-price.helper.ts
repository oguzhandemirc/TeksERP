// =============================================================================
// KURŞUN GRAM FİYATI — tek kaynak (oie-a, kullanıcı kararı K1/K2 2026-11-02)
// =============================================================================
// Soru: "bu kurşun işinin metre fiyatı kaç?" Fiyat gramla doğru orantılı: birim metre
// fiyatı = gramaj (gr/m, `FabricPropertyValue.amount`) × gram fiyatı. Gram fiyatı önce
// CARİNİN (müşteriye özel), yoksa işin kurşun İSTASYONUNUN; para birimi fatura para birimiyle
// aynı olmalı. Gramaj sayısı ya da gram fiyatı yoksa null → çağıran bugünkü hizmet kalemi
// fiyatında kalır (davranış değişmez).
// =============================================================================
import { Currency, Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { findCariAccountForCardTx } from "./finance.helper";
import type { ServiceRollWork } from "./service-pricing.helper";

type Db = Prisma.TransactionClient | typeof prisma;

/** Fatura satırı açıklaması: "Kurşun 40 gr (40 gr/m)". */
export function kursunGramLineLabel(valueName: string, amount: Prisma.Decimal): string {
  return `Kurşun ${valueName} (${amount.toString()} gr/m)`;
}

/** Birim metre fiyatı = gr/m × gram fiyatı (4 ondalık; snapshot `unitPrice` hassasiyeti). */
export function kursunMeterPrice(amount: Prisma.Decimal, gramPrice: Prisma.Decimal): Prisma.Decimal {
  return amount.mul(gramPrice).toDecimalPlaces(4);
}

export interface KursunGramPricing {
  /** valueId → gr/m (yalnız sayısı olan değerler). */
  amountByValue: Map<string, Prisma.Decimal>;
  /** Müşteriye özel gram fiyatı (fatura para biriminde), yoksa null. */
  customerPrice: Prisma.Decimal | null;
  /** stepId → istasyonun gram fiyatı (fatura para biriminde olanlar). */
  stationPriceByStep: Map<string, Prisma.Decimal>;
}

/** İşler için gram fiyatı girdilerini toplu okur (değer sayısı, cari fiyatı, adım→istasyon fiyatı). */
export async function loadKursunGramPricing(params: {
  valueIds: string[];
  stepIds: string[];
  customerId: string | null;
  currency: Currency;
  db?: Db;
}): Promise<KursunGramPricing> {
  const db = params.db ?? prisma;
  const values = params.valueIds.length === 0 ? [] : await db.fabricPropertyValue.findMany({
    where: { id: { in: params.valueIds }, amount: { not: null } },
    select: { id: true, amount: true },
  });
  const cari = params.customerId
    ? await findCariAccountForCardTx(db, { customerId: params.customerId, subcontractorId: null }, { kursunGramPrice: true, kursunGramCurrency: true })
    : null;
  const steps = params.stepIds.length === 0 ? [] : await db.workOrderStep.findMany({
    where: { id: { in: params.stepIds }, station: { kursunGramPrice: { not: null }, kursunGramCurrency: params.currency } },
    select: { id: true, station: { select: { kursunGramPrice: true } } },
  });
  return {
    amountByValue: new Map(values.map((v) => [v.id, v.amount!])),
    customerPrice: cari?.kursunGramPrice != null && cari.kursunGramCurrency === params.currency ? cari.kursunGramPrice : null,
    stationPriceByStep: new Map(steps.map((s) => [s.id, s.station.kursunGramPrice!])),
  };
}

/** Tek iş: müşteri özel > istasyon; gramaj sayısı ya da fiyat yoksa null (bugünkü fiyat). */
export function pickKursunGramPrice(
  p: KursunGramPricing,
  work: { valueId: string | null; workOrderStepId: string | null },
): { unitPrice: Prisma.Decimal; amount: Prisma.Decimal } | null {
  const amount = work.valueId ? p.amountByValue.get(work.valueId) : undefined;
  if (!amount) return null;
  const gram = p.customerPrice ?? (work.workOrderStepId ? p.stationPriceByStep.get(work.workOrderStepId) : undefined) ?? null;
  if (gram === null) return null;
  return { unitPrice: kursunMeterPrice(amount, gram), amount };
}

/** Kurşun işinde gram fiyatı (cari > istasyon) × gr/m kalem fiyatını EZER; tanımsızsa kalem fiyatı kalır. Çağıran kalemli işleri verir. */
export async function applyKursunGramPrices(works: ServiceRollWork[], ctx: { currency: Currency; customerId: string | null; db: Db }): Promise<void> {
  const kursun = works.filter((w) => w.source !== "PROPERTY" && w.valueId && w.qtyUnit === "METER");
  if (kursun.length === 0) return;
  const pricing = await loadKursunGramPricing({
    valueIds: [...new Set(kursun.map((w) => w.valueId!))],
    stepIds: [...new Set(kursun.map((w) => w.workOrderStepId).filter((v): v is string => v !== null))],
    customerId: ctx.customerId, currency: ctx.currency, db: ctx.db,
  });
  for (const w of kursun) {
    const hit = pickKursunGramPrice(pricing, w);
    if (!hit) continue;
    w.unitPrice = hit.unitPrice;
    w.gramLabel = kursunGramLineLabel(w.valueName, hit.amount);
  }
}
