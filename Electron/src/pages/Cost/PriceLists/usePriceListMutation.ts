// Fiyat listesi eylemlerinin ortak kabuğu: başarıda detay + liste tazelenir; hata Türkçe; 409'da ekran yeniden okunur.
// İstek sürerken ikinci çağrı düşer (çift tık render beklemeden tek istek).
import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiErrorStatus } from "../shared/errors";
import { priceListErrorMessage } from "./pl-errors";

export const priceListDetailKey = (id: string) => ["price-lists", "detail", id] as const;

interface Opts<T, V> { listId: string; fn: (v: V) => Promise<T & { message?: string }>; onDone?: (r: T) => void; onFail?: (e: unknown) => void }

export function usePriceListMutation<T, V = void>({ listId, fn, onDone, onFail }: Opts<T, V>) {
  const qc = useQueryClient();
  const inFlight = useRef(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: priceListDetailKey(listId) });
    void qc.invalidateQueries({ queryKey: ["price-lists", "list"] });
  };
  const m = useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      if (r.message) toast.success(r.message);
      refresh();
      onDone?.(r);
    },
    onError: (e) => {
      // eslint-disable-next-line yerel/mutation-onerror-toast -- fiyat listesi istekleri `suppressErrorToast` taşır (service.ts OWN); cümle koda göre burada.
      toast.error(priceListErrorMessage(e));
      if (apiErrorStatus(e) === 409) refresh();
      onFail?.(e);
    },
  });
  const mutate = (v: V) => {
    if (inFlight.current) return;
    inFlight.current = true;
    m.mutate(v, { onSettled: () => { inFlight.current = false; } });
  };
  return { ...m, mutate };
}
