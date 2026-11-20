import { useState } from "react";
import { FileText, ImageOff, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatBytes, isImage } from "./attachments";
import { readDestekError } from "./errors";
import { downloadAttachment, useAttachmentContent } from "./useAttachmentBlob";
import type { TicketAttachment } from "./types";

const EXPIRED = "Ek süresi dolduğu için silindi.";

function errorText(e: unknown): string {
  const err = readDestekError(e);
  return err.code === "ATTACHMENT_EXPIRED" ? EXPIRED : err.message;
}

/** Asıl görsel: sunucu vekilinden `blob:` olarak, panel içinde. */
function ImageViewer({ a, onClose }: { a: TicketAttachment; onClose: () => void }) {
  const original = useAttachmentContent(a.id, "original", true);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[90vw]">
        <DialogHeader>
          <DialogTitle className="truncate">{a.name}</DialogTitle>
          <DialogDescription>{formatBytes(a.size)}</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[75vh] min-h-40 items-center justify-center overflow-auto">
          {original.url ? (
            <img src={original.url} alt={a.name} className="max-h-[75vh] max-w-full object-contain" />
          ) : original.error ? (
            <span className="text-sm text-destructive">{errorText(original.error)}</span>
          ) : (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Yazışmadaki ek: görselse küçük önizleme (`variant=thumb`), tıklanınca asıl görsel panel içinde; PDF tıklanınca
 * indirilir. Baytlar sunucu vekilinden gelir (§5.10). Silinmiş ek istek ATMAZ; yüklenemezse dosya adı görünür.
 */
export function AttachmentPreview({ a }: { a: TicketAttachment }) {
  const [error, setError] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  const [viewing, setViewing] = useState(false);
  const image = isImage(a.mime);
  const thumb = useAttachmentContent(a.id, "thumb", image && !a.deleted);

  const expired = thumb.error ? readDestekError(thumb.error).code === "ATTACHMENT_EXPIRED" : false;
  if (a.deleted || expired) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed px-2 py-1.5 text-[11px] text-muted-foreground">
        <ImageOff className="h-3.5 w-3.5 shrink-0" />
        <span>Ek süresi dolduğu için silindi · {a.name} · {formatBytes(a.size)}</span>
      </div>
    );
  }

  const open = () => {
    setError(null);
    if (image) setViewing(true);
    else void downloadAttachment(a.id, a.name).catch((e: unknown) => setError(errorText(e)));
  };

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={open}
        title={image ? `${a.name} — büyüt` : `${a.name} — indir`}
        className="flex items-center gap-2 overflow-hidden rounded-md border bg-background/60 text-left text-xs hover:bg-accent/50"
      >
        {image && thumb.url && !broken ? (
          <img src={thumb.url} alt={a.name} className="max-h-40 max-w-[16rem] object-contain" onError={() => setBroken(true)} />
        ) : (
          <span className="flex items-center gap-2 px-2 py-1.5">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="max-w-[14rem] truncate">{a.name}</span>
            <span className="text-muted-foreground">{formatBytes(a.size)}</span>
          </span>
        )}
      </button>
      {error && <span className="text-[11px] text-destructive">{error}</span>}
      {viewing && <ImageViewer a={a} onClose={() => setViewing(false)} />}
    </div>
  );
}
