// Kart formu "Finans" bölümü (Z-B ①) — yalnız `finance:read` + modül açıkken çizilir; `finance:write` yoksa salt-okunur.
// Açık bakiye ve mevcut terimler kartın hesabından (`by-customer`); hesap yoksa (404) sakin cümle, uydurma yok.
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { UseFormReturn } from "react-hook-form";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { getCariByCustomer, money, type Currency } from "@/pages/Finance/service";
import { FINANCE_CURRENCIES, financeFieldsFromView, riskLimitError, termDaysError, type FinanceFormFields } from "./customerFinance";

/** Üç kapı tek yerde: modül · okuma · yazma — dialog ve iki sayfa (payload) aynı cevabı okur. */
export function useCustomerFinanceAccess(): { enabled: boolean; canRead: boolean; canWrite: boolean } {
  const enabled = useFeatureFlags().data?.data?.financeEnabled ?? false;
  const { hasPermission } = useRoleAccess();
  return { enabled, canRead: enabled && hasPermission("finance:read"), canWrite: enabled && hasPermission("finance:write") };
}

interface Props {
  form: UseFormReturn<FinanceFormFields & Record<string, unknown>>;
  /** Düzenlemede kart id'si — hesap/terimler ondan okunur; yeni kartta null (hesap kayıtla doğar). */
  customerId: string | null;
  canWrite: boolean;
}

export function CustomerFinanceSection({ form, customerId, canWrite }: Props) {
  const acc = useQuery({
    queryKey: ["finance", "cari", "by-customer", customerId],
    queryFn: () => getCariByCustomer(customerId as string),
    enabled: Boolean(customerId),
    staleTime: 30_000,
  });
  // Terimler açılışta BİR KEZ tohumlanır (kullanıcının yazdığı geri alınmaz); hesap yoksa alanlar boş kalır.
  useEffect(() => {
    if (!acc.isSuccess || !acc.data) return;
    const f = financeFieldsFromView({ paymentTermDays: acc.data.paymentTermDays ?? null, defaultCurrency: acc.data.defaultCurrency as Currency, taxOffice: acc.data.taxOffice ?? null, riskLimit: acc.data.riskLimit == null ? null : String(acc.data.riskLimit), isActive: acc.data.isActive });
    for (const [k, v] of Object.entries(f)) if (!form.getValues(k as keyof FinanceFormFields)) form.setValue(k as keyof FinanceFormFields, v as never, { shouldDirty: false });
  }, [acc.isSuccess, acc.data, form]);
  const term = form.watch("financePaymentTermDays") as string;
  const risk = form.watch("financeRiskLimit") as string;
  const ro = !canWrite;
  return (
    <div className="border-t pt-3" data-testid="customer-finance">
      <div className="mb-2 flex items-baseline justify-between">
        <h4 className="text-sm font-semibold">Finans</h4>
        <span className="text-[11px] text-muted-foreground">{ro ? "Salt okunur — düzenleme için muhasebe yazma yetkisi gerekir" : "Terimler cari hesapta tutulur; fatura vadesi buradan önerilir"}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Vade (gün)" error={termDaysError(term ?? "") ? { message: termDaysError(term ?? "") as string } : undefined}>
          <Input type="number" min={0} max={3650} step={1} readOnly={ro} aria-label="Vade (gün)" {...form.register("financePaymentTermDays")} />
        </FormField>
        <FormField label="Para birimi">
          <select className="h-9 w-full rounded-md border bg-background px-2 text-sm disabled:opacity-60" disabled={ro} aria-label="Para birimi" {...form.register("financeDefaultCurrency")}>
            <option value="">(hesap varsayılanı)</option>
            {FINANCE_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </FormField>
        <FormField label="Vergi dairesi"><Input maxLength={100} readOnly={ro} aria-label="Vergi dairesi" {...form.register("financeTaxOffice")} /></FormField>
        <FormField label="Risk limiti" error={riskLimitError(risk ?? "") ? { message: riskLimitError(risk ?? "") as string } : undefined}>
          <Input inputMode="decimal" readOnly={ro} aria-label="Risk limiti" {...form.register("financeRiskLimit")} />
        </FormField>
      </div>
      <p className="mt-2 text-xs text-muted-foreground" data-testid="customer-finance-balance">
        {!customerId ? "Cari hesap kart kaydedilince kendiliğinden açılır." : acc.isLoading ? "Hesap okunuyor…" : acc.isError ? "Hesap okunamadı — bu, hesap yok demek DEĞİLDİR." : !acc.data ? "Bu kartın cari hesabı henüz yok — kurulum göçü tamamlanınca ya da ilk finans kaydında doğar." : `Açık bakiye: ${acc.data.balances.filter((b) => Number(b.balance) !== 0).map((b) => money(b.balance, b.currency)).join(" · ") || "0"}`}
      </p>
    </div>
  );
}
