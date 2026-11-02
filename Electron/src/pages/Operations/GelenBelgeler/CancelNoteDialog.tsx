// Onaylı gelen belge iptali (K15) — önizleme ZORUNLU: belgeden doğan HER top ve bağlı iş emri listelenir, engeller
// kırmızı; işlem görmemiş iş emri kayıt başına işaretlenir (işaretsiz açık iş emri sunucuda da engeldir). Sebep zorunlu.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAttemptToken } from "@/lib/attemptToken";
import { cancelNote, getNoteCancelPreview, INCOMING_DOCUMENT_QUERY_KEY } from "./service";
import type { CancelPreviewRoll, CancelPreviewWorkOrder, NoteCancelPreview } from "./cancelTypes";

const OUTCOME_LABEL: Record<CancelPreviewRoll["outcome"], string> = { CANCEL: "Ters kayıtla düşer", SKIP: "Zaten iptal", BLOCKED: "Engel" };
export const MIN_REASON = 3;

function RollList({ rolls }: { rolls: CancelPreviewRoll[] }) {
  return (
    <div className="max-h-56 overflow-auto rounded-md border" data-testid="cancel-rolls">
      {rolls.map((r) => (
        <div key={r.rollId} className={`flex items-center gap-3 border-b px-3 py-1.5 text-sm last:border-b-0 ${r.outcome === "BLOCKED" ? "bg-destructive/5 text-destructive" : ""}`} data-testid="cancel-roll-row">
          <span className="w-32 shrink-0 font-mono text-xs">{r.barcode ?? "—"}</span>
          <span className="w-20 shrink-0 text-xs text-muted-foreground">{r.senderRollNo ?? `Satır ${r.lineNo}`}</span>
          <span className="w-20 shrink-0 tabular-nums">{r.meters} m</span>
          <span className="min-w-0 flex-1 truncate text-xs">{r.location ?? "—"}</span>
          <span className="shrink-0 text-xs font-medium">{OUTCOME_LABEL[r.outcome]}</span>
        </div>
      ))}
    </div>
  );
}

function WorkOrderList({ items, chosen, toggle }: { items: CancelPreviewWorkOrder[]; chosen: Set<string>; toggle: (id: string) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1 rounded-md border p-2 text-sm" data-testid="cancel-work-orders">
      <p className="px-1 text-xs font-medium text-muted-foreground">Bağlı iş emirleri</p>
      {items.map((w) => (
        <label key={w.id} className={`flex items-start gap-2 rounded px-1 py-1 ${w.selectable ? "cursor-pointer hover:bg-muted/40" : "text-destructive"}`}>
          <Checkbox checked={chosen.has(w.id)} disabled={!w.selectable} onCheckedChange={() => toggle(w.id)} aria-label={`${w.workOrderNumber} birlikte iptal edilsin`} />
          <span className="min-w-0 flex-1">
            <span className="font-mono text-xs">{w.workOrderNumber}</span> · {w.noteRollCount} belge topu{w.otherRollCount > 0 ? ` + ${w.otherRollCount} başka top` : ""}
            <span className="block text-xs text-muted-foreground">{w.selectable && !chosen.has(w.id) ? "İşaretlemezseniz belge iptal edilemez." : w.effect}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

function PreviewBody({ data, chosen, toggle }: { data: NoteCancelPreview; chosen: Set<string>; toggle: (id: string) => void }) {
  const hard = data.blockers.filter((b) => b.code !== "WORK_ORDER_NOT_SELECTED");
  return (
    <div className="min-w-0 space-y-3">
      <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm" data-testid="cancel-summary">
        <strong>{data.summary.cancelRollCount}</strong> / {data.summary.rollCount} top ters kayıtla düşecek ({data.summary.cancelMeters} m)
        {data.summary.workOrderCount > 0 ? <> · <strong>{data.summary.workOrderCount}</strong> iş emri bağlı</> : null}
      </div>
      <RollList rolls={data.rolls} />
      <WorkOrderList items={data.workOrders} chosen={chosen} toggle={toggle} />
      {hard.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" data-testid="cancel-blockers">
          <p className="mb-1 font-medium">Belge iptal edilemez:</p>
          <ul className="list-disc space-y-0.5 pl-4 text-xs">
            {hard.map((b, i) => <li key={`${b.code}-${b.rollId ?? b.workOrderId ?? i}`}>{b.message}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

interface Props {
  note: { id: string; noteNo: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CancelNoteDialog({ note, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const preview = useQuery({ queryKey: [INCOMING_DOCUMENT_QUERY_KEY, "iptal-onizleme", note.id], queryFn: () => getNoteCancelPreview(note.id), enabled: open, staleTime: 0, gcTime: 0 });
  const toggle = (id: string) => setChosen((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const run = useMutation({
    mutationFn: () => cancelNote(note.id, { clientToken: attempt.token(), reason: reason.trim(), workOrderIds: [...chosen] }),
    onSuccess: (res) => {
      attempt.onSuccess();
      toast.success(`${res.note.noteNo} iptal edildi: ${res.cancelledRollCount} top düştü${res.cancelledWorkOrders.length ? `, ${res.cancelledWorkOrders.length} iş emri iptal` : ""}.`);
      void qc.invalidateQueries({ queryKey: [INCOMING_DOCUMENT_QUERY_KEY] });
      onOpenChange(false);
    },
    // Engel arada doğduysa (409) önizleme tazelenir; kesin 4xx'te token düşer, belirsizde yapışır.
    onError: (e) => { attempt.onFailure(e); void preview.refetch(); },
  });
  const data = preview.data;
  const pendingWo = data?.workOrders.some((w) => w.selectable && !chosen.has(w.id)) ?? true;
  const ready = !!data?.cancellable && !pendingWo && reason.trim().length >= MIN_REASON;
  return (
    <Dialog open={open} onOpenChange={(o) => !run.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Ban className="h-5 w-5" /> {note.noteNo} iptal edilsin mi?</DialogTitle>
          <DialogDescription>
            Belge ve satırları silinmez, "İptal edildi" olur; toplar ters kayıtla stoktan düşer. İşaretlediğiniz iş emirleri birlikte iptal edilir.
            İptal edilen belgenin kağıdı yeniden girilebilir.
          </DialogDescription>
        </DialogHeader>
        {preview.isLoading ? <Skeleton className="h-24 w-full" />
          : preview.isError || !data ? <p className="text-sm text-destructive">Önizleme alınamadı; hiçbir şey değişmedi.</p>
          : <PreviewBody data={data} chosen={chosen} toggle={toggle} />}
        <label className="block space-y-1 text-sm">
          <span className="font-medium">İptal sebebi (zorunlu)</span>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={2} aria-label="İptal sebebi" placeholder="Ör. yanlış belge girildi" />
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={run.isPending}>Vazgeç</Button>
          <Button variant="destructive" className="gap-1.5" onClick={() => run.mutate()} disabled={!ready || run.isPending} data-testid="cancel-note-confirm">
            {run.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Belgeyi iptal et
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
