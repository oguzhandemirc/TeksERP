import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Save } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormField } from "@/components/forms/FormField";
import { ColorPickerModal } from "@/components/forms/color-picker/ColorPickerModal";
import { PropertyChipsField } from "@/components/forms/PropertyChipsField";
import { qualityGradeService } from "@/pages/QualityGrades/service";
import { loadAllForPicker } from "@/lib/picker-loader";
import { rollService } from "./service";
import { manualAdjustService } from "./manualAdjustService";
import type { Roll } from "./types";

interface Props {
  /** Düzeltilecek topun id'si — null = kapalı. */
  rollId: string | null;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

/**
 * "Manuel Düzelt" — süpervizör bir topun renk/en/kalite/özelliğini düzeltir
 * (roll:manual-adjust). Relabel motoruyla (applyManualProperties) aynı ama ZORUNLU
 * sebep (audit event=MANUAL_ATTRIBUTE). Barkodsuz açık kumaşta da çalışır.
 * itemId/barcode KAPSAM DIŞI (kimlik/izlenebilirlik).
 */
export function ManualAttributesDialog({ rollId, onOpenChange, onSaved }: Props) {
  const open = Boolean(rollId);
  const detailQ = useQuery({
    queryKey: ["roll-detail", rollId],
    queryFn: () => rollService.getById(rollId!),
    enabled: open,
    staleTime: 0,
  });
  const roll = detailQ.data?.data ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manuel Düzelt</DialogTitle>
          <DialogDescription>
            Topun renk / en / kalite / özelliğini düzelt — zorunlu sebep (audit).
          </DialogDescription>
        </DialogHeader>
        {detailQ.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : roll ? (
          <ManualAttributesForm
            key={roll.id}
            roll={roll}
            onSaved={() => {
              onSaved?.();
              onOpenChange(false);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ManualAttributesForm({ roll, onSaved }: { roll: Roll; onSaved: () => void }) {
  const qc = useQueryClient();
  const [colorId, setColorId] = useState<string | null>(roll.colorId);
  const [qualityGrade, setQualityGrade] = useState<string>(roll.qualityGrade ?? "");
  const [width, setWidth] = useState<string>(roll.width != null ? String(roll.width) : "");
  const [propertyIds, setPropertyIds] = useState<string[]>(
    (roll.properties ?? []).map((p) => p.propertyId),
  );
  const [reason, setReason] = useState<string>("");

  const gradesQ = useQuery({
    queryKey: ["quality-grades", "picker"],
    queryFn: () => loadAllForPicker(qualityGradeService, { sortBy: "sortOrder" }),
    staleTime: 5 * 60_000,
  });
  const grades = useMemo(() => gradesQ.data?.data ?? [], [gradesQ.data?.data]);

  const mut = useMutation({
    mutationFn: () =>
      manualAdjustService.applyManualAttributes(roll.id, {
        colorId,
        propertyIds,
        width: width.trim() === "" ? null : Number(width),
        qualityGrade: qualityGrade || undefined,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      toast.success("Top nitelikleri güncellendi.");
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      void qc.invalidateQueries({ queryKey: ["roll-detail"] });
      onSaved();
    },
  });

  const canSave = reason.trim().length >= 3 && !mut.isPending;

  return (
    <div className="space-y-3">
      <FormField label="Renk">
        <ColorPickerModal value={colorId} onChange={setColorId} allowNone label="Renk seç" />
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Kalite Sınıfı">
          <Select value={qualityGrade} onValueChange={setQualityGrade}>
            <SelectTrigger>
              <SelectValue placeholder="Kalite seç..." />
            </SelectTrigger>
            <SelectContent>
              {grades.map((g) => (
                <SelectItem key={g.id} value={g.code}>
                  {g.name} ({g.code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="En (cm)" htmlFor="manual-attr-width">
          <Input
            id="manual-attr-width"
            type="number"
            step="0.1"
            min="0"
            value={width}
            onChange={(e) => setWidth(e.target.value)}
          />
        </FormField>
      </div>

      <FormField label="Özellikler" hint="Topun fiilen sahip olduğu özellikler — tıklayarak ekle/çıkar.">
        <PropertyChipsField itemId={roll.itemId} value={propertyIds} onChange={setPropertyIds} />
      </FormField>

      <FormField label="İşlem Nedeni (zorunlu)" htmlFor="manual-attr-reason">
        <Input
          id="manual-attr-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Örn. boyahane yanlış renk verdi, düzeltildi"
          maxLength={500}
        />
      </FormField>

      <div className="flex justify-end pt-1">
        <Button size="sm" disabled={!canSave} onClick={() => mut.mutate()} className="gap-1">
          <Save className="h-3.5 w-3.5" />
          {mut.isPending ? "Kaydediliyor..." : "Kaydet"}
        </Button>
      </div>
    </div>
  );
}
