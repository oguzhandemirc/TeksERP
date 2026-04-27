import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Truck,
  Plus,
  Trash2,
  Send,
  AlertTriangle,
  Building2,
  Ruler,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { subcontractorService } from "@/services/subcontractorService";
import { workOrderService } from "@/services/workOrderService";
import { customerService } from "@/services/customerService";
import { rollService } from "@/services/rollService";
import type { Roll } from "@/types/models";

export default function DispatchCreatePage() {
  const qc = useQueryClient();
  const [workOrderId, setWorkOrderId] = useState("");
  const [stepId, setStepId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  const [driverName, setDriverName] = useState("");
  const [notes, setNotes] = useState("");
  const [rolls, setRolls] = useState<Roll[]>([]);
  const [rollBarcodeInput, setRollBarcodeInput] = useState("");

  const { data: workOrdersData } = useQuery({
    queryKey: ["work-orders", "for-dispatch"],
    queryFn: () =>
      workOrderService.getAll({
        page: 1,
        pageSize: 200,
        sortBy: "createdAt",
        sortOrder: "desc",
        filters: {},
      }),
  });

  const { data: customersData } = useQuery({
    queryKey: ["customers", "subcontractors-and-dyehouses"],
    queryFn: () =>
      customerService.getAll({
        page: 1,
        pageSize: 500,
        sortBy: "name",
        sortOrder: "asc",
        filters: { isActive: "true" },
      }),
  });

  const workOrder = useMemo(
    () => workOrdersData?.data?.find((w) => w.id === workOrderId),
    [workOrdersData, workOrderId],
  );

  const externalStepOptions = useMemo(() => {
    if (!workOrder?.steps) return [];
    return workOrder.steps
      .filter((s) => s.station?.type === "EXTERNAL")
      .map((s) => ({
        value: s.id,
        label: `#${s.stepSequence} — ${s.station?.code} ${s.station?.name} (${s.status})`,
      }));
  }, [workOrder]);

  useEffect(() => {
    setStepId("");
    if (workOrder?.dyehouseCompanyId) {
      setCompanyId(workOrder.dyehouseCompanyId);
    }
  }, [workOrderId, workOrder?.dyehouseCompanyId]);

  const lookupRollMutation = useMutation({
    mutationFn: (bc: string) => rollService.getByBarcode(bc),
    onSuccess: (res) => {
      if (res.data) {
        const roll = res.data;
        if (rolls.some((r) => r.id === roll.id)) {
          toast.warning("Bu top zaten listede");
          return;
        }
        setRolls((prev) => [...prev, roll]);
        setRollBarcodeInput("");
      }
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "Top bulunamadı";
      toast.error(msg);
    },
  });

  const dispatchMutation = useMutation({
    mutationFn: () =>
      subcontractorService.dispatch({
        workOrderId,
        stepId,
        companyId,
        rollIds: rolls.map((r) => r.id),
        plateNumber: plateNumber.trim() || undefined,
        driverName: driverName.trim() || undefined,
        notes: notes.trim() || undefined,
      }),
    onSuccess: (res) => {
      toast.success(
        `Sevk belgesi oluşturuldu: ${res.data?.dispatchNo ?? ""}`,
      );
      qc.invalidateQueries({ queryKey: ["rolls"] });
      qc.invalidateQueries({ queryKey: ["roll-detail"] });
      qc.invalidateQueries({ queryKey: ["pending-returns"] });
      qc.invalidateQueries({ queryKey: ["dispatches"] });
      qc.invalidateQueries({ queryKey: ["work-orders"] });
      qc.invalidateQueries({ queryKey: ["work-orders", "for-dispatch"] });
      qc.invalidateQueries({ queryKey: ["workorder-detail"] });
      qc.invalidateQueries({ queryKey: ["workorder-dispatches"] });
      qc.invalidateQueries({ queryKey: ["workorder-manifests"] });
      qc.invalidateQueries({ queryKey: ["active-steps"] });
      setRolls([]);
      setPlateNumber("");
      setDriverName("");
      setNotes("");
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "Sevk oluşturulamadı";
      toast.error(msg);
    },
  });

  const workOrderOptions =
    workOrdersData?.data?.map((w) => ({
      value: w.id,
      label: `${w.batchNumber} (${w.status})`,
    })) ?? [];

  const companyOptions =
    customersData?.data
      ?.filter((c) => c.type === "SUBCONTRACTOR" || c.type === "DYEHOUSE")
      .map((c) => ({
        value: c.id,
        label: `${c.code} - ${c.name}${c.type === "DYEHOUSE" ? " (Boyahane)" : " (Fason)"}`,
      })) ?? [];

  const totalQty = rolls.reduce((s, r) => s + (r.currentQty || 0), 0);

  const canSubmit =
    !!workOrderId &&
    !!stepId &&
    !!companyId &&
    rolls.length > 0 &&
    !dispatchMutation.isPending;

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center gap-2">
        <Truck className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight">Fason Sevk Oluştur</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Send className="h-5 w-5" />
            Yeni Sevk Belgesi
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">İş Emri (Parti)</Label>
              <Select
                value={workOrderId}
                onChange={(e) => setWorkOrderId(e.target.value)}
                options={workOrderOptions}
                placeholder="Parti seçiniz"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Fason Adım (EXTERNAL)</Label>
              <Select
                value={stepId}
                onChange={(e) => setStepId(e.target.value)}
                options={externalStepOptions}
                placeholder={
                  workOrder
                    ? externalStepOptions.length === 0
                      ? "Bu partide EXTERNAL adım yok"
                      : "Adım seçiniz"
                    : "Önce parti seçin"
                }
              />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Fason Firma</Label>
              <Select
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                options={companyOptions}
                placeholder="Firma seçiniz"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Plaka (opsiyonel)</Label>
              <Input
                value={plateNumber}
                onChange={(e) => setPlateNumber(e.target.value)}
                placeholder="34 ABC 123"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Şoför (opsiyonel)</Label>
              <Input
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                placeholder="Ahmet Yılmaz"
              />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Not (opsiyonel)</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Sevk notu"
              />
            </div>
          </div>

          <div className="rounded-lg border p-3 space-y-2 bg-muted/20">
            <Label className="text-xs flex items-center gap-1">
              <Building2 className="h-3.5 w-3.5" /> Sevk Edilecek Toplar
            </Label>
            <div className="flex gap-2">
              <Input
                value={rollBarcodeInput}
                onChange={(e) => setRollBarcodeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && rollBarcodeInput.trim()) {
                    e.preventDefault();
                    lookupRollMutation.mutate(rollBarcodeInput.trim());
                  }
                }}
                placeholder="Top barkodu okutun ve Enter"
                className="h-11"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  rollBarcodeInput.trim() &&
                  lookupRollMutation.mutate(rollBarcodeInput.trim())
                }
                isLoading={lookupRollMutation.isPending}
              >
                <Plus className="h-4 w-4" /> Ekle
              </Button>
            </div>

            {rolls.length === 0 ? (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Henüz top eklenmedi
              </p>
            ) : (
              <div className="space-y-1.5">
                {rolls.map((r, idx) => (
                  <div
                    key={r.id}
                    className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-sm"
                  >
                    <Badge variant="outline" className="text-[10px]">
                      {idx + 1}
                    </Badge>
                    <span className="font-mono text-xs">{r.barcode}</span>
                    <span className="text-xs text-muted-foreground truncate">
                      {r.item?.code} {r.item?.name}
                    </span>
                    <span className="ml-auto flex items-center gap-1 text-xs">
                      <Ruler className="h-3 w-3" />
                      {r.currentQty.toFixed(1)}m
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setRolls((prev) => prev.filter((x) => x.id !== r.id))
                      }
                      className="h-7 w-7"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                ))}
                <div className="flex justify-between pt-1 text-xs text-muted-foreground">
                  <span>{rolls.length} top</span>
                  <span>Toplam: {totalQty.toFixed(1)}m</span>
                </div>
              </div>
            )}
          </div>

          <Button
            type="button"
            disabled={!canSubmit}
            onClick={() => dispatchMutation.mutate()}
            isLoading={dispatchMutation.isPending}
            className="w-full h-12"
          >
            <Send className="h-4 w-4" /> Sevk Belgesi Oluştur ve Yazdır
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
