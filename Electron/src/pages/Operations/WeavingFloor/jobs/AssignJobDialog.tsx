// "İş ver" / "İşi değiştir" penceresi: ① Dokuma İş Emri seçici (modal içinde liste) → ② önizleme (her tezgah adıyla,
// satır başına seçim) → ③ sonuç (Başladı · Olmadı · Uyarılar). Dolu hatta iş vermek Değiştir'dir ve yalnız işaretlenen
// satırda olur; satır token'ı mantıksal deneme başına bir kez (`useAttemptToken.keyed`). Tezgah başına farklı iş (C.6)
// yalnız sunucu `rowJobs` derse çizilir; tek işte gövde bugünkü gibi.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAttemptToken } from "@/lib/attemptToken";
import { apiErrorMessage } from "@/services/apiClient";
import { LOOM_FLOOR_QUERY_KEY } from "../useLoomFloorLive";
import type { LiveLoom } from "../types";
import { PreviewTable, ResultView, usePickedRows } from "./BulkParts";
import { JobPicker } from "./JobPicker";
import { RowJobs } from "./RowJobs";
import { LoomFitList } from "./LoomFitList";
import { useProposalGates } from "@/pages/Operations/Orders/production-proposal/gates";
import { allJobsChosen, assignRowsOf, assignTargetsOf, effectiveJobOf, initialSelection, isMixed, jobIdOf, maxLinesOf, rowKey, withRowJobs, type JobDialogMode } from "./plan";
import { runService, type BulkPreview, type BulkResult, type BulkTarget } from "./runService";

export const BULK_CONTEXT_QUERY_KEY = ["machine-runs", "bulk-context"] as const;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  looms: readonly LiveLoom[];
  mode: JobDialogMode;
  online: boolean;
}

function LinePicker({ max, value, onChange }: { max: number; value: number; onChange: (n: number) => void }) {
  return (
    <div role="radiogroup" aria-label="Hat" className="flex items-center gap-2 text-sm">
      <span>Çift hatlı tezgahlarda hat:</span>
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <Button key={n} type="button" size="sm" role="radio" aria-checked={value === n} variant={value === n ? "default" : "outline"} onClick={() => onChange(n)}>
          {n}. hat
        </Button>
      ))}
    </div>
  );
}

function useAssignFlow({ open, looms, mode }: Pick<Props, "open" | "looms" | "mode">) {
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const [jobId, setShared] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<ReadonlyMap<string, string>>(new Map());
  const [line, setLine] = useState(1);
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const { picked, setPicked, toggle } = usePickedRows();
  const [result, setResult] = useState<BulkResult | null>(null);
  const maxLines = useMemo(() => maxLinesOf(looms), [looms]);

  useEffect(() => {
    if (!open) return;
    setShared(null);
    setOverrides(new Map());
    setLine(1);
    setPreview(null);
    setResult(null);
    attempt.renew();
  }, [open, attempt]);

  const ctx = useQuery({ queryKey: BULK_CONTEXT_QUERY_KEY, queryFn: runService.context, enabled: open });
  const weavingOrderId = jobIdOf(jobId);
  const mixed = ctx.data?.rowJobs === true && isMixed(looms, jobId, overrides);
  /** Ortak işi seçmek = "hepsine aynı işi uygula": tezgah başına seçimler sıfırlanır. */
  const setJobId = (v: string) => {
    setShared(v);
    setOverrides(new Map());
  };
  const pickRow = (loomId: string, v: string | null) =>
    setOverrides((m) => {
      const next = new Map(m);
      if (v === null || v === jobId) next.delete(loomId);
      else next.set(loomId, v);
      return next;
    });

  const previewMut = useMutation({
    mutationFn: (targets: BulkTarget[]) =>
      mixed
        ? runService.preview({ action: "ASSIGN", targets: withRowJobs(targets, (id) => effectiveJobOf(id, jobId, overrides)) })
        : runService.preview({ action: "ASSIGN", weavingOrderId, targets }),
    onSuccess: (p) => {
      setPreview(p);
      setPicked(initialSelection(p.rows, mode));
      setResult(null);
    },
  });

  const assignMut = useMutation({
    mutationFn: () =>
      mixed
        ? runService.assign({ rows: assignRowsOf(preview?.rows ?? [], picked, attempt.keyed, true) })
        : runService.assign({ weavingOrderId, rows: assignRowsOf(preview?.rows ?? [], picked, attempt.keyed) }),
    onError: (e) => attempt.onFailure(e),
    onSuccess: (r) => {
      attempt.onSuccess();
      setResult(r);
      void qc.invalidateQueries({ queryKey: LOOM_FLOOR_QUERY_KEY });
    },
  });

  const pickedCount = preview ? preview.rows.filter((r) => r.outcome !== "BLOCKED" && picked.has(rowKey(r))).length : 0;
  const retryFailed = result && result.failed.length > 0 ? () => previewMut.mutate(result.failed.map((f) => ({ machineId: f.machineId, productionLineNo: f.productionLineNo }))) : null;
  const canPreview = allJobsChosen(looms, jobId, overrides);
  return { ctx, jobId, setJobId, overrides, pickRow, mixed, canPreview, line, setLine, maxLines, preview, setPreview, picked, toggle, result, previewMut, assignMut, pickedCount, retryFailed };
}

export function AssignJobDialog({ open, onOpenChange, looms, mode, online }: Props) {
  const f = useAssignFlow({ open, looms, mode });
  const { ctx, jobId, setJobId, line, setLine, maxLines, preview, setPreview, picked, toggle, result, previewMut, assignMut, pickedCount, retryFailed } = f;
  const required = ctx.data?.weavingOrderRequired ?? true;
  const title = mode === "replace" ? "İşi değiştir" : "İş ver";
  const { loomSuggestionVisible } = useProposalGates();
  const fitJobId = loomSuggestionVisible && !f.mixed ? jobIdOf(jobId) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {title} — {looms.length} tezgah
          </DialogTitle>
          <DialogDescription>
            {result ? "Sonuç" : preview ? "Etkilenecek tezgahları gözden geçirin; istemediğinizin işaretini kaldırın." : "Dokuma İş Emri seçin, sonra önizleyin."}
          </DialogDescription>
        </DialogHeader>

        {!online && <p className="text-sm text-destructive">Sunucuya ulaşılamıyor — bağlantı gelince gönderebilirsiniz.</p>}

        {result ? (
          <ResultView result={result} okTitle="Başladı" onRetryFailed={online ? retryFailed : null} />
        ) : preview ? (
          <>
            {preview.weavingOrder && <p className="text-sm">Dokuma İş Emri: <span className="font-medium">{preview.weavingOrder.weavingOrderNumber}</span></p>}
            <PreviewTable rows={preview.rows} picked={picked} onToggle={toggle} showJob={f.mixed} />
          </>
        ) : ctx.isLoading ? (
          <p className="text-sm text-muted-foreground">İşler yükleniyor…</p>
        ) : ctx.isError ? (
          <p className="text-sm text-destructive">{apiErrorMessage(ctx.error, "İş listesi alınamadı")}</p>
        ) : (
          <div className="space-y-3">
            <JobPicker label={ctx.data?.rowJobs === true && looms.length > 1 ? "Hepsine aynı iş" : undefined} jobs={ctx.data?.weavingOrders ?? []} required={required} value={jobId} onChange={setJobId} />
            {ctx.data?.rowJobs === true && looms.length > 1 && (
              <RowJobs looms={looms} jobs={ctx.data.weavingOrders} required={required} shared={jobId} overrides={f.overrides} onPick={f.pickRow} />
            )}
            {fitJobId && <LoomFitList looms={looms} weavingOrderId={fitJobId} />}
            {maxLines > 1 && <LinePicker max={maxLines} value={line} onChange={setLine} />}
          </div>
        )}

        {(previewMut.isError || assignMut.isError) && (
          <p role="alert" className="text-sm text-destructive">
            {apiErrorMessage(previewMut.error ?? assignMut.error)}
            {assignMut.isError && " — aynı seçimle tekrar gönderebilirsiniz; çift koşum açılmaz."}
          </p>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={() => onOpenChange(false)}>Kapat</Button>
          ) : preview ? (
            <>
              <Button variant="outline" onClick={() => setPreview(null)} disabled={assignMut.isPending}>
                Geri
              </Button>
              <Button onClick={() => assignMut.mutate()} disabled={!online || pickedCount === 0 || assignMut.isPending}>
                {assignMut.isPending ? "Gönderiliyor…" : `Başlat (${pickedCount} tezgah)`}
              </Button>
            </>
          ) : (
            <Button onClick={() => previewMut.mutate(assignTargetsOf(looms, line))} disabled={!online || !f.canPreview || previewMut.isPending}>
              {previewMut.isPending ? "Önizleniyor…" : "Önizle"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
