// Belge tipini SIFIRLA ("bu tipi unut" = pasife al; geri alınabilir). Önce sunucu önizlemesi (yazmaz) etkilenen HER tipi
// listeler — sürüm, okuma, belge durumları, açık taslaklar, bağlı gönderen — kayıt başına seçim; sonuç done/failed ayrı
// gösterilir (düşen kayıt sessiz geçmez). Eski belgeler, iş emirleri ve okumalar değişmez (kök kural: yıkıcı işlemde önizleme).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatFactory } from "@/lib/factory-time";
import { lowerTr } from "@/lib/tr-case";
import { INCOMING_DOCUMENT_QUERY_KEY } from "../service";
import { NOTE_STATUS_LABEL } from "../noteStatus";
import type { NoteStatus } from "../types";
import { previewTemplateReset, resetTemplates } from "./service";
import type { TemplateResetFailure, TemplateResetPreviewItem, TemplateResetResult } from "./types";

export const RESET_EXPLAIN = "Sıfırlanan tip artık belge tanımaz. Eski belgeler, iş emirleri ve okumalar DEĞİŞMEZ. Aynı belgeyi yeniden tanıtabilirsiniz; tip \"Kullanılmayan tipler\"den geri alınabilir.";
const DRAFTS_SHOWN = 50;

/** "3 onaylandı · 1 taslak" — durum sayıları sunucudan. */
export function notesText(byStatus: TemplateResetPreviewItem["notesByStatus"]): string {
  const parts = Object.entries(byStatus)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([s, n]) => `${n} ${lowerTr(NOTE_STATUS_LABEL[s as NoteStatus] ?? s)}`);
  return parts.length ? parts.join(" · ") : "okunan belge yok";
}

function PreviewRow({ item, checked, onToggle }: { item: TemplateResetPreviewItem; checked: boolean; onToggle: () => void }) {
  const more = item.draftsTotal - Math.min(item.drafts.length, DRAFTS_SHOWN);
  return (
    <div className="flex gap-3 border-b px-3 py-2 text-sm last:border-b-0" data-testid={`reset-row-${item.code}`}>
      <Checkbox className="mt-0.5" checked={checked} disabled={!item.isActive} onCheckedChange={onToggle} aria-label={`${item.name} sıfırlansın`} />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="font-medium">
          {item.name} <span className="text-xs font-normal text-muted-foreground">{item.code} · sürüm {item.version}</span>
        </div>
        {!item.isActive && <div className="text-xs text-muted-foreground">Zaten kullanılmıyor.</div>}
        <div className="text-xs text-muted-foreground">
          {item.hitCount} okuma · {notesText(item.notesByStatus)}
          {item.lastReadAt && ` · son okuma ${formatFactory(item.lastReadAt, "dd.MM.yyyy HH:mm")}`}
          {item.sender && ` · gönderen ${item.sender.name}`}
        </div>
        {item.draftsTotal > 0 && (
          <div className="text-xs text-amber-800 dark:text-amber-300" data-testid={`reset-drafts-${item.code}`}>
            Açık taslak: {item.drafts.slice(0, DRAFTS_SHOWN).map((d) => d.documentNo).join(", ")}
            {more > 0 && ` +${more} daha`} — taslaklar kalır, elle tamamlanır.
          </div>
        )}
      </div>
    </div>
  );
}

function FailedList({ failed, names }: { failed: TemplateResetFailure[]; names: Map<string, string> }) {
  if (failed.length === 0) return null;
  return (
    <ul className="space-y-0.5 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs" data-testid="reset-failed">
      {failed.map((f) => (
        <li key={f.code}><b>{names.get(f.code) ?? f.code}</b> — {f.message}</li>
      ))}
    </ul>
  );
}

function ResultView({ result, names }: { result: TemplateResetResult; names: Map<string, string> }) {
  return (
    <div className="space-y-2 text-sm" data-testid="reset-result">
      {result.done.length > 0 && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3" data-testid="reset-done">
          <b>{result.done.length} tip sıfırlandı:</b> {result.done.map((d) => names.get(d.code) ?? d.code).join(", ")}
        </div>
      )}
      <FailedList failed={result.failed} names={names} />
    </div>
  );
}

interface Props {
  /** Önizlenecek kodlar; null/boş → kapalı. */
  codes: string[] | null;
  /** Çoklu kip: kutular boş başlar (kullanıcı seçer); tekil kipte seçili. */
  multi?: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SablonSifirlaDialog({ codes, multi = false, onOpenChange }: Props) {
  const open = !!codes && codes.length > 0;
  const qc = useQueryClient();
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const preview = useQuery({ queryKey: ["gelen-belge-sablon-sifirla-onizleme", codes], queryFn: () => previewTemplateReset(codes ?? []), enabled: open, staleTime: 0, gcTime: 0 });
  const items = preview.data?.items ?? [];
  const chosen = picked ?? new Set(multi ? [] : items.filter((i) => i.isActive).map((i) => i.code));
  const selected = items.filter((i) => i.isActive && chosen.has(i.code));
  const names = new Map(items.map((i) => [i.code, i.name]));
  const apply = useMutation({
    mutationFn: () => resetTemplates(selected.map((i) => ({ code: i.code, expectedVersion: i.version }))),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [INCOMING_DOCUMENT_QUERY_KEY] }),
  });
  const toggle = (code: string) => {
    const n = new Set(chosen);
    if (n.has(code)) n.delete(code);
    else n.add(code);
    setPicked(n);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !apply.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><RotateCcw className="h-5 w-5" /> {multi ? "Belge tiplerini sıfırla" : "Belge tipini sıfırla"}</DialogTitle>
          <DialogDescription>{RESET_EXPLAIN}</DialogDescription>
        </DialogHeader>
        <div className="min-w-0">
          {apply.data ? (
            <ResultView result={apply.data} names={names} />
          ) : preview.isLoading ? (
            <p className="text-sm text-muted-foreground">Önizleme alınıyor…</p>
          ) : preview.isError ? (
            <p className="text-sm text-destructive">Önizleme alınamadı; hiçbir tip sıfırlanmadı. Diyaloğu kapatıp yeniden deneyin.</p>
          ) : (
            <div className="space-y-2">
              <div className="max-h-80 overflow-auto rounded-md border">
                {items.map((i) => <PreviewRow key={i.code} item={i} checked={chosen.has(i.code)} onToggle={() => toggle(i.code)} />)}
              </div>
              <FailedList failed={preview.data?.failed ?? []} names={names} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={apply.isPending}>{apply.data ? "Kapat" : "Vazgeç"}</Button>
          {!apply.data && (
            <Button variant="destructive" className="gap-1.5" onClick={() => apply.mutate()} disabled={apply.isPending || !preview.data || selected.length === 0} data-testid="reset-apply">
              {apply.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {selected.length > 1 ? `${selected.length} tipi sıfırla` : "Seçileni sıfırla"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
