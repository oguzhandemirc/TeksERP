import { useEffect, useMemo, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import type { PickedOrderLine } from "./OrderPickerDialog";
import type { WorkOrderFormValues } from "./schema";

/**
 * Bağlı sipariş kalemleri → form alanları otomatik senkronizasyonu.
 *
 * - `derived`: kalemlerden türeyen `totalQuantity` (toplam) ve `width`
 *   (tüm en'ler eşitse o değer, değilse null).
 * - `handleLinesChange`: kalem ekle/sil — form'un `orderLineIds`'i + state'i günceller,
 *   `targetQuantity` ve (eşitse) `width` her zaman senkronize tutulur.
 * - `handlePickerConfirm`: picker onayında targetItem + targetPropertyIds otomatik dolar
 *   (tüm kalemler aynı ürün ise). Kalem silmede yeniden çalışmaz.
 */
export function useLinkedLinesAutoFill(form: UseFormReturn<WorkOrderFormValues>) {
  const [pickedLines, setPickedLines] = useState<PickedOrderLine[]>([]);

  const derived = useMemo(() => {
    if (pickedLines.length === 0) return null;
    const first = pickedLines[0];
    if (!first) return null;
    const allSameWidth = pickedLines.every((l) => l.width === first.width);
    return {
      totalQuantity: pickedLines.reduce((sum, l) => sum + Number(l.allocatedQty), 0),
      width: allSameWidth && first.width != null ? first.width : null,
    };
  }, [pickedLines]);

  useEffect(() => {
    if (!derived) return;
    form.setValue("targetQuantity", derived.totalQuantity);
    if (derived.width != null) form.setValue("width", derived.width);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derived]);

  const handleLinesChange = (next: PickedOrderLine[]) => {
    setPickedLines(next);
    form.setValue(
      "orderLineIds",
      next.map((l) => l.lineId),
    );
    form.setValue(
      "orderLineAllocations",
      next.map((l) => ({ orderLineId: l.lineId, allocatedQty: l.allocatedQty })),
    );
  };

  const handlePickerConfirm = (lines: PickedOrderLine[]) => {
    const first = lines[0];
    if (!first) return;
    const allSameItem = lines.every((l) => l.itemId === first.itemId);
    if (!allSameItem) return;

    form.setValue("targetItemId", first.itemId);

    const allSameColor = lines.every((l) => l.colorId === first.colorId);
    if (allSameColor) {
      form.setValue("targetColorId", first.colorId);
    }

    const propIds = new Set<string>();
    for (const line of lines) {
      for (const prop of line.requiredProperties) propIds.add(prop.id);
    }
    form.setValue("targetPropertyIds", Array.from(propIds));
  };

  return {
    pickedLines,
    setPickedLines,
    derived,
    handleLinesChange,
    handlePickerConfirm,
  };
}
