// =============================================================================
// TEKLİF / FİYAT LİSTESİ GÖRÜNÜRLÜĞÜ — maliyet alanları OPT-IN (MAL-4; plan §4.3, #169 kırpma kalıbı)
// =============================================================================
// Maliyet tabanı ticari sırdır: `cost:read` taşımayan isteğe kalemin TL/m maliyeti, kâr oranı, maliyet+kâr
// önerisi, maliyet fotoğrafı, toplam maliyet ve marj HİÇ gitmez (alan düşer — sıfırlanmaz). İç not yalnız
// `quote:write`. Liste, detay ve HER geçiş yanıtı bu tek yardımcıdan geçer (`test_teklif_uc`).
// =============================================================================
import { Prisma } from "@prisma/client";
import type { SalesQuoteStatus } from "@prisma/client";
import { matchesPermission } from "../../middlewares/rbac.middleware";
import { isQuoteExpired } from "./sales-quote-state.helper";

const LINE_COST_KEYS = ["costPerMTry", "markupPct", "suggestedUnitPrice", "costSnapshot", "standardCostVersionId"] as const;
const LIST_LINE_COST_KEYS = ["costPerMTry", "markupPct", "standardCostVersionId"] as const;

type Row = Record<string, unknown>;
const omit = (o: Row, keys: readonly string[]): Row => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

export interface QuoteViewer {
  canSeeCost: boolean;
  canSeeInternal: boolean;
  quote<T extends object>(q: T): Row;
  priceList<T extends object>(l: T): Row;
}

/** Brüt marj (TL): satış (teklif dövizi × kur) − maliyet; yalnız maliyet görene. */
function margin(q: Row): { brutMarjTry: string; marjPct: string | null } | null {
  const total = q.totalAmount as Prisma.Decimal | undefined;
  const cost = q.totalCostTry as Prisma.Decimal | null | undefined;
  const fx = q.fxRate as Prisma.Decimal | undefined;
  if (!total || !cost || !fx) return null;
  const salesTry = new Prisma.Decimal(total).mul(fx);
  const m = salesTry.minus(cost);
  return { brutMarjTry: m.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2), marjPct: salesTry.gt(0) ? m.div(salesTry).mul(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2) : null };
}

export function quoteViewFor(user: { permissions?: string[] } | undefined): QuoteViewer {
  const perms = user?.permissions ?? [];
  const canSeeCost = matchesPermission(perms, "cost:read");
  const canSeeInternal = matchesPermission(perms, "quote:write");
  return {
    canSeeCost,
    canSeeInternal,
    quote(q) {
      let out: Row = { ...(q as Row) };
      // "Süresi doldu" durum değil, türetilmiş bayrak — panel tarih karşılaştırmaz, bu alanı okur (MAL-5).
      if (out.status && out.validUntilDate instanceof Date) {
        out.suresiDoldu = isQuoteExpired({ status: out.status as SalesQuoteStatus, validUntilDate: out.validUntilDate });
      }
      if (!canSeeInternal) out = omit(out, ["internalNote"]);
      if (Array.isArray(out.lines)) out.lines = (out.lines as Row[]).map((l) => (canSeeCost ? l : omit(l, LINE_COST_KEYS)));
      if (!canSeeCost) return omit(out, ["totalCostTry"]);
      return { ...out, marj: margin(out) };
    },
    priceList(l) {
      const out: Row = { ...(l as Row) };
      if (Array.isArray(out.lines) && !canSeeCost) out.lines = (out.lines as Row[]).map((x) => omit(x, LIST_LINE_COST_KEYS));
      return out;
    },
  };
}
