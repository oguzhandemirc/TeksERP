import { useEffect, useMemo, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import type { PickedOrderLine } from "./OrderPickerDialog";
import type { WorkOrderFormValues } from "./schema";

/**
 * Bağlı sipariş kalemleri → form alanları otomatik senkronizasyonu.
 *
 * - `derived`: kalemlerden türeyen `totalQuantity` (açık toplamı = hedef metraj
 *   ÖNERİSİ, kullanıcı değiştirebilir) ve `width` (tüm en'ler eşitse o değer).
 * - `handleLinesChange`: kalem ekle/sil — form'un `orderLineIds`'i + state'i günceller
 *   (link-only, metraj taşımaz); `targetQuantity` önerisi + (eşitse) `width` senkron.
 * - `handlePickerConfirm`: picker onayında targetItem + targetPropertyIds otomatik dolar
 *   (tüm kalemler aynı kumaş ise). Kalem silmede yeniden çalışmaz.
 */
export function useLinkedLinesAutoFill(form: UseFormReturn<WorkOrderFormValues>) {
  const [pickedLines, setPickedLines] = useState<PickedOrderLine[]>([]);

  const derived = useMemo(() => {
    if (pickedLines.length === 0) return null;
    const first = pickedLines[0];
    if (!first) return null;
    const allSameWidth = pickedLines.every((l) => l.width === first.width);
    return {
      // Önerilen hedef metraj = bağlı kalemlerin açık (sevk edilmemiş) toplamı.
      totalQuantity: pickedLines.reduce((sum, l) => sum + Number(l.openQty), 0),
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
    // Link-only: yalnız hangi kalemler bağlı — metraj taşımaz (fazla → stok).
    form.setValue(
      "orderLineIds",
      next.map((l) => l.lineId),
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
