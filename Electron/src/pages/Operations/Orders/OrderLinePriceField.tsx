// Birim fiyat hücresi — kalem seçilince satış fiyatı önerisi (D2/F2). Ayrı bileşen: öneri kancası satır
// başınadır ve kancalar `map` içinde çağrılamaz. Yazma kuralı ortak saf yüklemde (`shouldApplySuggestion`):
// boşken doldur · kullanıcının yazdığını ASLA ezme · kaynak değişince yalnız bizim yazdığımız değeri tazele.
// `financeEnabled` kapısı kancanın içindedir — fabrika görünümünde istek HİÇ atılmaz (403 üretirdi).
import { useRef } from "react";
import { Input } from "@/components/ui/input";
import { useItemPriceSuggestion, describeSuggestion } from "@/hooks/useItemPriceSuggestion";
import type { OrderLineFormValues } from "./schema";

export function OrderLinePriceField({ line, customerId, currency, onPatch }: { line: OrderLineFormValues; customerId: string | null; currency: string | null; onPatch: (patch: Partial<OrderLineFormValues>) => void }) {
  const patchRef = useRef(onPatch);
  patchRef.current = onPatch;
  const suggestion = useItemPriceSuggestion({
    itemId: line.itemId || null,
    kind: "SALE",
    currency,
    customerId,
    current: line.unitPrice ?? "",
    // Sipariş formu fiyatı STRING tutar (schema.ts) — sayı string'e çevrilir, temizlik boş string yazar.
    onApply: (p) => patchRef.current({ unitPrice: p === null ? "" : String(p) }),
  });
  const helper = describeSuggestion({ price: suggestion.price, source: suggestion.source, message: suggestion.message, current: line.unitPrice ?? "" });
  return (
    <div>
      <Input className="w-full text-sm" type="number" step="0.01" min={0} placeholder="Birim fiyat" aria-label="Birim fiyat" value={line.unitPrice ?? ""} onChange={(e) => onPatch({ unitPrice: e.target.value })} />
      {helper && <p className="mt-1 text-[10px] text-muted-foreground">{helper}</p>}
    </div>
  );
}
