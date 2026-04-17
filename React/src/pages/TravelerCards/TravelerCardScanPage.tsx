import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ScanLine,
  CheckCircle2,
  XCircle,
  Ticket,
  Factory,
  Clock,
  MapPin,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { travelerCardService } from "@/services/travelerCardService";
import { stationService } from "@/services/stationService";
import {
  ScanType,
  scanTypeLabels,
  travelerCardStatusLabels,
  stepStatusLabels,
  type TravelerCardStatus,
  type StepStatus,
} from "@/types/enums";
import type { TravelerCard, TravelerCardScan } from "@/types/models";

const statusColor: Record<TravelerCardStatus, string> = {
  ACTIVE:
    "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  REPRINTED:
    "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  VOIDED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  COMPLETED:
    "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
};

export default function TravelerCardScanPage() {
  const [barcode, setBarcode] = useState("");
  const [stationId, setStationId] = useState("");
  const [scanType, setScanType] = useState<ScanType>(ScanType.ARRIVAL);
  const [notes, setNotes] = useState("");
  const [preview, setPreview] = useState<TravelerCard | null>(null);
  const [lastScan, setLastScan] = useState<TravelerCardScan | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const { data: stationsData } = useQuery({
    queryKey: ["stations", "all-active"],
    queryFn: () =>
      stationService.getAll({
        page: 1,
        pageSize: 200,
        sortBy: "name",
        sortOrder: "asc",
        filters: { isActive: "true" },
      }),
  });

  const stationOptions =
    stationsData?.data?.map((s) => ({
      value: s.id,
      label: `${s.code} - ${s.name}`,
    })) ?? [];

  // Kart önizleme (barkod okutulduğunda otomatik tetiklenir)
  const lookupMutation = useMutation({
    mutationFn: (bc: string) => travelerCardService.findByBarcode(bc),
    onSuccess: (res) => {
      if (res.success && res.data) {
        setPreview(res.data);
      } else {
        setPreview(null);
        toast.error(res.message ?? "Kart bulunamadı");
      }
    },
    onError: () => {
      setPreview(null);
    },
  });

  const scanMutation = useMutation({
    mutationFn: () =>
      travelerCardService.scan({
        barcode: barcode.trim(),
        stationId,
        scanType,
        notes: notes.trim() || undefined,
      }),
    onSuccess: (res) => {
      if (res.success && res.data) {
        toast.success(res.message ?? "Tarama kaydedildi");
        setLastScan(res.data);
        setBarcode("");
        setNotes("");
        setPreview(null);
        inputRef.current?.focus();
      }
    },
  });

  const handleBarcodeEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && barcode.trim()) {
      e.preventDefault();
      lookupMutation.mutate(barcode.trim());
    }
  };

  const handleScan = (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcode.trim() || !stationId) {
      toast.error("Barkod ve istasyon seçimi zorunludur");
      return;
    }
    scanMutation.mutate();
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-2">
        <ScanLine className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight">
          Refakat Kartı Tarama
        </h1>
      </div>

      {/* Tarama Formu */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">El Terminali / Saha Girişi</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleScan} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="barcode">Refakat Kartı Barkodu *</Label>
              <Input
                id="barcode"
                ref={inputRef}
                value={barcode}
                onChange={(e) => setBarcode(e.target.value.toUpperCase())}
                onKeyDown={handleBarcodeEnter}
                placeholder="RK-YYMM-XXXXXX-C (barkod okutun veya elle yazın, Enter'a basın)"
                className="font-mono text-lg h-12"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Enter'a basarak kartı önce önizleyin, sonra "Taramayı Kaydet" ile
                kayıt edin.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="stationId">İstasyon *</Label>
                <Select
                  id="stationId"
                  value={stationId}
                  onChange={(e) => setStationId(e.target.value)}
                  options={stationOptions}
                  placeholder="İstasyon seçiniz"
                />
              </div>

              <div className="space-y-2">
                <Label>Tarama Tipi *</Label>
                <div className="flex gap-1">
                  {(
                    [
                      { type: ScanType.ARRIVAL, color: "blue" },
                      { type: ScanType.DEPARTURE, color: "green" },
                      { type: ScanType.INFO, color: "gray" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.type}
                      type="button"
                      onClick={() => setScanType(opt.type)}
                      className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                        scanType === opt.type
                          ? opt.color === "blue"
                            ? "bg-blue-100 text-blue-800 ring-2 ring-blue-500 dark:bg-blue-900 dark:text-blue-200"
                            : opt.color === "green"
                              ? "bg-green-100 text-green-800 ring-2 ring-green-500 dark:bg-green-900 dark:text-green-200"
                              : "bg-gray-100 text-gray-800 ring-2 ring-gray-500 dark:bg-gray-800 dark:text-gray-200"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                    >
                      {scanTypeLabels[opt.type]}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Not (opsiyonel)</Label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="ör: Renk tonu uygun, makinede arıza tespit edildi..."
              />
            </div>

            <Button
              type="submit"
              className="w-full h-12 text-base"
              disabled={!barcode.trim() || !stationId}
              isLoading={scanMutation.isPending}
            >
              <ScanLine className="h-5 w-5" />
              Taramayı Kaydet
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Kart Önizleme */}
      {preview && (
        <Card className="border-primary">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Ticket className="h-5 w-5 text-primary" />
              Kart Bilgileri
              <Badge
                variant="secondary"
                className={statusColor[preview.status]}
              >
                {travelerCardStatusLabels[preview.status]}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {preview.status !== "ACTIVE" && (
              <div className="flex items-center gap-2 rounded bg-red-50 dark:bg-red-950 p-2 text-sm text-red-800 dark:text-red-200">
                <AlertTriangle className="h-4 w-4" />
                Bu kart artık geçerli değil — tarama reddedilecek.
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 text-sm">
              <span className="text-muted-foreground">Kart No:</span>
              <span className="font-mono font-medium">{preview.cardNumber}</span>
              <span className="text-muted-foreground">Parti No:</span>
              <span className="font-medium">
                {preview.workOrder?.batchNumber ?? "—"}
              </span>
              <span className="text-muted-foreground">Versiyon:</span>
              <span>v{preview.version}</span>
              {preview.workOrder?.recipeNo && (
                <>
                  <span className="text-muted-foreground">Reçete:</span>
                  <span>{preview.workOrder.recipeNo}</span>
                </>
              )}
              {preview.workOrder?.width && (
                <>
                  <span className="text-muted-foreground">En:</span>
                  <span>{preview.workOrder.width} cm</span>
                </>
              )}
              {preview.workOrder?.dyehouseCompany && (
                <>
                  <span className="text-muted-foreground">
                    <Factory className="h-3 w-3 inline mr-1" />
                    Hedef:
                  </span>
                  <span>
                    {preview.workOrder.dyehouseCompany.code} —{" "}
                    {preview.workOrder.dyehouseCompany.name}
                  </span>
                </>
              )}
            </div>

            {/* Rota */}
            {preview.workOrder?.steps && preview.workOrder.steps.length > 0 && (
              <div className="pt-2 border-t">
                <div className="text-xs text-muted-foreground mb-2">Rota:</div>
                <div className="space-y-1">
                  {preview.workOrder.steps.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span className="text-muted-foreground w-6">
                        #{s.stepSequence}
                      </span>
                      <span className="font-medium flex-1">
                        {s.station?.code} — {s.station?.name}
                      </span>
                      <Badge variant="outline" className="text-[10px] py-0">
                        {stepStatusLabels[s.status as StepStatus]}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Son 5 tarama */}
            {preview.scans && preview.scans.length > 0 && (
              <div className="pt-2 border-t">
                <div className="text-xs text-muted-foreground mb-2">
                  Son Taramalar:
                </div>
                <div className="space-y-2">
                  {preview.scans.slice(0, 5).map((scan) => (
                    <div key={scan.id} className="space-y-0.5">
                      <div className="flex items-center gap-2 text-xs">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        <span className="tabular-nums text-muted-foreground">
                          {new Date(scan.scannedAt).toLocaleString("tr-TR")}
                        </span>
                        <Badge variant="outline" className="text-[10px] py-0">
                          {scanTypeLabels[scan.scanType as ScanType]}
                        </Badge>
                        <span className="font-medium">
                          {scan.station?.code}
                        </span>
                      </div>
                      {scan.notes && (
                        <div className="ml-5 text-xs italic text-muted-foreground border-l-2 border-muted pl-2">
                          &ldquo;{scan.notes}&rdquo;
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Son başarılı tarama */}
      {lastScan && (
        <Card className="border-green-500">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-green-700 dark:text-green-400">
              <CheckCircle2 className="h-5 w-5" />
              Son Tarama Kaydedildi
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <span className="text-muted-foreground">Zaman:</span>
              <span className="font-medium">
                {new Date(lastScan.scannedAt).toLocaleString("tr-TR")}
              </span>
              <span className="text-muted-foreground">
                <MapPin className="h-3 w-3 inline mr-1" />
                İstasyon:
              </span>
              <span>
                {lastScan.station?.code} — {lastScan.station?.name}
              </span>
              <span className="text-muted-foreground">Tip:</span>
              <span>
                {scanTypeLabels[lastScan.scanType as ScanType]}
              </span>
              {lastScan.notes && (
                <>
                  <span className="text-muted-foreground">Not:</span>
                  <span>{lastScan.notes}</span>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {lookupMutation.isError && (
        <div className="flex items-center gap-2 rounded border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          <XCircle className="h-4 w-4" />
          Kart okuma başarısız — barkodu kontrol edin.
        </div>
      )}
    </div>
  );
}
