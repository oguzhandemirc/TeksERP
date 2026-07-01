import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Lock, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/forms/FormField";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ColorPickerModal } from "@/components/forms/color-picker/ColorPickerModal";
import { PropertyChipsField } from "@/components/forms/PropertyChipsField";
import { qualityGradeService } from "@/pages/QualityGrades/service";
import { loadAllForPicker } from "@/lib/picker-loader";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { shipmentStatusLabels, type ShipmentStatus } from "@/pages/Operations/Shipments/types";
import { relabelService } from "./service";
import type { RelabelContext } from "./types";

/**
 * Spec düzeltme — yanlış girilmiş renk/kalite/en/özelliği düzeltir (mevcut
 * `applyManualProperties` ucu). Müşteri bağlamına DOKUNMAZ; o ayrı bölümde.
 * Üst bileşen `key={ctx.id}` ile remount eder → state taze top'tan seed olur.
 */
export function RelabelSpecForm({ ctx, onSaved }: { ctx: RelabelContext; onSaved: () => void }) {
  const qc = useQueryClient();
  const { hasAnyPermission } = useRoleAccess();
  const canEdit = hasAnyPermission(["roll:write", "label:edit"]);
  const canKartela = hasAnyPermission(["kartela:write"]);

  const [colorId, setColorId] = useState<string | null>(ctx.colorId);
  const [qualityGrade, setQualityGrade] = useState<string>(ctx.qualityGrade);
  const [width, setWidth] = useState<string>(ctx.width != null ? String(ctx.width) : "");
  const [propertyIds, setPropertyIds] = useState<string[]>(ctx.propertyIds);
  const [marked, setMarked] = useState<boolean>(ctx.markedForKartela);

  // Kartelalık işareti — spec'ten bağımsız (ayrı uç); değişince anında kaydeder + tazeler.
  const markMut = useMutation({
    mutationFn: (value: boolean) => relabelService.setMarkedForKartela(ctx.id, value),
    onSuccess: (_d, value) => {
      setMarked(value);
      toast.success(value ? "Kartelalık olarak işaretlendi." : "Kartelalık işareti kaldırıldı.");
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      onSaved();
    },
  });

  const gradesQ = useQuery({
    queryKey: ["quality-grades", "picker"],
    queryFn: () => loadAllForPicker(qualityGradeService, { sortBy: "sortOrder" }),
    staleTime: 5 * 60_000,
  });
  const grades = useMemo(() => gradesQ.data?.data ?? [], [gradesQ.data?.data]);

  const mut = useMutation({
    mutationFn: () =>
      relabelService.applySpec(ctx.id, {
        colorId,
        propertyIds,
        width: width.trim() === "" ? null : Number(width),
        qualityGrade: qualityGrade || undefined,
      }),
    onSuccess: () => {
      toast.success("Top spec'i güncellendi.");
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      onSaved();
    },
  });

  const disabled = !canEdit || ctx.specLocked;

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Spec Düzelt</h3>
        <span className="text-xs text-muted-foreground">renk · kalite · en · özellik</span>
      </div>

      {ctx.specLocked && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          Bu top commit'li bir sevkiyatta ({ctx.shipment?.shipmentNo} ·{" "}
          {ctx.shipment ? (shipmentStatusLabels[ctx.shipment.status as ShipmentStatus] ?? ctx.shipment.status) : ""}).
          Spec düzenlemek için önce sevkiyatı hazırlığa geri alın.
        </div>
      )}
      {!canEdit && !ctx.specLocked && (
        <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          Spec düzenleme yetkiniz yok (roll:write / label:edit).
        </div>
      )}

      <FormField label="Renk">
        <ColorPickerModal
          value={colorId}
          onChange={setColorId}
          allowNone
          label="Renk seç"
          disabled={disabled}
        />
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Kalite Sınıfı">
          <Select value={qualityGrade} onValueChange={setQualityGrade} disabled={disabled}>
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
        <FormField label="En (cm)" htmlFor="relabel-width">
          <Input
            id="relabel-width"
            type="number"
            step="0.1"
            min="0"
            value={width}
            disabled={disabled}
            onChange={(e) => setWidth(e.target.value)}
          />
        </FormField>
      </div>

      <FormField label="Özellikler" hint="Topun fiilen sahip olduğu özellikler — tıklayarak ekle/çıkar.">
        <PropertyChipsField
          itemId={ctx.itemId}
          value={propertyIds}
          onChange={setPropertyIds}
          disabled={disabled}
        />
      </FormField>

      {canKartela && (
        <label className="flex cursor-pointer items-start gap-2 rounded-md border border-purple-200 bg-purple-50/60 p-2.5 dark:border-purple-900/50 dark:bg-purple-950/20">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={marked}
            disabled={markMut.isPending}
            onChange={(e) => markMut.mutate(e.target.checked)}
          />
          <span className="text-sm">
            <span className="font-medium">Kartelalık</span> — bu topu kartela (numune) için işaretle
            <span className="block text-xs text-muted-foreground">
              İşaretli toplar kartela sevk/kabul akışında görünür. Bitmiş top da işaretlenebilir.
              {markMut.isPending ? " (kaydediliyor…)" : ""}
            </span>
          </span>
        </label>
      )}

      <div className="flex justify-end pt-1">
        <Button size="sm" disabled={disabled || mut.isPending} onClick={() => mut.mutate()} className="gap-1">
          <Save className="h-3.5 w-3.5" />
          {mut.isPending ? "Kaydediliyor..." : "Spec'i Kaydet"}
        </Button>
      </div>
    </div>
  );
}
