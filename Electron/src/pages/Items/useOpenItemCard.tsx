// "Üründe aç" (desen kartı, D3/K7): kumaşa ait olanın (atkı, varyant, ek çözgü) asıl yeri kumaşın KENDİ ürün penceresidir.
// Pencere istenen sekmede açılır; kaydetme Ürün Kartları ekranıyla aynı gövde ve uçtan (ortak kayıt formu). Yazma izni
// yoksa pencere yerine Ürün Kartları ekranı yeni sekmede açılır (okuma).
import { Suspense, lazy, useCallback, useMemo, useState } from "react";
import { useRecordForm } from "@/components/forms/record-form/useRecordForm";
import type { RecordFormSpec } from "@/components/forms/record-form/types";
import { ItemType } from "@/types/enums";
import type { Item } from "./types";
import { useItemRecordForm } from "./useItemRecordForm";

const ItemFormDialog = lazy(() => import("./ItemFormDialog").then((m) => ({ default: m.ItemFormDialog })));
const FABRIC_ONLY = [ItemType.FABRIC] as const;

export type ItemCardTab = "warp" | "weft" | "weave" | "variants";
interface FabricRef { id: string; code: string }

export function useOpenItemCard() {
  const base = useItemRecordForm<FabricRef>(FABRIC_ONLY);
  const [tab, setTab] = useState<ItemCardTab>("weft");
  const spec = useMemo<RecordFormSpec<Item, FabricRef>>(() => ({
    ...base,
    // Kullanım yeri değil, kumaşın kendi tanım penceresi: düzenleme burada serbest.
    isExclusive: () => true,
    invalidateKeys: [...base.invalidateKeys, "weave-designs", "item-construction", "weft-specs"],
    renderForm: ({ open, onOpenChange, initial, onSubmit, isSubmitting }) => open && (
      <Suspense fallback={null}><ItemFormDialog
        open={open}
        onOpenChange={onOpenChange}
        initial={initial}
        initialTab={tab}
        isSubmitting={isSubmitting}
        onSubmit={(payload) => onSubmit(payload as unknown as Partial<Item>)}
      /></Suspense>
    ),
  }), [base, tab]);
  const handle = useRecordForm(spec, () => undefined);
  const { canWrite, openEdit } = handle;
  const open = useCallback((fabric: FabricRef, target: ItemCardTab) => {
    if (!canWrite) {
      void import("@/store/tabs").then((m) => m.useTabsStore.getState().openTab(base.cardPath(fabric), { forceNew: true }));
      return;
    }
    setTab(target);
    openEdit(fabric);
  }, [canWrite, openEdit, base]);
  return { open, element: handle.element };
}
