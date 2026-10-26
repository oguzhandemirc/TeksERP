// Teklif eylemlerinin ortak kabuğu: başarıda detay + liste tazelenir (uyarılar genel interceptor'dan); hata Türkçe cümleyle söylenir ve 409'da
// (durum bu arada değişti) ekran yeniden okunur — kullanıcı eski durumla karar vermesin.
import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiErrorStatus } from "../shared/errors";
import { quoteErrorMessage } from "./quote-errors";

export const quoteDetailKey = (id: string) => ["quotes", "detail", id] as const;

interface Opts<T, V> {
  quoteId: string;
  fn: (v: V) => Promise<T & { message?: string; warnings?: string[] }>;
  onDone?: (r: T) => void;
  onFail?: (e: unknown) => void;
  /** Geçiş/dönüştürme gibi TEK atımlık eylem: istek sürerken ikinci çağrı düşer (çift tık, render beklemeden). */
  exclusive?: boolean;
}

export function useQuoteMutation<T, V = void>({ quoteId, fn, onDone, onFail, exclusive }: Opts<T, V>) {
  const qc = useQueryClient();
  const inFlight = useRef(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: quoteDetailKey(quoteId) });
    void qc.invalidateQueries({ queryKey: ["quotes", "list"] });
  };
  const m = useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      if (r.message) toast.success(r.message);
      refresh();
      onDone?.(r);
    },
    onError: (e) => {
      // eslint-disable-next-line yerel/mutation-onerror-toast -- teklif istekleri `suppressErrorToast` taşır (service.ts OWN); cümle koda göre burada.
      toast.error(quoteErrorMessage(e));
      if (apiErrorStatus(e) === 409) refresh();
      onFail?.(e);
    },
  });
  if (!exclusive) return m;
  const mutate = (v: V) => {
    if (inFlight.current) return;
    inFlight.current = true;
    m.mutate(v, { onSettled: () => { inFlight.current = false; } });
  };
  return { ...m, mutate };
}
