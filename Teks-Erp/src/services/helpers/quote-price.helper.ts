// =============================================================================
// TEKLİF FİYAT ÖNERİSİ — TEK ZİNCİR (MAL-4; plan §4.3, veto §8-5)
// =============================================================================
// "Bu müşteriye bu ürünü bu dövizde kaça öneririz?" sorusunun TEK cevabı:
//   ① yayınlanmış MÜŞTERİ fiyat listesi → ② yayınlanmış GENEL liste → ③ `ItemPrice(SALE)` (köprü;
//   ticaret kapalıysa SORGU ATMADAN atlanır) → ④ maliyet × (1 + kâr) (`suggestUnitPrice`).
// Liste içinde renkli satır renksizden önce gelir. Liste geçerliliği YAYIN DURUMUDUR (validFromDate/validUntilDate
// bilgi). Zinciri başka dosya kurmaz — `test_quote_price_single_source` (AST) ölçer. Sipariş formunun
// öneri zinciri DEĞİŞMEZ (`resolveItemPrice`; veto §8-5).
// =============================================================================
import { Prisma, type Currency, type QuotePriceSource } from "@prisma/client";
import { suggestUnitPrice } from "./fabric-cost.helper";
import { suggestSalePrice } from "./maliyet-bridge.helper";

type Dec = Prisma.Decimal;

export interface QuotePriceInput {
  itemId: string | null;
  colorId: string | null;
  customerId: string | null;
  currency: Currency;
  /** TL/m maliyet; yoksa ④ katmanı öneri üretmez. */
  costPerMTry: Dec | null;
  markupPct: Dec;
  /** 1 döviz kaç TL; yoksa ④ katmanı öneri üretmez (1 VARSAYILMAZ). */
  fxRate: Dec | null;
  freightPerM?: Dec | null;
  financeChargePct?: Dec | null;
  commissionPct?: Dec | null;
}

export interface QuotePriceSuggestion {
  /** Teklif dövizinde birim fiyat önerisi (4 hane); hiçbir katman cevap vermezse null. */
  suggested: Dec | null;
  source: QuotePriceSource;
  priceListLineId: string | null;
  /** ④ katmanının cevabı ayrıca — liste fiyatı seçilse de iç görünümde maliyet + kâr kıyası için. */
  costPlus: Dec | null;
}

const PUBLISHED_LIST = (customerId: string | null, currency: Currency): Prisma.PriceListWhereInput => ({ status: "PUBLISHED", customerId, currency });

/** Bir listede ürünün satırı: renk eşleşen önce, sonra renksiz. */
async function listLineTx(tx: Prisma.TransactionClient, list: Prisma.PriceListWhereInput, itemId: string, colorId: string | null) {
  const rows = await tx.priceListLine.findMany({
    where: { priceList: list, itemId, recipeId: null, OR: [{ colorId: null }, ...(colorId ? [{ colorId }] : [])] },
    select: { id: true, colorId: true, unitPrice: true },
  });
  return rows.find((r) => colorId && r.colorId === colorId) ?? rows.find((r) => r.colorId === null) ?? null;
}

export async function resolveQuotePriceSuggestionTx(tx: Prisma.TransactionClient, p: QuotePriceInput): Promise<QuotePriceSuggestion> {
  const costPlus =
    p.costPerMTry === null
      ? null
      : suggestUnitPrice({ costPerMTry: p.costPerMTry, markupPct: p.markupPct, fxRate: p.fxRate, freightPerM: p.freightPerM, financeChargePct: p.financeChargePct, commissionPct: p.commissionPct });
  if (p.itemId) {
    if (p.customerId) {
      const own = await listLineTx(tx, PUBLISHED_LIST(p.customerId, p.currency), p.itemId, p.colorId);
      if (own) return { suggested: own.unitPrice, source: "PRICE_LIST", priceListLineId: own.id, costPlus };
    }
    const general = await listLineTx(tx, PUBLISHED_LIST(null, p.currency), p.itemId, p.colorId);
    if (general) return { suggested: general.unitPrice, source: "PRICE_LIST", priceListLineId: general.id, costPlus };
    const sale = await suggestSalePrice(p.itemId, p.currency, p.customerId);
    if (sale) return { suggested: sale, source: "ITEM_PRICE", priceListLineId: null, costPlus };
  }
  return { suggested: costPlus, source: "COST_PLUS", priceListLineId: null, costPlus };
}
