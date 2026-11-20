import { useRef, useState, type DragEvent } from "react";
import { Camera, FileText, Paperclip, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ACCEPT_ATTR, MAX_FILES, dataUrlOf, formatBytes, isImage, type DraftAttachment } from "./attachments";
import type { AttachmentDrafts } from "./useAttachmentDrafts";

interface Props {
  drafts: AttachmentDrafts;
  /** Görüntüyü çizim editöründe aç. */
  onEdit: (item: DraftAttachment) => void;
  /** Ekran görüntüsü al / yeniden al; köprü yoksa (web paneli) verilmez ve düğme çizilmez. */
  onCapture?: () => void;
  disabled?: boolean;
}

/** Panodan yapıştırılan dosyalar (ekran görüntüsü kopyalama dahil). Form `onPaste`inde çağrılır. */
export function filesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return [];
  return Array.from(data.files ?? []);
}

function Thumb({ item, onEdit, onRemove, disabled }: { item: DraftAttachment; onEdit: () => void; onRemove: () => void; disabled?: boolean }) {
  const image = isImage(item.contentType);
  return (
    <li className="group relative flex w-36 flex-col overflow-hidden rounded-md border bg-card">
      <button
        type="button"
        disabled={!image || disabled}
        onClick={onEdit}
        title={image ? "Üzerine çiz / düzenle" : item.name}
        className="flex h-20 items-center justify-center bg-muted/60"
      >
        {image ? (
          <img src={dataUrlOf(item)} alt={item.name} className="h-full w-full object-cover" />
        ) : (
          <FileText className="h-8 w-8 text-muted-foreground" />
        )}
      </button>
      <div className="flex items-center gap-1 px-2 py-1">
        <span className="min-w-0 flex-1 truncate text-[11px]" title={item.name}>
          {item.source === "screenshot" ? "Ekran görüntüsü" : item.name}
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground">{formatBytes(item.size)}</span>
      </div>
      <div className="absolute right-1 top-1 flex gap-1">
        {image && (
          <Button type="button" size="icon" variant="secondary" className="h-6 w-6" aria-label={`${item.name} düzenle`} disabled={disabled} onClick={onEdit}>
            <Pencil className="h-3 w-3" />
          </Button>
        )}
        <Button type="button" size="icon" variant="secondary" className="h-6 w-6" aria-label={`${item.name} çıkar`} disabled={disabled} onClick={onRemove}>
          <X className="h-3 w-3" />
        </Button>
      </div>
    </li>
  );
}

export function AttachmentField({ drafts, onEdit, onCapture, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const hasShot = drafts.items.some((a) => a.source === "screenshot");
  const full = drafts.items.length >= MAX_FILES;

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    if (!disabled) void drafts.addFiles(Array.from(e.dataTransfer.files));
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn("space-y-2 rounded-md border border-dashed p-3 transition-colors", over && "border-primary bg-primary/5")}
    >
      {drafts.items.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Ekler">
          {drafts.items.map((it) => (
            <Thumb key={it.id} item={it} disabled={disabled} onEdit={() => onEdit(it)} onRemove={() => drafts.remove(it.id)} />
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {onCapture && (
          <Button type="button" size="sm" variant="outline" disabled={disabled || (full && !hasShot)} onClick={onCapture}>
            <Camera className="mr-1.5 h-4 w-4" /> {hasShot ? "Yeniden al" : "Ekran görüntüsü al"}
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" disabled={disabled || full} onClick={() => inputRef.current?.click()}>
          <Paperclip className="mr-1.5 h-4 w-4" /> Dosya ekle
        </Button>
        <span className="text-xs text-muted-foreground">
          Sürükleyip bırakın ya da Ctrl+V ile yapıştırın · en çok {MAX_FILES} dosya, 10 MB · PNG, JPEG, WebP, GIF, PDF
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTR}
          className="hidden"
          aria-label="Dosya seç"
          onChange={(e) => {
            void drafts.addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>
      {drafts.errors.length > 0 && (
        <ul className="space-y-0.5 text-xs text-destructive" role="alert">
          {drafts.errors.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
