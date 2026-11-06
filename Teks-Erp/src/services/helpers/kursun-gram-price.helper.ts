// =============================================================================
// KURŞUN GRAM FİYATI — tek kaynak (oie-a, kullanıcı kararı K1/K2 2026-11-02)
// =============================================================================
// Soru: "bu kurşun işinin metre fiyatı kaç?" Fiyat gramla doğru orantılı: birim metre
// fiyatı = gramaj (gr/m, `FabricPropertyValue.amount`) × gram fiyatı. Gram fiyatı önce
// CARİNİN (müşteriye özel), yoksa işin kurşun İSTASYONUNUN; para birimi fatura para birimiyle
// aynı olmalı. Gramaj sayısı ya da gram fiyatı yoksa null → çağıran bugünkü hizmet kalemi
// fiyatında kalır (davranış değişmez).
// K14 (kullanıcı kararı 2026-11-02): ayar `finance.serviceBilling.kursunGramPriceBasis`
//   · SERVICE_DATE (varsayılan): fiyat SÜRÜMDEN, kalem tarifesiyle AYNI ana (`priceAt`: hizmet anı; fiyat
//     tarihi ayarı sevk günüyse sevk anı) çözülür. O anda geçerli sürüm yoksa en eski sürüm + uyarı.
//   · INVOICE_DATE: bugünkü kolon değeri (fatura anı) → gram fiyatlı her taslak `GRAM_PRICE_CURRENT_WARNING` taşır.
// =============================================================================
import { Currency, Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { findCariAccountForCardTx } from "./finance.helper";
import type { ServiceRollWork } from "./service-pricing.helper";
import type { KursunGramPriceBasis } from "../system-setting.service";

type Db = Prisma.TransactionClient | typeof prisma;

/** Fatura satırı açıklaması: "Kurşun 40 gr (40 gr/m)". */
export function kursunGramLineLabel(valueName: string, amount: Prisma.Decimal): string {
  return `Kurşun ${valueName} (${amount.toString()} gr/m)`;
}

/** Kademe fiyatlı (hizmet fiyat tablosu) kurşun satırının açıklaması: "Kurşun 40 gr". */
export function kursunTierLineLabel(valueName: string): string {
  return `Kurşun ${valueName}`;
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

/** Gram fiyatının sahibi — hizmet fiyat sırası (`service-price-pick.helper`) müşteri gramını genel kademeden önce alır. */
export type GramPriceOwner = "CUSTOMER" | "STATION";

/** Bir işin gram fiyatı adayı (yazılmamış); `late` = iş anında sürüm yoktu, sonradan girilen ilk sürüm. */
export interface KursunGramCandidate {
  unitPrice: Prisma.Decimal;
  amount: Prisma.Decimal;
  owner: GramPriceOwner;
  late: boolean;
  customerLater?: boolean;
}

/** Tek iş: müşteri özel > istasyon; gramaj sayısı ya da fiyat yoksa null (bugünkü fiyat). */
export function pickKursunGramPrice(
  p: KursunGramPricing,
  work: { valueId: string | null; workOrderStepId: string | null },
): KursunGramCandidate | null {
  const amount = work.valueId ? p.amountByValue.get(work.valueId) : undefined;
  if (!amount) return null;
  const station = work.workOrderStepId ? p.stationPriceByStep.get(work.workOrderStepId) ?? null : null;
  const gram = p.customerPrice ?? station;
  if (gram === null) return null;
  return { unitPrice: kursunMeterPrice(amount, gram), amount, owner: p.customerPrice ? "CUSTOMER" : "STATION", late: false };
}

/** Gram fiyatı tarihsiz: fatura anındaki değer kullanıldı (kurşun dışı kalemler iş tarihindeki tarifeden). */
export function gramPriceCurrentWarning(count: number): string {
  return `${count} kurşun işi gram fiyatının BUGÜNKÜ değeriyle (müşteri/istasyon) fiyatlandı; iş tarihinden sonra gram fiyatı değiştiyse tutarı kontrol edin.`;
}

/** K14 SERVICE_DATE: müşteri fiyatı işten SONRA ilk kez girildi; iş anında geçerli istasyon fiyatı kullanıldı. */
export function gramPriceCustomerLaterWarning(count: number): string {
  return `${count} kurşun işinde müşteriye özel gram fiyatı iş tarihinden SONRA girildi; iş tarihindeki istasyon gram fiyatıyla fiyatlandı — müşteri fiyatı geçerli olacaksa tutarı kontrol edin.`;
}

/** K14 SERVICE_DATE: iş anından ÖNCE hiç sürüm yoktu, fiyat sonradan girilen (en eski) sürümden geldi. */
export function gramPriceEnteredLaterWarning(count: number): string {
  return `${count} kurşun işinin tarihinde gram fiyatı tanımlı değildi; iş tarihinden SONRA girilen ilk gram fiyatıyla fiyatlandı — tutarı kontrol edin.`;
}

interface GramVersion { validFrom: Date; price: Prisma.Decimal | null; currency: Currency | null }

/** Sahibin sürümleri (validFrom, createdAt, id ARTAN) içinde `at` anında geçerli olan; yoksa null. */
function versionAt(list: GramVersion[] | undefined, at: number): GramVersion | null {
  let hit: GramVersion | null = null;
  for (const v of list ?? []) { if (v.validFrom.getTime() <= at) hit = v; else break; }
  return hit;
}

const usable = (v: GramVersion | null | undefined, currency: Currency): Prisma.Decimal | null =>
  v && v.price !== null && v.currency === currency ? v.price : null;

export interface KursunGramVersionPricing {
  amountByValue: Map<string, Prisma.Decimal>;
  /** Carinin sürümleri (artan); cari yoksa boş. */
  customer: GramVersion[];
  /** stepId → istasyonun sürümleri (artan). */
  stationByStep: Map<string, GramVersion[]>;
}

/** SERVICE_DATE girdileri — toplu (N+1 yok): değer sayıları, cari + istasyon sürümleri tek sorguda. */
export async function loadKursunGramVersions(params: { valueIds: string[]; stepIds: string[]; customerId: string | null; db?: Db }): Promise<KursunGramVersionPricing> {
  const db = params.db ?? prisma;
  const values = params.valueIds.length === 0 ? [] : await db.fabricPropertyValue.findMany({
    where: { id: { in: params.valueIds }, amount: { not: null } },
    select: { id: true, amount: true },
  });
  const cari = params.customerId ? await findCariAccountForCardTx(db, { customerId: params.customerId, subcontractorId: null }, { id: true }) : null;
  const steps = params.stepIds.length === 0 ? [] : await db.workOrderStep.findMany({ where: { id: { in: params.stepIds } }, select: { id: true, stationId: true } });
  const stationIds = [...new Set(steps.map((s) => s.stationId).filter((v): v is string => v !== null))];
  const owners: Prisma.KursunGramPriceVersionWhereInput[] = [
    ...(cari ? [{ cariAccountId: cari.id }] : []),
    ...(stationIds.length > 0 ? [{ stationId: { in: stationIds } }] : []),
  ];
  const rows = owners.length === 0 ? [] : await db.kursunGramPriceVersion.findMany({
    where: { OR: owners },
    orderBy: [{ validFrom: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { stationId: true, cariAccountId: true, validFrom: true, price: true, currency: true },
  });
  const byStation = new Map<string, GramVersion[]>();
  const customer: GramVersion[] = [];
  for (const r of rows) {
    const v = { validFrom: r.validFrom, price: r.price, currency: r.currency };
    if (r.cariAccountId) customer.push(v);
    else if (r.stationId) byStation.set(r.stationId, [...(byStation.get(r.stationId) ?? []), v]);
  }
  const stationByStep = new Map<string, GramVersion[]>();
  for (const s of steps) if (s.stationId && byStation.has(s.stationId)) stationByStep.set(s.id, byStation.get(s.stationId)!);
  return { amountByValue: new Map(values.map((v) => [v.id, v.amount!])), customer, stationByStep };
}

/**
 * Tek iş, SERVICE_DATE: ① `at` anında geçerli sürüm — müşteri > istasyon (fiyatsız/para birimi uymayan sürüm
 * düşer) · ② ikisinde de o anda sürüm yoksa EN ESKİ sürüm (müşteri > istasyon), `late` işaretli · ③ yoksa null.
 */
export function pickKursunGramVersionPrice(
  p: KursunGramVersionPricing,
  work: { valueId: string | null; workOrderStepId: string | null },
  at: number,
  currency: Currency,
): KursunGramCandidate | null {
  const amount = work.valueId ? p.amountByValue.get(work.valueId) : undefined;
  if (!amount) return null;
  const station = work.workOrderStepId ? p.stationByStep.get(work.workOrderStepId) : undefined;
  const cariNow = versionAt(p.customer, at);
  const stationNow = versionAt(station, at);
  const cariPrice = usable(cariNow, currency);
  const now = cariPrice ?? usable(stationNow, currency);
  // İstasyon fiyatı kullanıldı ama müşterinin işten SONRA girilmiş (o anda sürümü olmayan) fiyatı var → uyarı.
  const customerLater = !cariPrice && !cariNow && usable(p.customer[0], currency) !== null;
  if (now) return { unitPrice: kursunMeterPrice(amount, now), amount, owner: cariPrice ? "CUSTOMER" : "STATION", late: false, ...(customerLater ? { customerLater: true } : {}) };
  // O anda HİÇ sürümü olmayan sahibin ilk sürümü (fiyat ilk girildiğinde önceki işlere de uygulanır).
  const earlyCustomer = !cariNow ? usable(p.customer[0], currency) : null;
  const early = earlyCustomer ?? (!stationNow ? usable(station?.[0], currency) : null);
  return early ? { unitPrice: kursunMeterPrice(amount, early), amount, owner: earlyCustomer ? "CUSTOMER" : "STATION", late: true } : null;
}

/**
 * Kurşun işlerinin gram fiyatı ADAYLARI (yazmaz): gr/m × gram fiyatı, sahibiyle. Kalem/kademe fiyatıyla
 * kıyas ve seçim `service-price-pick.helper` `pickServicePrice`te; `priceAt` kalem tarifesinin anıyla aynıdır.
 */
export async function loadKursunGramCandidates(
  works: ServiceRollWork[],
  ctx: { currency: Currency; customerId: string | null; db: Db; basis: KursunGramPriceBasis; priceAt: (w: ServiceRollWork) => number },
): Promise<Map<ServiceRollWork, KursunGramCandidate>> {
  const out = new Map<ServiceRollWork, KursunGramCandidate>();
  const kursun = works.filter((w) => w.source !== "PROPERTY" && w.valueId && w.qtyUnit === "METER");
  if (kursun.length === 0) return out;
  const valueIds = [...new Set(kursun.map((w) => w.valueId!))];
  const stepIds = [...new Set(kursun.map((w) => w.workOrderStepId).filter((v): v is string => v !== null))];
  if (ctx.basis === "INVOICE_DATE") {
    const pricing = await loadKursunGramPricing({ valueIds, stepIds, customerId: ctx.customerId, currency: ctx.currency, db: ctx.db });
    for (const w of kursun) {
      const hit = pickKursunGramPrice(pricing, w);
      if (hit) out.set(w, hit);
    }
    return out;
  }
  const versions = await loadKursunGramVersions({ valueIds, stepIds, customerId: ctx.customerId, db: ctx.db });
  for (const w of kursun) {
    const hit = pickKursunGramVersionPrice(versions, w, ctx.priceAt(w), ctx.currency);
    if (hit) out.set(w, hit);
  }
  return out;
}

/** Hizmet fiyat tablosu için ŞU ANKİ gram fiyatları (kolon = güncel değer): müşteri cari kartı + aktif istasyonlar. */
export async function loadCurrentGramPrices(customerId: string | null, currency: Currency): Promise<{
  customer: Prisma.Decimal | null;
  stations: Array<{ id: string; name: string; price: Prisma.Decimal }>;
}> {
  const cari = customerId
    ? await findCariAccountForCardTx(prisma, { customerId, subcontractorId: null }, { kursunGramPrice: true, kursunGramCurrency: true })
    : null;
  const stations = await prisma.station.findMany({
    where: { isActive: true, kursunGramPrice: { not: null }, kursunGramCurrency: currency },
    select: { id: true, name: true, kursunGramPrice: true },
    orderBy: { name: "asc" },
  });
  return {
    customer: cari?.kursunGramPrice != null && cari.kursunGramCurrency === currency ? cari.kursunGramPrice : null,
    stations: stations.map((s) => ({ id: s.id, name: s.name, price: s.kursunGramPrice! })),
  };
}
