// =============================================================================
// ÖDEME DİYALOĞU — açık fatura eşleme durumu (taslak · sunucu listesi · tutar izleme) — tek kanca
// =============================================================================
// Tutar kullanıcı ELLE yazmadıysa eşlenen toplamı izler ("satır seçince tutar ön-dolar"); elle yazıldıysa
// taslak tutara UYAR ("Tümü" = kalan). Liste yalnız cari + kasa/banka belliyken çekilir; tutar yazılıysa
// sunucu FIFO önerisi de gelir (`suggested`). Saf kurallar `paymentAllocationDraft.ts`.
// =============================================================================
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { listOpenInvoices, type Direction } from "./Allocations/service";
import { fromKurus, toKurus } from "./Allocations/allocationMath";
import type { Currency } from "./service";
import { allocationBlockReason, allocationItems, distributedKurus, draftItems, draftsCloseAll, draftsFromSuggestion, fillMaxDraft, type Drafts } from "./paymentAllocationDraft";

interface Args {
  customerId: string | null;
  currency: Currency;
  direction: Direction;
  /** Kasa/banka seçildi mi — para birimi ondan gelir; seçilmeden liste çekilmez. */
  accountSelected: boolean;
  amount: number;
  setAmount: (v: number) => void;
}

export function usePaymentAllocation({ customerId, currency, direction, accountSelected, amount, setAmount }: Args) {
  const [drafts, setDrafts] = useState<Drafts>({});
  const [amountTouched, setAmountTouched] = useState(false);
  const amountText = amount > 0 ? amount.toFixed(2) : undefined;
  const openQ = useQuery({
    queryKey: ["finance", "allocations", "open-invoices", "by-customer", customerId, currency, direction, amountText ?? ""],
    queryFn: () => listOpenInvoices({ customerId: customerId as string, currency, direction, ...(amountText ? { amount: amountText } : {}) }),
    enabled: Boolean(customerId) && accountSelected,
    // Tutar her değişince anahtar değişir; eski satırlar ekranda kalsın (iskelet titremesi + taslağın boş satıra
    // karşı hesaplanması önlenir), yalnız FIFO önerisi tazelenir.
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
  const rows = openQ.data?.data ?? [];
  const items = draftItems(drafts, rows);
  const distributed = distributedKurus(items);
  const amountKurus = toKurus(amount);
  const applyDrafts = (next: Drafts) => {
    setDrafts(next);
    if (!amountTouched) setAmount(fromKurus(distributedKurus(draftItems(next, rows))));
  };
  return {
    rows,
    totalOpen: openQ.data?.totalOpen ?? "0",
    isLoading: openQ.isLoading,
    isError: openQ.isError,
    drafts,
    items,
    distributed: fromKurus(distributed),
    blockReason: allocationBlockReason(items, rows, amountKurus),
    bulkItems: () => allocationItems(items),
    reset: () => {
      setDrafts({});
      setAmountTouched(false);
    },
    touchAmount: () => setAmountTouched(true),
    onDraftChange: (id: string, v: string) => applyDrafts({ ...drafts, [id]: v }),
    onFillMax: (id: string) => applyDrafts(fillMaxDraft(drafts, rows, id, amountTouched ? amountKurus : 0)),
    onFifo: () => setDrafts(draftsFromSuggestion(rows)),
    onCloseAll: () => {
      const all = draftsCloseAll(rows);
      setDrafts(all.drafts);
      setAmount(fromKurus(all.totalKurus));
      setAmountTouched(false);
    },
  };
}
