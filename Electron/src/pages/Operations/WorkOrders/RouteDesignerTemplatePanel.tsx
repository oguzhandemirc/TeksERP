import { Input } from "@/components/ui/input";

interface Props {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  name: string;
  onNameChange: (v: string) => void;
  customerId: string | null;
  forCustomer: boolean;
  onForCustomerChange: (v: boolean) => void;
}

export function RouteDesignerTemplatePanel({
  enabled,
  onEnabledChange,
  name,
  onNameChange,
  customerId,
  forCustomer,
  onForCustomerChange,
}: Props) {
  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
        />
        Bu rotayı şablon olarak kaydet
      </label>
      {enabled && (
        <div className="space-y-2 pl-6">
          <div>
            <label className="text-xs text-muted-foreground">Şablon Adı *</label>
            <Input
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="Örn: Boyahane + Kursun + Tambur"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Kod otomatik atanır.
            </p>
          </div>
          {customerId && (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={forCustomer}
                onChange={(e) => onForCustomerChange(e.target.checked)}
              />
              Bu müşteriye özel varsayılan rota olarak kaydet
            </label>
          )}
        </div>
      )}
    </div>
  );
}
