// Toplu duruş penceresi (tasarım TEZGAH-SALONU-SECIM-IS-VERME F2): "Duruş bildir" (başlangıç Şimdi/Daha önce, sebep
// BİR KEZ) · "Hepsi çalıştı" (açık duruşları kapatır) · "Duruşu geri al" (gerekçe bir kez, yalnız açık duruş). Yazmadan
// önce önizler (her tezgah adıyla, satır başına işaret); sonuç Oldu/Olmadı listesi. Satır token'ı ve gönderilen saat
// mantıksal denemeye yapışıktır: belirsiz hatada aynı, kesin 4xx'te / başarıda / form değişince yenilenir.
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { isAmbiguousFailure, useAttemptToken } from "@/lib/attemptToken";
import { apiErrorMessage } from "@/services/apiClient";
import { localInputToIso, nowLocalInput } from "@/pages/Operations/MachineStops/types";
import { useStopReasonPresets } from "@/pages/Operations/MachineStops/useStopReasonPresets";
import { LOOM_FLOOR_QUERY_KEY } from "../useLoomFloorLive";
import { ResultView, usePickedRows } from "../jobs/BulkParts";
import type { LiveLoom } from "../types";
import { ReasonList, StopPreviewTable, TimeChoice, type TimeValue } from "./StopBulkParts";
import { stopService, type BulkStopAction, type BulkStopPreview, type BulkStopResult } from "./stopService";

export type StopDialogMode = "open" | "close" | "revoke";

const ACTION: Record<StopDialogMode, BulkStopAction> = { open: "OPEN", close: "CLOSE", revoke: "REVOKE" };
const TEXT: Record<StopDialogMode, { title: string; desc: string; submit: string; ok: string }> = {
  open: {
    title: "Duruş bildir",
    desc: "Seçili tezgahlarda duruş açılır; sebep bir kez seçilir ve her tezgaha yazılır. Sebep şimdi seçilmezse duruş yine açılır, sebebi Tezgah Duruşları ekranında girilir.",
    submit: "Duruş aç",
    ok: "Duruşa geçti",
  },
  close: { title: "Hepsi çalıştı", desc: "Seçili tezgahların açık duruşları birlikte kapanır.", submit: "Duruşları kapat", ok: "Kapandı" },
  revoke: {
    title: "Duruşu geri al",
    desc: "Açık duruş hiç olmamış sayılır; kaydı silinmez, geri alındı olarak kalır. Gerekçe bir kez yazılır ve her duruşa işlenir.",
    submit: "Geri al",
    ok: "Geri alındı",
  },
};

interface Props {
  open: boolean;
  mode: StopDialogMode;
  looms: readonly LiveLoom[];
  online: boolean;
  onOpenChange: (open: boolean) => void;
}

const isoOf = (t: TimeValue): string | null => (t.now ? null : localInputToIso(t.local));

function useStopForm() {
  const [time, setTime] = useState<TimeValue>(() => ({ now: true, local: nowLocalInput() }));
  const [reasonCode, setReasonCode] = useState("");
  const [note, setNote] = useState("");
  const [revokeReason, setRevokeReason] = useState("");
  const reset = useCallback(() => {
    setTime({ now: true, local: nowLocalInput() });
    setReasonCode("");
    setNote("");
    setRevokeReason("");
  }, []);
  return { time, setTime, reasonCode, setReasonCode, note, setNote, revokeReason, setRevokeReason, reset };
}

function useStopBulkFlow({ open, mode, looms, online }: Omit<Props, "onOpenChange">) {
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const stamp = useRef<string | null>(null);
  const form = useStopForm();
  const [preview, setPreview] = useState<BulkStopPreview | null>(null);
  const { picked, setPicked, toggle } = usePickedRows();
  const [result, setResult] = useState<BulkStopResult | null>(null);
  const fresh = useCallback(() => {
    attempt.renew();
    stamp.current = null;
  }, [attempt]);

  const previewMut = useMutation({
    mutationFn: (machineIds: string[]) => stopService.preview({ action: ACTION[mode], machineIds, at: isoOf(form.time) }),
    onSuccess: (p) => {
      setPreview(p);
      setPicked(new Set(p.rows.filter((r) => r.defaultSelected && r.outcome !== "BLOCKED").map((r) => r.machineId)));
      setResult(null);
    },
  });
  const { mutate: runPreview } = previewMut;
  const { reset: resetForm } = form;

  useEffect(() => {
    if (!open) return;
    resetForm();
    setPreview(null);
    setResult(null);
    fresh();
    // Kapat/geri al açılışta önizler ("şimdi" ile); aç önce başlangıç ve sebep ister.
    if (mode !== "open" && online && looms.length > 0) runPreview(looms.map((l) => l.id));
  }, [open, mode, looms, online, runPreview, fresh, resetForm]);

  const chosen = (preview?.rows ?? []).filter((r) => r.outcome !== "BLOCKED" && picked.has(r.machineId));
  // Gönderilen saat denemeye yapışık: ilk gönderimde doğar (Şimdi = o an), belirsiz hatadan sonra AYNEN gider.
  const stampNow = () => (stamp.current ??= isoOf(form.time) ?? new Date().toISOString());
  const stopRows = () => chosen.map((r) => ({ stopId: r.current!.id }));

  const submitMut = useMutation({
    mutationFn: (): Promise<BulkStopResult> => {
      if (mode === "close") return stopService.close({ endedAt: stampNow(), rows: stopRows() });
      if (mode === "revoke") return stopService.revoke({ reason: form.revokeReason.trim(), rows: stopRows() });
      const rows = chosen.map((r) => ({ machineId: r.machineId, clientToken: attempt.keyed(r.machineId) }));
      return stopService.open({ startedAt: stampNow(), reasonCode: form.reasonCode || null, reasonNote: form.note.trim() || null, rows });
    },
    onError: (e) => {
      attempt.onFailure(e);
      if (!isAmbiguousFailure(e)) stamp.current = null;
    },
    onSuccess: (r) => {
      attempt.onSuccess();
      stamp.current = null;
      setResult(r);
      void qc.invalidateQueries({ queryKey: LOOM_FLOOR_QUERY_KEY });
    },
  });

  // Saat değişince önizleme (çakışma/sıra kararı ona bağlı) ve deneme düşer; sebep/not değişince yalnız deneme.
  const setTime = (t: TimeValue) => {
    form.setTime(t);
    setPreview(null);
    fresh();
  };
  const edit = (set: (v: string) => void) => (v: string) => {
    set(v);
    fresh();
  };
  const timeOk = form.time.now || localInputToIso(form.time.local) !== null;
  const reasonOk = mode !== "revoke" || form.revokeReason.trim().length >= 3;
  const ready = online && timeOk && reasonOk && chosen.length > 0 && !submitMut.isPending;
  const retryFailed = result && result.failed.length > 0 ? () => runPreview(result.failed.map((f) => f.machineId)) : null;
  const doPreview = () => runPreview(looms.map((l) => l.id));
  return { form, setTime, edit, preview, picked, toggle, result, previewMut, submitMut, chosen, ready, timeOk, retryFailed, doPreview };
}

type Flow = ReturnType<typeof useStopBulkFlow>;

function FormFields({ mode, flow }: { mode: StopDialogMode; flow: Flow }) {
  const { active } = useStopReasonPresets();
  const { form } = flow;
  if (mode === "revoke") {
    return <Textarea aria-label="Geri alma gerekçesi" placeholder="Gerekçe (zorunlu, en az 3 karakter)" maxLength={300} value={form.revokeReason} onChange={(e) => form.setRevokeReason(e.target.value)} />;
  }
  return (
    <div className="space-y-3">
      <TimeChoice label={mode === "open" ? "Başlangıç" : "Bitiş"} value={form.time} onChange={flow.setTime} />
      {mode === "open" && (
        <>
          <ReasonList presets={active} value={form.reasonCode} onChange={flow.edit(form.setReasonCode)} />
          <Textarea aria-label="Not" placeholder="Not (isteğe bağlı)" rows={2} maxLength={300} value={form.note} onChange={(e) => flow.edit(form.setNote)(e.target.value)} />
        </>
      )}
    </div>
  );
}

function Body({ mode, flow }: { mode: StopDialogMode; flow: Flow }) {
  const { labelOf } = useStopReasonPresets();
  const reasonLabel = (c: string | null) => (c ? labelOf(c) : "sebep bekleniyor");
  if (flow.result) return <ResultView result={flow.result} okTitle={TEXT[mode].ok} onRetryFailed={flow.retryFailed} />;
  return (
    <div className="space-y-3">
      <FormFields mode={mode} flow={flow} />
      {flow.preview ? (
        <StopPreviewTable rows={flow.preview.rows} picked={flow.picked} onToggle={flow.toggle} reasonLabel={reasonLabel} />
      ) : flow.previewMut.isPending ? (
        <p className="text-sm text-muted-foreground">Önizleniyor…</p>
      ) : null}
    </div>
  );
}

export function StopBulkDialog({ open, mode, looms, online, onOpenChange }: Props) {
  const flow = useStopBulkFlow({ open, mode, looms, online });
  const err = flow.previewMut.error ?? flow.submitMut.error;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {TEXT[mode].title} — {looms.length} tezgah
          </DialogTitle>
          <DialogDescription>{TEXT[mode].desc}</DialogDescription>
        </DialogHeader>
        {!online && <p className="text-sm text-destructive">Sunucuya ulaşılamıyor — bağlantı gelince gönderebilirsiniz.</p>}
        <Body mode={mode} flow={flow} />
        {err && (
          <p role="alert" className="text-sm text-destructive">
            {apiErrorMessage(err)}
          </p>
        )}
        <DialogFooter>
          {flow.result ? (
            <Button onClick={() => onOpenChange(false)}>Kapat</Button>
          ) : !flow.preview ? (
            <Button onClick={flow.doPreview} disabled={!online || !flow.timeOk || flow.previewMut.isPending}>
              Önizle
            </Button>
          ) : (
            <Button variant={mode === "revoke" ? "destructive" : "default"} onClick={() => flow.submitMut.mutate()} disabled={!flow.ready}>
              {flow.submitMut.isPending ? "Gönderiliyor…" : `${TEXT[mode].submit} (${flow.chosen.length} tezgah)`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
