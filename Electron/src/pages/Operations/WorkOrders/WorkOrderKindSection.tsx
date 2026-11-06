// İş emri türü seçimi + Fason (müşteri malı) müşterisi (2026-11-06).
// Stok ↔ Sipariş türü bağdan türetilir (seçilmez); Fason ayrı türdür: siparişsiz, müşteri zorunlu, sonradan değişmez.
import { Factory, PackageOpen } from "lucide-react";
import { FormSection } from "@/components/forms/FormSection";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import { cn } from "@/lib/utils";
import { TERIM_AD } from "@/lib/terim";

interface Props {
  isEdit: boolean;
  customerGoods: boolean;
  onCustomerGoodsChange: (next: boolean) => void;
  customerId: string | null;
  onCustomerChange: (id: string | null) => void;
  /** Sipariş kalemi seçiliyse Fason'a geçilemez (gerekçe metni). */
  blockedReason?: string;
  error?: string;
}

const CHOICE = "flex min-h-11 flex-1 items-center gap-2 rounded-md border px-3 py-2 text-left text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export function WorkOrderKindSection({ isEdit, customerGoods, onCustomerGoodsChange, customerId, onCustomerChange, blockedReason, error }: Props) {
  // Düzenlemede tür donuk: Stok/Sipariş İE'sinde bölüm gösterilmez, Fason'da müşteri salt okunur.
  if (isEdit && !customerGoods) return null;
  return (
    <FormSection title="İş türü" icon={Factory} tone="amber" required={customerGoods}>
      {!isEdit && (
        <div className="flex gap-2" role="radiogroup" aria-label="İş türü">
          <button
            type="button"
            role="radio"
            aria-checked={!customerGoods}
            onClick={() => onCustomerGoodsChange(false)}
            className={cn(CHOICE, !customerGoods ? "border-primary bg-primary/10 text-primary" : "bg-background hover:bg-muted")}
          >
            <PackageOpen className="h-4 w-4 shrink-0" />
            Stok / Sipariş
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={customerGoods}
            disabled={Boolean(blockedReason)}
            title={blockedReason}
            onClick={() => onCustomerGoodsChange(true)}
            className={cn(CHOICE, customerGoods ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-background hover:bg-muted")}
          >
            <Factory className="h-4 w-4 shrink-0" />
            {TERIM_AD.fasonMusteriMali}
          </button>
        </div>
      )}
      {customerGoods && (
        <div className="mt-3 space-y-1">
          <div className="text-xs font-medium text-muted-foreground">Müşteri (malın sahibi) *</div>
          <CustomerPickerField value={customerId} onChange={onCustomerChange} disabled={isEdit} />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <p className="text-xs text-muted-foreground">
            Sipariş bağlanmaz; müşteri işin üstünde durur ve listede görünür. Tür sonradan değiştirilemez.
          </p>
        </div>
      )}
    </FormSection>
  );
}
