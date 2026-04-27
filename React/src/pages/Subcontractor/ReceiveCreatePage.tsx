import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  PackageCheck,
  Building2,
  Ruler,
  RefreshCw,
  FileText,
  AlertTriangle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { subcontractorService } from "@/services/subcontractorService";
import type { PendingReturnGroup } from "@/types/models";

type ReturnRow = {
  rollId: string;
  barcode: string;
  dispatchedQty: number;
  notes: string;
};

export default function ReceiveCreatePage() {
  const qc = useQueryClient();
  const [selectedStepId, setSelectedStepId] = useState("");
  const [manifestNo, setManifestNo] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<ReturnRow[]>([]);

  const { data: pendingData, isLoading } = useQuery({
    queryKey: ["pending-returns"],
    queryFn: () => subcontractorService.pendingReturns(),
    refetchInterval: 30000,
  });

  const pending: PendingReturnGroup[] = pendingData?.data ?? [];
  const selectedGroup =
    pending.find((g) => g.step.id === selectedStepId) ?? null;

  useEffect(() => {
    if (!selectedGroup) {
      setRows([]);
      setManifestNo("");
      setNotes("");
      return;
    }
    setRows(
      selectedGroup.rolls.map((r) => ({
        rollId: r.id,
        barcode: r.barcode,
        dispatchedQty: r.currentQty,
        notes: "",
      })),
    );
    setManifestNo("");
    setNotes("");
  }, [selectedGroup]);

  const receiveMutation = useMutation({
    mutationFn: () => {
      if (!selectedGroup) throw new Error("Adım seçilmedi");
      return subcontractorService.receive({
        workOrderId: selectedGroup.workOrder.id,
        stepId: selectedGroup.step.id,
        companyId: selectedGroup.lastDispatch?.companyId ?? "",
        manifestNo: manifestNo.trim(),
        notes: notes.trim() || undefined,
        returns: rows.map((r) => ({
          rollId: r.rollId,
          notes: r.notes.trim() || null,
        })),
      });
    },
    onSuccess: () => {
      toast.success(
        `Fason kabul tamamlandı. Toplar sonraki adıma taşındı.`,
      );
      qc.invalidateQueries({ queryKey: ["pending-returns"] });
      qc.invalidateQueries({ queryKey: ["rolls"] });
      qc.invalidateQueries({ queryKey: ["roll-detail"] });
      qc.invalidateQueries({ queryKey: ["roll-history"] });
      qc.invalidateQueries({ queryKey: ["receipts"] });
      qc.invalidateQueries({ queryKey: ["dispatches"] });
      qc.invalidateQueries({ queryKey: ["work-orders"] });
      qc.invalidateQueries({ queryKey: ["workorder-detail"] });
      qc.invalidateQueries({ queryKey: ["workorder-dispatches"] });
      qc.invalidateQueries({ queryKey: ["workorder-manifests"] });
      qc.invalidateQueries({ queryKey: ["active-steps"] });
      setSelectedStepId("");
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "Kabul başarısız";
      toast.error(msg);
    },
  });

  const canSubmit =
    !!selectedGroup &&
    manifestNo.trim().length >= 2 &&
    rows.length > 0;

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center gap-2">
        <PackageCheck className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight">Fason Mal Kabul</h1>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <PackageCheck className="h-5 w-5" />
            Fasondan Bekleyen İadeler
            <Badge variant="secondary" className="ml-1">
              {pending.length}
            </Badge>
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              qc.invalidateQueries({ queryKey: ["pending-returns"] })
            }
          >
            <RefreshCw className="h-4 w-4" /> Yenile
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-16 bg-muted animate-pulse rounded-md"
                />
              ))}
            </div>
          ) : pending.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Fasonda bekleyen sevk bulunmuyor.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {pending.map((g) => {
                const active = g.step.id === selectedStepId;
                return (
                  <button
                    key={g.step.id}
                    type="button"
                    onClick={() => setSelectedStepId(g.step.id)}
                    className={`text-left rounded-lg border p-3 transition-colors cursor-pointer ${
                      active
                        ? "border-primary bg-primary/5 ring-2 ring-primary/30"
                        : "hover:border-primary/40 hover:bg-muted/30"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <span className="font-semibold text-sm">
                        {g.workOrder.batchNumber}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        #{g.step.stepSequence} {g.step.station.code}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-3">
                      {g.workOrder.dyehouseCompany && (
                        <span>{g.workOrder.dyehouseCompany.code}</span>
                      )}
                      <span>{g.rollCount} top</span>
                      <span className="flex items-center gap-1">
                        <Ruler className="h-3 w-3" />
                        {g.totalQty.toFixed(1)}m
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedGroup && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-5 w-5" />
              Mal Kabul — {selectedGroup.workOrder.batchNumber} (
              {selectedGroup.step.station.code})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900 p-3 text-xs flex gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <strong>Yeni barkod basılmaz, ölçüm yapılmaz.</strong> Toplar
                irsaliye ile kabul edilip otomatik olarak bir sonraki istasyona
                taşınır. Metraj / ağırlık / fire ölçümü sonraki istasyonda
                yapılır.
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">İrsaliye No *</Label>
                <Input
                  value={manifestNo}
                  onChange={(e) => setManifestNo(e.target.value)}
                  placeholder="Fason firma irsaliye numarası"
                  className="h-11"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Kabul Notu</Label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Göz kontrolü notu…"
                />
              </div>
            </div>

            <div className="space-y-2">
              {rows.map((row, idx) => (
                <div
                  key={row.rollId}
                  className="rounded-lg border p-3 grid grid-cols-1 sm:grid-cols-6 gap-2 bg-card"
                >
                  <div className="sm:col-span-2 space-y-0.5">
                    <Label className="text-xs text-muted-foreground">
                      Top #{idx + 1}
                    </Label>
                    <code className="text-xs font-mono block">
                      {row.barcode}
                    </code>
                    <span className="text-[11px] text-muted-foreground">
                      Sevk öncesi: {row.dispatchedQty.toFixed(1)}m
                    </span>
                  </div>

                  <div className="sm:col-span-4 space-y-1">
                    <Label className="text-xs">Not (opsiyonel)</Label>
                    <Input
                      value={row.notes}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((r, i) =>
                            i === idx ? { ...r, notes: e.target.value } : r,
                          ),
                        )
                      }
                      placeholder="Bu topa dair not…"
                    />
                  </div>
                </div>
              ))}
            </div>

            <Button
              type="button"
              disabled={!canSubmit || receiveMutation.isPending}
              onClick={() => receiveMutation.mutate()}
              isLoading={receiveMutation.isPending}
              className="w-full h-12"
            >
              <PackageCheck className="h-4 w-4" /> Mal Kabul Yap ve Topları
              Sonraki Adıma Taşı
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
