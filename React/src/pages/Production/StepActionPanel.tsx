import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ScanBarcode, Play, CheckCircle, Loader2, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  productionService,
  type StepActionRequest,
} from "@/services/productionService";
import { stationService } from "@/services/stationService";

export default function StepActionPanel() {
  const [barcode, setBarcode] = useState("");
  const [stationId, setStationId] = useState("");
  const [action, setAction] = useState<"START" | "FINISH" | "SKIP">("START");
  const [newQty, setNewQty] = useState("");
  const [newWeight, setNewWeight] = useState("");
  const [reason, setReason] = useState("");
  const qc = useQueryClient();

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

  const mutation = useMutation({
    mutationFn: (data: StepActionRequest) =>
      productionService.stepAction(data),
    onSuccess: (res) => {
      toast.success(res.message ?? "İşlem başarılı");
      qc.invalidateQueries({ queryKey: ["active-steps"] });
      qc.invalidateQueries({ queryKey: ["rolls"] });
      setBarcode("");
      setNewQty("");
      setNewWeight("");
      setReason("");
    },
    onError: () => {
      toast.error("İşlem başarısız");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcode.trim() || !stationId) return;
    if (action === "SKIP" && reason.trim().length < 3) {
      toast.error("Atlama gerekçesi en az 3 karakter olmalı");
      return;
    }

    const data: StepActionRequest = {
      barcode: barcode.trim(),
      stationId,
      action,
    };
    if (action === "FINISH" && newQty) data.newQty = Number(newQty);
    if (action === "FINISH" && newWeight) data.newWeight = Number(newWeight);
    if (action === "SKIP") data.reason = reason.trim();

    mutation.mutate(data);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ScanBarcode className="h-5 w-5" />
          İstasyon İşlemi
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="barcode">Top Barkodu</Label>
              <Input
                id="barcode"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="Barkod okutun..."
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="stationId">İstasyon</Label>
              <Select
                id="stationId"
                value={stationId}
                onChange={(e) => setStationId(e.target.value)}
                options={stationOptions}
                placeholder="İstasyon seçiniz"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAction("START")}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                  action === "START"
                    ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 ring-2 ring-blue-500"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                <Play className="h-4 w-4" />
                Başlat
              </button>
              <button
                type="button"
                onClick={() => setAction("FINISH")}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                  action === "FINISH"
                    ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 ring-2 ring-green-500"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                <CheckCircle className="h-4 w-4" />
                Tamamla
              </button>
              <button
                type="button"
                onClick={() => setAction("SKIP")}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                  action === "SKIP"
                    ? "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 ring-2 ring-amber-500"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                <SkipForward className="h-4 w-4" />
                Atla
              </button>
            </div>
          </div>

          {action === "FINISH" && (
            <div className="grid grid-cols-2 gap-4 p-3 rounded-md border border-dashed">
              <div className="space-y-2">
                <Label htmlFor="newQty">Yeni Metraj (opsiyonel)</Label>
                <Input
                  id="newQty"
                  type="number"
                  step="0.1"
                  value={newQty}
                  onChange={(e) => setNewQty(e.target.value)}
                  placeholder="ör: 115.5"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="newWeight">Yeni Ağırlık (opsiyonel)</Label>
                <Input
                  id="newWeight"
                  type="number"
                  step="0.1"
                  value={newWeight}
                  onChange={(e) => setNewWeight(e.target.value)}
                  placeholder="ör: 42.0"
                />
              </div>
              <p className="col-span-2 text-xs text-muted-foreground">
                Fason (dış) istasyonlarda fire/çekme hesabı için yeni metraj veya kilo zorunludur.
              </p>
            </div>
          )}

          {action === "SKIP" && (
            <div className="p-3 rounded-md border border-dashed border-amber-500 space-y-2">
              <Label htmlFor="skipReason">Atlama Gerekçesi *</Label>
              <Input
                id="skipReason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="ör: Ön kurutma atlandı, yeterli ısıl işlem yapıldı"
              />
              <p className="text-xs text-muted-foreground">
                Bu adım atlanacak — bağlı topun bir sonraki istasyona taşınması
                sistem tarafından yapılır. Gerekçe iz takibi için zorunludur.
              </p>
            </div>
          )}

          <Button
            type="submit"
            disabled={!barcode.trim() || !stationId || mutation.isPending}
            className="w-full"
          >
            {mutation.isPending && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            {action === "START"
              ? "İşlemi Başlat"
              : action === "FINISH"
                ? "İşlemi Tamamla"
                : "Adımı Atla"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
