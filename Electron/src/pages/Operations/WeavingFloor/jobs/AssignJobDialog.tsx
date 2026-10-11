// "İş ver" / "İşi değiştir" penceresi: ① Dokuma İş Emri seçici (modal içinde liste) → ② önizleme (her tezgah adıyla,
// satır başına seçim) → ③ sonuç (Başladı · Olmadı · Uyarılar). Dolu hatta iş vermek Değiştir'dir ve yalnız işaretlenen
// satırda olur; satır token'ı mantıksal deneme başına bir kez (`useAttemptToken.keyed`).
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAttemptToken } from "@/lib/attemptToken";
import { foldedIncludes } from "@/lib/search-fold";
import { apiErrorMessage } from "@/services/apiClient";
import { LOOM_FLOOR_QUERY_KEY } from "../useLoomFloorLive";
import type { LiveLoom } from "../types";
import { PreviewTable, ResultView, usePickedRows } from "./BulkParts";
import { assignRowsOf, assignTargetsOf, initialSelection, maxLinesOf, rowKey, type JobDialogMode } from "./plan";
import { runService, type BulkPreview, type BulkResult, type BulkTarget, type JobOption } from "./runService";

export const BULK_CONTEXT_QUERY_KEY = ["machine-runs", "bulk-context"] as const;
/** İşsiz (numune) koşum seçimi — yalnız "iş zorunlu" ayarı kapalıyken çizilir. */
const NO_JOB = "__numune__";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  looms: readonly LiveLoom[];
  mode: JobDialogMode;
  online: boolean;
}

function JobPicker({ jobs, required, value, onChange }: { jobs: JobOption[]; required: boolean; value: string | null; onChange: (v: string) => void }) {
  const [q, setQ] = useState("");
  const shown = jobs.filter((j) => foldedIncludes(`${j.weavingOrderNumber} ${j.item.code} ${j.item.name} ${j.warpSpec?.code ?? ""}`, q));
  return (
    <div className="space-y-2">
      <Input placeholder="Dokuma İş Emri ara (no, kumaş, çözgü)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Dokuma İş Emri ara" />
      <div role="radiogroup" aria-label="Dokuma İş Emri" className="max-h-[45vh] overflow-auto rounded border">
        {!required && (
          <JobRow id={NO_JOB} checked={value === NO_JOB} onChange={onChange} title="İşsiz (numune) koşum" sub="Dokuma İş Emrine bağlanmaz" />
        )}
        {shown.map((j) => (
          <JobRow
            key={j.id}
            id={j.id}
            checked={value === j.id}
            onChange={onChange}
            title={j.weavingOrderNumber}
            sub={[j.item.name, j.warpSpec ? `çözgü ${j.warpSpec.code}` : null, j.plannedM !== null ? `${j.plannedM} m` : null, j.status === "IN_PROGRESS" ? "devam ediyor" : "planlandı"].filter(Boolean).join(" · ")}
          />
        ))}
        {shown.length === 0 && <p className="p-3 text-sm text-muted-foreground">Açık Dokuma İş Emri yok.</p>}
      </div>
    </div>
  );
}

function JobRow({ id, checked, onChange, title, sub }: { id: string; checked: boolean; onChange: (v: string) => void; title: string; sub: string }) {
  return (
    <button type="button" role="radio" aria-checked={checked} onClick={() => onChange(id)} className={`block w-full border-b px-3 py-2 text-left last:border-b-0 ${checked ? "bg-primary/10" : "hover:bg-muted"}`}>
      <div className="font-medium">{title}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </button>
  );
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
  const [jobId, setJobId] = useState<string | null>(null);
  const [line, setLine] = useState(1);
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const { picked, setPicked, toggle } = usePickedRows();
  const [result, setResult] = useState<BulkResult | null>(null);
  const maxLines = useMemo(() => maxLinesOf(looms), [looms]);

  useEffect(() => {
    if (!open) return;
    setJobId(null);
    setLine(1);
    setPreview(null);
    setResult(null);
    attempt.renew();
  }, [open, attempt]);

  const ctx = useQuery({ queryKey: BULK_CONTEXT_QUERY_KEY, queryFn: runService.context, enabled: open });
  const weavingOrderId = jobId === NO_JOB ? null : jobId;

  const previewMut = useMutation({
    mutationFn: (targets: BulkTarget[]) => runService.preview({ action: "ASSIGN", weavingOrderId, targets }),
    onSuccess: (p) => {
      setPreview(p);
      setPicked(initialSelection(p.rows, mode));
      setResult(null);
    },
  });

  const assignMut = useMutation({
    mutationFn: () => runService.assign({ weavingOrderId, rows: assignRowsOf(preview?.rows ?? [], picked, attempt.keyed) }),
    onError: (e) => attempt.onFailure(e),
    onSuccess: (r) => {
      attempt.onSuccess();
      setResult(r);
      void qc.invalidateQueries({ queryKey: LOOM_FLOOR_QUERY_KEY });
    },
  });

  const pickedCount = preview ? preview.rows.filter((r) => r.outcome !== "BLOCKED" && picked.has(rowKey(r))).length : 0;
  const retryFailed = result && result.failed.length > 0 ? () => previewMut.mutate(result.failed.map((f) => ({ machineId: f.machineId, productionLineNo: f.productionLineNo }))) : null;
  return { ctx, jobId, setJobId, line, setLine, maxLines, preview, setPreview, picked, toggle, result, previewMut, assignMut, pickedCount, retryFailed };
}

export function AssignJobDialog({ open, onOpenChange, looms, mode, online }: Props) {
  const { ctx, jobId, setJobId, line, setLine, maxLines, preview, setPreview, picked, toggle, result, previewMut, assignMut, pickedCount, retryFailed } = useAssignFlow({ open, looms, mode });
  const title = mode === "replace" ? "İşi değiştir" : "İş ver";

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
            <PreviewTable rows={preview.rows} picked={picked} onToggle={toggle} />
          </>
        ) : ctx.isLoading ? (
          <p className="text-sm text-muted-foreground">İşler yükleniyor…</p>
        ) : ctx.isError ? (
          <p className="text-sm text-destructive">{apiErrorMessage(ctx.error, "İş listesi alınamadı")}</p>
        ) : (
          <div className="space-y-3">
            <JobPicker jobs={ctx.data?.weavingOrders ?? []} required={ctx.data?.weavingOrderRequired ?? true} value={jobId} onChange={setJobId} />
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
            <Button onClick={() => previewMut.mutate(assignTargetsOf(looms, line))} disabled={!online || jobId === null || previewMut.isPending}>
              {previewMut.isPending ? "Önizleniyor…" : "Önizle"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
