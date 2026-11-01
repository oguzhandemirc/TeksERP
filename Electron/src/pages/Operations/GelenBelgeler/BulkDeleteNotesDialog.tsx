// Toplu taslak silme — önizleme ZORUNLU (kök CLAUDE.md: yıkıcı işlemde etkilenen HER kayıt listelenir, kayıt
// başına seçim). Sunucu önizlemesi kesin hükümdür; silinemeyen belge gizlenmez, nedeniyle gösterilir.
// Uygula her kaydı tekil silme yolundan geçirir; sonuç kayıt başınadır (biri düşerse diğerleri silinir).
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { applyBulkDeleteNotes, INCOMING_DOCUMENT_QUERY_KEY, previewBulkDeleteNotes } from "./service";
import type { BulkDeletePreviewItem, BulkDeleteResult } from "./types";

interface Props {
  /** Seçilen belge kimlikleri; null/boş → kapalı. */
  ids: string[] | null;
  onOpenChange: (open: boolean) => void;
  /** Uygula bitti (kısmi de olsa) — çağıran seçimi temizler. */
  onDone?: () => void;
}

/** Sonuç toast'ı — düşen kayıt SESSİZ geçmez: numarası ve Türkçe nedeniyle söylenir. */
function resultToast(res: BulkDeleteResult, items: BulkDeletePreviewItem[]): void {
  const failed = res.results.filter((r) => !r.ok);
  const deleted = res.summary.deleted;
  if (failed.length === 0) {
    toast.success(`${deleted} taslak silindi.`);
    return;
  }
  const noOf = (id: string) => items.find((i) => i.id === id)?.noteNo ?? id.slice(0, 8);
  toast.warning(`${deleted} taslak silindi, ${failed.length} belge silinemedi.`, {
    description: failed.map((f) => `${noOf(f.id)}: ${f.message ?? "silinemedi"}`).join(" · "),
    duration: 12_000,
  });
}

function PreviewRow({ item, checked, onToggle }: { item: BulkDeletePreviewItem; checked: boolean; onToggle: () => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-muted/40" data-testid="bulk-delete-row">
      <Checkbox checked={checked} onCheckedChange={onToggle} aria-label={`${item.noteNo ?? ""} silinsin`} />
      <span className="w-32 shrink-0 font-mono text-xs">{item.noteNo}</span>
      <span className="min-w-0 flex-1 truncate">
        {item.ownerName ?? "Sahip seçilmedi"} · {item.senderName ?? "—"}
        {item.senderDocNo ? ` · ${item.senderDocNo}` : ""}
      </span>
      <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
        {item.lineCount} satır · {item.scanCount} sayfa
      </span>
    </label>
  );
}

function BlockedList({ items }: { items: BulkDeletePreviewItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm" data-testid="bulk-delete-blocked">
      <p className="mb-1 font-medium">{items.length} belge silinmeyecek:</p>
      <ul className="space-y-0.5 text-xs">
        {items.map((i) => (
          <li key={i.id}>
            <span className="font-mono">{i.noteNo ?? i.id.slice(0, 8)}</span> — {i.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface BodyProps {
  loading: boolean;
  error: boolean;
  deletable: BulkDeletePreviewItem[];
  blocked: BulkDeletePreviewItem[];
  chosen: BulkDeletePreviewItem[];
  excluded: Set<string>;
  toggle: (id: string) => void;
}

/** Önizleme gövdesi — özet şeridi, kayıt başına seçilebilir taslaklar, silinmeyecekler kutusu. */
function PreviewBody({ loading, error, deletable, blocked, chosen, excluded, toggle }: BodyProps) {
  return (
    <>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">Önizleme alınamadı; hiçbir belge silinmedi. Diyaloğu kapatıp yeniden deneyin.</p>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm" data-testid="bulk-delete-summary">
              <strong>{chosen.length}</strong> taslak silinecek —{" "}
              <strong>{chosen.reduce((s, i) => s + i.lineCount, 0)}</strong> satır,{" "}
              <strong>{chosen.reduce((s, i) => s + i.scanCount, 0)}</strong> sayfa fotoğrafı çözülecek.
            </div>
            {deletable.length > 0 && (
              <div className="max-h-72 overflow-auto rounded-md border">
                {deletable.map((i) => (
                  <PreviewRow key={i.id} item={i} checked={!excluded.has(i.id)} onToggle={() => toggle(i.id)} />
                ))}
              </div>
            )}
            <BlockedList items={blocked} />
          </div>
        )}
    </>
  );
}

export function BulkDeleteNotesDialog({ ids, onOpenChange, onDone }: Props) {
  const open = !!ids && ids.length > 0;
  const qc = useQueryClient();
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const preview = useQuery({
    queryKey: ["gelen-belge-toplu-sil-onizleme", ids],
    queryFn: () => previewBulkDeleteNotes(ids ?? []),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
  });
  const items = useMemo(() => preview.data?.items ?? [], [preview.data]);
  const deletable = items.filter((i) => i.deletable);
  const blocked = items.filter((i) => !i.deletable);
  const chosen = deletable.filter((i) => !excluded.has(i.id));
  const toggle = (id: string) =>
    setExcluded((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const apply = useMutation({
    mutationFn: () => applyBulkDeleteNotes(chosen.map((i) => i.id)),
    onSuccess: (res) => {
      resultToast(res, items);
      const gone = new Set(res.results.filter((r) => r.ok).map((r) => r.id));
      qc.removeQueries({ predicate: (q) => q.queryKey[0] === INCOMING_DOCUMENT_QUERY_KEY && q.queryKey[1] === "detail" && gone.has(String(q.queryKey[2])) });
      // Liste + sekme sayaçları (özet aynı sorgudan) tazelenir.
      void qc.invalidateQueries({ queryKey: [INCOMING_DOCUMENT_QUERY_KEY] });
      setExcluded(new Set());
      onOpenChange(false);
      onDone?.();
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !apply.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5" /> Seçilen taslakları sil
          </DialogTitle>
          <DialogDescription>
            Yalnız taslak silinir; satırları kalıcı gider, geri alınamaz. Sayfa fotoğrafları silinmez, yeni belgede
            kullanılabilir. Silinen numaralar yeniden verilmez. Silmek istemediğinizin işaretini kaldırın.
          </DialogDescription>
        </DialogHeader>
        <PreviewBody loading={preview.isLoading} error={preview.isError} deletable={deletable} blocked={blocked} chosen={chosen} excluded={excluded} toggle={toggle} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={apply.isPending}>
            Vazgeç
          </Button>
          <Button variant="destructive" className="gap-1.5" onClick={() => apply.mutate()} disabled={apply.isPending || preview.isLoading || chosen.length === 0}>
            {apply.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {chosen.length} taslağı sil
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
