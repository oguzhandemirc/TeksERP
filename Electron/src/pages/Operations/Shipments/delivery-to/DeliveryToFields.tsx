import { useState } from "react";
import { MapPin } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import { customerService } from "@/pages/Customers/service";
import { DELIVERY_ADDRESS_MAX, EMPTY_DELIVERY_TO, deliveryToError, formatCustomerAddress, type DeliveryToState } from "./deliveryTo";

/**
 * "Teslim yeri (başka adrese teslim)" — opsiyonel; kutu kapalıyken alan yok (bugünkü form).
 * Cari modal seçiciden (combobox yok); seçilince kart adresi adres kutusuna ön dolar, düzenlenebilir.
 */
export function DeliveryToFields({
  value,
  onChange,
  ownerCustomerId,
  disabled,
  defaultOpen,
}: {
  value: DeliveryToState;
  onChange: (v: DeliveryToState) => void;
  /** Sevkiyatın carisi — teslim yeri o olamaz (sunucu da 400 der). */
  ownerCustomerId?: string | null;
  disabled?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? value.customerId !== null);
  const [loading, setLoading] = useState(false);
  const error = deliveryToError(value, ownerCustomerId);

  const pick = async (customerId: string | null) => {
    if (!customerId) {
      onChange(EMPTY_DELIVERY_TO);
      return;
    }
    onChange({ customerId, address: value.address });
    setLoading(true);
    try {
      const c = (await customerService.getById(customerId)).data as Parameters<typeof formatCustomerAddress>[0];
      onChange({ customerId, address: formatCustomerAddress(c) ?? "" });
    } catch {
      // Adres ön doldurulamadı — boş kalır; sunucu belge doğarken kart adresini basar.
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-md border p-3" data-testid="delivery-to-fields">
      <label className="flex items-center gap-2 text-sm font-medium">
        <Checkbox
          checked={open}
          disabled={disabled}
          aria-label="Teslim yeri (başka adrese teslim)"
          onCheckedChange={(v) => {
            setOpen(!!v);
            if (!v) onChange(EMPTY_DELIVERY_TO);
          }}
        />
        <MapPin className="h-4 w-4 text-muted-foreground" />
        Teslim yeri (başka adrese teslim)
      </label>
      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-muted-foreground">
            Sevkiyatın carisi malın sahibi kalır; seçilen cari (ör. boyahane) irsaliyeye teslim yeri olarak basılır.
          </p>
          <CustomerPickerField variant="cari" clearable value={value.customerId} onChange={(id) => void pick(id)} disabled={disabled} placeholder="Teslim yeri carisi seç…" />
          <textarea
            value={value.address}
            maxLength={DELIVERY_ADDRESS_MAX}
            rows={2}
            disabled={disabled || loading || !value.customerId}
            aria-label="Teslim adresi"
            onChange={(e) => onChange({ customerId: value.customerId, address: e.target.value })}
            placeholder={value.customerId ? "Teslim adresi (boş bırakılırsa carinin kart adresi basılır)" : "Önce teslim yeri carisi seçin"}
            className="w-full resize-none rounded-md border border-input bg-background px-3 py-1.5 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}
