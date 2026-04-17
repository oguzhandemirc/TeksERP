import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ClipboardList,
  ArrowRight,
  CheckCircle2,
  Clock,
  SkipForward,
  Printer,
  Factory,
  FileText,
  Save,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { workOrderService } from "@/services/workOrderService";
import {
  workOrderStatusLabels,
  workOrderTypeLabels,
  stepStatusLabels,
} from "@/types/enums";
import type { WorkOrderStatus, WorkOrderType, StepStatus } from "@/types/enums";
import ManifestPrintDialog from "../Field/ManifestPrintDialog";
import TravelerCardSection from "./TravelerCardSection";
import {
  SlideOverPanel,
  SlideOverContentLoader,
} from "@/components/ui/SlideOverPanel";

interface WorkOrderDetailPanelProps {
  workOrderId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

const woStatusColorMap: Record<string, string> = {
  PLANNED: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  IN_PROGRESS: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  PAUSED: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  COMPLETED: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  CANCELLED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const stepStatusIcon: Record<string, typeof Clock> = {
  PENDING: Clock,
  ACTIVE: ArrowRight,
  COMPLETED: CheckCircle2,
  SKIPPED: SkipForward,
};

const stepStatusColor: Record<string, string> = {
  PENDING: "border-muted-foreground/20 bg-muted/5 text-muted-foreground",
  ACTIVE:
    "border-blue-200 bg-blue-50/50 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300",
  COMPLETED:
    "border-emerald-200 bg-emerald-50/50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300",
  SKIPPED:
    "border-gray-200 bg-gray-50 dark:bg-gray-900/50 opacity-60 text-muted-foreground",
};

export default function WorkOrderDetailPanel({
  workOrderId,
  isOpen,
  onClose,
}: WorkOrderDetailPanelProps) {
  const [showManifest, setShowManifest] = useState(false);
  const [manifestData, setManifestData] = useState<
    Record<string, unknown> | null
  >(null);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["workorder-detail", workOrderId],
    queryFn: () => workOrderService.getById(workOrderId!),
    enabled: !!workOrderId && isOpen,
  });

  const { data: manifestsData } = useQuery({
    queryKey: ["workorder-manifests", workOrderId],
    queryFn: () => workOrderService.listManifests(workOrderId!),
    enabled: !!workOrderId && isOpen,
  });
  const manifests = manifestsData?.data ?? [];

  const handlePrintManifest = async () => {
    if (!workOrderId) return;
    const response = await workOrderService.getManifest(workOrderId);
    if (response.success && response.data) {
      setManifestData(response.data as Record<string, unknown>);
      setShowManifest(true);
    }
  };

  const saveManifestMutation = useMutation({
    mutationFn: () => workOrderService.createManifest(workOrderId!),
    onSuccess: (res) => {
      toast.success(res.message ?? "Çeki Listesi kayıt altına alındı");
      qc.invalidateQueries({ queryKey: ["workorder-manifests", workOrderId] });
    },
  });

  const handleViewSavedManifest = (snapshot: Record<string, unknown>) => {
    setManifestData(snapshot);
    setShowManifest(true);
  };

  const wo = data?.data;

  const headerActions = wo &&
    (wo.status === "IN_PROGRESS" || wo.status === "COMPLETED") && (
      <Button variant="outline" size="sm" onClick={handlePrintManifest}>
        <Printer className="h-4 w-4 mr-1" />
        Çeki Listesi
      </Button>
    );

  return (
    <>
      <SlideOverPanel
        title={wo ? `İş Emri: ${wo.batchNumber}` : "İş Emri Detayı"}
        isOpen={isOpen}
        onClose={onClose}
        widthClass="max-w-lg"
        headerActions={headerActions}
      >
        {isLoading ? (
          <SlideOverContentLoader />
        ) : !wo ? (
          <div className="text-center text-muted-foreground py-10">
            İş emri bulunamadı
          </div>
        ) : (
          <div className="space-y-6">
            {/* Başlık ve Durum */}
            <div className="flex items-center gap-3 border-b pb-4">
              <ClipboardList className="h-5 w-5 text-primary" />
              <span className="text-xl font-bold">{wo.batchNumber}</span>
              <Badge
                className={woStatusColorMap[wo.status] ?? ""}
                variant="secondary"
              >
                {workOrderStatusLabels[wo.status as WorkOrderStatus] ??
                  wo.status}
              </Badge>
            </div>

            {/* Genel Bilgiler */}
            <div className="rounded-lg border p-4 space-y-3 bg-muted/10">
              <div className="text-sm font-semibold flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                Genel Bilgiler
              </div>
              <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
                <span className="text-muted-foreground">Tür:</span>
                <span className="font-medium">
                  {workOrderTypeLabels[wo.type as WorkOrderType] ?? wo.type}
                </span>
                <span className="text-muted-foreground">Adım Sayısı:</span>
                <span>{wo.steps?.length ?? 0}</span>
                {wo.width && (
                  <>
                    <span className="text-muted-foreground">Kumaş Eni:</span>
                    <span>{wo.width} cm</span>
                  </>
                )}
                {wo.targetQuantity && (
                  <>
                    <span className="text-muted-foreground">Hedef Uzunluk:</span>
                    <span>{wo.targetQuantity} mt</span>
                  </>
                )}
                {wo.recipeNo && (
                  <>
                    <span className="text-muted-foreground">
                      Reçete/Varyant:
                    </span>
                    <span>{wo.recipeNo}</span>
                  </>
                )}
                {wo.dyehouseCompany && (
                  <>
                    <span className="text-muted-foreground">
                      <Factory className="h-3 w-3 inline mr-1" />
                      Hedef Boyahane/Fason:
                    </span>
                    <span className="font-medium">
                      {wo.dyehouseCompany.code} — {wo.dyehouseCompany.name}
                    </span>
                  </>
                )}
                <span className="text-muted-foreground">
                  Sipariş Bağlantısı:
                </span>
                <span>{wo.orderLinks?.length ?? 0}</span>
              </div>
              {wo.parameters && Object.keys(wo.parameters).length > 0 && (
                <div className="mt-2 pt-2 border-t border-muted">
                  <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                    Parametreler:
                  </span>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {Object.entries(wo.parameters).map(([key, val]) => (
                      <Badge
                        key={key}
                        variant="outline"
                        className="text-[10px] bg-background"
                      >
                        {key}: {String(val)}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Rota Adımları */}
            {wo.steps && wo.steps.length > 0 && (
              <div className="space-y-3">
                <div className="text-sm font-semibold flex items-center justify-between">
                  <span>Rota Adımları ({wo.steps.length})</span>
                  <div className="h-px flex-1 bg-border ml-3" />
                </div>
                <div className="space-y-2.5">
                  {wo.steps
                    .sort((a, b) => a.stepSequence - b.stepSequence)
                    .map((step) => {
                      const StatusIcon = stepStatusIcon[step.status] ?? Clock;
                      const isCompleted = step.status === "COMPLETED";
                      const isActive = step.status === "ACTIVE";

                      return (
                        <div
                          key={step.id}
                          className={`flex items-start gap-3 rounded-xl border p-3.5 transition-all ${
                            stepStatusColor[step.status] ?? ""
                          } ${
                            isActive
                              ? "ring-2 ring-blue-500/20 shadow-sm"
                              : ""
                          }`}
                        >
                          <div
                            className={`p-2 rounded-full mt-0.5 ${
                              isCompleted
                                ? "bg-emerald-500/10 text-emerald-600"
                                : isActive
                                ? "bg-blue-500/10 text-blue-600"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            <StatusIcon className="h-4 w-4 shrink-0" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold opacity-60 uppercase tracking-tight">
                                ADIM {step.stepSequence}
                              </span>
                              <span className="font-bold text-sm truncate">
                                {step.station?.code} - {step.station?.name}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                              <Badge
                                variant={
                                  isCompleted
                                    ? "default"
                                    : isActive
                                    ? "secondary"
                                    : "outline"
                                }
                                className={`text-[10px] px-1.5 h-5 ${
                                  isCompleted
                                    ? "bg-emerald-600 hover:bg-emerald-600 text-white border-none"
                                    : ""
                                }`}
                              >
                                {stepStatusLabels[step.status as StepStatus] ??
                                  step.status}
                              </Badge>
                              {step.startedAt && (
                                <span className="text-[11px] opacity-70 flex items-center gap-1">
                                  <Clock className="h-2.5 w-2.5" />
                                  {new Date(step.startedAt).toLocaleString(
                                    "tr-TR",
                                    {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                      day: "2-digit",
                                      month: "2-digit",
                                    },
                                  )}
                                </span>
                              )}
                              {step.completedAt && (
                                <span className="text-[11px] opacity-70 flex items-center gap-1">
                                  <CheckCircle2 className="h-2.5 w-2.5" />
                                  {new Date(step.completedAt).toLocaleString(
                                    "tr-TR",
                                    {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                      day: "2-digit",
                                      month: "2-digit",
                                    },
                                  )}
                                </span>
                              )}
                            </div>
                            {step.notes && (
                              <div
                                className={`mt-2 text-xs p-2 rounded-lg border ${
                                  isCompleted
                                    ? "bg-emerald-500/5 border-emerald-500/10"
                                    : "bg-muted/50 border-muted"
                                }`}
                              >
                                <span className="font-semibold opacity-70">
                                  Not:
                                </span>{" "}
                                <span className="opacity-90">{step.notes}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* Bağlı Siparişler */}
            {wo.orderLinks && wo.orderLinks.length > 0 && (
              <div className="space-y-3">
                <div className="text-sm font-semibold flex items-center justify-between">
                  <span>Bağlı Siparişler ({wo.orderLinks.length})</span>
                  <div className="h-px flex-1 bg-border ml-3" />
                </div>
                <div className="space-y-2">
                  {wo.orderLinks.map((link) => (
                    <div
                      key={`${link.workOrderId}-${link.orderLineId}`}
                      className="flex items-center justify-between rounded-xl border p-3 text-sm bg-background/50"
                    >
                      <div className="space-y-0.5">
                        <div className="font-bold text-primary">
                          {link.orderLine?.order?.orderNumber ?? "—"}
                        </div>
                        {link.orderLine?.order?.customer && (
                          <div className="text-[11px] text-muted-foreground">
                            {link.orderLine.order.customer.name}
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="font-medium text-xs">
                          {link.orderLine?.item?.code}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {link.orderLine?.quantity} mt
                          {link.allocatedQty !== undefined &&
                            link.allocatedQty > 0 && (
                              <>
                                {" · "}
                                <span className="font-bold text-blue-600 dark:text-blue-400">
                                  {link.allocatedQty} mt
                                </span>
                              </>
                            )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Refakat Kartları */}
            <TravelerCardSection
              workOrderId={wo.id}
              canPrint={wo.status === "PLANNED" || wo.status === "IN_PROGRESS"}
            />

            {/* Çeki Listesi Geçmişi */}
            <div className="rounded-xl border p-4 space-y-4 bg-muted/5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-primary" />
                  <span className="text-sm font-bold">Çeki Listesi Kayıtları</span>
                </div>
                {(wo.status === "IN_PROGRESS" || wo.status === "COMPLETED") && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    onClick={() => saveManifestMutation.mutate()}
                    isLoading={saveManifestMutation.isPending}
                  >
                    <Save className="h-3.5 w-3.5" />
                    Belge Kaydet
                  </Button>
                )}
              </div>
              {manifests.length === 0 ? (
                <p className="text-xs text-muted-foreground italic text-center py-2 opacity-70">
                  Kayıtlı belge bulunamadı.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-2">
                  {manifests.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() =>
                        handleViewSavedManifest(
                          m.snapshot as Record<string, unknown>,
                        )
                      }
                      className="w-full flex items-center justify-between rounded-lg border bg-background px-3 py-2.5 text-xs transition-colors hover:border-primary/50 hover:bg-muted/30"
                    >
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-md bg-primary/10 text-primary">
                          <FileText className="h-3.5 w-3.5" />
                        </div>
                        <span className="font-mono font-bold tracking-tighter">
                          {m.manifestNo}
                        </span>
                      </div>
                      <div className="text-right flex flex-col items-end">
                        <span className="font-medium opacity-80">
                          {new Date(m.printedAt).toLocaleDateString("tr-TR")}
                        </span>
                        <span className="text-[10px] opacity-60">
                          {m.printedBy?.fullName}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Sistem Bilgileri */}
            <div className="flex justify-between items-center text-[10px] text-muted-foreground pt-4 border-t opacity-60">
              <span>
                Oluşturma: {new Date(wo.createdAt).toLocaleString("tr-TR")}
              </span>
              <span>
                Güncelleme: {new Date(wo.updatedAt).toLocaleString("tr-TR")}
              </span>
            </div>
          </div>
        )}
      </SlideOverPanel>

      {showManifest && manifestData && (
        <ManifestPrintDialog
          open={showManifest}
          onOpenChange={setShowManifest}
          manifestData={manifestData}
          workOrderId={workOrderId ?? ""}
        />
      )}
    </>
  );
}
