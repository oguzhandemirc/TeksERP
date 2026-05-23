import { useState } from "react";
import { Plus, Trash2, PackagePlus } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { usePricingEnabled } from "@/hooks/usePricingEnabled";
import { itemService } from "@/pages/Items/service";
import type { Item, ItemCreatePayload } from "@/pages/Items/types";
import { ItemFormDialog } from "@/pages/Items/ItemFormDialog";
import { LineRequiredPropertiesEditor } from "./LineRequiredPropertiesEditor";
import { OrderLineColorPicker } from "./OrderLineColorPicker";
import { OrderLineAliasFields } from "./OrderLineAliasFields";
import { newLineClientId, type OrderLineFormValues } from "./schema";
import { toast } from "sonner";

interface Props {
  value: OrderLineFormValues[];
  onChange: (next: OrderLineFormValues[]) => void;
  error?: string;
  /** Müşterinin aliası — alias suggest için. */
  customerId: string | null;
}

export function OrderLinesEditor({ value, onChange, error, customerId }: Props) {
  const qc = useQueryClient();
  const pricingEnabled = usePricingEnabled();
  const [quickAddForLine, setQuickAddForLine] = useState<string | null>(null);

  const createItemMutation = useMutation({
    mutationFn: (payload: ItemCreatePayload) =>
      itemService.create(payload as unknown as Partial<Item>),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["items"] });
      const created = res.data;
      if (quickAddForLine && created?.id) {
        updateLine(quickAddForLine, { itemId: created.id });
        toast.success(`Ürün oluşturuldu: ${created.code}`);
      }
      setQuickAddForLine(null);
    },
  });

  const updateLine = (clientId: string, patch: Partial<OrderLineFormValues>) => {
    onChange(value.map((l) => (l.clientId === clientId ? { ...l, ...patch } : l)));
  };

  const removeLine = (clientId: string) => {
    onChange(value.filter((l) => l.clientId !== clientId));
  };

  const addLine = () => {
    onChange([
      ...value,
      {
        clientId: newLineClientId(),
        itemId: "",
        colorId: null,
        quantity: 0,
        width: null,
        unitPrice: "",
        customerItemName: "",
        customerColorName: "",
        requiredPropertyIds: [],
      },
    ]);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Kalemler ({value.length})
        </div>
        <Button type="button" size="sm" variant="outline" onClick={addLine} className="gap-1">
          <Plus className="h-3.5 w-3.5" /> Kalem Ekle
        </Button>
      </div>

      <ul className="space-y-1.5">
        {value.map((line, idx) => (
          <li key={line.clientId} className="rounded-md border p-2.5">
            <div className="flex items-start gap-2">
              <Badge variant="muted" className="mt-1 h-6 w-6 justify-center font-mono">
                {idx + 1}
              </Badge>
              <div className="grid flex-1 grid-cols-12 gap-2">
                <div className="col-span-12 sm:col-span-5 flex gap-1">
                  <div className="flex-1">
                    <ReferenceSelect<Item>
                      value={line.itemId || undefined}
                      onChange={(v) =>
                        updateLine(line.clientId, {
                          itemId: v ?? "",
                          colorId: null,
                          requiredPropertyIds: [],
                        })
                      }
                      service={itemService}
                      queryKey="items"
                      getLabel={(i) => i.name}
                      placeholder="Ürün seç..."
                    />
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="h-9 w-9 shrink-0"
                    onClick={() => setQuickAddForLine(line.clientId)}
                    title="Yeni ürün tanımla"
                  >
                    <PackagePlus className="h-4 w-4" />
                  </Button>
                </div>
                <div className="col-span-12 sm:col-span-3">
                  <OrderLineColorPicker
                    itemId={line.itemId}
                    value={line.colorId ?? null}
                    onChange={(v) => updateLine(line.clientId, { colorId: v })}
                  />
                </div>
                <Input
                  className="col-span-4 sm:col-span-2 text-sm"
                  type="number"
                  step="0.1"
                  min={0}
                  placeholder="Miktar"
                  value={line.quantity || ""}
                  onChange={(e) => updateLine(line.clientId, { quantity: Number(e.target.value) || 0 })}
                />
                <Input
                  className="col-span-4 sm:col-span-2 text-sm"
                  type="number"
                  step="0.1"
                  min={0}
                  placeholder="En (cm)"
                  value={line.width ?? ""}
                  onChange={(e) =>
                    updateLine(line.clientId, {
                      width: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
                {pricingEnabled && (
                  <Input
                    className="col-span-12 sm:col-span-12 text-sm"
                    placeholder="Birim fiyat (opsiyonel)"
                    value={line.unitPrice ?? ""}
                    onChange={(e) => updateLine(line.clientId, { unitPrice: e.target.value })}
                  />
                )}
                <div className="col-span-12">
                  <OrderLineAliasFields
                    customerId={customerId}
                    itemId={line.itemId}
                    colorId={line.colorId ?? null}
                    itemName={line.customerItemName ?? ""}
                    colorName={line.customerColorName ?? ""}
                    onChange={(patch) => updateLine(line.clientId, patch)}
                  />
                </div>
                <div className="col-span-12 -mt-1">
                  <LineRequiredPropertiesEditor
                    itemId={line.itemId}
                    value={line.requiredPropertyIds ?? []}
                    onChange={(ids) => updateLine(line.clientId, { requiredPropertyIds: ids })}
                  />
                </div>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-destructive"
                onClick={() => removeLine(line.clientId)}
                aria-label="Sil"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <ItemFormDialog
        open={quickAddForLine !== null}
        onOpenChange={(open) => {
          if (!open) setQuickAddForLine(null);
        }}
        isSubmitting={createItemMutation.isPending}
        onSubmit={async (payload) => {
          await createItemMutation.mutateAsync(payload);
        }}
      />
    </div>
  );
}
