import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ScanLine,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Flag,
  Undo2,
  Loader2,
  RefreshCw,
  PackageCheck,
  ArrowRight,
  Ruler,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { kursunQcService } from "@/services/kursunQcService";
import type { KursunQcRollSummary } from "@/types/kursunQc";

export default function KursunQcPage() {
  const qc = useQueryClient();
  const [cardBarcode, setCardBarcode] = useState("");
  const [stepId, setStepId] = useState<string | null>(null);
  const [errorDialogRoll, setErrorDialogRoll] =
    useState<KursunQcRollSummary | null>(null);

  const stepQuery = useQuery({
    queryKey: ["kursun-qc-step", stepId],
    queryFn: () => kursunQcService.getStep(stepId!),
    enabled: !!stepId,
    refetchInterval: 10000,
  });

  const step = stepQuery.data?.data ?? null;

  const lookupMutation = useMutation({
    mutationFn: (barcode: string) => kursunQcService.getByCardBarcode(barcode),
    onSuccess: (res) => {
      if (res.data) {
        setStepId(res.data.workOrderStepId);
        toast.success(
          `Adım açıldı: ${res.data.stationCode} · Parti ${res.data.batchNumber}`,
        );
      }
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "Kart bulunamadı";
      toast.error(msg);
    },
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["kursun-qc-step", stepId] });

  const applyKursunM = useMutation({
    mutationFn: (rollId: string) =>
      kursunQcService.applyKursun({ rollId, stepId: stepId! }),
    onSuccess: (r) => {
      toast.success(r.message ?? "Kurşun geçildi");
      invalidate();
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "İşlem başarısız";
      toast.error(msg);
    },
  });

  const undoKursunM = useMutation({
    mutationFn: (rollId: string) =>
      kursunQcService.undoKursun({ rollId, stepId: stepId! }),
    onSuccess: (r) => {
      toast.success(r.message ?? "Geri alındı");
      invalidate();
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "İşlem başarısız";
      toast.error(msg);
    },
  });

  const completeQc2M = useMutation({
    mutationFn: (rollId: string) =>
      kursunQcService.completeQc2({ rollId, stepId: stepId! }),
    onSuccess: (r) => {
      toast.success(r.message ?? "QC2 tamamlandı");
      invalidate();
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "İşlem başarısız";
      toast.error(msg);
    },
  });

  const finishStepM = useMutation({
    mutationFn: () => kursunQcService.finishStep(stepId!),
    onSuccess: (r) => {
      toast.success(
        r.message ??
          `Adım kapatıldı, ${r.data?.movedRollCount ?? 0} top taşındı`,
      );
      setStepId(null);
      qc.invalidateQueries({ queryKey: ["rolls"] });
      qc.invalidateQueries({ queryKey: ["work-orders"] });
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "Adım kapatılamadı";
      toast.error(msg);
    },
  });

  const onLookup = () => {
    const v = cardBarcode.trim();
    if (!v) return;
    lookupMutation.mutate(v);
  };

  const totalRolls = step?.rolls.length ?? 0;
  const qc2Done = step?.rolls.filter((r) => r.qc2Completed).length ?? 0;
  const allQc2Done = totalRolls > 0 && qc2Done === totalRolls;

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight">
          Kurşun + Kalite Kontrol 2
        </h1>
        {step && (
          <Badge variant="secondary" className="ml-2">
            {step.stationCode} · {step.batchNumber}
          </Badge>
        )}
      </div>

      {/* Kart Okutma / Step ID */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ScanLine className="h-5 w-5" /> Refakat Kartı / Adım
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 items-end">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Refakat Kartı Barkodu</Label>
              <Input
                value={cardBarcode}
                onChange={(e) => setCardBarcode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onLookup();
                }}
                placeholder="TC-... (okut veya yapıştır)"
                className="h-11 font-mono"
                autoFocus
              />
            </div>
            <Button
              onClick={onLookup}
              disabled={lookupMutation.isPending || !cardBarcode.trim()}
              className="h-11"
            >
              {lookupMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ScanLine className="h-4 w-4" />
              )}
              Adımı Aç
            </Button>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>veya doğrudan adım ID'si gir:</span>
            <Input
              value={stepId ?? ""}
              onChange={(e) => setStepId(e.target.value.trim() || null)}
              placeholder="workOrderStepId (uuid)"
              className="font-mono h-8 text-xs"
            />
            {stepId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => invalidate()}
                disabled={stepQuery.isFetching}
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${
                    stepQuery.isFetching ? "animate-spin" : ""
                  }`}
                />
                Yenile
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Step Detail */}
      {stepId && step && (
        <>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base flex items-center gap-2">
                <PackageCheck className="h-5 w-5" />
                {step.stationName}
                <Badge variant="outline" className="ml-1">
                  {totalRolls} top
                </Badge>
                <Badge
                  variant={allQc2Done ? "default" : "secondary"}
                  className="ml-1"
                >
                  QC2: {qc2Done}/{totalRolls}
                </Badge>
              </CardTitle>
              <Button
                disabled={
                  !allQc2Done || finishStepM.isPending || totalRolls === 0
                }
                isLoading={finishStepM.isPending}
                onClick={() => finishStepM.mutate()}
              >
                <ArrowRight className="h-4 w-4" />
                Adımı Bitir ve Sonraki İstasyona Gönder
              </Button>
            </CardHeader>
            <CardContent>
              {stepQuery.isLoading ? (
                <div className="space-y-2">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="h-20 bg-muted animate-pulse rounded-md"
                    />
                  ))}
                </div>
              ) : step.rolls.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  Bu adımda aktif top yok.
                </p>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {step.rolls.map((r) => (
                    <RollCard
                      key={r.rollId}
                      roll={r}
                      onApplyKursun={() => applyKursunM.mutate(r.rollId)}
                      onUndoKursun={() => undoKursunM.mutate(r.rollId)}
                      onCompleteQc2={() => completeQc2M.mutate(r.rollId)}
                      onReportError={() => setErrorDialogRoll(r)}
                      applyPending={
                        applyKursunM.isPending &&
                        applyKursunM.variables === r.rollId
                      }
                      undoPending={
                        undoKursunM.isPending &&
                        undoKursunM.variables === r.rollId
                      }
                      qc2Pending={
                        completeQc2M.isPending &&
                        completeQc2M.variables === r.rollId
                      }
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Hata Bildir Dialog */}
      <ReportErrorDialog
        roll={errorDialogRoll}
        stepId={stepId}
        onClose={() => setErrorDialogRoll(null)}
        onSaved={invalidate}
      />
    </div>
  );
}

// ─── Roll Card ──────────────────────────────────────────────────────────────
interface RollCardProps {
  roll: KursunQcRollSummary;
  onApplyKursun: () => void;
  onUndoKursun: () => void;
  onCompleteQc2: () => void;
  onReportError: () => void;
  applyPending: boolean;
  undoPending: boolean;
  qc2Pending: boolean;
}

function RollCard({
  roll,
  onApplyKursun,
  onUndoKursun,
  onCompleteQc2,
  onReportError,
  applyPending,
  undoPending,
  qc2Pending,
}: RollCardProps) {
  return (
    <div
      className={`rounded-xl border p-3 space-y-3 transition-colors ${
        roll.qc2Completed
          ? "border-green-300 bg-green-50/40 dark:bg-green-950/10 dark:border-green-900"
          : "bg-card"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <code className="text-sm font-mono font-semibold">
            {roll.barcode}
          </code>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
            <Ruler className="h-3 w-3" />
            {roll.currentQty.toFixed(1)}m
          </div>
        </div>
        <div className="flex items-center gap-1 flex-wrap justify-end">
          {roll.kursunApplied && (
            <Badge variant="secondary" className="text-[10px]">
              Kurşun ✓
            </Badge>
          )}
          {roll.qc2Completed && (
            <Badge className="text-[10px] bg-green-600">QC2 ✓</Badge>
          )}
          {roll.errorCount > 0 && (
            <Badge variant="destructive" className="text-[10px]">
              {roll.errorCount} hata
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {roll.kursunApplied ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onUndoKursun}
            disabled={undoPending || roll.qc2Completed}
            isLoading={undoPending}
          >
            <Undo2 className="h-4 w-4" /> Kurşunu Geri Al
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={onApplyKursun}
            disabled={applyPending}
            isLoading={applyPending}
          >
            <ShieldCheck className="h-4 w-4" /> Kurşun Geç
          </Button>
        )}

        <Button
          size="sm"
          variant={roll.qc2Completed ? "outline" : "default"}
          onClick={onCompleteQc2}
          disabled={qc2Pending || roll.qc2Completed}
          isLoading={qc2Pending}
        >
          <CheckCircle2 className="h-4 w-4" />
          {roll.qc2Completed ? "QC2 Tamam" : "QC2 Tamamla"}
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={onReportError}
          className="col-span-2"
        >
          <Flag className="h-4 w-4" /> Hata Bildir
        </Button>
      </div>
    </div>
  );
}

// ─── Report Error Dialog ────────────────────────────────────────────────────
interface ReportErrorDialogProps {
  roll: KursunQcRollSummary | null;
  stepId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

function ReportErrorDialog({
  roll,
  stepId,
  onClose,
  onSaved,
}: ReportErrorDialogProps) {
  const [startMeter, setStartMeter] = useState("");
  const [endMeter, setEndMeter] = useState("");
  const [errorType, setErrorType] = useState("");

  const reset = () => {
    setStartMeter("");
    setEndMeter("");
    setErrorType("");
  };

  const saveM = useMutation({
    mutationFn: () =>
      kursunQcService.reportError({
        rollId: roll!.rollId,
        stepId: stepId!,
        startMeter: Number(startMeter),
        endMeter: Number(endMeter),
        errorType: errorType.trim() || null,
      }),
    onSuccess: (r) => {
      toast.success(r.message ?? "Hata kaydı açıldı");
      reset();
      onSaved();
      onClose();
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "Kayıt başarısız";
      toast.error(msg);
    },
  });

  const valid =
    !!roll &&
    !!stepId &&
    startMeter !== "" &&
    endMeter !== "" &&
    Number(endMeter) > Number(startMeter) &&
    Number(endMeter) <= (roll?.currentQty ?? Infinity);

  return (
    <Dialog
      open={!!roll}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Hata Bildir — {roll?.barcode}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Bu kayıt Tambur'da kararlaştırılıncaya kadar <b>beklemede</b>{" "}
            kalacak. Top metrajı: <b>{roll?.currentQty.toFixed(1)}m</b>
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Başlangıç (m)</Label>
              <Input
                type="number"
                step="0.1"
                min="0"
                value={startMeter}
                onChange={(e) => setStartMeter(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Bitiş (m)</Label>
              <Input
                type="number"
                step="0.1"
                min="0"
                value={endMeter}
                onChange={(e) => setEndMeter(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Hata Tipi (opsiyonel)</Label>
            <Input
              value={errorType}
              onChange={(e) => setErrorType(e.target.value)}
              placeholder="örn. atkı atlaması, renk farkı…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            İptal
          </Button>
          <Button
            disabled={!valid || saveM.isPending}
            isLoading={saveM.isPending}
            onClick={() => saveM.mutate()}
          >
            <Flag className="h-4 w-4" /> Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
