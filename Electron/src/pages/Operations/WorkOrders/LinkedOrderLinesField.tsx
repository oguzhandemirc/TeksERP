import { useState } from "react";
import { Link2, Package, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { OrderPickerDialog, type PickedOrderLine } from "./OrderPickerDialog";

interface Props {
  lines: PickedOrderLine[];
  onChange: (next: PickedOrderLine[]) => void;
  /** Picker onayında çağrılır. Auto-fill için (kalem silmede tetiklenmez). */
  onPickerConfirm?: (lines: PickedOrderLine[]) => void;
  /** Edit modunda mevcut WO'nun kendi bağladığı kalemler picker'da müsait görünsün. */
  excludeWorkOrderId?: string | null;
  /** Material committed WO için: yeni sipariş satırları sadece bu kumaş + en'de olabilir. */
  requiredItemId?: string | null;
  requiredWidth?: number | null;
  /** Kalem yokken tam panel yerine slim "Sipariş Bağla" çubuğu göster (stoğa üretim). */
  compact?: boolean;
}

function earliestDeadline(lines: PickedOrderLine[]): string | null {
  const ds = lines
    .map((l) => l.orderDeadline)
    .filter((d): d is string => Boolean(d));
  if (ds.length === 0) return null;
  const min = ds.reduce((a, b) => (a < b ? a : b));
  return new Date(min).toLocaleDateString("tr-TR");
}

/**
 * Bağlı sipariş kalemleri için sol panel. Kendi header + scroll body'sini taşır
 * ki ana formdan bağımsız scroll'lansın.
 */
export function LinkedOrderLinesField({
  lines,
  onChange,
  onPickerConfirm,
  excludeWorkOrderId,
  requiredItemId,
  requiredWidth,
  compact,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const handleConfirm = (next: PickedOrderLine[]) => {
    onChange(next);
    onPickerConfirm?.(next);
  };
  const handleRemove = (lineId: string) =>
    onChange(lines.filter((l) => l.lineId !== lineId));

  const totalQty = lines.reduce((s, l) => s + Number(l.openQty), 0);
  const uniqueCustomers = new Set(lines.map((l) => l.customerId)).size;
  const deadline = earliestDeadline(lines);

  // Kalem yok + compact: 340px panel yerine tek satırlık bağla çubuğu.
  if (compact && lines.length === 0) {
    return (
      <>
        <div className="flex items-center gap-2 rounded-md border bg-muted/10 px-3 py-2 text-xs">
          <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground">
            Stoğa üretim. İstersen sipariş kalemi bağla — toplar o siparişe yazılır.
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ml-auto h-7 shrink-0 gap-1 text-xs"
            onClick={() => setPickerOpen(true)}
          >
            <Link2 className="h-3 w-3" /> Sipariş Bağla
          </Button>
        </div>
        <OrderPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          initialSelected={lines}
          onConfirm={handleConfirm}
          excludeWorkOrderId={excludeWorkOrderId}
          requiredItemId={requiredItemId}
          requiredWidth={requiredWidth}
        />
      </>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Sticky header */}
      <div className="shrink-0 space-y-1.5 border-b bg-muted/40 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Bağlı Sipariş Kalemleri
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-xs"
            onClick={() => setPickerOpen(true)}
          >
            {lines.length > 0 ? (
              <>
                <Pencil className="h-3 w-3" /> Düzenle
              </>
            ) : (
              <>
                <Link2 className="h-3 w-3" /> Seç
              </>
            )}
          </Button>
        </div>
        {lines.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">{lines.length} kalem</span>
            <span>·</span>
            <span className="tabular-nums">
              {totalQty.toLocaleString("tr-TR")} m
            </span>
            <span>·</span>
            <span>{uniqueCustomers} müşteri</span>
            {deadline && (
              <>
                <span>·</span>
                <span>termin: {deadline}</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto p-2">
        {lines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-6 text-center text-xs text-muted-foreground">
            <Link2 className="mb-2 h-7 w-7 text-muted-foreground/50" />
            <div className="font-medium text-foreground">Henüz kalem seçilmedi</div>
            <div className="mt-1">
              Bağlanmazsa stoğa üretim gibi davranır.
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {lines.map((line) => (
              <div
                key={line.lineId}
                className="group rounded-md border bg-card p-2 text-[11px]"
              >
                <div className="flex items-start justify-between gap-1">
                  <span className="font-mono text-xs font-semibold">
                    {line.orderNumber}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemove(line.lineId)}
                    className="-mr-1 -mt-0.5 rounded p-0.5 text-muted-foreground opacity-60 transition-opacity hover:bg-destructive/10 hover:text-destructive hover:opacity-100 group-hover:opacity-100"
                    aria-label={`${line.orderNumber} kaldır`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                <div className="mt-0.5 text-muted-foreground">
                  {line.customerName}
                  {line.orderDeadline && (
                    <> · termin {new Date(line.orderDeadline).toLocaleDateString("tr-TR")}</>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <span className="font-medium">{line.itemName}</span>
                  {line.itemColorName && (
                    <Badge variant="muted" className="gap-1 text-[10px]">
                      {line.itemColorHex && (
                        <span
                          className="h-2 w-2 rounded-full border"
                          style={{ backgroundColor: line.itemColorHex }}
                        />
                      )}
                      {line.itemColorName}
                    </Badge>
                  )}
                  <span className="ml-auto tabular-nums text-muted-foreground">
                    {line.quantity.toLocaleString("tr-TR")} m
                    {line.width ? ` × ${line.width}cm` : ""}
                  </span>
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  Açık {line.openQty.toLocaleString("tr-TR")} m (sevk edilmemiş)
                </div>
                {line.requiredProperties.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {line.requiredProperties.map((rp) => (
                      <Badge
                        key={rp.id}
                        variant="outline"
                        className="text-[10px]"
                      >
                        {rp.name}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <OrderPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        initialSelected={lines}
        onConfirm={handleConfirm}
        excludeWorkOrderId={excludeWorkOrderId}
        requiredItemId={requiredItemId}
        requiredWidth={requiredWidth}
      />
    </div>
  );
}
