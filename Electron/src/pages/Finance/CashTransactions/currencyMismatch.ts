import type { CashTxnRow } from "./service";

// Kasa defteri satırında "belge para birimi ≠ hesap para birimi" (yalnız GÖSTERİM).
// Yeni kayıtta sunucu eşitliği zorlar; rozet eski/sapmış veriyi görünür kılar.
// Kur çevrimi YAPILMAZ — tutar belgedeki para biriminde kalır.

export interface CurrencyMismatch {
  doc: string;
  account: string;
  hint: string;
}

export function currencyMismatchOf(r: Pick<CashTxnRow, "currency" | "cashBox" | "bankAccount" | "payment">): CurrencyMismatch | null {
  const acc = r.cashBox ?? r.bankAccount;
  const account = acc?.currency;
  if (!acc || !account) return null; // eski backend: alan yok → rozet yok
  const doc = [r.payment?.currency, r.currency].find((c) => c && c !== account);
  if (!doc) return null;
  return {
    doc,
    account,
    hint: `Belge ${doc}, "${acc.name}" ise ${account} hesabıdır. Tutar belgedeki para biriminde gösterilir; burada kur çevrimi yapılmaz.`,
  };
}
