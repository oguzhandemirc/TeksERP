// =============================================================================
// SİPARİŞ NO — iş emrindeki "Parti kodu" kalıbı (sipariş formu ②, 2026-09-17; emsal WorkOrderFormView:859-897)
// =============================================================================
// Otomatik modda kutu salt-okunur + kilit ikonu + "Otomatik oluşturulur — kendiniz girmek için tıklayın.";
// tıklayınca (odak) yazılabilir; boş bırakıp çıkınca otomatik moda döner. Düzenlemede `disabled` + not.
// Tekillik: backend 409 "'X' numaralı sipariş zaten var" → ALAN hatası (`form.setError`), toast değil —
// çağıran `orderNumberConflictMessage` ile ayıklar.
// =============================================================================
import { useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/forms/FormField";
import { cn } from "@/lib/utils";
import type { OrderFormValues } from "./schema";

export const ORDER_NUMBER_AUTO_PLACEHOLDER = "Otomatik oluşturulur — kendiniz girmek için tıklayın.";

type ApiErr = { response?: { status?: number; data?: { message?: string } }; message?: string } | undefined;

/** 409 gövdesinden sipariş no çakışmasını ayıklar; değilse null (öteki hatalar toast'ta kalır). */
export function orderNumberConflictMessage(err: unknown): string | null {
  const e = err as ApiErr;
  const msg = e?.response?.data?.message ?? "";
  return e?.response?.status === 409 && /numaralı sipariş zaten var/.test(msg) ? msg : null;
}

/** Sunucu mesajı varsa o, yoksa genel cümle (elle numarada genel toast bastırıldığı için form basar). */
export function apiErrorMessage(err: unknown): string {
  const e = err as ApiErr;
  return e?.response?.data?.message ?? e?.message ?? "İşlem başarısız.";
}

interface Props {
  form: UseFormReturn<OrderFormValues>;
  isEdit: boolean;
}

export function OrderNumberField({ form, isEdit }: Props) {
  const [override, setOverride] = useState(false);
  const editable = isEdit || override;
  return (
    <FormField label="Sipariş No" htmlFor="orderNumber" error={form.formState.errors.orderNumber} hintTone="muted" hint={override && !isEdit ? "Benzersiz olmalı — boş bırakırsanız otomatik atanır." : undefined}>
      <div className="relative">
        <Input
          id="orderNumber"
          readOnly={!editable}
          disabled={isEdit}
          placeholder={editable ? "örn: SIP-2026-001" : ORDER_NUMBER_AUTO_PLACEHOLDER}
          className={cn(!editable && "cursor-pointer bg-muted/40 pr-9")}
          onFocus={() => {
            if (!isEdit && !override) setOverride(true);
          }}
          {...form.register("orderNumber", {
            onBlur: (e) => {
              if (!isEdit && !e.target.value.trim()) {
                setOverride(false);
                form.clearErrors("orderNumber");
              }
            },
          })}
        />
        {!editable && <Lock className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />}
      </div>
      {isEdit && <p className="mt-1 text-xs text-muted-foreground">Mevcut siparişin numarası değiştirilemez (muhasebe/irsaliye izi).</p>}
    </FormField>
  );
}
