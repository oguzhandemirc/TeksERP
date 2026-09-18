// =============================================================================
// ÖDEME DİYALOĞU — "Açık faturalar" bölümü (mevcut `OpenInvoiceTable` yeniden kullanılır; kayıt yolu `allocateBulk`)
// =============================================================================
// Simple is more: cari + kasa seçilince liste kendiliğinden gelir; satırdaki "Tümü" tek tıkla o faturayı
// kapatır ve tutar boşsa tutarı ön-doldurur; "FIFO dağıt" yazılı tutarı vade sırasıyla böler (sunucu önerisi);
// "Tümünü kapat" hepsini yazar ve tutarı toplamla doldurur. Hiçbir şey seçilmezse ödeme BAĞSIZ kaydedilir.
// =============================================================================
import { Button } from "@/components/ui/button";
import { OpenInvoiceTable } from "./Allocations/OpenInvoiceTable";
import type { OpenInvoiceRow } from "./Allocations/service";
import { money, type Currency } from "./service";
import type { Drafts } from "./paymentAllocationDraft";

interface Props {
  rows: OpenInvoiceRow[];
  totalOpen: string;
  isLoading: boolean;
  isError: boolean;
  currency: Currency;
  drafts: Drafts;
  distributed: number;
  amount: number;
  blockReason: string | null;
  disabled: boolean;
  onDraftChange: (invoiceId: string, value: string) => void;
  onFillMax: (invoiceId: string) => void;
  onFifo: () => void;
  onCloseAll: () => void;
}

export function PaymentOpenInvoices(p: Props) {
  const hasRows = p.rows.length > 0;
  return (
    <div className="mt-3 space-y-2 rounded-md border p-3" data-testid="payment-open-invoices">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-medium">
          Açık faturalar
          {hasRows && <span className="ml-1 text-muted-foreground">({p.rows.length} · {money(Number(p.totalOpen), p.currency)})</span>}
        </div>
        <div className="ml-auto flex gap-2">
          <Button type="button" size="sm" variant="outline" disabled={p.disabled || !hasRows || p.amount <= 0} title="Yazılı tutarı vade sırasıyla faturalara böler" onClick={p.onFifo} data-testid="odeme-fifo">
            FIFO dağıt
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={p.disabled || !hasRows} title="Bütün açık faturaları kapatır ve tutarı toplamla doldurur" onClick={p.onCloseAll} data-testid="odeme-tumunu-kapat">
            Tümünü kapat
          </Button>
        </div>
      </div>
      <OpenInvoiceTable rows={p.rows} isLoading={p.isLoading} isError={p.isError} currency={p.currency} drafts={p.drafts} onDraftChange={p.onDraftChange} onFillMax={p.onFillMax} disabled={p.disabled} />
      <p className="text-xs text-muted-foreground" data-testid="odeme-eslenen">
        {p.distributed > 0 ? `Eşlenen: ${money(p.distributed, p.currency)}` : "Seçim yoksa ödeme faturaya bağlanmadan kaydedilir; sonra Fatura Kapama'dan eşlenebilir."}
      </p>
      {p.blockReason && <p className="text-xs text-destructive" data-testid="odeme-engel">{p.blockReason}</p>}
    </div>
  );
}
