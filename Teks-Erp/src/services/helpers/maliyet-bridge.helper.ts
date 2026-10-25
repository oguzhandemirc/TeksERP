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
import { readDevereEnabled, readFinanceEnabled, readIplikEnabled, readTicaretEnabled } from "../system-setting.service";
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
