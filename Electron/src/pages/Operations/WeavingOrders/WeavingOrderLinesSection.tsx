// =============================================================================
// DOKUMA İŞİ FORMU — "Sipariş satırları" bölümü (Z2): opsiyonel bağ, satır başına tahsis metresi
// =============================================================================
// Simple is more: yeni ZORUNLU alan yok; bağ tek dokunuşla eklenir/kaldırılır, kumaş seçilmeden
// düğme kilitli ("önce kumaş"). Gövde `orderLines` küme REPLACE — form dizisi bağların tamamıdır.
// Satırın gösterim verisi (müşteri · sipariş no · açık) form değerinde DEĞİL, yerel `meta`da:
// düzenlemede DTO'dan, eklemede seçici satırından gelir.
// =============================================================================
import { useState } from "react";
import { useFieldArray, type UseFormReturn } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/forms/FormField";
import { num, type AvailableOrderLine } from "@/pages/Operations/Orders/availableLines";
import type { WeavingOrderFormValues } from "./schema";
import type { WeavingOrderLineLink } from "./types";
import { OrderLinePickerDialog } from "./OrderLinePickerDialog";

/** Satırın gösterim verisi — DTO (kayıtlı bağ) ya da seçici satırı (yeni bağ) aynı biçime iner. */
export interface LineMeta {
  orderNumber: string;
  customerName: string;
  itemName: string;
  /** Seçiciden gelen satırda renk; kayıtlı DTO renk taşımaz → null. */
  colorName: string | null;
  /** Miktar cümlesi: seçicide "N m açık", kayıtlıda "N birim istendi" (açık metre DTO'da yok). */
  qtyText: string;
}

const fmtN = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 0 });

/** Seçici satırı → gösterim (saf): açık = netOpenQty (yoksa openQty), ölçülmeyen birimde "ölçülmüyor". */
export function metaFromAvailable(l: AvailableOrderLine): LineMeta {
  const open = num(l.netOpenQty ?? l.openQty);
  return { orderNumber: l.orderNumber, customerName: l.customerName, itemName: l.itemName, colorName: l.colorName, qtyText: open === null ? "ölçülmüyor" : `${fmtN(open)} m açık` };
}

/** Kayıtlı bağ (Z1 DTO, iç içe) → gösterim (saf): açık = quantity − shippedQty; iptal satır "iptal" işaretli. */
export function metaFromLink(l: WeavingOrderLineLink): LineMeta {
  const open = Math.max(0, num(l.orderLine.quantity) ?? 0) - Math.max(0, num(l.orderLine.shippedQty) ?? 0);
  const unit = l.orderLine.unit === "MT" ? "m" : l.orderLine.unit.toLowerCase();
  return {
    orderNumber: l.orderLine.order.orderNumber,
    customerName: l.orderLine.order.customer.name,
    itemName: l.orderLine.item.name,
    colorName: null,
    qtyText: l.orderLine.cancelledAt ? "satır iptal" : `${fmtN(Math.max(0, open))} ${unit} açık`,
  };
}

interface Props {
  form: UseFormReturn<WeavingOrderFormValues>;
  initialLines: WeavingOrderLineLink[];
  /** Bayrak (`dokumaOrderLineLinkRequired`) açıkken alan zorunlu işaretlenir; sunucu 400'ü kesin hattır. */
  required?: boolean;
}

export function WeavingOrderLinesSection({ form, initialLines, required = false }: Props) {
  const itemId = form.watch("itemId");
  const colorId = form.watch("colorId") || null;
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "orderLines" });
  const [meta, setMeta] = useState<Record<string, LineMeta>>(() =>
    Object.fromEntries(initialLines.map((l) => [l.orderLineId, metaFromLink(l)])),
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const linked = new Set(fields.map((f) => f.orderLineId));
  const rootError = form.formState.errors.orderLines;
  return (
    <FormField
      label="Sipariş satırları"
      required={required}
      error={rootError && "message" in rootError && typeof rootError.message === "string" ? (rootError as { message: string }) : undefined}
      hint={required ? "Bu kurulumda dokuma işi bir sipariş satırına bağlanmalı (ayar açık)." : "İsteğe bağlı — stoka dokuma meşru. Tahsis metresi boş bırakılabilir."}
    >
      <div className="space-y-2">
        {fields.length > 0 && (
          <table className="w-full text-sm" data-testid="wo-order-lines">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="p-1 text-left font-medium">Sipariş / Müşteri</th>
                <th className="p-1 text-left font-medium">Kumaş / Renk</th>
                <th className="p-1 text-right font-medium">Tahsis (m)</th>
                <th className="w-9 p-1" />
              </tr>
            </thead>
            <tbody>
              {fields.map((f, i) => {
                const m = meta[f.orderLineId];
                const err = form.formState.errors.orderLines?.[i]?.allocatedM;
                return (
                  <tr key={f.id} className="border-t" data-testid={`wo-ol-${f.orderLineId}`}>
                    <td className="p-1">
                      <div className="font-mono text-xs">{m?.orderNumber ?? f.orderLineId}</div>
                      <div className="text-xs text-muted-foreground">{m?.customerName ?? "—"}</div>
                    </td>
                    <td className="p-1 text-xs">
                      <div>{m?.itemName ?? "—"}</div>
                      <div className="text-muted-foreground">{m ? `${m.colorName ? `${m.colorName} · ` : ""}${m.qtyText}` : ""}</div>
                    </td>
                    <td className="p-1 text-right">
                      <Input {...form.register(`orderLines.${i}.allocatedM`)} inputMode="decimal" placeholder="boş = miktarsız" className="h-8 w-32 text-right" aria-label={`${m?.orderNumber ?? f.orderLineId} tahsis metresi`} />
                      {err?.message && <div className="mt-0.5 text-right text-[11px] text-destructive">{String(err.message)}</div>}
                    </td>
                    <td className="p-1">
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => remove(i)} aria-label={`${m?.orderNumber ?? f.orderLineId} bağını kaldır`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <Button type="button" variant="outline" size="sm" disabled={!itemId} title={!itemId ? "Önce kumaş seçin" : undefined} onClick={() => setPickerOpen(true)} data-testid="wo-ol-ekle">
          <Plus className="mr-1 h-4 w-4" /> Satır ekle
        </Button>
        {pickerOpen && itemId && (
          <OrderLinePickerDialog
            open
            onOpenChange={(o) => !o && setPickerOpen(false)}
            itemId={itemId}
            colorId={colorId}
            excludeIds={linked}
            onAdd={(rows) => {
              setMeta((prev) => ({ ...prev, ...Object.fromEntries(rows.map((r) => [r.lineId, metaFromAvailable(r)])) }));
              for (const r of rows) append({ orderLineId: r.lineId, allocatedM: "" });
              setPickerOpen(false);
            }}
          />
        )}
      </div>
    </FormField>
  );
}
