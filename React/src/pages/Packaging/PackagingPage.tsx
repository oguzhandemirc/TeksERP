import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  PackageCheck,
  Ruler,
  ChevronRight,
  ScanLine,
  Loader2,
  X,
  CreditCard,
  Barcode,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  packagingService,
  type PackagingRollSummary,
  type PackagingStepSummary,
} from "@/services/packagingService";
import PackagingDecisionPanel from "./PackagingDecisionPanel";

type ScanMode = "CARD" | "ROLL";

export default function PackagingPage() {
  const [selectedRoll, setSelectedRoll] = useState<PackagingRollSummary | null>(
    null,
  );
  const [scanMode, setScanMode] = useState<ScanMode>("CARD");
  const [scanInput, setScanInput] = useState("");
  const [cardSummary, setCardSummary] = useState<PackagingStepSummary | null>(
    null,
  );
  const [lastCardBarcode, setLastCardBarcode] = useState<string | null>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const { data: pendingData, isLoading } = useQuery({
    queryKey: ["packaging-pending"],
    queryFn: () => packagingService.getPendingRolls(),
    refetchInterval: 20000,
    enabled: !selectedRoll && !cardSummary,
  });

  useEffect(() => {
    if (!selectedRoll && !cardSummary) {
      scanInputRef.current?.focus();
    }
  }, [selectedRoll, cardSummary]);

  const cardScanMutation = useMutation({
    mutationFn: (code: string) => packagingService.getByCardBarcode(code),
    onSuccess: (res, code) => {
      if (res.success && res.data) {
        setCardSummary(res.data);
        setLastCardBarcode(code);
        setScanInput("");
        toast.success(
          `İş emri ${res.data.batchNumber} — ${res.data.rolls.length} top`,
        );
      } else {
        toast.error(res.message ?? "Kart bulunamadı");
      }
    },
  });

  const rollScanMutation = useMutation({
    mutationFn: (code: string) => packagingService.getByRollBarcode(code),
    onSuccess: (res) => {
      if (res.success && res.data) {
        setSelectedRoll(res.data);
        setScanInput("");
      } else {
        toast.error(res.message ?? "Top bulunamadı");
      }
    },
  });

  const isScanning = cardScanMutation.isPending || rollScanMutation.isPending;

  const handleScan = () => {
    const code = scanInput.trim();
    if (!code) return;
    if (scanMode === "CARD") {
      cardScanMutation.mutate(code);
    } else {
      rollScanMutation.mutate(code);
    }
  };

  const refreshCardSummary = async () => {
    if (!lastCardBarcode) return;
    const res = await packagingService.getByCardBarcode(lastCardBarcode);
    if (res.success && res.data) {
      setCardSummary(res.data);
    }
  };

  if (selectedRoll) {
    return (
      <div className="max-w-2xl mx-auto">
        <PackagingDecisionPanel
          summary={selectedRoll}
          onDone={async () => {
            setSelectedRoll(null);
            qc.invalidateQueries({ queryKey: ["packaging-pending"] });
            if (lastCardBarcode) {
              await refreshCardSummary();
            }
          }}
          onBack={() => setSelectedRoll(null)}
        />
      </div>
    );
  }

  const pendingRolls = pendingData?.data ?? [];

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PackageCheck className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">
            Paket / Tartı / Etiket
          </h1>
        </div>
        {cardSummary ? (
          <Badge variant="default" className="text-sm px-3 py-1">
            {cardSummary.rolls.length} Top
          </Badge>
        ) : (
          <Badge variant="secondary" className="text-sm px-3 py-1">
            {pendingRolls.length} Bekleyen
          </Badge>
        )}
      </div>

      {/* Scan bar */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setScanMode("CARD")}
              className={`h-12 rounded-lg text-sm font-semibold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                scanMode === "CARD"
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              <CreditCard className="h-4 w-4" />
              Refakat Kartı
            </button>
            <button
              type="button"
              onClick={() => setScanMode("ROLL")}
              className={`h-12 rounded-lg text-sm font-semibold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                scanMode === "ROLL"
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              <Barcode className="h-4 w-4" />
              Top Barkodu
            </button>
          </div>

          <div className="flex items-center gap-2">
            <ScanLine className="h-5 w-5 text-primary" />
            <h2 className="text-sm font-semibold">
              {scanMode === "CARD"
                ? "Refakat Kartını Okut"
                : "Top Barkodunu Okut"}
            </h2>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleScan();
            }}
            className="flex gap-2"
          >
            <Input
              ref={scanInputRef}
              placeholder={
                scanMode === "CARD" ? "RK-YYMM-XXXXXX-C" : "Top barkodu"
              }
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              className="h-14 text-lg font-mono"
              autoFocus
              disabled={isScanning}
            />
            <Button
              type="submit"
              className="h-14 px-6"
              disabled={isScanning || !scanInput.trim()}
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

      {/* Card scanned view */}
      {cardSummary && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">İş Emri</p>
              <p className="text-lg font-bold">{cardSummary.batchNumber}</p>
              <p className="text-xs text-muted-foreground">
                {cardSummary.stationCode} — {cardSummary.stationName}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10"
              onClick={() => {
                setCardSummary(null);
                setLastCardBarcode(null);
                setTimeout(() => scanInputRef.current?.focus(), 0);
              }}
              aria-label="Kart taramasını temizle"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          {cardSummary.rolls.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center">
                <PackageCheck className="h-10 w-10 mx-auto mb-3 text-green-500 opacity-60" />
                <p className="text-muted-foreground">
                  Bu iş emrinin paketleme adımında bekleyen top yok.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {cardSummary.rolls.map((r) => (
                <RollCard
                  key={r.rollId}
                  roll={r}
                  onSelect={() => setSelectedRoll(r)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Global fallback */}
      {!cardSummary && (
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
                  Paketleme kuyruğu boş
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Kart / top okut ya da her 20 saniyede otomatik yenilenir.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {pendingRolls.map((r) => (
                <RollCard
                  key={r.rollId}
                  roll={r}
                  onSelect={() => setSelectedRoll(r)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface RollCardProps {
  roll: PackagingRollSummary;
  onSelect: () => void;
}

function RollCard({ roll, onSelect }: RollCardProps) {
  return (
    <button type="button" onClick={onSelect} className="w-full text-left cursor-pointer">
      <Card className="hover:border-primary/50 hover:shadow-md transition-all active:scale-[0.99]">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-base sm:text-lg truncate">
                  {roll.barcode}
                </span>
                <Badge variant="secondary" className="text-xs">
                  {roll.itemCode}
                </Badge>
                {roll.variantCode && (
                  <Badge variant="outline" className="text-xs">
                    {roll.variantCode}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {roll.itemName}
                {roll.variantName ? ` — ${roll.variantName}` : ""}
                {roll.defaultCustomerName
                  ? ` • ${roll.defaultCustomerName}`
                  : ""}
              </p>
              <div className="flex items-center gap-4 text-sm">
                <span className="flex items-center gap-1">
                  <Ruler className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-medium">{roll.currentQty}m</span>
                </span>
                {roll.width != null && (
                  <span className="text-muted-foreground text-xs">
                    En: {roll.width} cm
                  </span>
                )}
                <span className="text-muted-foreground text-xs">
                  Parti: {roll.workOrderBatchNumber}
                </span>
              </div>
            </div>
            <ChevronRight className="h-6 w-6 text-muted-foreground shrink-0" />
          </div>
        </CardContent>
      </Card>
    </button>
  );
}
