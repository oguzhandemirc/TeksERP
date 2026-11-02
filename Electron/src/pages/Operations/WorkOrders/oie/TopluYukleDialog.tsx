// Toplu okutma (K8): seçilen HER dosya ayrı belge taslağı olur (tek belgenin sayfaları değil). Dosya başına ayrı deneme
// token'ı; biri düşerse diğerleri sürer, düşen satırda neden yazılır ve "Yeniden gönder" yalnız kalanları dener.
import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiErrorText } from "@/lib/api-error";
import { useAttemptToken } from "@/lib/attemptToken";
import { batchFailure } from "./batchToken";
import { createUploadNote, uploadScan } from "@/pages/Operations/GelenBelgeler/service";
import { submitUpload, UploadError, EMPTY_UPLOAD_PROGRESS, type UploadProgress } from "@/pages/Operations/GelenBelgeler/submitUpload";
import { addPickedFiles, splitAcceptedFiles, UPLOAD_ACCEPT, type UploadPage } from "@/pages/Operations/GelenBelgeler/uploadPrep";
import { UploadDropZone } from "@/pages/Operations/GelenBelgeler/UploadDropZone";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: (noteIds: string[]) => void;
}

interface Item {
  page: UploadPage;
  progress: UploadProgress;
  noteId: string | null;
  error: string | null;
}

const api = { createDraftNote: createUploadNote, uploadScan };

const noop = () => undefined;

/** Sırayla gönderir (paralel değil: okuma kuyruğu ve sunucu yükü); her dosya kendi sonucunu taşır, hatalar döner. */
export async function sendEach(items: Item[], tokenFor: (key: string) => string, onItem: (i: number, it: Item) => void): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    if (it.noteId) continue;
    // Token dosya özetine bağlı (aynı dosya aynı deneme); yapış/yenile kararı partinin sonunda (`settleBatch`).
    const binding = { token: () => tokenFor(it.page.sha256), onFailure: noop, onSuccess: noop };
    try {
      const r = await submitUpload(api, { pages: [it.page], ownerCustomerId: null, senderDocNo: null, firstPageNo: 1 }, binding, it.progress);
      onItem(i, { ...it, noteId: r.note.id, error: null });
    } catch (e) {
      errors.push(e instanceof UploadError ? e.original : e);
      const progress = e instanceof UploadError ? e.progress : it.progress;
      onItem(i, { ...it, progress, error: apiErrorText(e instanceof UploadError ? e.original : e, "Gönderilemedi.") });
    }
  }
  return errors;
}

export function TopluYukleDialog({ open, onOpenChange, onDone }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const attempt = useAttemptToken();
  const pick = async (files: File[]) => {
    const { accepted, notice } = splitAcceptedFiles(files);
    setBusy(true);
    const r = await addPickedFiles(items.map((i) => i.page), accepted);
    const known = new Set(items.map((i) => i.page.sha256));
    const fresh = r.pages.filter((p) => !known.has(p.sha256)).map((page) => ({ page, progress: EMPTY_UPLOAD_PROGRESS, noteId: null, error: null }));
    setItems([...items, ...fresh]);
    setNotices(notice ? [notice, ...r.notices] : r.notices);
    setBusy(false);
  };
  const send = async () => {
    setBusy(true);
    const next = [...items];
    const errors = await sendEach(next, (k) => attempt.keyed(k), (i, it) => { next[i] = it; setItems([...next]); });
    const failure = batchFailure(errors);
    if (failure === undefined) attempt.onSuccess();
    else attempt.onFailure(failure);
    setBusy(false);
    if (next.every((it) => it.noteId)) {
      onOpenChange(false);
      onDone(next.map((it) => it.noteId!));
    }
  };
  const pending = items.filter((i) => !i.noteId).length;
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto" data-testid="oie-bulk-upload">
        <DialogHeader>
          <DialogTitle>Birden çok belge</DialogTitle>
          <DialogDescription>Her fotoğraf ayrı bir belge ve ayrı bir iş emri olur. Okunanlar tek listede kontrol edilip birlikte kaydedilir.</DialogDescription>
        </DialogHeader>
        <input ref={fileRef} type="file" multiple accept={UPLOAD_ACCEPT} className="hidden" data-testid="oie-bulk-input" onChange={(e) => { void pick(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
        <UploadDropZone disabled={busy} onFiles={(f) => void pick(f)}>
          <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}><Upload className="mr-1 h-4 w-4" /> Dosyaları seç</Button>
        </UploadDropZone>
        <ul className="flex flex-col gap-1 text-sm">
          {items.map((it) => (
            <li key={it.page.sha256} className="flex justify-between gap-2" data-testid="oie-bulk-file">
              <span className="truncate">{it.page.name}</span>
              <span className={it.error ? "text-destructive" : "text-muted-foreground"}>{it.noteId ? "Gönderildi" : (it.error ?? "Bekliyor")}</span>
            </li>
          ))}
        </ul>
        {notices.map((n) => <p key={n} className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">{n}</p>)}
        <DialogFooter>
          {items.some((i) => i.noteId) && pending > 0 && !busy && (
            <Button variant="outline" onClick={() => { onOpenChange(false); onDone(items.filter((i) => i.noteId).map((i) => i.noteId!)); }}>Gönderilenlerle devam et</Button>
          )}
          <Button onClick={() => void send()} disabled={busy || pending === 0} data-testid="oie-bulk-send">{busy ? "Gönderiliyor…" : `Gönder (${pending})`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
