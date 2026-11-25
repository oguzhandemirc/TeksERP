// Ürün seçicisinin kayıt formu (Yeni · Örnek al; Düzenle → Ürünler ekranı, ürün kartı ortak kayıttır).
// Form = Ürünler ekranındaki ürün penceresi (aynı gövde: ItemCreatePayload).
import { Suspense, lazy, useMemo } from "react";
import type { RecordFormSpec } from "@/components/forms/record-form/types";
// Tembel: ürün penceresi ağır bir ağaç; ortak seçici (ItemPickerModal) onu statik import zincirine sokmasın.
const ItemFormDialog = lazy(() => import("./ItemFormDialog").then((m) => ({ default: m.ItemFormDialog })));
import { itemService } from "./service";
import type { Item } from "./types";
import type { ItemType } from "@/types/enums";

/** `R`: seçici satırı (ItemPickerRow özeti ya da Item) — örnek almadan önce tam kart çekilir.
 *  `allowedTypes`: seçicinin tip kapsamı; Yeni/Örnek al penceresinde Tip bununla sınırlanır (tek tipse kilitli). */
export function useItemRecordForm<R extends { id: string; code: string } = Item>(allowedTypes?: readonly ItemType[]): RecordFormSpec<Item, R> {
  const scopeKey = allowedTypes?.join(",") ?? "";
  return useMemo<RecordFormSpec<Item, R>>(() => {
    const scope = scopeKey ? (scopeKey.split(",") as ItemType[]) : undefined;
    return {
    entityName: "Ürün",
    service: itemService,
    writePermission: "item:write", // Ürünler ekranının writePermission'ı
    invalidateKeys: ["items", "item-picker"],
    templateRule: { clear: ["code"], suggestCopy: ["name"] },
    // Seçici satırı hafif özet (ItemPickerRow) — örnek almadan önce tam kart (izinli renk/özellik, yapı alanları).
    loadFull: async (row) => (await itemService.getById(row.id)).data,
    cardPath: (it) => `/definitions/items?search=${encodeURIComponent(it.code)}`,
    renderForm: ({ open, onOpenChange, initial, draft, onSubmit, isSubmitting }) => open && (
      <Suspense fallback={null}><ItemFormDialog
        open={open}
        onOpenChange={onOpenChange}
        initial={initial}
        draft={draft as Item | null}
        isSubmitting={isSubmitting}
        allowedTypes={scope}
        onSubmit={(payload) => onSubmit(payload as unknown as Partial<Item>)}
      /></Suspense>
    ),
    };
  }, [scopeKey]);
}
