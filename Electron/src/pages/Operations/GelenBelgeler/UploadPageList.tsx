// Yükleme modalındaki dosya listesi: ad, boy, "küçültüldü"/"gönderildi" işareti, kaldır.
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes, PDF_MIME, type UploadPage } from "./uploadPrep";

interface Props {
  pages: UploadPage[];
  uploaded: ReadonlySet<string>;
  disabled: boolean;
  onRemove: (sha256: string) => void;
}

export function UploadPageList({ pages, uploaded, disabled, onRemove }: Props) {
  if (!pages.length) return null;
  return (
    <ul className="flex flex-col gap-1 text-sm" data-testid="upload-pages">
      {pages.map((p, i) => (
        <li key={p.sha256} className="flex min-w-0 items-center gap-2 rounded border px-2 py-1">
          <span className="shrink-0 text-xs text-muted-foreground">#{i + 1}</span>
          <span className="min-w-0 flex-1 truncate" title={p.name}>{p.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {p.mimeType === PDF_MIME ? "PDF" : `${p.width}×${p.height}`} · {formatBytes(p.sizeBytes)}
            {p.resized ? " · küçültüldü" : ""}
            {uploaded.has(p.sha256) ? " · gönderildi" : ""}
          </span>
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label={`${p.name} kaldır`} disabled={disabled || uploaded.has(p.sha256)} onClick={() => onRemove(p.sha256)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </li>
      ))}
    </ul>
  );
}
