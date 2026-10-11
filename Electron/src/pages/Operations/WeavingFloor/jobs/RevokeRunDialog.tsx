// "Koşumu geri al" penceresi: TEK tezgahın AÇIK koşumu (çok hatlıysa hangisi sorulur), sebep zorunlu. Geri alınan
// koşum randımanın paydasından düşer; kayıt silinmez, `revokedAt` damgası yazılır. Bitmiş koşumun geri alınması salon dışı.
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiErrorMessage } from "@/services/apiClient";
import { formatFactory } from "@/lib/factory-time";
import { LOOM_FLOOR_QUERY_KEY } from "../useLoomFloorLive";
import type { LiveLoom } from "../types";
import { runService } from "./runService";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loom: LiveLoom | null;
  online: boolean;
}

export function RevokeRunDialog({ open, onOpenChange, loom, online }: Props) {
  const qc = useQueryClient();
  const runs = loom?.openRuns ?? [];
  const [runId, setRunId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) return;
    setReason("");
    const open1 = loom?.openRuns ?? [];
    setRunId(open1.length === 1 ? (open1[0]?.id ?? null) : null);
  }, [open, loom]);

  const mut = useMutation({
    mutationFn: () => runService.revoke(runId!, reason.trim()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: LOOM_FLOOR_QUERY_KEY });
      onOpenChange(false);
    },
  });
  const run = runs.find((r) => r.id === runId) ?? null;
  const ready = online && run !== null && reason.trim().length > 0 && !mut.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Koşumu geri al — {loom?.code ?? ""}</DialogTitle>
          <DialogDescription>Koşum hiç olmamış sayılır ve randımandan düşer; kaydı silinmez, geri alındı olarak kalır.</DialogDescription>
        </DialogHeader>
        {!online && <p className="text-sm text-destructive">Sunucuya ulaşılamıyor — bağlantı gelince gönderebilirsiniz.</p>}
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Bu tezgahta açık koşum yok.</p>
        ) : (
          <div role="radiogroup" aria-label="Koşum" className="rounded border">
            {runs.map((r) => (
              <button
                key={r.id}
                type="button"
                role="radio"
                aria-checked={runId === r.id}
                onClick={() => setRunId(r.id)}
                className={`block w-full border-b px-3 py-2 text-left text-sm last:border-b-0 ${runId === r.id ? "bg-primary/10" : "hover:bg-muted"}`}
              >
                <div className="font-medium">
                  {loom?.code}
                  {(loom?.lines ?? 1) > 1 ? ` · ${r.line}. hat` : ""} — {r.jobNo ?? "İşsiz koşum"}
                </div>
                <div className="text-xs text-muted-foreground">Başlangıç {formatFactory(r.startedAt, "dd.MM.yyyy HH:mm")}</div>
              </button>
            ))}
          </div>
        )}
        <Textarea aria-label="Geri alma sebebi" placeholder="Sebep (zorunlu)" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        {mut.isError && (
          <p role="alert" className="text-sm text-destructive">
            {apiErrorMessage(mut.error)}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mut.isPending}>
            Vazgeç
          </Button>
          <Button variant="destructive" onClick={() => mut.mutate()} disabled={!ready}>
            {mut.isPending ? "Gönderiliyor…" : "Geri al"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
