import { useState, type ClipboardEvent } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Textarea } from "@/components/ui/textarea";
import { AnnotateDialog } from "./annotate/AnnotateDialog";
import { AttachmentField, filesFromClipboard } from "./AttachmentField";
import { startReport } from "./useDestekShell";
import { useAttachmentDrafts } from "./useAttachmentDrafts";
import { useReply } from "./useTicketQueries";
import { useScreenshotActions } from "./useScreenshotActions";

interface Props {
  ticketId: string;
  canTenant: boolean;
  /** Kapalı talepte açıklama satırı ("yanıt yazarsanız talep yeniden açılır"). */
  closedNote?: string | null;
}

/** Yanıt kutusu: metin + ek (ekran görüntüsü ve çizim dahil). Gönderim sürerken kilitli. */
export function ReplyBox({ ticketId, canTenant, closedNote }: Props) {
  const [message, setMessage] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const drafts = useAttachmentDrafts();
  const shots = useScreenshotActions(drafts);
  const { send, isPending, error } = useReply(ticketId, canTenant);

  const submit = async () => {
    if (isPending) return;
    const text = message.trim();
    if (!text) return setLocalError("Mesaj boş olamaz.");
    if (text.length > 20_000) return setLocalError("Mesaj en çok 20.000 karakter olabilir.");
    setLocalError(null);
    try {
      await send({ message: text, files: drafts.items });
      setMessage("");
      drafts.reset(null);
    } catch {
      /* hata `useReply.error` ile kutunun altında gösterilir; yazılan metin korunur */
    }
  };

  const onPaste = (e: ClipboardEvent) => {
    const files = filesFromClipboard(e.clipboardData);
    if (files.length === 0) return;
    e.preventDefault();
    void drafts.addFiles(files);
  };

  return (
    <div className="space-y-2 border-t bg-background p-3" onPaste={onPaste}>
      {closedNote && <p className="text-xs text-muted-foreground">{closedNote}</p>}
      <Textarea
        aria-label="Yanıtınız"
        rows={3}
        value={message}
        disabled={isPending}
        placeholder="Yanıtınızı yazın… (Ctrl+Enter gönderir)"
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void submit();
        }}
      />
      <AttachmentField drafts={drafts} onEdit={shots.startEdit} onCapture={shots.capture} disabled={isPending} />
      {(localError || error) && (
        <Callout tone="danger">
          {localError ?? error?.message}
          {error?.suggestNewTicket && (
            <Button type="button" size="sm" variant="outline" className="ml-2 h-6" onClick={() => void startReport(0)}>
              Yeni talep aç
            </Button>
          )}
        </Callout>
      )}
      <div className="flex justify-end">
        <Button type="button" disabled={isPending} onClick={() => void submit()}>
          <Send className="mr-1.5 h-4 w-4" /> {isPending ? "Gönderiliyor…" : "Gönder"}
        </Button>
      </div>
      <AnnotateDialog source={shots.editSource} onClose={shots.cancelEdit} onSave={shots.saveEdit} />
    </div>
  );
}
