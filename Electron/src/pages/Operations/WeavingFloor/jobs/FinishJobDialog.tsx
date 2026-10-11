// "İşi bitir" penceresi: seçili tezgahların açık koşumları önizlenir (her tezgah + hat adıyla, satır başına seçim),
// atkı sayacı satır başına isteğe bağlıdır (boş = ölçülmedi, 0 yazılmaz). Dokuma İş Emri KAPANMAZ. Kapanış claim'i
// kendiliğinden tekrar güvenlidir (ikinci kez RUN_ALREADY_CLOSED) — token gerekmez.
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiErrorMessage } from "@/services/apiClient";
import { LOOM_FLOOR_QUERY_KEY } from "../useLoomFloorLive";
import type { LiveLoom } from "../types";
import { PreviewTable, ResultView, usePickedRows } from "./BulkParts";
import { finishTargetsOf, initialSelection, rowKey } from "./plan";
import { runService, type BulkPreview, type BulkPreviewRow, type BulkResult, type BulkTarget } from "./runService";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  looms: readonly LiveLoom[];
  online: boolean;
}

/** Atkı sayacı metni → sayı; boş = ölçülmedi (null), geçersiz = undefined (gönderim kilitli). */
export function parsePicks(text: string | undefined): number | null | undefined {
  const t = (text ?? "").trim();
  if (t === "") return null;
  return /^\d+$/.test(t) ? Number(t) : undefined;
}

function PicksInput({ r, value, onChange }: { r: BulkPreviewRow; value: string; onChange: (v: string) => void }) {
  return (
    <Input
      inputMode="numeric"
      className="h-8 w-28"
      aria-label={`${r.machineCode} ${r.productionLineNo}. hat atkı sayacı`}
      placeholder="ölçülmedi"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function FinishJobDialog({ open, onOpenChange, looms, online }: Props) {
  const qc = useQueryClient();
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const { picked, setPicked, toggle } = usePickedRows();
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [result, setResult] = useState<BulkResult | null>(null);

  const previewMut = useMutation({
    mutationFn: (targets: BulkTarget[]) => runService.preview({ action: "FINISH", targets }),
    onSuccess: (p) => {
      setPreview(p);
      setPicked(initialSelection(p.rows, "assign"));
      setResult(null);
    },
  });
  const { mutate: runPreview } = previewMut;

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setResult(null);
    setPicks({});
    const targets = finishTargetsOf(looms);
    if (targets.length > 0 && online) runPreview(targets);
  }, [open, looms, online, runPreview]);

  const chosen = (preview?.rows ?? []).filter((r) => r.current && r.outcome === "FINISH" && picked.has(rowKey(r)));
  const parsed = chosen.map((r) => ({ runId: r.current!.id, picksAtClose: parsePicks(picks[rowKey(r)]) }));
  const invalid = parsed.some((p) => p.picksAtClose === undefined);

  const finishMut = useMutation({
    mutationFn: () => runService.finish({ rows: parsed.map((p) => ({ runId: p.runId, picksAtClose: p.picksAtClose ?? null })) }),
    onSuccess: (r) => {
      setResult(r);
      void qc.invalidateQueries({ queryKey: LOOM_FLOOR_QUERY_KEY });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>İşi bitir — {looms.length} tezgah</DialogTitle>
          <DialogDescription>Koşum kapanır; Dokuma İş Emri açık kalır. Atkı sayacını bilmiyorsanız boş bırakın.</DialogDescription>
        </DialogHeader>
        {!online && <p className="text-sm text-destructive">Sunucuya ulaşılamıyor — bağlantı gelince gönderebilirsiniz.</p>}
        {result ? (
          <ResultView result={result} okTitle="Bitti" onRetryFailed={null} />
        ) : preview ? (
          <PreviewTable
            rows={preview.rows}
            picked={picked}
            onToggle={toggle}
            extra={(r) => <PicksInput r={r} value={picks[rowKey(r)] ?? ""} onChange={(v) => setPicks((p) => ({ ...p, [rowKey(r)]: v }))} />}
          />
        ) : previewMut.isPending ? (
          <p className="text-sm text-muted-foreground">Önizleniyor…</p>
        ) : (
          <p className="text-sm text-muted-foreground">Seçili tezgahlarda açık koşum yok.</p>
        )}
        {(previewMut.isError || finishMut.isError) && (
          <p role="alert" className="text-sm text-destructive">
            {apiErrorMessage(previewMut.error ?? finishMut.error)}
          </p>
        )}
        <DialogFooter>
          {result ? (
            <Button onClick={() => onOpenChange(false)}>Kapat</Button>
          ) : (
            <Button onClick={() => finishMut.mutate()} disabled={!online || chosen.length === 0 || invalid || finishMut.isPending}>
              {finishMut.isPending ? "Gönderiliyor…" : `Bitir (${chosen.length} koşum)`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
