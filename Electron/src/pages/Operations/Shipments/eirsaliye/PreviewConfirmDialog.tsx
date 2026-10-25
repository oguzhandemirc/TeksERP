// Yıkıcı e-İrsaliye eyleminin önizlemeli onayı: sunucu önizlemesindeki etkiler SOMUT
// listelenir; engel varsa onay kapalı ve cümle aynen basılır.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { apiErrorText } from "@/lib/api-error";
import { EIrsaliyeStatusBadge } from "./EIrsaliyeStatusBadge";
import type { EIrsaliyePreview, EIrsaliyeRecord } from "./types";

export interface PreviewConfirmProps {
  record: EIrsaliyeRecord | null;
  title: string;
  confirmLabel: string;
  previewKey: string;
  loadPreview: (id: string) => Promise<EIrsaliyePreview>;
  execute: (preview: EIrsaliyePreview) => Promise<unknown>;
  successText: string;
  onClose: () => void;
  onDone: () => void;
}

export function PreviewConfirmDialog(p: PreviewConfirmProps) {
  const id = p.record?.id ?? "";
  const q = useQuery({ queryKey: ["eirsaliye", p.previewKey, id], queryFn: () => p.loadPreview(id), enabled: Boolean(id), retry: false, gcTime: 0 });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (!p.record) return null;
  const preview = q.data;

  const confirm = async () => {
    if (!preview) return;
    setPending(true);
    try {
      await p.execute(preview);
      toast.success(p.successText);
      p.onDone();
      p.onClose();
    } catch (e) {
      setError(apiErrorText(e, "İşlem yapılamadı."));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && p.onClose()}>
      <DialogContent className="w-[min(34rem,calc(100vw-2rem))] max-w-none" data-testid={`eirsaliye-${p.previewKey}`}>
        <DialogHeader>
          <DialogTitle>{p.title}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{p.record.documentNo ?? "Numarasız taslak"}</span>
            <EIrsaliyeStatusBadge status={p.record.status} simulasyon={p.record.simulasyon} />
          </DialogDescription>
        </DialogHeader>
        {q.isLoading && <Skeleton className="h-16 w-full" />}
        {q.isError && <Callout tone="danger">{apiErrorText(q.error, "Önizleme alınamadı.")}</Callout>}
        {preview && (
          <>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {preview.etkiler.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
            {preview.engel && <Callout tone="danger">{preview.engel}</Callout>}
          </>
        )}
        {error && <Callout tone="danger">{error}</Callout>}
        <DialogFooter>
          <Button variant="outline" onClick={p.onClose} disabled={pending}>Vazgeç</Button>
          <Button variant="destructive" onClick={() => void confirm()} disabled={pending || !preview || Boolean(preview.engel)}>
            {p.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
