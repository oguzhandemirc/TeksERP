// Teklif eylemlerinin ortak kabuğu: başarıda detay + liste tazelenir (uyarılar genel interceptor'dan); hata Türkçe cümleyle söylenir ve 409'da
// (durum bu arada değişti) ekran yeniden okunur — kullanıcı eski durumla karar vermesin.
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
}

export function useQuoteMutation<T, V = void>({ quoteId, fn, onDone, onFail }: Opts<T, V>) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: quoteDetailKey(quoteId) });
    void qc.invalidateQueries({ queryKey: ["quotes", "list"] });
  };
  return useMutation({
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
}
