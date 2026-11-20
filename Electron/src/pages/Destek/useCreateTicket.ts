import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAttemptToken } from "@/lib/attemptToken";
import { IS_ELECTRON } from "@/lib/runtime-env";
import { getNetStats } from "@/services/netStats";
import { useTabsStore } from "@/store/tabs";
import { toOutgoing, type DraftAttachment } from "./attachments";
import { buildSupportContext } from "./context";
import { readDestekError, type DestekError } from "./errors";
import { destekService } from "./service";
import type { TicketType, TicketView } from "./types";

export interface TicketFormValues {
  type: TicketType;
  subject: string;
  message: string;
}

export type TicketFormErrors = Partial<Record<"subject" | "message", string>>;

/** İstemci doğrulaması — sınırlar sunucu Zod şemasıyla birebir (konu 1–200, mesaj 1–20 000, kırpılmış). */
export function validateTicketForm(v: Pick<TicketFormValues, "subject" | "message">): TicketFormErrors {
  const e: TicketFormErrors = {};
  const subject = v.subject.trim();
  const message = v.message.trim();
  if (!subject) e.subject = "Konu boş olamaz.";
  else if (subject.length > 200) e.subject = "Konu en çok 200 karakter olabilir.";
  if (!message) e.message = "Mesaj boş olamaz.";
  else if (message.length > 20_000) e.message = "Mesaj en çok 20.000 karakter olabilir.";
  return e;
}

/** O anki ekranın bağlamı (aktif sekme başlığı + yolu). */
function currentContext() {
  const { tabs, activeId } = useTabsStore.getState();
  const tab = tabs.find((t) => t.id === activeId);
  return buildSupportContext({
    screen: tab?.title ?? "Bilinmiyor",
    path: tab?.path ?? "/",
    isElectron: IS_ELECTRON,
    samples: getNetStats(),
    win: window,
    now: Date.now(),
  });
}

/**
 * Talep açma. `clientToken` mantıksal deneme başına BİR KEZ doğar (`useAttemptToken`): çift tıklama ve
 * belirsiz hata (ağ · 5xx · zaman aşımı) sonrası tekrar AYNI token'la gider → merkez aynı talebi döner.
 * Form her açılışta yeni deneme başlatır.
 */
export function useCreateTicket(open: boolean, onCreated: (t: TicketView) => void) {
  const attempt = useAttemptToken();
  const qc = useQueryClient();
  const [error, setError] = useState<DestekError | null>(null);

  useEffect(() => {
    if (open) {
      attempt.renew();
      setError(null);
    }
  }, [open, attempt]);

  const mutation = useMutation({
    mutationFn: (args: { values: TicketFormValues; files: DraftAttachment[] }) =>
      destekService.create({
        type: args.values.type,
        subject: args.values.subject.trim(),
        message: args.values.message.trim(),
        clientToken: attempt.token(),
        context: currentContext(),
        ...(args.files.length > 0 ? { files: toOutgoing(args.files) } : {}),
      }),
    onSuccess: (ticket) => {
      attempt.onSuccess();
      setError(null);
      void qc.invalidateQueries({ queryKey: ["destek-talepler"] });
      onCreated(ticket);
    },
    // Hata cümlesi formun İÇİNDE gösterilir (istek `suppressErrorToast` taşır); form kapanmaz.
    onError: (err) => {
      attempt.onFailure(err);
      setError(readDestekError(err));
    },
  });

  return { submit: mutation.mutate, isPending: mutation.isPending, error };
}
