// =============================================================================
// MALİYET GİRDİ DERLEYİCİSİ — motor girdisinin TEK kurucusu (MAL-2; plan §2.1)
// =============================================================================
// Kartlardan, maliyet yapısından, aktif parametre setinden, aktif iplik fiyatlarından ve tarifeden
// `CostInput` kurar; HER değer kaynağıyla yazılır. Tüketici (önizleme, sürüm, liste, teklif) maliyet
// tablolarına ayrıca gitmez. ⚠️ Ayrı dosya: `cost-input.helper` (doğrulama) ürün/atkı servislerinden
// de import edilir; model okuyan derleyici orada dursa `item.routes` maliyet kapısına bağlanırdı
// (`test_maliyet_regime_gate` §2 ölçtü).
// =============================================================================
import { Prisma, type Currency } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { ACTIVE_FINISHING_RATE, ACTIVE_YARN_COST_PRICE } from "./cost-price-validity.helper";
import type { CostInput, CostPrice, CostRate, CostSource, CostWeftYarn, CostYarn, Sourced } from "./fabric-cost.helper";
import type { FinishingKgBasis } from "./fabric-cost-kg.helper";
import { resolveDenier } from "../../constants/warp-beam";
import { DEFAULT_COST_FINISHING_KG_BASIS, readCostFinishingKgBasis } from "../system-setting.service";


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
/** `recipeId` (SY-E1): varyantın tarife kodu ürün yapısınınkinden önce gelir; varyant ürünün olmalı. */
export type CostSourceRef = { itemId: string; recipeId?: string } | { adHoc: AdHocStructure };

const yarnSelect = { id: true, name: true, linearDensityDen: true } as const;
const itemSelect = {
  id: true, code: true, name: true, itemType: true, isActive: true, rawWidthCm: true,
  warpSpec: { select: { id: true, endsCount: true, takeUpPct: true, wastePct: true, reedWidthCm: true, yarnItem: { select: yarnSelect } } },
  weftSpec: { select: { id: true, picksPerCm: true, yarns: { orderBy: { sortOrder: "asc" }, select: { picksInRepeat: true, yarnItem: { select: yarnSelect } } } } },
  costStructure: { include: { processes: { orderBy: { sortOrder: "asc" }, select: { rateCode: true } } } },
} satisfies Prisma.ItemSelect;
export type CostItemRow = Prisma.ItemGetPayload<{ select: typeof itemSelect }>;
type ParamRow = Prisma.CostParameterSetGetPayload<object>;
type PriceRow = Prisma.YarnCostPriceGetPayload<object>;
type RateRow = Prisma.FinishingRateGetPayload<object>;
export interface CostRecipeRow { id: string; itemId: string; finishingRateCode: string | null }

/** Derleyicinin okuduğu her şey — liste N kalem için TEK seferde yükler (kalem başı sorgu yok). */
export interface CostSources {
  items: Map<string, CostItemRow>; params: ParamRow | null; prices: Map<string, PriceRow>; rates: Map<string, RateRow>; asOf: Date;
  /** SY-E1: istenen varyantlar + KG tabanı ayarı (yalnız KG tarifesi yüklendiyse okunur). */
  recipes?: Map<string, CostRecipeRow>; kgBasis?: FinishingKgBasis;
}

type Db = Prisma.TransactionClient;

export async function loadCostSourcesTx(tx: Db, itemIds: string[], extraRateCodes: string[] = [], recipeIds: string[] = []): Promise<CostSources> {
  const rows = itemIds.length ? await tx.item.findMany({ where: { id: { in: itemIds } }, select: itemSelect }) : [];
  const params = await tx.costParameterSet.findFirst({ where: { status: "ACTIVE" } });
  const recipes = recipeIds.length ? await tx.productRecipe.findMany({ where: { id: { in: recipeIds } }, select: { id: true, itemId: true, finishingRateCode: true } }) : [];
  const yarnIds = new Set<string>();
  const codes = new Set(extraRateCodes);
  for (const r of recipes) if (r.finishingRateCode) codes.add(r.finishingRateCode);
  for (const r of rows) {
    if (r.warpSpec) yarnIds.add(r.warpSpec.yarnItem.id);
    for (const y of r.weftSpec?.yarns ?? []) yarnIds.add(y.yarnItem.id);
    if (r.costStructure?.finishingRateCode) codes.add(r.costStructure.finishingRateCode);
    for (const p of r.costStructure?.processes ?? []) codes.add(p.rateCode);
  }
  const prices = yarnIds.size ? await tx.yarnCostPrice.findMany({ where: { ...ACTIVE_YARN_COST_PRICE, yarnItemId: { in: [...yarnIds] } } }) : [];
  const rates = codes.size ? await tx.finishingRate.findMany({ where: { ...ACTIVE_FINISHING_RATE, code: { in: [...codes] } } }) : [];
  // Metre tabanlı tarifelerde ayar okunmaz (sorgu sayısı bugünkü).
  const kgBasis = rates.some((r) => r.basis === "KG") ? await readCostFinishingKgBasis(tx) : undefined;
  return {
    items: new Map(rows.map((r) => [r.id, r])),
    params,
    prices: new Map(prices.map((p) => [p.yarnItemId, p])),
    rates: new Map(rates.map((r) => [r.code, r])),
    asOf: new Date(),
    ...(recipes.length ? { recipes: new Map(recipes.map((r) => [r.id, r])) } : {}),
    ...(kgBasis ? { kgBasis } : {}),
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

function finishingOf(src: CostSources, code: string | null | undefined): CostRate | null {
  if (!code) return null;
  const r = src.rates.get(code);
  if (!r) return { code, name: code, basis: "RAW_M", price: null };
  // KG (SY-E1): kg kaynağı girdiye DONAR (`kgBase`) — ayar sonradan değişse de sürüm aynı sayıyı verir.
  if (r.basis === "KG") return { code, name: r.name, basis: "KG", kgBase: src.kgBasis ?? DEFAULT_COST_FINISHING_KG_BASIS, price: { amount: r.pricePerM, currency: r.currency, source: "KART" } };
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
  // Öncelik (tasarım §6.5): ELLE > varyant kodu > ürün yapısı kodu > yok.
  const recipe = "itemId" in ref && ref.recipeId ? src.recipes?.get(ref.recipeId) : undefined;
  const code = o.finishingRateCode !== undefined ? o.finishingRateCode : (recipe?.finishingRateCode ?? cs?.finishingRateCode ?? ah?.finishingRateCode ?? null);
  const finishing = finishingOf(src, code);
  const extraTry = o.extraCostPerMTry ?? cs?.extraCostPerMTry ?? null;
  // Ek işlem (SY-G1) aynı tarife uzayından; çözülemeyen kod motorda FINISHING_RATE_MISSING (0 değil).
  // Terbiyeyle aynı kod iki kez sayılmaz (yazım kapısının ikinci seddi; what-if terbiye değişimi de kapsanır).
  const processes = (cs?.processes ?? []).filter((p) => p.rateCode !== code).map((p) => finishingOf(src, p.rateCode)).filter((r): r is CostRate => r !== null);
  return {
    schemaVersion: 1,
    parameterSetId: p?.id ?? null,
    warp: warpBase && {
      warpSpecId: warpBase.warpSpecId,
      endsCount: warpBase.endsCount,
      takeUpPct: firstOf([o.takeUpPct, "ELLE"], [warpBase.takeUp, warpBase.takeUpSrc], [p?.defaultTakeUpPct, "PARAMETRE"]),
      // Kart firesi (SY-C1): aynı çözgüyü paylaşan desenler tek yerden; boş kartta zincir bugünkü gibi PARAMETRE'ye düşer.
      wastePct: firstOf([o.warpWastePct, o.warpWasteMeasured ? "OLCULMUS" : "ELLE"], [cs?.warpWastePct, "YAPI"], [ws?.wastePct, "KART"], [p?.defaultWarpWastePct, "PARAMETRE"]),
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
    ...(processes.length ? { processes } : {}),
    lengthShrinkPct: firstOf([o.lengthShrinkPct, "ELLE"], [cs?.lengthShrinkPct, "YAPI"], [finishing && src.rates.get(finishing.code)?.typicalShrinkPct, "KART"]),
    fabricWastePct: firstOf([o.fabricWastePct, "ELLE"], [cs?.fabricWastePct, "YAPI"], [p?.defaultFabricWastePct, "PARAMETRE"]),
    overheadPct: firstOf([p?.overheadPct, "PARAMETRE"]),
    extra: extraTry ? { amountTry: extraTry, label: cs?.extraCostLabel ?? null } : null,
  };
}

/** Tek kalem/ad-hoc için yükle + derle. Kalem yoksa 404, KUMAŞ değilse 400. */
export async function assembleCostInputTx(tx: Db, ref: CostSourceRef, overrides: CostOverrides = {}): Promise<CostInput> {
  const extraCodes = [overrides.finishingRateCode, "adHoc" in ref ? ref.adHoc.finishingRateCode : null].filter((c): c is string => !!c);
  const recipeIds = "itemId" in ref && ref.recipeId ? [ref.recipeId] : [];
  const src = await loadCostSourcesTx(tx, "itemId" in ref ? [ref.itemId] : [], extraCodes, recipeIds);
  if ("itemId" in ref) {
    const item = src.items.get(ref.itemId);
    if (!item) throw AppError.notFound("Ürün bulunamadı.");
    if (item.itemType !== "FABRIC") throw AppError.badRequest("Maliyet yalnız KUMAŞ ürünlerde hesaplanır.", { code: "COST_FABRIC_ONLY" });
    if (ref.recipeId && src.recipes?.get(ref.recipeId)?.itemId !== ref.itemId) {
      throw AppError.badRequest("Varyant bu ürüne ait değil.", { code: "COST_RECIPE_MISMATCH" });
    }
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
  input.processes?.forEach((p) => add(p.price));
  return [...set].sort();
}
