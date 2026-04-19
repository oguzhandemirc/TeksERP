import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CircleDot,
  AlertTriangle,
  PackageCheck,
  Ruler,
  ChevronRight,
  ScanLine,
  Loader2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  tamburService,
  type TamburStepSummary,
} from "@/services/tamburService";
import TamburDecisionPanel from "./TamburDecisionPanel";

export default function TamburPage() {
  const [selectedRollId, setSelectedRollId] = useState<string | null>(null);
  const [cardBarcode, setCardBarcode] = useState("");
  const [scanned, setScanned] = useState<TamburStepSummary | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);

  const { data: pendingData, isLoading } = useQuery({
    queryKey: ["tambur-pending"],
    queryFn: () => tamburService.getPendingRolls(),
    refetchInterval: 20000,
    enabled: !scanned, // Scan ekranı aktifken global liste kapanır
  });

  useEffect(() => {
    if (!selectedRollId && !scanned) {
      scanInputRef.current?.focus();
    }
  }, [selectedRollId, scanned]);

  const scanCard = async () => {
    const code = cardBarcode.trim();
    if (!code) return;
    setIsScanning(true);
    try {
      const res = await tamburService.getByCardBarcode(code);
      if (res.success && res.data) {
        setScanned(res.data);
        setCardBarcode("");
        toast.success(
          `İş emri ${res.data.batchNumber} — ${res.data.rolls.length} top`,
        );
      } else {
        toast.error(res.message ?? "Kart bulunamadı");
      }
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "Kart okunamadı";
      toast.error(msg);
    } finally {
      setIsScanning(false);
    }
  };

  if (selectedRollId) {
    return (
      <div className="max-w-2xl mx-auto">
        <TamburDecisionPanel
          rollId={selectedRollId}
          onBack={() => setSelectedRollId(null)}
        />
      </div>
    );
  }

  const pendingRolls = pendingData?.data ?? [];

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CircleDot className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">
            Tambur İstasyonu
          </h1>
        </div>
        {scanned ? (
          <Badge variant="default" className="text-sm px-3 py-1">
            {scanned.rolls.length} Top
          </Badge>
        ) : (
          <Badge variant="secondary" className="text-sm px-3 py-1">
            {pendingRolls.length} Bekleyen
          </Badge>
        )}
      </div>

      {/* Scan Bar */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <ScanLine className="h-5 w-5 text-primary" />
            <h2 className="text-sm font-semibold">Refakat Kartı Oku</h2>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              scanCard();
            }}
            className="flex gap-2"
          >
            <Input
              ref={scanInputRef}
              placeholder="RK-YYMM-XXXXXX-C"
              value={cardBarcode}
              onChange={(e) => setCardBarcode(e.target.value)}
              className="h-14 text-lg font-mono"
              autoFocus
              disabled={isScanning}
            />
            <Button
              type="submit"
              className="h-14 px-6"
              disabled={isScanning || !cardBarcode.trim()}
            >
              {isScanning ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                "Oku"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Scanned Work Order View */}
      {scanned && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">İş Emri</p>
              <p className="text-lg font-bold">{scanned.batchNumber}</p>
              <p className="text-xs text-muted-foreground">
                {scanned.stationCode} — {scanned.stationName}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10"
              onClick={() => {
                setScanned(null);
                setTimeout(() => scanInputRef.current?.focus(), 0);
              }}
              aria-label="Kart taramasını temizle"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          {scanned.rolls.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center">
                <PackageCheck className="h-10 w-10 mx-auto mb-3 text-green-500 opacity-60" />
                <p className="text-muted-foreground">
                  Bu iş emrinin Tambur adımında açık top yok.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {scanned.rolls.map((r) => (
                <button
                  key={r.rollId}
                  type="button"
                  onClick={() => setSelectedRollId(r.rollId)}
                  className="w-full text-left cursor-pointer"
                >
                  <Card className="hover:border-primary/50 hover:shadow-md transition-all active:scale-[0.99]">
                    <CardContent className="p-4 sm:p-5">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-base sm:text-lg truncate">
                              {r.barcode}
                            </span>
                            <Badge variant="secondary" className="text-xs">
                              {r.itemCode}
                            </Badge>
                            {r.variantCode && (
                              <Badge variant="outline" className="text-xs">
                                Lot: {r.variantCode}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            {r.itemName}
                            {r.variantName ? ` — ${r.variantName}` : ""}
                          </p>
                          <div className="flex items-center gap-4 text-sm">
                            <span className="flex items-center gap-1">
                              <Ruler className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="font-medium">
                                {r.currentQty}m
                              </span>
                            </span>
                            {r.width != null && (
                              <span className="text-muted-foreground text-xs">
                                En: {r.width} cm
                              </span>
                            )}
                            {r.errorCount > 0 && (
                              <span className="flex items-center gap-1 text-orange-600 dark:text-orange-400">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                <span className="font-medium">
                                  {r.errorCount} hata
                                </span>
                              </span>
                            )}
                          </div>
                        </div>
                        <ChevronRight className="h-6 w-6 text-muted-foreground shrink-0" />
                      </div>
                    </CardContent>
                  </Card>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Global Pending Fallback */}
      {!scanned && (
        <>
          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">
              veya bekleyen toplar
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="h-24 bg-muted animate-pulse rounded-xl"
                />
              ))}
            </div>
          ) : pendingRolls.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <PackageCheck className="h-12 w-12 mx-auto mb-3 text-green-500 opacity-60" />
                <p className="text-lg font-medium text-muted-foreground">
                  Bekleyen top bulunmuyor
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Kartı okut veya her 20 saniyede otomatik yenilenir.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {pendingRolls.map((roll) => {
                const errorCount = roll.errors?.length ?? 0;
                const totalErrorMeters =
                  roll.errors?.reduce(
                    (sum, e) => sum + (e.endMeter - e.startMeter),
                    0,
                  ) ?? 0;

                return (
                  <button
                    key={roll.id}
                    type="button"
                    onClick={() => setSelectedRollId(roll.id)}
                    className="w-full text-left cursor-pointer"
                  >
                    <Card className="hover:border-primary/50 hover:shadow-md transition-all active:scale-[0.99]">
                      <CardContent className="p-4 sm:p-5">
                        <div className="flex items-center gap-3">
                          <div className="flex-1 min-w-0 space-y-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-base sm:text-lg truncate">
                                {roll.barcode}
                              </span>
                              <Badge variant="secondary" className="text-xs">
                                {roll.item?.code}
                              </Badge>
                              {roll.variant?.code && (
                                <Badge variant="outline" className="text-xs">
                                  Lot: {roll.variant.code}
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-4 text-sm">
                              <span className="flex items-center gap-1">
                                <Ruler className="h-3.5 w-3.5 text-muted-foreground" />
                                <span className="font-medium">
                                  {roll.currentQty}m
                                </span>
                              </span>
                              {roll.width != null && (
                                <span className="text-muted-foreground text-xs">
                                  En: {roll.width} cm
                                </span>
                              )}
                              <span className="flex items-center gap-1 text-orange-600 dark:text-orange-400">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                <span className="font-medium">
                                  {errorCount} hata
                                </span>
                              </span>
                              <span className="text-muted-foreground text-xs">
                                ({totalErrorMeters.toFixed(1)}m hatalı)
                              </span>
                            </div>
                          </div>
                          <ChevronRight className="h-6 w-6 text-muted-foreground shrink-0" />
                        </div>
                      </CardContent>
                    </Card>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
