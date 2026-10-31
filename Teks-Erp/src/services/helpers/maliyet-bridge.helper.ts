// =============================================================================
// MALİYET ↔ DİĞER MODÜLLER KÖPRÜSÜ (MAL-2; plan §4.2, emsal `customer-finance-bridge.helper`)
// =============================================================================
// Maliyet; kur (finans), alış fiyatı (ticaret), son giriş fiyatı (iplik) ve ölçülmüş levent firesi
// (devere) için ÖNERİ ister. O modüllerin tablolarına maliyet servisi DOĞRUDAN dokunmaz: statik
// kenar `test_*_regime_gate` tarayıcılarına `/api/cost`u o modülün kapısına bağlatırdı (ve
// tarayıcı haklı olurdu). Her fonksiyon ÖNCE lisans tavanlı `read<X>Enabled` okur; kapalıysa SORGU
// ATMADAN `null` ("bilinmiyor") döner, açıksa sahip modülün fonksiyonunu DİNAMİK import eder.
// `null` sıfır ya da 1 DEĞİLDİR: kur yoksa çağıran `FX_RATE_MISSING` yazar (`test_standart_maliyet_surum` §5).
// =============================================================================
import { Prisma, type Currency } from "@prisma/client";
import prisma from "../../lib/prisma";
import { readDevereEnabled, readEmanetEnabled, readFinanceEnabled, readIplikEnabled, readTicaretEnabled } from "../system-setting.service";
import { factoryYmd } from "../../constants/time";
import { addDaysYmd } from "./dokuma-levent-rapor.helper";

/** Ölçülmüş fire önerisi: son 180 gün, take-up'ı bilinen kapanmış levent ≥ 3 (plan §2.1). */
export const MEASURED_WASTE_DAYS = 180;
export const MEASURED_WASTE_MIN_BEAMS = 3;

/** `onDate` itibarıyla kur önerisi (1 döviz kaç TL). TRY tanım gereği 1 (sorgu yok); finans kapalı → null. */
export async function suggestFxRate(currency: Currency, onDate: Date): Promise<Prisma.Decimal | null> {
  if (currency === "TRY") return new Prisma.Decimal(1);
  if (!(await readFinanceEnabled())) return null;
  const { resolveExchangeRateTx } = await import("./finance.helper");
  return resolveExchangeRateTx(prisma as unknown as Prisma.TransactionClient, currency, onDate);
}

export interface YarnPriceSuggestion {
  iplikId: string;
  sonGiris: { birimFiyat: string; paraBirimi: string; tarih: string; fisId: string } | null;
  alisFiyati: { birimFiyat: string; paraBirimi: string; tarih: string; fiyatId: string } | null;
}

/** İplik fiyatı önerileri: son mal kabul (iplik modülü) + genel alış fiyatı (ticaret modülü). */
export async function suggestYarnPrices(yarnItemId: string): Promise<YarnPriceSuggestion> {
  const out: YarnPriceSuggestion = { iplikId: yarnItemId, sonGiris: null, alisFiyati: null };
  if (await readIplikEnabled()) {
    const { readLastYarnReceiptPrice } = await import("../yarn.service");
    const r = await readLastYarnReceiptPrice(yarnItemId);
    if (r) out.sonGiris = { birimFiyat: r.unitPrice.toFixed(4), paraBirimi: r.currency, tarih: r.at.toISOString(), fisId: r.goodsReceiptId };
  }
  if (await readTicaretEnabled()) {
    const { readLatestPurchasePrice } = await import("./item-purchase-price.helper");
    const p = await readLatestPurchasePrice(yarnItemId);
    if (p) out.alisFiyati = { birimFiyat: p.price.toFixed(4), paraBirimi: p.currency, tarih: p.at.toISOString(), fiyatId: p.id };
  }
  return out;
}

export interface MeasuredWarpWaste { firePct: string; leventSayisi: number; baslangic: string; bitis: string }

/**
 * Ölçülmüş çözgü firesi ÖNERİSİ (devere açıksa `beamResultReport`, tek kaynak). Yalnız öneridir:
 * yapıya ve standart sürüme kendiliğinden yazılmaz (plan §7-10; kullanıcı ezme olarak uygular).
 */
export async function measuredWarpWaste(warpSpecId: string): Promise<MeasuredWarpWaste | null> {
  if (!(await readDevereEnabled())) return null;
  const { beamResultReport } = await import("../reports/levent-sonucu.report.service");
  const bitis = factoryYmd();
  const baslangic = addDaysYmd(bitis, -MEASURED_WASTE_DAYS);
  const { data } = await beamResultReport({ from: baslangic, to: bitis, warpSpecId });
  const olculen = data.ozet.leventSayisi - data.ozet.olculemedi;
  if (olculen < MEASURED_WASTE_MIN_BEAMS || data.ozet.firePct === null) return null;
  return { firePct: new Prisma.Decimal(data.ozet.firePct).toFixed(2), leventSayisi: olculen, baslangic, bitis };
}

/**
 * Ürünün genel satış fiyatı önerisi (ticaret modülü `ItemPrice(SALE)`; müşteri istisnası önce).
 * Ticaret kapalı → SORGU ATMADAN null. Teklif öneri zincirinin ③ katmanı (`quote-price.helper`).
 */
export async function suggestSalePrice(itemId: string, currency: Currency, customerId: string | null): Promise<Prisma.Decimal | null> {
  if (!(await readTicaretEnabled())) return null;
  const { resolveItemPrice } = await import("../item-price.service");
  const r = await resolveItemPrice({ itemId, kind: "SALE", currency, customerId });
  return r?.price ?? null;
}

// ── Kârlılık (D4-G2a) köprüleri — `null` = modül kapalı ──

/** Kârlılığın finans okumaları (fatura, satır, kur). Finans kapalı → SORGU ATMADAN null. */
export async function loadProfitabilityFinance(): Promise<typeof import("./profitability-finance.helper") | null> {
  if (!(await readFinanceEnabled())) return null;
  return import("./profitability-finance.helper");
}

/** Sarf kalemlerinin `at` anında geçerli genel alış fiyatı (`ItemPrice(PURCHASE)`, TRY önce); ticaret kapalı → null. */
export async function suggestConsumablePurchasePrices(itemIds: string[], at: Date): Promise<Map<string, { price: Prisma.Decimal; currency: Currency }> | null> {
  if (!(await readTicaretEnabled())) return null;
  const { resolveItemPricesFor } = await import("../item-price.service");
  const out = new Map<string, { price: Prisma.Decimal; currency: Currency }>();
  let rest = [...new Set(itemIds)];
  for (const currency of ["TRY", "USD", "EUR", "GBP", "RUB"] as const) {
    if (rest.length === 0) break;
    const hit = await resolveItemPricesFor({ itemIds: rest, kind: "PURCHASE", currency, asOf: at });
    for (const [id, r] of hit) out.set(id, { price: new Prisma.Decimal(r.price), currency });
    rest = rest.filter((id) => !hit.has(id));
  }
  return out;
}

// ── İplik ihtiyaç planı (MAL-7) köprüleri — `null` = modül kapalı, "bilinmiyor"; 0 DEĞİL ──

export interface YarnStockRead { serbestKg: Prisma.Decimal; emanetKg: Prisma.Decimal | null }

/**
 * İplik stoku (iplik modülü). Emanet açıksa müşteri sahipli lotlar AYRI döner ve serbest stoktan
 * çıkarılır (müşterinin malı ihtiyacı karşılamaz); emanet kapalıysa `emanetKg: null`.
 */
export async function readYarnStock(yarnItemIds: string[]): Promise<{ emanetAcik: boolean; byItem: Map<string, YarnStockRead> } | null> {
  if (!(await readIplikEnabled())) return null;
  const consigned = await readEmanetEnabled();
  const { readYarnStockKg } = await import("../yarn-lot.service");
  const raw = await readYarnStockKg(yarnItemIds, { consigned });
  const out = new Map<string, YarnStockRead>();
  for (const [id, r] of raw) out.set(id, { serbestKg: r.consignedKg ? r.totalKg.minus(r.consignedKg) : r.totalKg, emanetKg: r.consignedKg });
  return { emanetAcik: consigned, byItem: out };
}

/** Açık alış siparişi kg'ı (ticaret modülü; OPEN/PARTIAL, KG birimli kalem). Kapalı → null. */
export async function readOpenPurchase(yarnItemIds: string[]): Promise<Map<string, Prisma.Decimal> | null> {
  if (!(await readTicaretEnabled())) return null;
  const { readOpenPurchaseKgByItem } = await import("../purchase-order.service");
  return readOpenPurchaseKgByItem(yarnItemIds);
}

/** Hazır leventlerin kalan çözgü metresi (devere modülü; READY/MOUNTED, `remainingByBeam`). Kapalı → null. */
export async function readReadyBeams(warpSpecIds: string[]): Promise<Map<string, { remainingM: Prisma.Decimal; beamCount: number }> | null> {
  if (!(await readDevereEnabled())) return null;
  const { readReadyBeamRemainingM } = await import("../warp-beam.service");
  return readReadyBeamRemainingM(warpSpecIds);
}
