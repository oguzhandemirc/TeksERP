// Cari finans özeti — SAF: bakiye/vadesi geçmiş/risk satırları PARA BİRİMİ BAŞINA kalır (asla toplanmaz).
import { money, type CariRow, type Currency } from "@/pages/Finance/service";

export interface BalanceLine {
  currency: Currency;
  text: string;
  /** Pozitif = cari bize borçlu; negatif = biz borçluyuz; sıfır = kapalı. */
  side: "receivable" | "payable" | "zero";
}

/** Sıfır bakiyeli para birimi gösterilmez; hepsi sıfırsa tek "0" satırı (varsayılan birim). */
export function balanceLines(acc: Pick<CariRow, "balances" | "defaultCurrency">): BalanceLine[] {
  const lines = (acc.balances ?? [])
    .filter((b) => Number(b.balance) !== 0)
    .map<BalanceLine>((b) => ({ currency: b.currency, text: money(Math.abs(b.balance), b.currency), side: b.balance > 0 ? "receivable" : "payable" }));
  return lines.length > 0 ? lines : [{ currency: acc.defaultCurrency, text: money(0, acc.defaultCurrency), side: "zero" }];
}

export const SIDE_LABEL: Record<BalanceLine["side"], string> = { receivable: "bize borçlu", payable: "biz borçluyuz", zero: "hesap kapalı" };

/** Vadesi geçmiş açık tutarlar (sıfırlar atılır) — alan yoksa (eski backend) boş. */
export function overdueLines(acc: Pick<CariRow, "overdue">): { currency: Currency; text: string }[] {
  return (acc.overdue ?? []).filter((o) => Number(o.amount) > 0).map((o) => ({ currency: o.currency, text: money(o.amount, o.currency) }));
}

/** Risk kullanımı — yalnız limitin birimindeki bakiyeyle kıyaslanır; öteki birimler karışmaz. */
export function riskUsage(acc: Pick<CariRow, "balances" | "defaultCurrency" | "riskLimit">): { limit: string; pct: number | null } | null {
  const limit = acc.riskLimit == null ? null : Number(acc.riskLimit);
  if (limit == null || !Number.isFinite(limit) || limit <= 0) return null;
  const bal = acc.balances?.find((b) => b.currency === acc.defaultCurrency)?.balance ?? 0;
  return { limit: money(limit, acc.defaultCurrency), pct: Math.max(0, Math.round((bal / limit) * 100)) };
}
