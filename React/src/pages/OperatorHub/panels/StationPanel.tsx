import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ScanBarcode,
  Info,
  ArrowRight,
  MapPin,
  Building2,
  Ruler,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { productionService } from "@/services/productionService";
import { stationService } from "@/services/stationService";
import StepActionPanel from "@/pages/Production/StepActionPanel";
import {
  stepStatusLabels,
  rollStatusLabels,
  type StepStatus,
  type RollStatus,
} from "@/types/enums";
import type { StepInfoResponse } from "@/types/models";

export default function StationPanel() {
  const [barcode, setBarcode] = useState("");
  const [stationId, setStationId] = useState("");
  const [info, setInfo] = useState<StepInfoResponse | null>(null);

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

  const lookupMutation = useMutation({
    mutationFn: (bc: string) =>
      productionService.getStepInfo(bc, stationId || undefined),
    onSuccess: (res) => {
      if (res.data) {
        setInfo(res.data);
        if (res.data.stationMismatchMessage) {
          toast.warning(res.data.stationMismatchMessage);
        }
      }
    },
    onError: (err: unknown) => {
      setInfo(null);
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "Bilgi alınamadı";
      toast.error(msg);
    },
  });

  const onLookup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcode.trim()) return;
    lookupMutation.mutate(barcode.trim());
  };

  return (
    <div className="space-y-4">
      {/* Planlama Notu ve Bilgi Önizleme */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Info className="h-5 w-5" />
            Adım Bilgi Önizleme (Tablet)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onLookup} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-1 space-y-1">
                <Label className="text-xs">İstasyon (opsiyonel)</Label>
                <Select
                  value={stationId}
                  onChange={(e) => setStationId(e.target.value)}
                  options={stationOptions}
                  placeholder="Tüm istasyonlar"
                />
              </div>
              <div className="sm:col-span-2 space-y-1">
                <Label className="text-xs">Top Barkodu</Label>
                <div className="flex gap-2">
                  <Input
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    placeholder="Barkod okutun…"
                    className="h-11"
                  />
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={!barcode.trim() || lookupMutation.isPending}
                    isLoading={lookupMutation.isPending}
                  >
                    <ScanBarcode className="h-4 w-4" /> Sorgula
                  </Button>
                </div>
              </div>
            </div>

            {info && (
              <div className="rounded-lg border p-3 space-y-3 bg-muted/30">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="default">{info.roll.barcode}</Badge>
                  <Badge variant="secondary">
                    {rollStatusLabels[info.roll.status as RollStatus] ??
                      info.roll.status}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {info.roll.item?.code} {info.roll.item?.name}
                  </span>
                  <span className="flex items-center gap-1 text-sm">
                    <Ruler className="h-3.5 w-3.5" />
                    {info.roll.currentQty.toFixed(1)}m
                  </span>
                </div>

                {info.workOrder && (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold">
                      Parti: {info.workOrder.batchNumber}
                    </span>
                    {info.workOrder.recipeNo && (
                      <Badge variant="outline" className="text-xs">
                        Reçete: {info.workOrder.recipeNo}
                      </Badge>
                    )}
                    {info.workOrder.dyehouseCompany && (
                      <Badge variant="outline" className="text-xs">
                        Boyahane: {info.workOrder.dyehouseCompany.name}
                      </Badge>
                    )}
                  </div>
                )}

                {info.workOrder?.orderLinks &&
                  info.workOrder.orderLinks.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      Bağlı Siparişler:{" "}
                      {info.workOrder.orderLinks
                        .map(
                          (l) =>
                            l.orderLine?.order?.orderNumber ??
                            "?",
                        )
                        .join(", ")}
                    </div>
                  )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div className="rounded-md border p-2 bg-background">
                    <p className="text-xs text-muted-foreground">Aktif Adım</p>
                    {info.currentStep ? (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <MapPin className="h-3.5 w-3.5" />
                          <span className="text-sm font-semibold">
                            {info.currentStep.station.code} -{" "}
                            {info.currentStep.station.name}
                          </span>
                          <Badge variant="secondary" className="text-xs">
                            {stepStatusLabels[
                              info.currentStep.status as StepStatus
                            ] ?? info.currentStep.status}
                          </Badge>
                          {info.currentStep.isExternal && (
                            <Badge
                              variant="outline"
                              className="text-[10px] py-0 border-purple-400 text-purple-700 dark:text-purple-300"
                            >
                              Dış İstasyon (Fason)
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap text-xs">
                          <span className="text-muted-foreground">
                            Bu top:
                          </span>
                          {info.currentStep.rollCompleted ? (
                            <Badge
                              variant="outline"
                              className="text-[10px] py-0 border-blue-400 text-blue-700 dark:text-blue-300"
                            >
                              Adımı tamamlamış
                            </Badge>
                          ) : info.currentStep.rollActive ? (
                            <Badge
                              variant="outline"
                              className="text-[10px] py-0 border-green-400 text-green-700 dark:text-green-300"
                            >
                              Başlatılmış — FINISH bekliyor
                              {info.currentStep.rollMovementStartedAt && (
                                <span className="ml-1 text-muted-foreground">
                                  (
                                  {new Date(
                                    info.currentStep.rollMovementStartedAt,
                                  ).toLocaleTimeString("tr-TR")}
                                  )
                                </span>
                              )}
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-[10px] py-0 border-amber-400 text-amber-700 dark:text-amber-300"
                            >
                              Başlatılmadı
                            </Badge>
                          )}
                        </div>
                        {info.currentStep.isExternal && (
                          <p className="text-[11px] text-purple-700 dark:text-purple-300">
                            Dış istasyonda START/FINISH kullanılmaz. Sevk:
                            &ldquo;Fason Sevk&rdquo; · Mal kabul: &ldquo;Fason
                            Mal Kabul&rdquo; sekmeleri.
                          </p>
                        )}
                        {info.currentStep.notes && (
                          <p className="text-xs flex items-start gap-1">
                            <FileText className="h-3 w-3 mt-0.5 shrink-0" />
                            {info.currentStep.notes}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Aktif adım yok (tamamlandı veya rota boş)
                      </p>
                    )}
                  </div>

                  <div className="rounded-md border p-2 bg-background">
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <ArrowRight className="h-3 w-3" /> Sonraki Adım
                    </p>
                    {info.nextStep ? (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold">
                            {info.nextStep.station.code} -{" "}
                            {info.nextStep.station.name}
                          </span>
                        </div>
                        {info.nextStep.notes && (
                          <p className="text-xs flex items-start gap-1">
                            <FileText className="h-3 w-3 mt-0.5 shrink-0" />
                            {info.nextStep.notes}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">—</p>
                    )}
                  </div>
                </div>

                {info.stationMismatchMessage && (
                  <div className="rounded-md border border-amber-400 bg-amber-50 dark:bg-amber-950 p-2 text-xs">
                    ⚠ {info.stationMismatchMessage}
                  </div>
                )}
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Eylem Paneli — mevcut StepActionPanel yeniden kullanılıyor */}
      <StepActionPanel />
    </div>
  );
}
