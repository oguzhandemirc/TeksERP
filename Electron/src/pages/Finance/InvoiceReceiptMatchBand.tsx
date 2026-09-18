// Fatura detayı — fatura toplamı ↔ bağlı fişlerin toplamı, toleransı AŞAN farklar sarı bantta (sunucu hesaplar).
import type { Currency, InvoiceReceiptMatch } from "./service";
import { differenceText, exceededDifferences } from "./invoiceReceipts";

export function InvoiceReceiptMatchBand({ match, currency }: { match: InvoiceReceiptMatch | null | undefined; currency: Currency }) {
  const rows = exceededDifferences(match);
  if (rows.length === 0) return null;
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200" data-testid="invoice-receipt-match">
      <div className="font-medium">Fatura, bağlı mal kabul fişlerinden toleransın üstünde ayrışıyor — onaydan önce kontrol edin.</div>
      <ul className="mt-1 list-disc pl-4">
        {rows.map((d) => <li key={d.kind}>{differenceText(d, currency)}</li>)}
      </ul>
    </div>
  );
}
