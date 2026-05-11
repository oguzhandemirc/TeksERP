import { useState } from "react";
import { Link2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FormField } from "@/components/forms/FormField";
import { OrderPickerDialog, type PickedOrderLine } from "./OrderPickerDialog";

interface Props {
  lines: PickedOrderLine[];
  onChange: (next: PickedOrderLine[]) => void;
  /** Picker onayında çağrılır. Auto-fill için (kalem silmede tetiklenmez). */
  onPickerConfirm?: (lines: PickedOrderLine[]) => void;
}

export function LinkedOrderLinesField({ lines, onChange, onPickerConfirm }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const handleConfirm = (next: PickedOrderLine[]) => {
    onChange(next);
    onPickerConfirm?.(next);
  };

  const handleRemove = (lineId: string) => {
    onChange(lines.filter((l) => l.lineId !== lineId));
  };

  return (
    <FormField label="Bağlı Sipariş Kalemleri (opsiyonel)">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground">
            Bu iş emrinin karşılayacağı sipariş kalemlerini seç.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={() => setPickerOpen(true)}
          >
            <Link2 className="h-3.5 w-3.5" />
            {lines.length > 0 ? "Düzenle" : "Sipariş Kalemi Seç"}
          </Button>
        </div>

        {lines.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            Henüz sipariş kalemi seçilmedi. Bağlanmazsa stoğa üretim gibi davranır.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {lines.map((line) => (
              <div
                key={line.lineId}
                className="flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-xs"
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono font-medium">{line.orderNumber}</span>
                    <span className="text-muted-foreground">·</span>
                    <span>{line.customerName}</span>
                    {line.orderDeadline && (
                      <Badge variant="muted" className="ml-auto text-[10px]">
                        Termin: {new Date(line.orderDeadline).toLocaleDateString("tr-TR")}
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{line.itemName}</span>
                    {line.itemColorName && (
                      <Badge variant="muted" className="gap-1 text-[10px]">
                        {line.itemColorHex && (
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: line.itemColorHex }}
                          />
                        )}
                        {line.itemColorName}
                      </Badge>
                    )}
                    <span className="text-muted-foreground">
                      {line.quantity.toLocaleString("tr-TR")} m
                      {line.width ? ` × ${line.width} cm` : ""}
                    </span>
                  </div>
                  {line.requiredProperties.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="text-[10px] text-muted-foreground">
                        Özellik:
                      </span>
                      {line.requiredProperties.map((rp) => (
                        <Badge key={rp.id} variant="outline" className="text-[10px]">
                          {rp.name}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-destructive"
                  onClick={() => handleRemove(line.lineId)}
                  aria-label="Kaldır"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <OrderPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          initialSelectedIds={lines.map((l) => l.lineId)}
          onConfirm={handleConfirm}
        />
      </div>
    </FormField>
  );
}
