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
  Handshake,
  AlertTriangle,
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

  const isFason = !!summary.ownerCustomerId;
  const hasAnyOrder = summary.availableOrderLinks.length > 0;
  const canShip = isFason || hasAnyOrder;
  const multipleOrders = summary.availableOrderLinks.length > 1;
  const selectedLink: PackagingOrderLinkOption | null =
    summary.availableOrderLinks.find((l) => l.orderLineId === orderLineId) ??
    null;

  useEffect(() => {
    if (!canShip && destination === "SHIP") {
      setDestination("WAREHOUSE");
    }
  }, [canShip, destination]);

  useEffect(() => {
    if (destination === "WAREHOUSE" || isFason) return;
    if (!orderLineId && summary.availableOrderLinks.length === 1) {
      setOrderLineId(summary.availableOrderLinks[0].orderLineId);
    }
  }, [destination, orderLineId, summary.availableOrderLinks, isFason]);

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
        // Fason topta orderLineId gönderilmez
        orderLineId:
          destination === "SHIP" && !isFason ? orderLineId : null,
      }),
    onSuccess: (res) => {
      if (res.success && res.data) {
        setPrintedLabel(res.data.label);
        toast.success(res.message ?? "Paketleme tamamlandı");
        qc.invalidateQueries({ queryKey: ["packaging-pending"] });
        qc.invalidateQueries({ queryKey: ["rolls"] });
        qc.invalidateQueries({ queryKey: ["roll-detail"] });
        qc.invalidateQueries({ queryKey: ["roll-history"] });
        qc.invalidateQueries({ queryKey: ["ready-orders"] });
        qc.invalidateQueries({ queryKey: ["ready-fason"] });
        qc.invalidateQueries({ queryKey: ["orders"] });
        qc.invalidateQueries({ queryKey: ["order-detail"] });
        qc.invalidateQueries({ queryKey: ["work-orders"] });
        qc.invalidateQueries({ queryKey: ["workorder-detail"] });
        qc.invalidateQueries({ queryKey: ["workorder-manifests"] });
        // UX D: otomatik yazdırma — operatör ek tıklamadan kurtulur
        setTimeout(() => window.print(), 200);
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
  // UX E: mantıklı ağırlık sınırları (0.5–200 kg)
  const MIN_WEIGHT = 0.5;
  const MAX_WEIGHT = 200;
  const weightValid =
    !Number.isNaN(weightNum) &&
    weightNum >= MIN_WEIGHT &&
    weightNum <= MAX_WEIGHT;
  const weightWarning =
    weightKg !== "" && !Number.isNaN(weightNum) && !weightValid
      ? `Kilo ${MIN_WEIGHT}–${MAX_WEIGHT} kg arasında olmalı`
      : null;
  const canFinalize =
    weightKg !== "" &&
    weightValid &&
    (destination === "WAREHOUSE" ||
      (destination === "SHIP" &&
        (isFason || orderLineId != null || !hasAnyOrder)));

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

      {/* Müşteri desen karşılığı (varsa) */}
      {summary.previewCustomerLabel && (
        <Card className="border-purple-300 bg-purple-50 dark:border-purple-800 dark:bg-purple-950/30">
          <CardContent className="p-3 space-y-1">
            <p className="text-[11px] uppercase tracking-wide text-purple-800 dark:text-purple-300 font-semibold">
              Etikette Basılacak Desen Adı
            </p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <p className="text-[10px] text-muted-foreground">Bizde</p>
                <p className="font-medium truncate">
                  {summary.variantCode ?? "—"}
                  {summary.variantName ? ` · ${summary.variantName}` : ""}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">
                  Müşteride
                  {summary.previewCustomerName
                    ? ` (${summary.previewCustomerName})`
                    : ""}
                </p>
                <p className="font-semibold text-purple-900 dark:text-purple-200 truncate">
                  {summary.previewCustomerLabel}
                  {summary.previewCustomerCode
                    ? ` · ${summary.previewCustomerCode}`
                    : ""}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

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
          {weightWarning && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {weightWarning}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Destination */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <Label className="text-sm font-semibold">Hedef</Label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => canShip && setDestination("SHIP")}
              disabled={!canShip}
              className={`h-20 rounded-lg text-sm font-semibold transition-all flex flex-col items-center justify-center gap-1 ${
                !canShip
                  ? "bg-muted/50 text-muted-foreground/60 cursor-not-allowed opacity-60"
                  : destination === "SHIP"
                    ? "bg-primary text-primary-foreground shadow-md ring-2 ring-primary/40 cursor-pointer"
                    : "bg-muted text-muted-foreground hover:bg-muted/80 cursor-pointer"
              }`}
            >
              <Truck className="h-6 w-6" />
              Sevke Hazır
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
              {isFason ? (
                <div className="rounded-lg border border-purple-200 bg-purple-50/60 dark:border-purple-900 dark:bg-purple-950/30 px-3 py-2 flex items-center gap-2">
                  <Handshake className="h-4 w-4 text-purple-600 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] uppercase tracking-wide text-purple-800 dark:text-purple-300 font-semibold">
                      Müşteri Malı (Fason)
                    </p>
                    <p className="text-sm font-semibold truncate">
                      {summary.ownerCustomerName ?? "—"}
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <Label className="text-xs text-muted-foreground">
                    Sipariş Atanması
                  </Label>
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
                </>
              )}
            </div>
          )}

          {!canShip && (
            <p className="text-xs text-muted-foreground">
              Stok üretimi: sipariş veya müşteri bağlantısı yok — sadece depoya
              kaldırılabilir.
            </p>
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
                {label.customerVariantLabel ? (
                  <div className="space-y-0.5">
                    <p className="text-base font-bold text-purple-900 dark:text-purple-200">
                      {label.customerVariantLabel}
                      {label.customerVariantCode
                        ? ` · ${label.customerVariantCode}`
                        : ""}
                      <span className="text-[10px] font-normal text-muted-foreground ml-1">
                        (müşterideki adı)
                      </span>
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Bizdeki: {label.variantCode}
                      {label.variantName ? ` — ${label.variantName}` : ""}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm font-semibold">
                    {label.variantCode}
                    {label.variantName ? ` — ${label.variantName}` : ""}
                  </p>
                )}
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

      <p className="text-[11px] text-muted-foreground text-center">
        Etiket otomatik gönderildi. Yazıcıdan çıkmadıysa "Tekrar Yazdır"a
        basın.
      </p>
      <div className="grid grid-cols-[1fr_2fr] gap-2">
        <Button
          variant="outline"
          onClick={handlePrint}
          className="h-14 text-sm font-semibold"
        >
          <Printer className="h-5 w-5" />
          Tekrar Yazdır
        </Button>
        <Button onClick={onDone} className="h-14 text-base font-bold">
          <CheckCircle2 className="h-5 w-5" />
          Tamam — Bir Sonraki Top
        </Button>
      </div>
    </div>
  );
}
