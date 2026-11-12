// Sipariş formu — "Müşteri ve şartlar" bölümü (müşteri · şube · sipariş no · termin · para birimi).
// Alanlar, kilitler ve seçiciler OrderFormDialog'dakiyle AYNI; yalnız yerleşim ayrı dosyada (tek grid).
import { Controller, type UseFormReturn } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { FormField } from "@/components/forms/FormField";
import { DatePickerInput } from "@/components/forms/DatePickerInput";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import { BranchSelect } from "@/pages/Customers/BranchSelect";
import { usePricingEnabled, useCustomerBranchesEnabled } from "@/hooks/usePricingEnabled";
import { currencyService } from "@/services/featureFlagService";
import { OrderNumberField } from "./OrderNumberField";
import type { OrderFormValues } from "./schema";

interface Props {
  form: UseFormReturn<OrderFormValues>;
  isEdit: boolean;
  headerLocked: boolean;
  /** Boş müşteri alanının nabız fazı (usePulseSync). */
  dim: boolean;
}

type Base = Pick<Props, "form" | "headerLocked">;

function CustomerBranchFields({ form, headerLocked, dim }: Base & { dim: boolean }) {
  const branchesEnabled = useCustomerBranchesEnabled();
  return (
    <>
      <FormField
        label="Müşteri"
        error={form.formState.errors.customerId}
        required
      >
        <Controller
          control={form.control}
          name="customerId"
          render={({ field }) => (
            // ① Tedarikçi modalının müşteri kipi: tam liste (CUSTOMER sonra BOTH), rol, Şehir, "Yeni müşteri".
            <CustomerPickerField
              value={field.value || null}
              onChange={(id) => {
                field.onChange(id);
                form.setValue("branchId", null);
              }}
              disabled={headerLocked}
              triggerClassName={!field.value ? `h-9 border-primary shadow-lg shadow-primary/50 ring-2 ring-primary/30 transition-all duration-700 ${dim ? "opacity-50" : "opacity-100"}` : "h-9"}
            />
          )}
        />
      </FormField>
      {branchesEnabled && (
        <FormField label="Şube" error={form.formState.errors.branchId}>
          <Controller
            control={form.control}
            name="branchId"
            render={({ field }) => (
              <BranchSelect
                customerId={form.watch("customerId") || null}
                value={field.value}
                onChange={field.onChange}
                disabled={headerLocked}
              />
            )}
          />
        </FormField>
      )}
    </>
  );
}

function CurrencyField({ form, headerLocked }: Base) {
  const currenciesQ = useQuery({
    queryKey: ["currencies"],
    queryFn: () => currencyService.list(),
    staleTime: 60 * 60 * 1000,
  });
  return (
      <FormField
        label="Para Birimi"
        htmlFor="currency"
        error={form.formState.errors.currency}
        required
      >
        <Controller
          control={form.control}
          name="currency"
          render={({ field }) => (
            <select
              id="currency"
              value={field.value}
              onChange={field.onChange}
              disabled={headerLocked}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            >
              {(currenciesQ.data?.data ?? [{ code: "TRY", name: "TRY", symbol: "₺" }]).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          )}
        />
      </FormField>
  );
}

export function OrderFormHeaderFields({ form, isEdit, headerLocked, dim }: Props) {
  const pricingEnabled = usePricingEnabled();
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      <CustomerBranchFields form={form} headerLocked={headerLocked} dim={dim} />
      {/* Saha #16 + ②: sipariş no "Parti kodu" kalıbı — otomatik/kilitli, tıklayınca yazılır, boş bırakınca
          otomatiğe döner. Termin ile aynı satırı yarı yarıya paylaşır. */}
      <div className="contents">
        <OrderNumberField form={form} isEdit={isEdit} />
        <FormField label="Termin" error={form.formState.errors.deadline}>
          <Controller
            control={form.control}
            name="deadline"
            render={({ field }) => (
              <DatePickerInput
                value={field.value ?? ""}
                onChange={field.onChange}
                placeholder="Boş = varsayılan"
              />
            )}
          />
        </FormField>
      </div>
      {pricingEnabled && <CurrencyField form={form} headerLocked={headerLocked} />}
    </div>
  );
}
