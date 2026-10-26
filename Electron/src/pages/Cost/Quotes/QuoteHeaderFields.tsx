// Teklif başlığı alanları (yeni + taslak düzenleme). Müşteri seçici DOĞRUDAN modal (yalnız müşteri rollü kartlar
// sunucuda doğrulanır: CUSTOMER_ROLE_REQUIRED). Müşteri ve döviz yalnız yeni teklifte seçilir (sunucu PATCH'te reddeder).
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/forms/FormField";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import { DatePickerInput } from "@/components/forms/DatePickerInput";
import { BranchSelect } from "@/pages/Customers/BranchSelect";
import { CurrencySelect } from "../shared/CurrencySelect";
import type { QuoteHeaderForm } from "./service";

export interface HeaderFieldsProps {
  value: QuoteHeaderForm;
  onChange: (patch: Partial<QuoteHeaderForm>) => void;
  mode: "create" | "update";
  /** Kayıtlı teklifte kur kaynağı rozeti (sunucu alanı). */
  fxSource?: "MANUAL" | "TCMB" | null;
  customerName?: string;
}

const Grid = ({ children }: { children: ReactNode }) => <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>;

function fxSourceLabel(currency: string, src: HeaderFieldsProps["fxSource"]): string | null {
  if (currency === "TRY" || src === undefined) return null;
  return src === "MANUAL" ? "Elle girildi" : src === "TCMB" ? "TCMB" : "Finans kuru önerisi";
}

function PartyFields({ value, onChange, mode, fxSource, customerName }: HeaderFieldsProps) {
  const src = fxSourceLabel(value.currency, fxSource);
  return (
    <Grid>
      <FormField label="Müşteri" required className="sm:col-span-2">
        {mode === "create" ? (
          <CustomerPickerField value={value.customerId} onChange={(customerId) => onChange({ customerId, branchId: null })} />
        ) : (
          <p className="flex h-9 items-center text-sm font-medium">{customerName}</p>
        )}
      </FormField>
      <FormField label="Şube (sevk noktası)">
        <BranchSelect customerId={value.customerId} value={value.branchId} onChange={(branchId) => onChange({ branchId })} />
      </FormField>
      <FormField label="Geçerlilik (son gün)" hint={mode === "create" ? "Boş: teklif tarihinden 30 gün" : undefined}>
        <DatePickerInput value={value.validUntilDate} onChange={(v) => onChange({ validUntilDate: v })} aria-label="Geçerlilik tarihi" />
      </FormField>
      <FormField label="Para birimi" required>
        {mode === "create" ? (
          <CurrencySelect value={value.currency} onChange={(currency) => onChange({ currency })} />
        ) : (
          <p className="flex h-9 items-center text-sm font-medium">{value.currency}</p>
        )}
      </FormField>
      {value.currency !== "TRY" && (
        <FormField label={`Kur (1 ${value.currency} = ? TL)`} hint={mode === "create" ? "Boş: finans modülünün kuru önerilir" : undefined}>
          <div className="flex items-center gap-2">
            <Input inputMode="decimal" value={value.fxRate} onChange={(e) => onChange({ fxRate: e.target.value })} aria-label="Kur" />
            {src && <Badge variant="outline" className="whitespace-nowrap" data-testid="fx-source">{src}</Badge>}
          </div>
        </FormField>
      )}
    </Grid>
  );
}

function TermFields({ value, onChange }: HeaderFieldsProps) {
  const num = (label: string, key: "paymentTermDays" | "commissionPct" | "financeChargePct" | "freightPerM", hint?: string) => (
    <FormField label={label} hint={hint}>
      <Input inputMode="decimal" value={value[key]} onChange={(e) => onChange({ [key]: e.target.value })} aria-label={label} />
    </FormField>
  );
  return (
    <Grid>
      {num("Vade (gün)", "paymentTermDays")}
      {num("Vade farkı %", "financeChargePct")}
      {num("Komisyon %", "commissionPct")}
      {num(`Navlun (${value.currency}/m)`, "freightPerM")}
    </Grid>
  );
}

function TextFields({ value, onChange }: HeaderFieldsProps) {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <FormField label="Müşteri referansı">
        <Input maxLength={100} value={value.customerReference} onChange={(e) => onChange({ customerReference: e.target.value })} />
      </FormField>
      <FormField label="Not (müşteriye)">
        <Textarea rows={2} maxLength={1000} value={value.notes} onChange={(e) => onChange({ notes: e.target.value })} />
      </FormField>
      <FormField label="İç not" hint="Müşteri belgesine çıkmaz">
        <Textarea rows={2} maxLength={1000} value={value.internalNote} onChange={(e) => onChange({ internalNote: e.target.value })} />
      </FormField>
    </div>
  );
}

export function QuoteHeaderFields(p: HeaderFieldsProps) {
  return (
    <div className="space-y-3">
      <PartyFields {...p} />
      <TermFields {...p} />
      <TextFields {...p} />
    </div>
  );
}
