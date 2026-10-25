// =============================================================================
// MALİYET GİRDİSİ — sayısal alan kuralları (MAL-1) + TEK girdi derleyicisi (MAL-2)
// =============================================================================
// Derleyici (`assembleCostInputTx`) kartlardan, maliyet yapısından, aktif parametre setinden,
// aktif iplik fiyatlarından ve tarifeden motor girdisini kurar; HER değer kaynağıyla yazılır
// (plan §2.1 öncelik sırası). Tüketici (önizleme, sürüm, liste, teklif) tabloya ayrıca gitmez.
// =============================================================================
// Maliyet girdileri `Decimal`dir; JS float'ı Decimal kolona yazmak yasak (kök kural) →
// gövde metin ya da sayı gelir, buradan `Prisma.Decimal`e çevrilir. Aralıklar migration
// `maliyet_girdileri` CHECK'lerinin aynasıdır (DB ikinci hat; kullanıcı Türkçe 400 görür).
// =============================================================================
import { Prisma, type Currency } from "@prisma/client";
import { ACTIVE_FINISHING_RATE, ACTIVE_YARN_COST_PRICE } from "./cost-price-validity.helper";
import type { CostInput, CostPrice, CostSource, CostWeftYarn, CostYarn, Sourced } from "./fabric-cost.helper";
import { resolveDenier } from "../../constants/warp-beam";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";

export interface DecimalRule {
  label: string;
  /** Alt sınır; `minExclusive` true ise sınır dahil değil. */
  min?: number;
  minExclusive?: boolean;
  max?: number;
  maxExclusive?: boolean;
  /** Ondalık hane tavanı (kolonun ölçeği). */
  scale: number;
  /** Tam sayı mı (Int kolon). */
  integer?: boolean;
}

/** Yüzde kuralı: 0 ≤ x < 100 (fire, genel gider, çekme). */
export const PCT_RULE = (label: string): DecimalRule => ({ label, min: 0, max: 100, maxExclusive: true, scale: 2 });
/** Randıman: 0 < x ≤ 100. */
export const EFFICIENCY_RULE = (label: string): DecimalRule => ({ label, min: 0, minExclusive: true, max: 100, scale: 2 });
/** Kâr oranı: 0 ≤ x ≤ 1000. */
export const MARKUP_RULE = (label: string): DecimalRule => ({ label, min: 0, max: 1000, scale: 2 });

const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

/**
 * `undefined` → alan gönderilmedi (dokunma) · `null`/"" → temizle · aksi hâlde kurala uyan Decimal.
 * Zorunlu alanın boşluğunu ÇAĞIRAN ölçer (taslak kopyasında boş alan önceki değeri taşır).
 */
export function parseDecimalField(raw: unknown, rule: DecimalRule): Prisma.Decimal | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim().replace(",", ".") : null;
  if (text === null || !NUMERIC_RE.test(text) || (typeof raw === "number" && !Number.isFinite(raw))) {
    throw AppError.badRequest(`${rule.label} sayı olmalı.`);
  }
  const d = new Prisma.Decimal(text);
  if (rule.integer && !d.isInteger()) throw AppError.badRequest(`${rule.label} tam sayı olmalı.`);
  if (d.decimalPlaces() > rule.scale) throw AppError.badRequest(`${rule.label} en çok ${rule.scale} ondalık hane alabilir.`);
  if (rule.min !== undefined && (rule.minExclusive ? d.lte(rule.min) : d.lt(rule.min))) {
    throw AppError.badRequest(`${rule.label} ${rule.minExclusive ? "sıfırdan büyük" : `en az ${rule.min}`} olmalı.`);
  }
  if (rule.max !== undefined && (rule.maxExclusive ? d.gte(rule.max) : d.gt(rule.max))) {
    throw AppError.badRequest(`${rule.label} ${rule.maxExclusive ? `${rule.max}'den küçük` : `en çok ${rule.max}`} olmalı.`);
  }
  return d;
}

/** İsteğe bağlı kısa metin: `undefined` dokunma · boş → null · uzunluk tavanı. */
export function parseTextField(raw: unknown, label: string, maxLen: number): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") throw AppError.badRequest(`${label} metin olmalı.`);
  const t = raw.trim();
  if (t.length === 0) return null;
  if (t.length > maxLen) throw AppError.badRequest(`${label} en çok ${maxLen} karakter olabilir.`);
  return t;
}

/** Partial unique / unique yarışı: P2002 → Türkçe 409; başka hata olduğu gibi döner. */
export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/** Damgalı sürüm değişiminin iki ayak izi (eski satır damgası + yeni satır) — iplik fiyatı ve apre tarifesi ortak. */
export function logStampedVersionAudit(opts: {
  tableName: string;
  userId?: string;
  previousId: string | null;
  revokeReason: string;
  rowId: string;
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown>;
}): void {
  if (opts.previousId) {
    void AuditService.log({
      userId: opts.userId,
      action: "UPDATE",
      tableName: opts.tableName,
      recordId: opts.previousId,
      oldData: { revokeReason: null },
      newData: { revokeReason: opts.revokeReason },
    });
  }
  void AuditService.log({
    userId: opts.userId,
    action: "CREATE",
    tableName: opts.tableName,
    recordId: opts.rowId,
    oldData: opts.oldData,
    newData: opts.newData,
  });
}

// ── DERLEYİCİ (MAL-2) ────────────────────────────────────────────────────────

type Dec = Prisma.Decimal;
/** Fiyat 90 günden eskiyse `PRICE_STALE` (plan §2.2). */
const PRICE_STALE_DAYS = 90;

/** İstek düzeyi ezmeler (Hızlı Hesaplayıcı / önizleme) — kaynak `ELLE`, en yüksek öncelik. */
export interface CostOverrides {
  takeUpPct?: Dec | null;
  warpWastePct?: Dec | null;
  /** `warpWastePct` ölçülmüş fire önerisinden geldiyse kaynak `OLCULMUS` yazılır. */
  warpWasteMeasured?: boolean;
  weftWastePct?: Dec | null;
  fabricWastePct?: Dec | null;
  weftLengthCm?: Dec | null;
  loomRpm?: Dec | null;
  efficiencyPct?: Dec | null;
  beamLengthM?: Dec | null;
  lengthShrinkPct?: Dec | null;
  extraCostPerMTry?: Dec | null;
  /** `null` = terbiyeyi kaldır (ham satış); `undefined` = yapıdakini kullan. */
  finishingRateCode?: string | null;
}
export interface AdHocYarn { name: string; denier: Dec | null; pricePerKg: Dec | null; currency: Currency; picksInRepeat?: number }
/** Kartı olmayan desen (teklif "yeni desen" kalemi, Hızlı Hesaplayıcı): elle yapı, elle iplik. */
export interface AdHocStructure {
  warp: { endsCount: number; takeUpPct?: Dec | null; yarn: AdHocYarn } | null;
  weft: { picksPerCm: Dec | null; rawWidthCm?: Dec | null; yarns: AdHocYarn[] } | null;
  finishingRateCode?: string | null;
}
export type CostSourceRef = { itemId: string } | { adHoc: AdHocStructure };

const yarnSelect = { id: true, name: true, linearDensityDen: true } as const;
const itemSelect = {
  id: true, code: true, name: true, itemType: true, isActive: true, rawWidthCm: true,
  warpSpec: { select: { id: true, endsCount: true, takeUpPct: true, reedWidthCm: true, yarnItem: { select: yarnSelect } } },
  weftSpec: { select: { id: true, picksPerCm: true, yarns: { orderBy: { sortOrder: "asc" }, select: { picksInRepeat: true, yarnItem: { select: yarnSelect } } } } },
  costStructure: true,
} satisfies Prisma.ItemSelect;
export type CostItemRow = Prisma.ItemGetPayload<{ select: typeof itemSelect }>;
type ParamRow = Prisma.CostParameterSetGetPayload<object>;
type PriceRow = Prisma.YarnCostPriceGetPayload<object>;
type RateRow = Prisma.FinishingRateGetPayload<object>;

/** Derleyicinin okuduğu her şey — liste N kalem için TEK seferde yükler (kalem başı sorgu yok). */
export interface CostSources { items: Map<string, CostItemRow>; params: ParamRow | null; prices: Map<string, PriceRow>; rates: Map<string, RateRow>; asOf: Date }

type Db = Prisma.TransactionClient;

export async function loadCostSourcesTx(tx: Db, itemIds: string[], extraRateCodes: string[] = []): Promise<CostSources> {
  const rows = itemIds.length ? await tx.item.findMany({ where: { id: { in: itemIds } }, select: itemSelect }) : [];
  const params = await tx.costParameterSet.findFirst({ where: { status: "ACTIVE" } });
  const yarnIds = new Set<string>();
  const codes = new Set(extraRateCodes);
  for (const r of rows) {
    if (r.warpSpec) yarnIds.add(r.warpSpec.yarnItem.id);
    for (const y of r.weftSpec?.yarns ?? []) yarnIds.add(y.yarnItem.id);
    if (r.costStructure?.finishingRateCode) codes.add(r.costStructure.finishingRateCode);
  }
  const prices = yarnIds.size ? await tx.yarnCostPrice.findMany({ where: { ...ACTIVE_YARN_COST_PRICE, yarnItemId: { in: [...yarnIds] } } }) : [];
  const rates = codes.size ? await tx.finishingRate.findMany({ where: { ...ACTIVE_FINISHING_RATE, code: { in: [...codes] } } }) : [];
  return {
    items: new Map(rows.map((r) => [r.id, r])),
    params,
    prices: new Map(prices.map((p) => [p.yarnItemId, p])),
    rates: new Map(rates.map((r) => [r.code, r])),
    asOf: new Date(),
  };
}

/** İlk dolu katman kazanır; hiçbiri yoksa son katmanın kaynağıyla `null`. */
function firstOf(...layers: Array<[Dec | null | undefined, CostSource, Sourced<Dec>["flag"]?]>): Sourced<Dec> {
  for (const [v, source, flag] of layers) if (v !== null && v !== undefined) return flag ? { value: v, source, flag } : { value: v, source };
  return { value: null, source: layers[layers.length - 1][1] };
}
const dec = (v: Dec | number | null | undefined): Dec | null => (v === null || v === undefined ? null : new Prisma.Decimal(v));

function yarnPrice(src: CostSources, yarnItemId: string): CostPrice | null {
  const p = src.prices.get(yarnItemId);
  if (!p) return null;
  const stale = src.asOf.getTime() - p.createdAt.getTime() > PRICE_STALE_DAYS * 86_400_000;
  return { amount: p.pricePerKg, currency: p.currency, source: "KART", ...(stale ? { flag: "PRICE_STALE" as const } : {}) };
}
const cardYarn = (src: CostSources, y: { id: string; name: string; linearDensityDen: Dec | null }): CostYarn => ({
  yarnItemId: y.id, name: y.name, denier: { value: resolveDenier(y), source: "KART" }, price: yarnPrice(src, y.id),
});
const adHocYarn = (y: AdHocYarn): CostYarn => ({
  yarnItemId: null, name: y.name, denier: { value: y.denier, source: "ELLE" },
  price: y.pricePerKg ? { amount: y.pricePerKg, currency: y.currency, source: "ELLE" } : null,
});

function finishingOf(src: CostSources, code: string | null | undefined): CostInput["finishing"] {
  if (!code) return null;
  const r = src.rates.get(code);
  if (!r) return { code, name: code, basis: "RAW_M", price: null };
  return { code, name: r.name, basis: r.basis, price: { amount: r.pricePerM, currency: r.currency, source: "KART" } };
}

/** Plan §2.1 öncelik tablosu — saf; `src` önceden yüklenmiş olmalı. */
export function buildCostInput(src: CostSources, ref: CostSourceRef, o: CostOverrides = {}): CostInput {
  const p = src.params;
  const item = "itemId" in ref ? src.items.get(ref.itemId) : undefined;
  const cs = item?.costStructure ?? null;
  const ws = item?.warpSpec ?? null;
  const ah = "adHoc" in ref ? ref.adHoc : null;
  const rawWidth = item ? item.rawWidthCm : dec(ah?.weft?.rawWidthCm);
  const fromWidth = rawWidth && p ? rawWidth.plus(p.weftSelvedgeAllowanceCm) : null;
  const warpBase = ws
    ? { warpSpecId: ws.id, endsCount: ws.endsCount, takeUp: ws.takeUpPct, takeUpSrc: "KART" as const, yarn: cardYarn(src, ws.yarnItem) }
    : ah?.warp
      ? { warpSpecId: null, endsCount: ah.warp.endsCount, takeUp: dec(ah.warp.takeUpPct), takeUpSrc: "ELLE" as const, yarn: adHocYarn(ah.warp.yarn) }
      : null;
  const weftYarns: CostWeftYarn[] = item?.weftSpec
    ? item.weftSpec.yarns.map((y) => ({ ...cardYarn(src, y.yarnItem), picksInRepeat: y.picksInRepeat }))
    : (ah?.weft?.yarns ?? []).map((y) => ({ ...adHocYarn(y), picksInRepeat: y.picksInRepeat ?? 1 }));
  const picks = item?.weftSpec ? item.weftSpec.picksPerCm : ah?.weft ? dec(ah.weft.picksPerCm) : null;
  const hasWeft = !!item?.weftSpec || !!ah?.weft;
  const code = o.finishingRateCode !== undefined ? o.finishingRateCode : (cs?.finishingRateCode ?? ah?.finishingRateCode ?? null);
  const finishing = finishingOf(src, code);
  const extraTry = o.extraCostPerMTry ?? cs?.extraCostPerMTry ?? null;
  return {
    schemaVersion: 1,
    parameterSetId: p?.id ?? null,
    warp: warpBase && {
      warpSpecId: warpBase.warpSpecId,
      endsCount: warpBase.endsCount,
      takeUpPct: firstOf([o.takeUpPct, "ELLE"], [warpBase.takeUp, warpBase.takeUpSrc], [p?.defaultTakeUpPct, "PARAMETRE"]),
      wastePct: firstOf([o.warpWastePct, o.warpWasteMeasured ? "OLCULMUS" : "ELLE"], [cs?.warpWastePct, "YAPI"], [p?.defaultWarpWastePct, "PARAMETRE"]),
      yarn: warpBase.yarn,
    },
    weft: hasWeft
      ? {
          weftSpecId: item?.weftSpec?.id ?? null,
          picksPerCm: { value: picks, source: item ? "KART" : "ELLE" },
          lengthCm: firstOf([o.weftLengthCm, "ELLE"], [cs?.weftLengthCm, "YAPI"], [ws?.reedWidthCm, "KART"], [fromWidth, "KART", "WEFT_LENGTH_FROM_WIDTH"]),
          wastePct: firstOf([o.weftWastePct, "ELLE"], [cs?.weftWastePct, "YAPI"], [p?.defaultWeftWastePct, "PARAMETRE"]),
          yarns: weftYarns,
        }
      : null,
    loom: {
      rpm: firstOf([o.loomRpm, "ELLE"], [dec(cs?.loomRpm), "YAPI"], [dec(p?.defaultLoomRpm), "PARAMETRE"]),
      efficiencyPct: firstOf([o.efficiencyPct, "ELLE"], [cs?.efficiencyPct, "YAPI"], [p?.defaultEfficiencyPct, "PARAMETRE"]),
      machineRateTry: firstOf([p?.loomHourRateTry, "PARAMETRE"]),
      laborRateTry: firstOf([p?.laborHourRateTry, "PARAMETRE"]),
      loomsPerOperator: firstOf([p?.loomsPerOperator, "PARAMETRE"]),
      energyKwhPerHour: firstOf([p?.energyKwhPerLoomHour, "PARAMETRE"]),
      energyPriceTry: firstOf([p?.energyPriceTryPerKwh, "PARAMETRE"]),
    },
    beam: {
      prepCostTry: firstOf([p?.beamPrepCostTry, "PARAMETRE"]),
      lengthM: firstOf([o.beamLengthM, "ELLE"], [cs?.beamLengthM, "YAPI"], [p?.defaultBeamLengthM, "PARAMETRE"]),
    },
    finishing,
    lengthShrinkPct: firstOf([o.lengthShrinkPct, "ELLE"], [cs?.lengthShrinkPct, "YAPI"], [finishing && src.rates.get(finishing.code)?.typicalShrinkPct, "KART"]),
    fabricWastePct: firstOf([o.fabricWastePct, "ELLE"], [cs?.fabricWastePct, "YAPI"], [p?.defaultFabricWastePct, "PARAMETRE"]),
    overheadPct: firstOf([p?.overheadPct, "PARAMETRE"]),
    extra: extraTry ? { amountTry: extraTry, label: cs?.extraCostLabel ?? null } : null,
  };
}

/** Tek kalem/ad-hoc için yükle + derle. Kalem yoksa 404, KUMAŞ değilse 400. */
export async function assembleCostInputTx(tx: Db, ref: CostSourceRef, overrides: CostOverrides = {}): Promise<CostInput> {
  const extraCodes = [overrides.finishingRateCode, "adHoc" in ref ? ref.adHoc.finishingRateCode : null].filter((c): c is string => !!c);
  const src = await loadCostSourcesTx(tx, "itemId" in ref ? [ref.itemId] : [], extraCodes);
  if ("itemId" in ref) {
    const item = src.items.get(ref.itemId);
    if (!item) throw AppError.notFound("Ürün bulunamadı.");
    if (item.itemType !== "FABRIC") throw AppError.badRequest("Maliyet yalnız KUMAŞ ürünlerde hesaplanır.", { code: "COST_FABRIC_ONLY" });
  }
  return buildCostInput(src, ref, overrides);
}

/** Girdinin kur isteyen dövizleri (TRY hariç) — önizleme/sürüm kuru yalnız bunlar için arar. */
export function costCurrencies(input: CostInput): Currency[] {
  const set = new Set<Currency>();
  const add = (p: CostPrice | null | undefined) => p && p.currency !== "TRY" && set.add(p.currency);
  add(input.warp?.yarn.price);
  input.weft?.yarns.forEach((y) => add(y.price));
  add(input.finishing?.price);
  return [...set].sort();
}
