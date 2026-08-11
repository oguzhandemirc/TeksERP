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
import { needsSupervisorEdit, type RelabelContext } from "./types";

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
  const [metraj, setMetraj] = useState<string>(ctx.currentQty != null ? String(ctx.currentQty) : "");
  const [propertyIds, setPropertyIds] = useState<string[]>(ctx.propertyIds);
  const [marked, setMarked] = useState<boolean>(ctx.markedForKartela);
  // Süpervizör kapsamı: top serbest satılabilir stokta DEĞİLSE (örn. istasyonda,
  // IN_PRODUCTION) düzeltme sebep ister + roll:manual-adjust yetkisi arar. Eski
  // ayrı "Manuel Düzelt" diyaloğunun tek işlevi buydu; buraya taşındı.
  const supervisorScope = needsSupervisorEdit(ctx.status);
  const canSupervise = hasAnyPermission(["roll:manual-adjust"]);
  const [reason, setReason] = useState("");
  const reasonOk = !supervisorScope || reason.trim().length >= 3;
  // Kaydettikten sonra "fiziksel etiketi de yenile" hatırlatması (bir alan tekrar değişince gizlenir).
  const [savedHint, setSavedHint] = useState(false);

  const gradesQ = useQuery({
    queryKey: ["quality-grades", "picker"],
    queryFn: () => loadAllForPicker(qualityGradeService, { sortBy: "sortOrder" }),
    staleTime: 5 * 60_000,
  });
  const grades = useMemo(() => gradesQ.data?.data ?? [], [gradesQ.data?.data]);

  // Tek "Kaydet" tüm veri düzeltmelerini kaydeder: spec (renk/kalite/en/özellik) + kartelalık.
  // (Kartelalık ayrı uç → yalnız değiştiyse ikinci çağrı.) Müşteri baskısı AYRI (bir baskı eylemi).
  const mut = useMutation({
    mutationFn: async () => {
      await relabelService.applySpec(ctx.id, {
        colorId,
        propertyIds,
        width: width.trim() === "" ? null : Number(width),
        qualityGrade: qualityGrade || undefined,
        // Metraj YALNIZ değiştiyse gönder — değişmediyse göndermeyip backend'in
        // "kısmen tüketilmiş" guard'ını (renk-only kayıtlarda) gereksiz tetikleme.
        currentQty:
          metraj.trim() !== "" && Number(metraj) !== ctx.currentQty ? Number(metraj) : undefined,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      if (canKartela && marked !== ctx.markedForKartela) {
        await relabelService.setMarkedForKartela(ctx.id, marked);
      }
    },
    onSuccess: () => {
      toast.success("Kaydedildi.");
      setSavedHint(true);
      // Liste + detay sheet'in "Etiket güncel değil" rozeti tazelensin (labelDirty değişti).
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      void qc.invalidateQueries({ queryKey: ["roll-detail"] });
      onSaved();
    },
  });

  const disabled = !canEdit || ctx.specLocked || (supervisorScope && !canSupervise);

  // Alan setter'larını sararak: kullanıcı yeniden düzenlemeye başlarsa hatırlatma kaybolur.
  const edit =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setSavedHint(false);
      setter(v);
    };

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Veri Düzelt</h3>
        <span className="text-xs text-muted-foreground">
          renk · metraj · kalite · en · özellik{canKartela ? " · kartelalık" : ""}
        </span>
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

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Renk">
          <ColorPickerModal
            value={colorId}
            onChange={edit(setColorId)}
            allowNone
            label="Renk seç"
            disabled={disabled}
          />
        </FormField>
        <FormField label="Metraj (mt)" htmlFor="relabel-metraj">
          <Input
            id="relabel-metraj"
            type="number"
            step="0.1"
            min="0"
            value={metraj}
            disabled={disabled}
            onChange={(e) => edit(setMetraj)(e.target.value)}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Kalite Sınıfı">
          <Select value={qualityGrade} onValueChange={edit(setQualityGrade)} disabled={disabled}>
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
            onChange={(e) => edit(setWidth)(e.target.value)}
          />
        </FormField>
      </div>

      <FormField label="Özellikler" hint="Topun fiilen sahip olduğu özellikler — tıklayarak ekle/çıkar.">
        <PropertyChipsField
          itemId={ctx.itemId}
          value={propertyIds}
          onChange={edit(setPropertyIds)}
          disabled={disabled}
        />
        {/* SEÇİM (CHOICE) tipli özellikler salt-okunur: değer istasyonda (Kurşun/QC2)
            seçilir, buradan düzenlenmez — chip listesi FLAG'e süzülü olduğu için bu
            satır olmadan "GRAMAJ: 50 gr" bilgisi Düzelt'te hiç görünmezdi (VAL-02). */}
        {ctx.properties.some((p) => p.value) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ctx.properties
              .filter((p) => p.value)
              .map((p) => (
                <span
                  key={p.id}
                  title="İstasyonda seçilen değer — buradan düzenlenmez"
                  className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
                >
                  {p.name}: {p.value!.name}
                </span>
              ))}
          </div>
        )}
      </FormField>

      {canKartela && (
        <label className="flex cursor-pointer items-start gap-2 rounded-md border border-purple-200 bg-purple-50/60 p-2.5 dark:border-purple-900/50 dark:bg-purple-950/20">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={marked}
            disabled={disabled}
            onChange={(e) => edit(setMarked)(e.target.checked)}
          />
          <span className="text-sm">
            <span className="font-medium">Kartelalık</span> — topu kartela (numune) için işaretle
            <span className="block text-xs text-muted-foreground">
              Kartela sevk/kabul akışında görünür. Bitmiş top da işaretlenebilir.
            </span>
          </span>
        </label>
      )}

      {/* SÜPERVİZÖR KAPSAMI: top serbest satılabilir stokta değil (üretimde) →
          sebep zorunlu + roll:manual-adjust. Yetki yoksa alan yerine net uyarı. */}
      {supervisorScope && !canSupervise && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
          Bu top serbest depoda değil (üretimde) — niteliklerini düzeltmek için{" "}
          <span className="font-mono">roll:manual-adjust</span> yetkisi gerekiyor.
        </div>
      )}
      {supervisorScope && canSupervise && (
        <FormField
          label="İşlem nedeni (zorunlu)"
          htmlFor="relabel-reason"
          hint="Top üretimde olduğu için düzeltme gerekçesi kayda geçer."
        >
          <Input
            id="relabel-reason"
            value={reason}
            disabled={disabled}
            placeholder="Örn. KK1'de yanlış renk girilmiş"
            onChange={(e) => edit(setReason)(e.target.value)}
          />
        </FormField>
      )}

      {savedHint && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300">
          ✓ Kaydedildi. Fiziksel etiketi de yenilemek için <strong>"Etiket"</strong>i kullan.
        </div>
      )}

      <div className="flex justify-end pt-1">
        <Button
          size="sm"
          disabled={disabled || !reasonOk || mut.isPending}
          onClick={() => mut.mutate()}
          className="gap-1"
        >
          <Save className="h-3.5 w-3.5" />
          {mut.isPending ? "Kaydediliyor..." : "Kaydet"}
        </Button>
      </div>
    </div>
  );
}
