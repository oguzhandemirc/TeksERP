// Belge yükle (yeni DRAFT) / Sayfa ekle (mevcut DRAFT) — çoklu dosya; büyük görüntü tarayıcıda küçülür, PDF arşivdir.
// Yarıda kalan gönderimin tekrarı aynı taslağa kalan sayfaları yükler (ikinci taslak açılmaz) — `useUploadForm`.
import { useRef } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import { hasPdf, PDF_NOT_READ_TEXT } from "./uploadPrep";
import { UploadPageList } from "./UploadPageList";
import { useUploadForm, type UploadTarget } from "./useUploadForm";

export type { UploadTarget } from "./useUploadForm";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  target: UploadTarget;
  onDone: (note: { id: string; noteNo: string }) => void;
}

const NOTE = "rounded px-2 py-1 text-xs";

export function UploadDialog({ open, onOpenChange, target, onDone }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const f = useUploadForm(target, (note) => {
    onOpenChange(false);
    onDone(note);
  });
  const close = (o: boolean) => {
    if (f.busy) return;
    if (!o) f.clearFields();
    onOpenChange(o);
  };
  const locked = f.headerLocked || f.busy;
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{target.kind === "new" ? "Belge yükle" : `Sayfa ekle — ${target.noteNo}`}</DialogTitle>
          <DialogDescription>Fotoğraf (JPEG/PNG) ya da PDF. Büyük fotoğraf gönderilmeden önce küçültülür; tek dosya en çok 5 MB.</DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 flex-col gap-3">
          {target.kind === "new" && (
            <>
              <CustomerPickerField value={f.owner} onChange={f.setOwner} disabled={locked} placeholder="Sahip (isteğe bağlı)" clearable />
              <Input aria-label="Gönderen belge no" placeholder="Gönderen belge no (isteğe bağlı)" value={f.docNo} maxLength={64} disabled={locked} onChange={(e) => f.setDocNo(e.target.value)} />
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,application/pdf"
            className="hidden"
            data-testid="upload-file-input"
            onChange={(e) => {
              void f.pick(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={f.busy}>
            <Upload className="mr-1 h-4 w-4" />
            Dosya seç
          </Button>
          <UploadPageList pages={f.pages} uploaded={f.progress.uploaded} disabled={f.busy} onRemove={f.discard} />
          {hasPdf(f.pages) && <p className={`${NOTE} bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200`} data-testid="upload-pdf-note">{PDF_NOT_READ_TEXT}</p>}
          {f.notices.map((n) => (
            <p key={n} className={`${NOTE} bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200`}>{n}</p>
          ))}
          {f.headerLocked && target.kind === "new" && <p className="text-xs text-muted-foreground">Taslak {f.progress.note?.noteNo} açıldı; yeniden gönderim kalan dosyaları aynı taslağa yükler.</p>}
          {f.error && <p className="rounded bg-destructive/10 px-2 py-1 text-sm text-destructive" data-testid="upload-error">{f.error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={() => void f.send()} disabled={f.busy || f.remaining === 0}>
            {f.busy ? "Gönderiliyor…" : f.error ? "Yeniden gönder" : `Gönder (${f.remaining})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
