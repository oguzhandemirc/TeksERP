// Kumaşa özel müşteri renk adı — cari kartı ve kumaş kartı AYNI yazma yolunu kullanır (tek PUT/DELETE ucu).
// İki ekran aynı satırları gösterdiği için her yazım İKİ listeyi de tazeler; sipariş detayı da çözülmüş adı taşır.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { customerAliasService } from "./aliasService";

export const CUSTOMER_ITEM_COLOR_ALIASES_QUERY_KEY = "customer-item-color-aliases";
export const ITEM_CUSTOMER_COLOR_ALIASES_QUERY_KEY = "item-customer-color-aliases";

export interface ItemColorAliasKey {
  customerId: string;
  itemId: string;
  colorId: string;
}

export function useItemColorAliasMutations(opts?: { onSaved?: () => void; onDeleted?: () => void }) {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: [CUSTOMER_ITEM_COLOR_ALIASES_QUERY_KEY] });
    void qc.invalidateQueries({ queryKey: [ITEM_CUSTOMER_COLOR_ALIASES_QUERY_KEY] });
    void qc.invalidateQueries({ queryKey: ["orders", "detail"] });
  };

  const upsert = useMutation({
    mutationFn: ({ customerId, itemId, colorId, alias }: ItemColorAliasKey & { alias: string }) =>
      customerAliasService.upsertItemColorAlias(customerId, itemId, colorId, alias),
    onSuccess: () => {
      toast.success("Kumaşa özel renk adı kaydedildi.");
      invalidate();
      opts?.onSaved?.();
    },
  });

  const remove = useMutation({
    mutationFn: ({ customerId, itemId, colorId }: ItemColorAliasKey) =>
      customerAliasService.deleteItemColorAlias(customerId, itemId, colorId),
    onSuccess: () => {
      toast.success("Kumaşa özel renk adı silindi.");
      invalidate();
      opts?.onDeleted?.();
    },
  });

  return { upsert, remove };
}
