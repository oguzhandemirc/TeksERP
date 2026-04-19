import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  Loader2,
  Weight,
  Truck,
  Warehouse,
  CheckCircle2,
  Printer,
  Repeat2,
  Ruler,
  Package,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  packagingService,
  type PackagingDestination,
  type PackagingLabelPayload,
  type PackagingOrderLinkOption,
  type PackagingRollSummary,
} from "@/services/packagingService";

interface PackagingDecisionPanelProps {
  summary: PackagingRollSummary;
  onBack: () => void;
  onDone: () => void;
}

export default function PackagingDecisionPanel({
  summary,
  onBack,
  onDone,
}: PackagingDecisionPanelProps) {
  const qc = useQueryClient();

  const [weightKg, setWeightKg] = useState<string>(
    summary.weightKg != null ? String(summary.weightKg) : "",
  );
  const [destination, setDestination] =
    useState<PackagingDestination>("SHIP");
  const [orderLineId, setOrderLineId] = useState<string | null>(
    summary.defaultOrderLineId,
  );
  const [orderPickerOpen, setOrderPickerOpen] = useState(false);
  const [printedLabel, setPrintedLabel] =
    useState<PackagingLabelPayload | null>(null);

  const multipleOrders = summary.availableOrderLinks.length > 1;
  const selectedLink: PackagingOrderLinkOption | null =
    summary.availableOrderLinks.find((l) => l.orderLineId === orderLineId) ??
    null;

  useEffect(() => {
    if (destination === "WAREHOUSE") return;
    if (!orderLineId && summary.availableOrderLinks.length === 1) {
      setOrderLineId(summary.availableOrderLinks[0].orderLineId);
    }
  }, [destination, orderLineId, summary.availableOrderLinks]);

  const weighMutation = useMutation({
    mutationFn: () => packagingService.simulateWeigh(summary.rollId),
    onSuccess: (res) => {
      if (res.success && res.data) {
        setWeightKg(String(res.data.weightKg));
        toast.success(`Tartı: ${res.data.weightKg} kg`);
      } else {
        toast.error(res.message ?? "Tartı okunamadı");
      }
    },
    onError: () => toast.error("Tartı simülasyonu başarısız"),
  });

  const finalizeMutation = useMutation({
    mutationFn: () =>
      packagingService.finalize({
        rollId: summary.rollId,
        weightKg: Number(weightKg),
        destination,
        orderLineId: destination === "SHIP" ? orderLineId : null,
      }),
    onSuccess: (res) => {
      if (res.success && res.data) {
        setPrintedLabel(res.data.label);
        toast.success(res.message ?? "Paketleme tamamlandı");
        qc.invalidateQueries({ queryKey: ["packaging-pending"] });
        qc.invalidateQueries({ queryKey: ["rolls"] });
      } else {
        toast.error(res.message ?? "Paketleme başarısız");
      }
    },
    onError: (err) => {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response
          ?.data?.message ?? "Paketleme başarısız";
      toast.error(msg);
    },
  });

  const weightNum = Number(weightKg);
  const canFinalize =
    weightKg !== "" &&
    !Number.isNaN(weightNum) &&
    weightNum > 0 &&
    (destination === "WAREHOUSE" ||
      (destination === "SHIP" &&
        (orderLineId != null || summary.availableOrderLinks.length === 0)));

  if (printedLabel) {
    return (
      <LabelPreview
        label={printedLabel}
        onDone={() => {
          setPrintedLabel(null);
          onDone();
          onBack();
        }}
      />
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
          aria-label="Geri"
        >
          <ArrowLeft className="h-6 w-6" />
        </Button>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold truncate">{summary.barcode}</h2>
          <p className="text-sm text-muted-foreground truncate">
            {summary.itemCode} — {summary.itemName}
          </p>
          <div className="flex gap-1.5 flex-wrap mt-1">
            {summary.variantCode && (
              <Badge variant="outline" className="text-xs">
                {summary.variantCode}
                {summary.variantName ? ` — ${summary.variantName}` : ""}
              </Badge>
            )}
            <Badge variant="secondary" className="text-xs">
              Parti: {summary.workOrderBatchNumber}
            </Badge>
          </div>
        </div>
      </div>

      {/* Roll summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">Metraj</p>
            <p className="text-2xl font-bold">{summary.currentQty}</p>
            <p className="text-xs text-muted-foreground">m</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">En</p>
            <p className="text-2xl font-bold">
              {summary.width != null ? summary.width : "—"}
            </p>
            <p className="text-xs text-muted-foreground">cm</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">Kalite</p>
            <p className="text-2xl font-bold">{summary.qualityGrade}</p>
          </CardContent>
        </Card>
      </div>

      {/* Weight */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <Label
            htmlFor="weightKg"
            className="text-sm font-semibold flex items-center gap-2"
          >
            <Weight className="h-4 w-4" />
            Kilo (kg)
          </Label>
          <div className="flex gap-2">
            <Input
              id="weightKg"
              type="number"
              step="0.01"
              min="0"
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
              placeholder="0.00"
              className="h-14 text-2xl font-bold text-center"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => weighMutation.mutate()}
              disabled={weighMutation.isPending}
              className="h-14 px-5 shrink-0"
            >
              {weighMutation.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <Weight className="h-5 w-5 mr-1" />
                  Tartıdan Çek
                </>
              )}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            İleride COM port üzerinden otomatik okunacak. Şu an simülasyon.
          </p>
        </CardContent>
      </Card>

      {/* Destination */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <Label className="text-sm font-semibold">Hedef</Label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setDestination("SHIP")}
              className={`h-20 rounded-lg text-sm font-semibold transition-all cursor-pointer flex flex-col items-center justify-center gap-1 ${
                destination === "SHIP"
                  ? "bg-primary text-primary-foreground shadow-md ring-2 ring-primary/40"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              <Truck className="h-6 w-6" />
              Sevkiyata
            </button>
            <button
              type="button"
              onClick={() => setDestination("WAREHOUSE")}
              className={`h-20 rounded-lg text-sm font-semibold transition-all cursor-pointer flex flex-col items-center justify-center gap-1 ${
                destination === "WAREHOUSE"
                  ? "bg-primary text-primary-foreground shadow-md ring-2 ring-primary/40"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              <Warehouse className="h-6 w-6" />
              Depoya
            </button>
          </div>

          {destination === "SHIP" && (
            <div className="pt-2 space-y-2">
              <Label className="text-xs text-muted-foreground">
                Sipariş Atanması
              </Label>
              {summary.availableOrderLinks.length === 0 ? (
                <p className="text-xs text-destructive">
                  Bu iş emri hiçbir siparişe bağlı değil — lütfen depoya
                  kaldırın.
                </p>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0 border rounded-lg px-3 py-2 bg-muted/40">
                    {selectedLink ? (
                      <>
                        <p className="text-xs text-muted-foreground">
                          {selectedLink.orderNumber}
                        </p>
                        <p className="text-sm font-semibold truncate">
                          {selectedLink.customerName}
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Sipariş seçilmedi
                      </p>
                    )}
                  </div>
                  {multipleOrders && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setOrderPickerOpen(true)}
                      className="h-12 shrink-0"
                    >
                      <Repeat2 className="h-4 w-4 mr-1" />
                      Değiştir
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Finalize */}
      <Button
        onClick={() => finalizeMutation.mutate()}
        disabled={!canFinalize || finalizeMutation.isPending}
        className="w-full h-14 text-base font-semibold"
        size="lg"
      >
        {finalizeMutation.isPending ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <CheckCircle2 className="h-5 w-5" />
        )}
        Bitti — Etiket Yazdır
      </Button>

      {/* Order picker dialog */}
      <Dialog open={orderPickerOpen} onOpenChange={setOrderPickerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sipariş Seç</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {summary.availableOrderLinks.map((l) => (
              <button
                key={l.orderLineId}
                type="button"
                onClick={() => {
                  setOrderLineId(l.orderLineId);
                  setOrderPickerOpen(false);
                }}
                className={`w-full text-left rounded-lg border p-3 transition-colors cursor-pointer ${
                  orderLineId === l.orderLineId
                    ? "border-primary bg-primary/10"
                    : "hover:bg-muted"
                }`}
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {l.orderNumber}
                  </p>
                  <Badge variant="secondary" className="text-xs">
                    {l.requestedQty}m
                  </Badge>
                </div>
                <p className="text-sm font-semibold">{l.customerName}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {l.itemCode} — {l.itemName}
                </p>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface LabelPreviewProps {
  label: PackagingLabelPayload;
  onDone: () => void;
}

function LabelPreview({ label, onDone }: LabelPreviewProps) {
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Printer className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-bold">Etiket Önizleme</h2>
      </div>

      <Card className="border-2 border-dashed border-primary/50">
        <CardContent className="p-5 space-y-3">
          <div className="text-center border-b pb-3">
            <p className="text-3xl font-mono font-bold tracking-wider">
              {label.barcode}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Parti: {label.batchNumber}
            </p>
          </div>

          <div className="space-y-2">
            <div>
              <p className="text-[10px] uppercase text-muted-foreground">
                Kumaş
              </p>
              <p className="text-sm font-semibold">
                {label.itemCode} — {label.itemName}
              </p>
            </div>
            {label.variantCode && (
              <div>
                <p className="text-[10px] uppercase text-muted-foreground">
                  Desen / Varyant
                </p>
                <p className="text-sm font-semibold">
                  {label.variantCode}
                  {label.variantName ? ` — ${label.variantName}` : ""}
                </p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3 border-t pt-3">
            <div className="text-center">
              <p className="text-[10px] uppercase text-muted-foreground flex items-center justify-center gap-1">
                <Ruler className="h-3 w-3" /> En
              </p>
              <p className="text-lg font-bold">
                {label.widthCm != null ? `${label.widthCm}` : "—"}
                <span className="text-xs font-normal ml-0.5">cm</span>
              </p>
            </div>
            <div className="text-center">
              <p className="text-[10px] uppercase text-muted-foreground flex items-center justify-center gap-1">
                <Package className="h-3 w-3" /> Metraj
              </p>
              <p className="text-lg font-bold">
                {label.lengthMeters}
                <span className="text-xs font-normal ml-0.5">m</span>
              </p>
            </div>
            <div className="text-center">
              <p className="text-[10px] uppercase text-muted-foreground flex items-center justify-center gap-1">
                <Weight className="h-3 w-3" /> Kilo
              </p>
              <p className="text-lg font-bold">
                {label.weightKg}
                <span className="text-xs font-normal ml-0.5">kg</span>
              </p>
            </div>
          </div>

          <div className="border-t pt-3">
            {label.destination === "SHIP" ? (
              <>
                <p className="text-[10px] uppercase text-muted-foreground flex items-center gap-1">
                  <Truck className="h-3 w-3" /> Sevkiyat
                </p>
                <p className="text-sm font-semibold">
                  {label.customerName ?? "—"}
                </p>
                {label.orderNumber && (
                  <p className="text-xs text-muted-foreground">
                    Sipariş: {label.orderNumber}
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="text-[10px] uppercase text-muted-foreground flex items-center gap-1">
                  <Warehouse className="h-3 w-3" /> Depo
                </p>
                <p className="text-sm font-semibold">
                  Satışa / sevke bekletiliyor
                </p>
              </>
            )}
          </div>

          <p className="text-[10px] text-muted-foreground text-right">
            Basım: {new Date(label.printedAt).toLocaleString("tr-TR")}
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          onClick={handlePrint}
          className="h-14 text-base font-semibold"
        >
          <Printer className="h-5 w-5" />
          Yazdır
        </Button>
        <Button onClick={onDone} className="h-14 text-base font-semibold">
          <CheckCircle2 className="h-5 w-5" />
          Tamam
        </Button>
      </div>
    </div>
  );
}
