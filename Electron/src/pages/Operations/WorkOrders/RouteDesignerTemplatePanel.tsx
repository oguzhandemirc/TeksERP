import { Input } from "@/components/ui/input";

interface Props {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  name: string;
  onNameChange: (v: string) => void;
  code: string;
  onCodeChange: (v: string) => void;
  customerId: string | null;
  forCustomer: boolean;
  onForCustomerChange: (v: boolean) => void;
}

export function RouteDesignerTemplatePanel({
  enabled,
  onEnabledChange,
  name,
  onNameChange,
  code,
  onCodeChange,
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
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label className="text-xs text-muted-foreground">Şablon Adı *</label>
              <Input
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder="Örn: Boyahane + Kursun + Tambur"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Kod (opsiyonel)</label>
              <Input
                value={code}
                onChange={(e) => onCodeChange(e.target.value)}
                placeholder="BKT-STD"
              />
            </div>
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
