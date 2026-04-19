import { useState, useEffect, useRef, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ScanLine,
  ShieldCheck,
  CheckCircle2,
  Undo2,
  Loader2,
  RefreshCw,
  ArrowRight,
  Trash2,
  X,
  Plus,
  Ruler,
  AlertTriangle,
  ChevronLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { kursunQcService } from "@/services/kursunQcService";
import { defectTypeService } from "@/services/defectTypeService";
import type {
  KursunQcRollSummary,
  KursunQcDefectSummary,
} from "@/types/kursunQc";
import type { DefectType } from "@/types/models";

type Severity = DefectType["severity"];

interface PendingDefect {
  defectTypeId: string;
  defectName: string;
  severity: Severity;
  startMeter: string;
  endMeter: string;
}

const severityButtonClass = (sev: Severity) => {
  switch (sev) {
    case "MINOR":
      return "bg-amber-100 hover:bg-amber-200 text-amber-900 border-amber-300 dark:bg-amber-900/40 dark:text-amber-100 dark:border-amber-700 dark:hover:bg-amber-900/60";
    case "MAJOR":
      return "bg-orange-100 hover:bg-orange-200 text-orange-900 border-orange-400 dark:bg-orange-900/40 dark:text-orange-100 dark:border-orange-700 dark:hover:bg-orange-900/60";
    case "CRITICAL":
      return "bg-red-100 hover:bg-red-200 text-red-900 border-red-400 dark:bg-red-900/40 dark:text-red-100 dark:border-red-700 dark:hover:bg-red-900/60";
    default:
      return "bg-slate-100 hover:bg-slate-200 text-slate-900 border-slate-300 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-700 dark:hover:bg-slate-700";
  }
};

const severityLabels: Record<NonNullable<Severity>, string> = {
  MINOR: "Düşük",
  MAJOR: "Orta",
  CRITICAL: "Kritik",
};

const errorMessage = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data
    ?.message ?? fallback;

export default function KursunQcPage() {
  const qc = useQueryClient();
  const [cardBarcode, setCardBarcode] = useState("");
  const [stepId, setStepId] = useState<string | null>(null);
  const [activeRollId, setActiveRollId] = useState<string | null>(null);
  const [pendingDefect, setPendingDefect] = useState<PendingDefect | null>(
    null,
  );

  const scanInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!stepId) {
      const t = setTimeout(() => scanInputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [stepId]);

  const stepQuery = useQuery({
    queryKey: ["kursun-qc-step", stepId],
    queryFn: () => kursunQcService.getStep(stepId!),
    enabled: !!stepId,
    refetchInterval: 15000,
  });
  const step = stepQuery.data?.data ?? null;

  const defectsQuery = useQuery({
    queryKey: ["defect-types-active"],
    queryFn: () =>
      defectTypeService.getAll({
        page: 1,
        pageSize: 100,
        sortBy: "name",
        sortOrder: "asc",
        filters: { isActive: "true" },
      }),
    staleTime: 5 * 60 * 1000,
  });
  const defectCatalog = defectsQuery.data?.data ?? [];

  // Auto-pick active roll when step changes / current selection invalid
  useEffect(() => {
    if (!step || step.rolls.length === 0) {
      setActiveRollId(null);
      return;
    }
    const stillExists = step.rolls.some((r) => r.rollId === activeRollId);
    if (!stillExists) {
      const next =
        step.rolls.find((r) => !r.qc2Completed) ?? step.rolls[0];
      setActiveRollId(next.rollId);
    }
  }, [step, activeRollId]);

  // Reset pending defect when switching rolls
  useEffect(() => {
    setPendingDefect(null);
  }, [activeRollId]);

  const activeRoll = useMemo(
    () => step?.rolls.find((r) => r.rollId === activeRollId) ?? null,
    [step, activeRollId],
  );

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["kursun-qc-step", stepId] });

  const lookupMutation = useMutation({
    mutationFn: (barcode: string) => kursunQcService.getByCardBarcode(barcode),
    onSuccess: (res) => {
      if (res.data) {
        setStepId(res.data.workOrderStepId);
        setCardBarcode("");
        toast.success(
          `Adım açıldı: ${res.data.stationCode} · Parti ${res.data.batchNumber}`,
        );
      }
    },
    onError: (err) => toast.error(errorMessage(err, "Kart bulunamadı")),
  });

  const applyKursunM = useMutation({
    mutationFn: (rollId: string) =>
      kursunQcService.applyKursun({ rollId, stepId: stepId! }),
    onSuccess: (r) => {
      toast.success(r.message ?? "Kurşun geçildi");
      invalidate();
    },
    onError: (err) => toast.error(errorMessage(err, "Kurşun geçilemedi")),
  });

  const undoKursunM = useMutation({
    mutationFn: (rollId: string) =>
      kursunQcService.undoKursun({ rollId, stepId: stepId! }),
    onSuccess: (r) => {
      toast.success(r.message ?? "Kurşun geri alındı");
      invalidate();
    },
    onError: (err) => toast.error(errorMessage(err, "Geri alınamadı")),
  });

  const completeQc2M = useMutation({
    mutationFn: (rollId: string) =>
      kursunQcService.completeQc2({ rollId, stepId: stepId! }),
    onSuccess: (r, rollId) => {
      toast.success(r.message ?? "QC2 tamamlandı");
      invalidate();
      // auto-advance to next pending roll
      if (step) {
        const next = step.rolls.find(
          (x) => !x.qc2Completed && x.rollId !== rollId,
        );
        if (next) setActiveRollId(next.rollId);
      }
    },
    onError: (err) => toast.error(errorMessage(err, "QC2 tamamlanamadı")),
  });

  const reportErrorM = useMutation({
    mutationFn: (data: {
      rollId: string;
      defectTypeId: string;
      startMeter: number;
      endMeter: number;
    }) =>
      kursunQcService.reportError({
        rollId: data.rollId,
        stepId: stepId!,
        startMeter: data.startMeter,
        endMeter: data.endMeter,
        defectTypeId: data.defectTypeId,
      }),
    onSuccess: () => {
      toast.success("Hata kaydı açıldı");
      setPendingDefect(null);
      invalidate();
    },
    onError: (err) => toast.error(errorMessage(err, "Hata kaydedilemedi")),
  });

  const deleteErrorM = useMutation({
    mutationFn: (errorId: string) => kursunQcService.deleteError(errorId),
    onSuccess: () => {
      toast.success("Hata silindi");
      invalidate();
    },
    onError: (err) => toast.error(errorMessage(err, "Hata silinemedi")),
  });

  const finishStepM = useMutation({
    mutationFn: () => kursunQcService.finishStep(stepId!),
    onSuccess: (r) => {
      toast.success(
        r.message ??
          `Adım kapatıldı, ${r.data?.movedRollCount ?? 0} top taşındı`,
      );
      setStepId(null);
      setActiveRollId(null);
      qc.invalidateQueries({ queryKey: ["rolls"] });
      qc.invalidateQueries({ queryKey: ["work-orders"] });
    },
    onError: (err) => toast.error(errorMessage(err, "Adım kapatılamadı")),
  });

  const onLookup = () => {
    const v = cardBarcode.trim();
    if (!v) return;
    lookupMutation.mutate(v);
  };

  const totalRolls = step?.rolls.length ?? 0;
  const qc2Done = step?.rolls.filter((r) => r.qc2Completed).length ?? 0;
  const allQc2Done = totalRolls > 0 && qc2Done === totalRolls;

  // ─── Scan landing ──────────────────────────────────────────────────────────
  if (!stepId) {
    return (
      <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center p-4">
        <div className="w-full max-w-2xl space-y-6">
          <div className="flex items-center justify-center gap-3">
            <ShieldCheck className="h-10 w-10 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight">
              Kurşun + Kalite Kontrol 2
            </h1>
          </div>
          <p className="text-center text-muted-foreground text-lg">
            Devam etmek için refakat kartını okutun
          </p>
          <div className="rounded-2xl border-2 border-dashed border-primary/40 p-6 bg-card space-y-4">
            <Label className="text-base font-semibold flex items-center gap-2">
              <ScanLine className="h-5 w-5" /> Refakat Kartı Barkodu
            </Label>
            <Input
              ref={scanInputRef}
              value={cardBarcode}
              onChange={(e) => setCardBarcode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onLookup();
              }}
              placeholder="TC-... (okuyucuyu kullanın veya elle girin)"
              className="h-16 text-2xl font-mono text-center"
              autoFocus
            />
            <Button
              onClick={onLookup}
              disabled={lookupMutation.isPending || !cardBarcode.trim()}
              isLoading={lookupMutation.isPending}
              className="w-full h-16 text-xl"
            >
              <ScanLine className="h-6 w-6" />
              Adımı Aç
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Loading step ─────────────────────────────────────────────────────────
  if (!step) {
    return (
      <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  // ─── Workspace ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 pb-24">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              setStepId(null);
              setActiveRollId(null);
            }}
            title="Kart değiştir"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <ShieldCheck className="h-7 w-7 text-primary" />
          <div>
            <div className="font-bold text-lg leading-tight">
              {step.stationName}
            </div>
            <div className="text-xs text-muted-foreground font-mono">
              {step.stationCode} · Parti {step.batchNumber}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-sm h-8 px-3">
            {totalRolls} top
          </Badge>
          <Badge
            variant={allQc2Done ? "default" : "secondary"}
            className={`text-sm h-8 px-3 ${
              allQc2Done ? "bg-green-600 hover:bg-green-600" : ""
            }`}
          >
            QC2 {qc2Done}/{totalRolls}
          </Badge>
          <Button
            variant="outline"
            size="icon"
            onClick={() => invalidate()}
            disabled={stepQuery.isFetching}
            title="Yenile"
          >
            <RefreshCw
              className={`h-4 w-4 ${
                stepQuery.isFetching ? "animate-spin" : ""
              }`}
            />
          </Button>
        </div>
      </div>

      {step.rolls.length === 0 ? (
        <div className="rounded-xl border bg-card p-12 text-center text-muted-foreground">
          Bu adımda aktif top yok.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
          {/* Roll list */}
          <RollSidebar
            rolls={step.rolls}
            activeRollId={activeRollId}
            onSelect={setActiveRollId}
          />

          {/* Active roll workspace */}
          <div>
            {activeRoll ? (
              <ActiveRollPanel
                roll={activeRoll}
                defectCatalog={defectCatalog}
                defectsLoading={defectsQuery.isLoading}
                pendingDefect={pendingDefect}
                onPickDefect={(d) => {
                  setPendingDefect({
                    defectTypeId: d.id,
                    defectName: d.name,
                    severity: d.severity,
                    startMeter: "",
                    endMeter: "",
                  });
                }}
                onCancelPending={() => setPendingDefect(null)}
                onChangePending={(patch) =>
                  setPendingDefect((p) => (p ? { ...p, ...patch } : p))
                }
                onSubmitPending={() => {
                  if (!pendingDefect || !activeRoll) return;
                  const start = Number(pendingDefect.startMeter);
                  const end = Number(pendingDefect.endMeter);
                  reportErrorM.mutate({
                    rollId: activeRoll.rollId,
                    defectTypeId: pendingDefect.defectTypeId,
                    startMeter: start,
                    endMeter: end,
                  });
                }}
                pendingSaving={reportErrorM.isPending}
                onApplyKursun={() => applyKursunM.mutate(activeRoll.rollId)}
                onUndoKursun={() => undoKursunM.mutate(activeRoll.rollId)}
                onCompleteQc2={() => completeQc2M.mutate(activeRoll.rollId)}
                onDeleteError={(id) => deleteErrorM.mutate(id)}
                applyPending={
                  applyKursunM.isPending &&
                  applyKursunM.variables === activeRoll.rollId
                }
                undoPending={
                  undoKursunM.isPending &&
                  undoKursunM.variables === activeRoll.rollId
                }
                qc2Pending={
                  completeQc2M.isPending &&
                  completeQc2M.variables === activeRoll.rollId
                }
                deletingErrorId={
                  deleteErrorM.isPending
                    ? (deleteErrorM.variables as string)
                    : null
                }
              />
            ) : (
              <div className="rounded-xl border bg-card p-12 text-center text-muted-foreground">
                Soldan bir top seçin
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sticky finish bar */}
      <div className="fixed inset-x-0 bottom-0 border-t bg-background/95 backdrop-blur p-3 z-10">
        <div className="max-w-7xl mx-auto flex items-center gap-3">
          <div className="flex-1 text-sm text-muted-foreground">
            {allQc2Done ? (
              <span className="text-green-600 font-semibold flex items-center gap-1">
                <CheckCircle2 className="h-4 w-4" />
                Tüm toplar QC2 tamamlandı, adım kapatılabilir.
              </span>
            ) : (
              <>
                Adımı kapatmak için tüm topların QC2 tamamlanmış olması gerekir
                ({qc2Done}/{totalRolls}).
              </>
            )}
          </div>
          <Button
            disabled={!allQc2Done || finishStepM.isPending || totalRolls === 0}
            isLoading={finishStepM.isPending}
            onClick={() => finishStepM.mutate()}
            className="h-14 text-lg px-6"
          >
            <ArrowRight className="h-5 w-5" />
            Adımı Bitir ve Sonraki İstasyona Gönder
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Roll Sidebar ──────────────────────────────────────────────────────────
interface RollSidebarProps {
  rolls: KursunQcRollSummary[];
  activeRollId: string | null;
  onSelect: (id: string) => void;
}

function RollSidebar({ rolls, activeRollId, onSelect }: RollSidebarProps) {
  return (
    <div className="rounded-xl border bg-card p-2 space-y-1.5 lg:max-h-[calc(100vh-14rem)] lg:overflow-y-auto">
      {rolls.map((r, idx) => {
        const isActive = r.rollId === activeRollId;
        return (
          <button
            key={r.rollId}
            onClick={() => onSelect(r.rollId)}
            className={`w-full text-left rounded-lg p-3 transition-colors border-2 ${
              isActive
                ? "border-primary bg-primary/10"
                : "border-transparent hover:bg-accent"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-bold w-5 text-center text-muted-foreground">
                  {idx + 1}
                </span>
                <code className="text-sm font-mono font-semibold truncate">
                  {r.barcode}
                </code>
              </div>
              {r.qc2Completed && (
                <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
              )}
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <Ruler className="h-3 w-3" />
              {r.currentQty.toFixed(1)}m
              {r.kursunApplied && (
                <Badge variant="secondary" className="text-[10px] py-0">
                  Kurşun
                </Badge>
              )}
              {r.errorCount > 0 && (
                <Badge variant="destructive" className="text-[10px] py-0">
                  {r.errorCount} hata
                </Badge>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─── Active Roll Panel ─────────────────────────────────────────────────────
interface ActiveRollPanelProps {
  roll: KursunQcRollSummary;
  defectCatalog: DefectType[];
  defectsLoading: boolean;
  pendingDefect: PendingDefect | null;
  onPickDefect: (d: DefectType) => void;
  onCancelPending: () => void;
  onChangePending: (patch: Partial<PendingDefect>) => void;
  onSubmitPending: () => void;
  pendingSaving: boolean;
  onApplyKursun: () => void;
  onUndoKursun: () => void;
  onCompleteQc2: () => void;
  onDeleteError: (errorId: string) => void;
  applyPending: boolean;
  undoPending: boolean;
  qc2Pending: boolean;
  deletingErrorId: string | null;
}

function ActiveRollPanel({
  roll,
  defectCatalog,
  defectsLoading,
  pendingDefect,
  onPickDefect,
  onCancelPending,
  onChangePending,
  onSubmitPending,
  pendingSaving,
  onApplyKursun,
  onUndoKursun,
  onCompleteQc2,
  onDeleteError,
  applyPending,
  undoPending,
  qc2Pending,
  deletingErrorId,
}: ActiveRollPanelProps) {
  return (
    <div className="space-y-4">
      {/* Roll header */}
      <div
        className={`rounded-xl border-2 p-4 ${
          roll.qc2Completed
            ? "border-green-400 bg-green-50/60 dark:bg-green-950/20 dark:border-green-800"
            : "border-border bg-card"
        }`}
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <code className="text-2xl font-mono font-bold">{roll.barcode}</code>
            <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
              <Ruler className="h-4 w-4" />
              {roll.currentQty.toFixed(1)} metre
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {roll.kursunApplied && (
              <Badge variant="secondary" className="text-sm h-7 px-3">
                <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Kurşun ✓
              </Badge>
            )}
            {roll.qc2Completed && (
              <Badge className="text-sm h-7 px-3 bg-green-600 hover:bg-green-600">
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> QC2 ✓
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Big primary actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {roll.kursunApplied ? (
          <Button
            onClick={onUndoKursun}
            disabled={undoPending || roll.qc2Completed}
            isLoading={undoPending}
            variant="outline"
            className="h-20 text-xl border-2"
          >
            <Undo2 className="h-6 w-6" /> Kurşunu Geri Al
          </Button>
        ) : (
          <Button
            onClick={onApplyKursun}
            disabled={applyPending || roll.qc2Completed}
            isLoading={applyPending}
            variant="secondary"
            className="h-20 text-xl border-2"
          >
            <ShieldCheck className="h-6 w-6" /> Kurşun Geç
          </Button>
        )}

        <Button
          onClick={onCompleteQc2}
          disabled={qc2Pending || roll.qc2Completed}
          isLoading={qc2Pending}
          className={`h-20 text-xl border-2 ${
            roll.qc2Completed ? "" : "bg-green-600 hover:bg-green-700"
          }`}
        >
          <CheckCircle2 className="h-6 w-6" />
          {roll.qc2Completed ? "QC2 Tamamlandı" : "QC2 Tamamla"}
        </Button>
      </div>

      {/* Defect catalog */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2 text-base">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Hata Türü Seç
          </h2>
          <span className="text-xs text-muted-foreground">
            Tıkla → metraj gir
          </span>
        </div>

        {defectsLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        ) : defectCatalog.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Hata tipi tanımlı değil. Yönetici "Tanımlar → Hata Tipleri"
            ekranından eklemeli.
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {defectCatalog.map((d) => {
              const selected = pendingDefect?.defectTypeId === d.id;
              return (
                <button
                  key={d.id}
                  onClick={() => onPickDefect(d)}
                  disabled={roll.qc2Completed}
                  className={`h-16 rounded-lg border-2 px-3 font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${severityButtonClass(
                    d.severity,
                  )} ${selected ? "ring-2 ring-offset-2 ring-primary" : ""}`}
                  title={d.description ?? d.name}
                >
                  <div className="text-base leading-tight">{d.name}</div>
                  {d.severity && (
                    <div className="text-[10px] uppercase tracking-wide opacity-70 mt-0.5">
                      {severityLabels[d.severity]}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Inline meter range entry */}
        {pendingDefect && (
          <div className="rounded-xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-3 mt-2">
            <div className="flex items-center justify-between">
              <div className="font-semibold">
                {pendingDefect.defectName} → metraj girin
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={onCancelPending}
                title="İptal"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Başlangıç (m)</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  inputMode="decimal"
                  value={pendingDefect.startMeter}
                  onChange={(e) =>
                    onChangePending({ startMeter: e.target.value })
                  }
                  className="h-14 text-2xl text-center font-semibold"
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Bitiş (m)</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  inputMode="decimal"
                  value={pendingDefect.endMeter}
                  onChange={(e) =>
                    onChangePending({ endMeter: e.target.value })
                  }
                  className="h-14 text-2xl text-center font-semibold"
                />
              </div>
            </div>
            {(() => {
              const s = Number(pendingDefect.startMeter);
              const e = Number(pendingDefect.endMeter);
              const valid =
                pendingDefect.startMeter !== "" &&
                pendingDefect.endMeter !== "" &&
                !Number.isNaN(s) &&
                !Number.isNaN(e) &&
                s >= 0 &&
                e > s &&
                e <= roll.currentQty;
              const errMsg = (() => {
                if (
                  pendingDefect.startMeter === "" ||
                  pendingDefect.endMeter === ""
                )
                  return null;
                if (Number.isNaN(s) || Number.isNaN(e)) return "Geçersiz sayı";
                if (s < 0) return "Başlangıç negatif olamaz";
                if (e <= s) return "Bitiş başlangıçtan büyük olmalı";
                if (e > roll.currentQty)
                  return `Bitiş top metrajını (${roll.currentQty.toFixed(1)}m) aşamaz`;
                return null;
              })();
              return (
                <>
                  {errMsg && (
                    <p className="text-xs text-destructive">{errMsg}</p>
                  )}
                  <Button
                    onClick={onSubmitPending}
                    disabled={!valid || pendingSaving}
                    isLoading={pendingSaving}
                    className="w-full h-16 text-xl"
                  >
                    <Plus className="h-5 w-5" /> Hatayı Kaydet
                  </Button>
                </>
              );
            })()}
          </div>
        )}
      </div>

      {/* Existing defects list */}
      <DefectList
        defects={roll.defects}
        onDelete={onDeleteError}
        deletingId={deletingErrorId}
        readonly={roll.qc2Completed}
      />
    </div>
  );
}

// ─── Defect List ───────────────────────────────────────────────────────────
interface DefectListProps {
  defects: KursunQcDefectSummary[];
  onDelete: (id: string) => void;
  deletingId: string | null;
  readonly: boolean;
}

function DefectList({
  defects,
  onDelete,
  deletingId,
  readonly,
}: DefectListProps) {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-base">
          Bu Top İçin Kayıtlı Hatalar
        </h2>
        <Badge variant={defects.length > 0 ? "destructive" : "secondary"}>
          {defects.length}
        </Badge>
      </div>
      {defects.length === 0 ? (
        <p className="text-sm text-muted-foreground py-3 text-center">
          Henüz hata kaydı yok.
        </p>
      ) : (
        <ul className="divide-y">
          {defects.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between py-2 gap-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="font-mono text-sm bg-muted rounded px-2 py-1">
                  {d.startMeter.toFixed(1)} – {d.endMeter.toFixed(1)} m
                </div>
                <div className="font-medium truncate">
                  {d.errorType ?? "—"}
                </div>
              </div>
              {!readonly && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onDelete(d.id)}
                  disabled={deletingId === d.id}
                  title="Hatayı sil"
                >
                  {deletingId === d.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4 text-destructive" />
                  )}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
