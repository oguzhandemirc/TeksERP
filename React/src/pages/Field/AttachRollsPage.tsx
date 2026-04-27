import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardList, Loader2, CheckCircle2, AlertCircle, ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { workOrderService, type AttachRollsResponse } from "@/services/workOrderService";
import { rollService } from "@/services/rollService";
import type { WorkOrder, OrderLine, Roll } from "@/types/models";
import { workOrderStatusLabels, workOrderTypeLabels } from "@/types/enums";
import type { WorkOrderStatus, WorkOrderType } from "@/types/enums";
import { RollStatus } from "@/types/enums";
import ManifestPrintDialog from "./ManifestPrintDialog";

const statusColorMap: Record<string, string> = {
  PLANNED: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  IN_PROGRESS: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  PAUSED: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  COMPLETED: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  CANCELLED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

/** Sipariş satırı varyantı: kod ve/veya ad (ör. yalnızca ad: "Gabardin") */
function orderLineVariantLabel(line: OrderLine | null | undefined): string | null {
  const v = line?.variant;
  if (!v) return null;
  const code = v.code?.trim() ?? "";
  const name = v.name?.trim() ?? "";
  if (code && name) return `${code} — ${name}`;
  if (name) return name;
  if (code) return code;
  return null;
}

/** Top üzerindeki varyant / roll.design (liste kartları için) */
function rollDesignLabel(roll: Roll): string | null {
  const v = roll.variant;
  if (v) {
    const code = v.code?.trim() ?? "";
    const name = v.name?.trim() ?? "";
    if (code && name) return `${code} — ${name}`;
    if (name) return name;
    if (code) return code;
  }
  const d = roll.design?.trim();
  return d || null;
}

export default function AttachRollsPage() {
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrder | null>(null);
  const [selectedStockRollIds, setSelectedStockRollIds] = useState<Set<string>>(new Set());
  const [selectedAttachedRollIds, setSelectedAttachedRollIds] = useState<Set<string>>(new Set());
  const [manifestData, setManifestData] = useState<Record<string, unknown> | null>(null);
  const [showManifest, setShowManifest] = useState(false);

  const qc = useQueryClient();

  // Fetch work orders that are PLANNED and ready for attachment
  const { data: workOrdersData, isLoading: isLoadingWorkOrders } = useQuery({
    queryKey: ["work-orders-available"],
    queryFn: () => workOrderService.getAvailableForAttach(),
  });

  // Fetch STOCK rolls for the selection
  const { data: rollsData, isLoading: isLoadingRolls } = useQuery({
    queryKey: ["rolls", "stock"],
    queryFn: () => rollService.getAll({ 
      page: 1, 
      pageSize: 100, 
      sortBy: "createdAt", 
      sortOrder: "desc", 
      filters: { status: RollStatus.STOCK } 
    }),
  });

  // Fetch ATTACHED (basket) rolls for the selected work order
  const { data: attachedRollsData, isLoading: isLoadingAttached } = useQuery({
    queryKey: ["attached-rolls", selectedWorkOrder?.id],
    queryFn: () => workOrderService.getAttachedRolls(selectedWorkOrder!.id),
    enabled: !!selectedWorkOrder,
  });

  // Tam sipariş satırı + varyant bilgisi (liste endpoint'i eski cache / eksik include olabilir)
  const { data: workOrderDetailRes } = useQuery({
    queryKey: ["work-order-detail", selectedWorkOrder?.id],
    queryFn: () => workOrderService.getById(selectedWorkOrder!.id),
    enabled: !!selectedWorkOrder?.id,
  });

  const displayWorkOrder: WorkOrder | null = selectedWorkOrder
    ? workOrderDetailRes?.success && workOrderDetailRes.data
      ? workOrderDetailRes.data
      : selectedWorkOrder
    : null;

  const attachMutation = useMutation({
    mutationFn: ({ workOrderId, rollIds }: { workOrderId: string; rollIds: string[] }) => {
      // Get barcodes for selected STOCK rolls
      const barcodes = rollsData?.data
        .filter((r) => rollIds.includes(r.id))
        .map((r) => r.barcode) ?? [];
      return workOrderService.attachRolls(workOrderId, barcodes);
    },
    onSuccess: async (response) => {
      const data = response.data as AttachRollsResponse;
      if (data.attached > 0) {
        toast.success(`${data.attached} top sepete eklendi.`);
      }
      if (data.errors.length > 0) {
        data.errors.forEach((err) => toast.error(err));
      }
      qc.invalidateQueries({ queryKey: ["rolls"] });
      qc.invalidateQueries({ queryKey: ["attached-rolls", selectedWorkOrder?.id] });
      qc.invalidateQueries({ queryKey: ["work-order-detail", selectedWorkOrder?.id] });
      qc.invalidateQueries({ queryKey: ["workorder-detail", selectedWorkOrder?.id] });
      setSelectedStockRollIds(new Set());
    },
    onError: () => {
      toast.error("Sepete bağlama işlemi başarısız");
    },
  });

  const detachMutation = useMutation({
    mutationFn: ({ workOrderId, rollIds }: { workOrderId: string; rollIds: string[] }) => {
      return workOrderService.detachRolls(workOrderId, rollIds);
    },
    onSuccess: async (response) => {
      const data = response.data as any;
      toast.success(`${data.detached || 0} top sepetten çıkarıldı.`);
      qc.invalidateQueries({ queryKey: ["rolls"] });
      qc.invalidateQueries({ queryKey: ["attached-rolls", selectedWorkOrder?.id] });
      qc.invalidateQueries({ queryKey: ["work-order-detail", selectedWorkOrder?.id] });
      qc.invalidateQueries({ queryKey: ["workorder-detail", selectedWorkOrder?.id] });
      setSelectedAttachedRollIds(new Set());
    },
    onError: () => {
      toast.error("Topları sepetten çıkarma işlemi başarısız");
    },
  });

  const lockMutation = useMutation({
    mutationFn: (workOrderId: string) => workOrderService.lockWorkOrder(workOrderId),
    onSuccess: async () => {
      toast.success("Sepet onaylandı, iş emri üretime alındı!");
      qc.invalidateQueries({ queryKey: ["work-orders"] });
      qc.invalidateQueries({ queryKey: ["work-orders-available"] });
      qc.invalidateQueries({ queryKey: ["workorder-detail"] });
      qc.invalidateQueries({ queryKey: ["workorder-manifests"] });
      
      // Fetch manifest for printing before returning to screen
      if (selectedWorkOrder) {
        const manifestResponse = await workOrderService.getManifest(selectedWorkOrder.id);
        if (manifestResponse.success) {
          setManifestData(manifestResponse.data as Record<string, unknown>);
          setShowManifest(true);
        }
      }
      setSelectedWorkOrder(null);
    },
    onError: () => {
      toast.error("Sepet onaylama başarısız oldu!");
    },
  });

  const workOrders = workOrdersData?.data ?? [];
  const stockRolls = rollsData?.data ?? [];
  const attachedRolls = attachedRollsData?.data ?? [];

  const toggleStockRollSelection = (rollId: string) => {
    setSelectedStockRollIds((prev) => {
      const next = new Set(prev);
      if (next.has(rollId)) next.delete(rollId);
      else next.add(rollId);
      return next;
    });
  };

  const toggleAllStockRolls = () => {
    if (selectedStockRollIds.size === stockRolls.length) {
      setSelectedStockRollIds(new Set());
    } else {
      setSelectedStockRollIds(new Set(stockRolls.map((r) => r.id)));
    }
  };

  const toggleAttachedRollSelection = (rollId: string) => {
    setSelectedAttachedRollIds((prev) => {
      const next = new Set(prev);
      if (next.has(rollId)) next.delete(rollId);
      else next.add(rollId);
      return next;
    });
  };

  const toggleAllAttachedRolls = () => {
    if (selectedAttachedRollIds.size === attachedRolls.length) {
      setSelectedAttachedRollIds(new Set());
    } else {
      setSelectedAttachedRollIds(new Set(attachedRolls.map((r) => r.id)));
    }
  };

  const handleAttach = () => {
    if (!selectedWorkOrder || selectedStockRollIds.size === 0) return;
    attachMutation.mutate({
      workOrderId: selectedWorkOrder.id,
      rollIds: Array.from(selectedStockRollIds),
    });
  };

  const handleDetach = () => {
    if (!selectedWorkOrder || selectedAttachedRollIds.size === 0) return;
    detachMutation.mutate({
      workOrderId: selectedWorkOrder.id,
      rollIds: Array.from(selectedAttachedRollIds),
    });
  };

  const handleLock = () => {
    if (!selectedWorkOrder) return;
    lockMutation.mutate(selectedWorkOrder.id);
  };

  const handleBack = () => {
    setSelectedWorkOrder(null);
    setSelectedStockRollIds(new Set());
    setSelectedAttachedRollIds(new Set());
  };

  const totalAttachedMeterage = attachedRolls.reduce((sum, r) => sum + r.currentQty, 0);


  // AŞAMA 2: Seçili İş Emri Detayı ve Top Bağlama Ekranı
  if (selectedWorkOrder && displayWorkOrder) {
    return (
      <div className="space-y-4">
        {/* Üst Kısım: Geri kartın içinde, başlığın yanında */}
        <div className="bg-card rounded-lg border p-4 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleBack}
                  className="shrink-0 mt-0.5"
                  aria-label="İş emirleri listesine dön"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold">{displayWorkOrder.batchNumber}</h2>
                  <Badge className={statusColorMap[displayWorkOrder.status] ?? ""} variant="secondary">
                    {workOrderStatusLabels[displayWorkOrder.status as WorkOrderStatus] ?? displayWorkOrder.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground flex-wrap">
                  <span className="font-medium text-foreground">
                    {workOrderTypeLabels[displayWorkOrder.type as WorkOrderType] ?? displayWorkOrder.type}
                  </span>
                  <span>•</span>
                  <span>İlk İstasyon: {displayWorkOrder.steps?.[0]?.station?.name ?? "-"}</span>
                  {displayWorkOrder.width && (
                    <>
                      <span>•</span>
                      <span>En: {displayWorkOrder.width}cm</span>
                    </>
                  )}
                  {displayWorkOrder.recipeNo && (
                    <>
                      <span>•</span>
                      <span>Desen: {displayWorkOrder.recipeNo}</span>
                    </>
                  )}
                </div>
                </div>
              </div>

              {/* Sipariş Kalemleri (Sağ Taraf / Alt Kısım) */}
              {displayWorkOrder.orderLinks && displayWorkOrder.orderLinks.length > 0 && (
                <div className="bg-muted/50 p-3 rounded-md min-w-[250px]">
                  <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Bağlı Siparişler</h3>
                  <div className="space-y-3">
                    {Array.from(new Set(displayWorkOrder.orderLinks.map(link => link.orderLine?.order?.customer?.name).filter(Boolean))).map(customerName => {
  const customerLinks = displayWorkOrder.orderLinks!.filter(l => l.orderLine?.order?.customer?.name === customerName);
  return (
    <div key={customerName as string}>
      <div className="text-sm font-bold text-primary mb-1">{customerName as string}</div>
      <div className="space-y-1">
        {customerLinks.map((link, idx) => {
          const variantText = orderLineVariantLabel(link.orderLine);
          return (
          <div key={idx} className="flex flex-col gap-0.5 bg-background p-1.5 rounded border border-border/50 text-xs shadow-sm">
            <div className="flex justify-between items-center">
              <span className="font-medium text-blue-600 dark:text-blue-400">#{link.orderLine?.order?.orderNumber}</span>
              <span className="font-semibold">{link.orderLine?.quantity} mt</span>
            </div>
            <div className="text-muted-foreground line-clamp-1">{link.orderLine?.item?.code} - {link.orderLine?.item?.name}</div>
            <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
              {link.orderLine?.width != null ? (
                <span className="font-medium text-foreground/80">En: {link.orderLine.width} cm</span>
              ) : (
                <span className="text-muted-foreground/70">En: —</span>
              )}
              {variantText ? (
                <span className="line-clamp-1 text-foreground/80" title={variantText}>
                  Desen/Varyant: {variantText}
                </span>
              ) : (
                <span className="text-muted-foreground/70">Desen/Varyant: —</span>
              )}
            </div>
          </div>
          );
        })}
      </div>
    </div>
  )
})}
                  </div>
                </div>
              )}
            </div>
        </div>

        {/* SEPETTEKİ TOPLAR */}
        <div className="rounded-lg border border-primary/20 bg-card shadow-sm mt-6 overflow-hidden">
          <div className="p-4 border-b flex items-center justify-between bg-primary/5">
            <div>
              <h3 className="text-lg font-bold flex items-center gap-2 text-primary">
                <ClipboardList className="h-5 w-5" />
                Sepetteki Toplar
              </h3>
              <p className="text-sm text-muted-foreground font-medium mt-0.5">
                Şu an iş emrine bağlı {attachedRolls.length} top (Toplam: {totalAttachedMeterage.toFixed(2)} mt)
              </p>
            </div>
            <div className="flex items-center gap-2">
              {attachedRolls.length > 0 && (
                <Button variant="outline" size="sm" onClick={toggleAllAttachedRolls} className="shadow-sm">
                  {selectedAttachedRollIds.size === attachedRolls.length ? "Tüm Seçimi Kaldır" : "Tümünü Seç"}
                </Button>
              )}
              <Button 
                variant="destructive" 
                size="sm" 
                onClick={handleDetach}
                disabled={selectedAttachedRollIds.size === 0 || detachMutation.isPending}
                className="shadow-sm"
              >
                {detachMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
                Seçileni Çıkar ({selectedAttachedRollIds.size})
              </Button>
            </div>
          </div>
          <div className="p-2">
            {isLoadingAttached ? (
              <div className="py-8 flex justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : attachedRolls.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground flex flex-col items-center">
                <AlertCircle className="h-8 w-8 mb-2 opacity-30" />
                <p>Sepette henüz top yok.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                {attachedRolls.map((roll) => (
                  <button
                    key={roll.id}
                    onClick={() => toggleAttachedRollSelection(roll.id)}
                    className={`flex flex-col p-3 rounded-md border text-left transition-all ${
                      selectedAttachedRollIds.has(roll.id) 
                        ? "bg-destructive/10 border-destructive ring-1 ring-destructive" 
                        : "bg-background hover:border-destructive/30 hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center justify-between w-full mb-2">
                      <code className="text-sm font-semibold tracking-wide">{roll.barcode}</code>
                      <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                          selectedAttachedRollIds.has(roll.id) ? "bg-destructive border-destructive" : "border-muted-foreground/30"
                        }`}
                      >
                        {selectedAttachedRollIds.has(roll.id) && <CheckCircle2 className="h-3.5 w-3.5 text-destructive-foreground" />}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground space-y-1 mb-2">
                      {roll.item && <div className="font-medium text-foreground line-clamp-1">{roll.item.code}</div>}
                    </div>
                    <div className="mt-auto pt-2 border-t flex items-center justify-between">
                      <span className="font-bold text-sm text-primary">{roll.currentQty} mt</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* BAĞLANABİLİR TOPLAR (STOCK) */}
        <div className="rounded-lg border bg-card shadow-sm mt-6">
          <div className="p-4 border-b flex items-center justify-between bg-muted/20">
            <div>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-muted-foreground" />
                Bağlanabilir Toplar
              </h3>
              <p className="text-sm text-muted-foreground font-medium mt-0.5">
                STOCK durumunda bekleyen {stockRolls.length} top.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {stockRolls.length > 0 && (
                <Button variant="outline" size="sm" onClick={toggleAllStockRolls}>
                  {selectedStockRollIds.size === stockRolls.length ? "Tüm Seçimi Kaldır" : "Tümünü Seç"}
                </Button>
              )}
              <Button 
                variant="default" 
                size="sm" 
                onClick={handleAttach}
                disabled={selectedStockRollIds.size === 0 || attachMutation.isPending}
                className="shadow-sm bg-green-600 hover:bg-green-700 text-white"
              >
                {attachMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
                Sepete Ekle ({selectedStockRollIds.size})
              </Button>
            </div>
          </div>
          
          <div className="p-2">
            {isLoadingRolls ? (
              <div className="py-8 flex justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : stockRolls.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground flex flex-col items-center">
                <AlertCircle className="h-8 w-8 mb-2 opacity-50" />
                <p>STOCK durumunda bağlanabilecek top bulunamadı.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 max-h-[400px] overflow-y-auto pr-1">
                {stockRolls.map((roll) => {
                  const productLine = roll.item
                    ? [roll.item.code, roll.item.name].filter(Boolean).join(" · ")
                    : "";
                  const desen = rollDesignLabel(roll);
                  return (
                  <button
                    key={roll.id}
                    onClick={() => toggleStockRollSelection(roll.id)}
                    className={`flex flex-col p-3 rounded-md border text-left transition-all ${
                      selectedStockRollIds.has(roll.id) 
                        ? "bg-green-50/50 dark:bg-green-500/10 border-green-500 ring-1 ring-green-500" 
                        : "bg-background hover:border-green-500/50 hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center justify-between w-full mb-2">
                      <code className="text-sm font-semibold tracking-wide">{roll.barcode}</code>
                      <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                          selectedStockRollIds.has(roll.id) ? "bg-green-600 border-green-600" : "border-muted-foreground/30"
                        }`}
                      >
                        {selectedStockRollIds.has(roll.id) && <CheckCircle2 className="h-3.5 w-3.5 text-white" />}
                      </div>
                    </div>
                    
                    <div className="text-[11px] text-muted-foreground space-y-0.5 mb-2 min-h-0">
                      {productLine ? (
                        <div
                          className="font-medium text-foreground line-clamp-1 leading-tight"
                          title={productLine}
                        >
                          {productLine}
                        </div>
                      ) : null}
                      {desen ? (
                        <div className="line-clamp-1 leading-tight" title={`Desen: ${desen}`}>
                          <span className="text-muted-foreground/75">Desen </span>
                          <span className="text-foreground/90">{desen}</span>
                        </div>
                      ) : null}
                    </div>
                    
                    <div className="mt-auto pt-2 border-t flex items-center justify-between">
                      <span className="font-bold text-sm">{roll.currentQty} mt</span>
                      <div className="flex items-center gap-1.5">
                        {roll.width && <Badge variant="outline" className="text-[10px] px-1 h-4">En: {roll.width}cm</Badge>}
                        {roll.weightKg && <Badge variant="secondary" className="text-[10px] px-1 h-4">{roll.weightKg}kg</Badge>}
                      </div>
                    </div>
                  </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Alt Kısım: Footer Action - KİLİTLE */}
        <div className="sticky bottom-4 z-40 rounded-xl border-2 border-primary/20 bg-card/95 backdrop-blur-md shadow-[0_0_40px_rgba(0,0,0,0.1)] p-5 flex items-center justify-between animate-in slide-in-from-bottom-4 mt-6">
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-1">Sepet Özeti</span>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-primary">{attachedRolls.length}</span>
              <span className="text-sm font-medium text-muted-foreground">Adet</span>
              <span className="text-muted-foreground/30 mx-2 text-xl">/</span>
              <span className="text-3xl font-black text-primary">{totalAttachedMeterage.toFixed(2)}</span>
              <span className="text-sm font-medium text-primary">mt</span>
            </div>
          </div>
          <Button
            size="lg"
            onClick={handleLock}
            disabled={attachedRolls.length === 0 || lockMutation.isPending}
            className="px-8 h-14 text-lg shadow-md transition-all hover:scale-[1.02]"
          >
            {lockMutation.isPending ? (
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
            ) : (
              <CheckCircle2 className="h-6 w-6 mr-2" />
            )}
            Sepeti Onayla & Üretime Al
          </Button>
        </div>

        {/* Manifest Yazdırma Dialog */}
        {showManifest && manifestData && (
          <ManifestPrintDialog
            open={showManifest}
            onOpenChange={setShowManifest}
            manifestData={manifestData}
            workOrderId={selectedWorkOrder?.id ?? ""}
          />
        )}
      </div>
    );
  }

  // AŞAMA 1: İş Emirleri Listesi Ekranı (Master View)
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardList className="h-7 w-7 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight">Top Bağlama</h1>
          </div>
          <p className="text-muted-foreground mt-1">
            Topları bağlamak istediğiniz partiyi seçiniz.
          </p>
        </div>
        <div className="bg-muted px-4 py-2 rounded-lg flex flex-col items-end">
          <span className="text-sm font-medium">Bekleyen İş Emri</span>
          <span className="text-2xl font-bold text-primary">{workOrders.length}</span>
        </div>
      </div>

      {isLoadingWorkOrders ? (
        <div className="py-20 flex flex-col items-center justify-center text-muted-foreground">
          <Loader2 className="h-10 w-10 animate-spin mb-4 text-primary" />
          <p>İş emirleri yükleniyor...</p>
        </div>
      ) : workOrders.length === 0 ? (
        <div className="py-20 flex flex-col items-center justify-center border-2 border-dashed rounded-xl bg-card">
          <AlertCircle className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-semibold">Bekleyen İş Emri Yok</h3>
          <p className="text-muted-foreground text-sm max-w-sm text-center mt-2">
            Şu anda topları bağlanmayı bekleyen (PLANNED) bir iş emri bulunamadı. Planlama birimi tarafından oluşturulduğunda burada görünecektir.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {workOrders.map((wo) => (
            <button
              key={wo.id}
              onClick={() => {
                setSelectedWorkOrder(wo);
                setSelectedStockRollIds(new Set());
                setSelectedAttachedRollIds(new Set());
              }}
              className="bg-card border rounded-xl p-5 text-left flex flex-col hover:border-primary/50 hover:shadow-md transition-all group"
            >
              <div className="flex items-start justify-between w-full mb-3">
                <span className="text-lg font-bold group-hover:text-primary transition-colors">{wo.batchNumber}</span>
                <Badge className={statusColorMap[wo.status] ?? ""} variant="secondary">
                  {workOrderStatusLabels[wo.status as WorkOrderStatus] ?? wo.status}
                </Badge>
              </div>

              <div className="flex flex-wrap gap-1.5 mb-4">
                <Badge variant="outline" className="bg-background text-xs font-normal">
                  {workOrderTypeLabels[wo.type as WorkOrderType] ?? wo.type}
                </Badge>
                {wo.steps?.[0] && (
                  <Badge variant="secondary" className="text-xs">
                    İstasyon: {wo.steps[0].station?.code}
                  </Badge>
                )}
                {wo.recipeNo && (
                  <Badge variant="outline" className="text-xs">Desen: {wo.recipeNo}</Badge>
                )}
                {wo.width && (
                   <Badge variant="outline" className="text-xs">En: {wo.width}cm</Badge>
                )}
              </div>

              {/* Sipariş & Müşteri Görünümü */}
              <div className="mt-auto border-t pt-4">
                {wo.orderLinks && wo.orderLinks.length > 0 ? (
                  <div className="space-y-3">
                    {Array.from(new Set(wo.orderLinks.map(link => link.orderLine?.order?.customer?.name).filter(Boolean))).map(customerName => {
                      const customerLinks = wo.orderLinks!.filter(l => l.orderLine?.order?.customer?.name === customerName);
                      const totalQty = customerLinks.reduce((acc, curr) => acc + (curr.orderLine?.quantity || 0), 0);
                      return (
                        <div key={customerName as string} className="flex flex-col gap-1">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-primary uppercase tracking-wider line-clamp-1">
                              {customerName as string}
                            </span>
                            <span className="text-xs font-semibold whitespace-nowrap text-muted-foreground">{totalQty} mt</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {customerLinks.map((link, idx) => (
                              <Badge 
                                key={idx} 
                                variant="secondary" 
                                className="text-[10px] px-1.5 h-4 bg-primary/10 text-primary border-primary/20 hover:bg-primary/20"
                              >
                                #{link.orderLine?.order?.orderNumber}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="text-sm font-medium text-muted-foreground italic flex items-center justify-center py-2 h-full">
                    Siparişe Bağlı Değil (Stok Üretimi)
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Manifest Yazdırma Dialog */}
      {showManifest && manifestData && !selectedWorkOrder && (
        <ManifestPrintDialog
          open={showManifest}
          onOpenChange={setShowManifest}
          manifestData={manifestData}
          workOrderId={""}
        />
      )}
    </div>
  );
}