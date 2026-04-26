import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  Scissors,
  ShieldCheck,
  Loader2,
  AlertTriangle,
  Ruler,
  CheckCircle2,
  Layers,
  Palette,
  Settings2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  tamburService,
  type ErrorDecision,
  type CutMode,
} from "@/services/tamburService";
import { swatchService } from "@/services/swatchService";
import type { RollError } from "@/types/models";

interface TamburDecisionPanelProps {
  rollId: string;
  onBack: () => void;
}

export default function TamburDecisionPanel({
  rollId,
  onBack,
}: TamburDecisionPanelProps) {
  const qc = useQueryClient();

  const { data: rollData, isLoading } = useQuery({
    queryKey: ["tambur-roll", rollId],
    queryFn: () => tamburService.getRollForDecision(rollId),
  });

  const roll = rollData?.data;
  const errors = roll?.errors ?? [];

  const [decisions, setDecisions] = useState<
    Record<string, { decision: "CUT" | "NO_CUT"; qualityGrade: string }>
  >({});
  const [netQty, setNetQty] = useState("");
  const [foldType, setFoldType] = useState<"2-KAT" | "4-KAT">("2-KAT");
  const [layerCount, setLayerCount] = useState<number>(2);
  const [cutMode, setCutMode] = useState<CutMode>("BY_DEFECT");
  const [cutLengthM, setCutLengthM] = useState("50");
  const [showSwatch, setShowSwatch] = useState(false);
  const [swatchLength, setSwatchLength] = useState("0.3");
  const [swatchCount, setSwatchCount] = useState("1");

  useEffect(() => {
    if (errors.length > 0) {
      const initial: typeof decisions = {};
      errors.forEach((err) => {
        initial[err.id] = { decision: "NO_CUT", qualityGrade: "FIRE" };
      });
      setDecisions(initial);
    }
  }, [errors.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (roll) {
      const cutTotal = (errors || []).reduce((sum, err) => {
        if (decisions[err.id]?.decision === "CUT") {
          return sum + (err.endMeter - err.startMeter);
        }
        return sum;
      }, 0);
      setNetQty(String(Math.max(0, roll.currentQty - cutTotal).toFixed(1)));
    }
  }, [decisions, roll, errors]);

  const finalizeMutation = useMutation({
    mutationFn: () => {
      const decisionArray: ErrorDecision[] = errors.map((err) => ({
        errorId: err.id,
        decision: decisions[err.id]?.decision ?? "NO_CUT",
        qualityGrade:
          decisions[err.id]?.decision === "CUT"
            ? decisions[err.id]?.qualityGrade || "FIRE"
            : undefined,
      }));

      return tamburService.finalize({
        rollId,
        netCurrentQty: Number(netQty),
        foldType,
        layerCount,
        cutMode,
        cutLengthM: cutMode === "FIXED_LENGTH" ? Number(cutLengthM) : null,
        decisions: decisionArray,
      });
    },
    onSuccess: (res) => {
      const splitCount = res.data?.splitRolls?.length ?? 0;
      toast.success(
        res.message ?? `Tambur tamamlandı. ${splitCount} kesim yapıldı.`,
      );
      qc.invalidateQueries({ queryKey: ["tambur-pending"] });
      qc.invalidateQueries({ queryKey: ["packaging-pending"] });
      qc.invalidateQueries({ queryKey: ["rolls"] });
      onBack();
    },
    onError: () => {
      toast.error("Finalizasyon başarısız");
    },
  });

  const swatchMutation = useMutation({
    mutationFn: () =>
      swatchService.create({
        sourceRollId: rollId,
        length: Number(swatchLength),
        count: Number(swatchCount),
      }),
    onSuccess: (res) => {
      toast.success(
        res.message ?? `${swatchCount} adet kartela basıldı.`,
      );
      qc.invalidateQueries({ queryKey: ["tambur-roll", rollId] });
      qc.invalidateQueries({ queryKey: ["swatches"] });
      setShowSwatch(false);
    },
    onError: () => {
      toast.error("Kartela basımı başarısız");
    },
  });

  const toggleDecision = (errorId: string) => {
    setDecisions((prev) => ({
      ...prev,
      [errorId]: {
        ...prev[errorId],
        decision: prev[errorId]?.decision === "CUT" ? "NO_CUT" : "CUT",
      },
    }));
  };

  const setQualityGrade = (errorId: string, grade: string) => {
    setDecisions((prev) => ({
      ...prev,
      [errorId]: { ...prev[errorId], qualityGrade: grade },
    }));
  };

  const cutCount = Object.values(decisions).filter(
    (d) => d.decision === "CUT",
  ).length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!roll) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Top bulunamadı.</p>
        <Button variant="outline" onClick={onBack} className="mt-4">
          Geri Dön
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          className="h-12 w-12 shrink-0"
        >
          <ArrowLeft className="h-6 w-6" />
        </Button>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold truncate">{roll.barcode}</h2>
          <p className="text-sm text-muted-foreground truncate">
            {roll.item?.code} — {roll.item?.name}
          </p>
          <div className="flex gap-1.5 flex-wrap mt-1">
            {roll.variant?.code && (
              <Badge variant="outline" className="text-xs">
                Lot: {roll.variant.code}
              </Badge>
            )}
            {roll.qualityGrade && (
              <Badge variant="secondary" className="text-xs">
                {roll.qualityGrade}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Roll Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">Metraj</p>
            <p className="text-2xl font-bold">{roll.currentQty}m</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">En</p>
            <p className="text-2xl font-bold">
              {roll.width != null ? `${roll.width}` : "—"}
              {roll.width != null && (
                <span className="text-sm font-normal ml-1">cm</span>
              )}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">Hata</p>
            <p className="text-2xl font-bold text-orange-600">
              {errors.length}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Error Decision Cards */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-orange-500" />
          Hatalar ve Kararlar
        </h3>

        {errors.map((err: RollError, idx: number) => {
          const d = decisions[err.id];
          const isCut = d?.decision === "CUT";
          const meterRange = (err.endMeter - err.startMeter).toFixed(1);

          return (
            <Card
              key={err.id}
              className={`transition-colors ${
                isCut
                  ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950"
                  : "border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950"
              }`}
            >
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className="text-xs"
                    >
                      #{idx + 1}
                    </Badge>
                    <div className="flex items-center gap-1 text-sm">
                      <Ruler className="h-3.5 w-3.5" />
                      <span className="font-medium">
                        {err.startMeter}m → {err.endMeter}m
                      </span>
                      <span className="text-muted-foreground">
                        ({meterRange}m)
                      </span>
                    </div>
                  </div>
                  {err.errorType && (
                    <Badge variant="secondary" className="text-xs">
                      {err.errorType}
                    </Badge>
                  )}
                </div>

                {/* Big Touch Buttons */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (!isCut) return;
                      toggleDecision(err.id);
                    }}
                    className={`flex items-center justify-center gap-2 h-14 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
                      !isCut
                        ? "bg-green-600 text-white shadow-md ring-2 ring-green-400"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    <ShieldCheck className="h-5 w-5" />
                    KESME
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (isCut) return;
                      toggleDecision(err.id);
                    }}
                    className={`flex items-center justify-center gap-2 h-14 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
                      isCut
                        ? "bg-red-600 text-white shadow-md ring-2 ring-red-400"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    <Scissors className="h-5 w-5" />
                    KES
                  </button>
                </div>

                {isCut && (
                  <div className="flex items-center gap-2">
                    <Label className="text-xs shrink-0">Kalite:</Label>
                    <div className="flex gap-1.5">
                      {["FIRE", "A1", "A2"].map((grade) => (
                        <button
                          key={grade}
                          type="button"
                          onClick={() => setQualityGrade(err.id, grade)}
                          className={`px-3 py-1.5 rounded text-xs font-medium transition-colors cursor-pointer ${
                            d?.qualityGrade === grade
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground hover:bg-muted/80"
                          }`}
                        >
                          {grade}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Sarım (Kat) + Katlama */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <Label className="text-sm font-semibold flex items-center gap-2">
            <Layers className="h-4 w-4" />
            Sarım ve Katlama
          </Label>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Kat Sayısı (Sarım)</p>
            <div className="grid grid-cols-6 gap-2">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setLayerCount(n)}
                  className={`h-12 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
                    layerCount === n
                      ? "bg-primary text-primary-foreground shadow-md ring-2 ring-primary/40"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Katlama Şekli</p>
            <div className="grid grid-cols-2 gap-2">
              {(["2-KAT", "4-KAT"] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setFoldType(opt)}
                  className={`h-12 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
                    foldType === opt
                      ? "bg-primary text-primary-foreground shadow-md ring-2 ring-primary/40"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Kesim Stratejisi */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <Label className="text-sm font-semibold flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Kesim Stratejisi
          </Label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setCutMode("BY_DEFECT")}
              className={`h-14 rounded-lg text-xs font-semibold transition-all cursor-pointer flex flex-col items-center justify-center ${
                cutMode === "BY_DEFECT"
                  ? "bg-primary text-primary-foreground shadow-md ring-2 ring-primary/40"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              <span>Hata Noktasında</span>
              <span className="text-[10px] opacity-80 font-normal mt-0.5">
                (yalnız işaretli yerler)
              </span>
            </button>
            <button
              type="button"
              onClick={() => setCutMode("FIXED_LENGTH")}
              className={`h-14 rounded-lg text-xs font-semibold transition-all cursor-pointer flex flex-col items-center justify-center ${
                cutMode === "FIXED_LENGTH"
                  ? "bg-primary text-primary-foreground shadow-md ring-2 ring-primary/40"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              <span>Sabit Metrede</span>
              <span className="text-[10px] opacity-80 font-normal mt-0.5">
                (her X m'de bir)
              </span>
            </button>
          </div>

          {cutMode === "FIXED_LENGTH" && (
            <div className="space-y-1 pt-2">
              <Label htmlFor="cutLen" className="text-xs">
                Her kaç metrede bir kesilecek?
              </Label>
              <Input
                id="cutLen"
                type="number"
                step="1"
                min="1"
                value={cutLengthM}
                onChange={(e) => setCutLengthM(e.target.value)}
                className="h-12 text-lg"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Swatch (Kartela) */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold flex items-center gap-2">
              <Palette className="h-4 w-4" />
              Numune Kartela
            </Label>
            <Button
              type="button"
              variant={showSwatch ? "default" : "outline"}
              size="sm"
              onClick={() => setShowSwatch((v) => !v)}
            >
              {showSwatch ? "Vazgeç" : "Kartela Kes"}
            </Button>
          </div>

          {showSwatch && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="swatchLength" className="text-xs">
                    Uzunluk (m)
                  </Label>
                  <Input
                    id="swatchLength"
                    type="number"
                    step="0.1"
                    value={swatchLength}
                    onChange={(e) => setSwatchLength(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="swatchCount" className="text-xs">
                    Adet
                  </Label>
                  <Input
                    id="swatchCount"
                    type="number"
                    step="1"
                    min="1"
                    value={swatchCount}
                    onChange={(e) => setSwatchCount(e.target.value)}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Toplam{" "}
                {(
                  Number(swatchLength || 0) * Number(swatchCount || 0)
                ).toFixed(1)}
                m net metrajdan düşülecek.
              </p>
              <Button
                type="button"
                onClick={() => swatchMutation.mutate()}
                disabled={
                  swatchMutation.isPending ||
                  Number(swatchLength) <= 0 ||
                  Number(swatchCount) <= 0
                }
                className="w-full"
                variant="secondary"
              >
                {swatchMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Palette className="h-4 w-4" />
                )}
                Kartela Üret ve Barkod Yazdır
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Net Quantity */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="netQty" className="text-sm font-semibold">
              Net Metraj (Kesim Sonrası)
            </Label>
            <Badge variant={cutCount > 0 ? "destructive" : "default"}>
              {cutCount} Kesim
            </Badge>
          </div>
          <Input
            id="netQty"
            type="number"
            step="0.1"
            value={netQty}
            onChange={(e) => setNetQty(e.target.value)}
            className="h-14 text-xl text-center font-bold"
          />
        </CardContent>
      </Card>

      {/* Finalize Button */}
      <Button
        onClick={() => finalizeMutation.mutate()}
        disabled={
          finalizeMutation.isPending || !netQty || Number(netQty) < 0
        }
        className="w-full h-14 text-base font-semibold"
        size="lg"
      >
        {finalizeMutation.isPending ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <CheckCircle2 className="h-5 w-5" />
        )}
        Bitti — Paket/Tartıya Gönder ({errors.length} hata, {cutCount} kesim)
      </Button>
    </div>
  );
}
