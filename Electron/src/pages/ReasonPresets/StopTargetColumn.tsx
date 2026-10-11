// =============================================================================
// HAZIR SEBEPLER › Tezgah Duruşu — HEDEF SÜRE sütunu + "hedefi girilmemiş N sebep" uyarısı
// =============================================================================
// Yalnız tezgah izleme açıkken çizilir. Yazma mevcut yetkiyle (`roll:manual-adjust`, sunucu
// PATCH kapısı aynı); yetki yoksa salt-okuma. Değer duruşa sebep kararında donar — burada
// değiştirmek geçmiş duruşları değiştirmez. "Çalışma dışı" sınıfı süre izlemez (sunucu kuralı).
// =============================================================================
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { parseStopTarget, reasonPresetService, type ReasonPreset } from "./service";

const tracksTarget = (r: Pick<ReasonPreset, "stopLossClass">): boolean => r.stopLossClass !== "NON_SCHEDULED";

/** Hedefi girilmemiş, süre izlenen, AKTİF tezgah duruşu sebepleri. */
export function missingTargetCount(rows: readonly ReasonPreset[]): number {
  return rows.filter((r) => r.kind === "MACHINE_STOP" && r.isActive && tracksTarget(r) && r.targetMinutes == null).length;
}

export function StopTargetGapCallout({ count, alarmOn }: { count: number; alarmOn: boolean }) {
  if (count === 0) return null;
  return (
    <Callout tone="warning" title={`Hedef süresi girilmemiş ${count} sebep`}>
      {alarmOn
        ? "Bu sebeplerle kaydedilen duruşlar alarm üretmez ve Tezgah Salonu'nda hedef aşımı olarak öne çıkmaz."
        : "Bu sebeplerle kaydedilen duruşlarda hedef aşımı izlenmez (Tezgah Salonu öne çıkarmaz; tezgah alarmı açılırsa alarm da üretmez)."}{" "}
      Hedefi aşağıdaki sütundan ya da sebebi düzenleyerek girin.
    </Callout>
  );
}

function ReadOnlyTarget({ row }: { row: ReasonPreset }) {
  if (!tracksTarget(row)) return <span className="text-xs text-muted-foreground">izlenmez</span>;
  if (row.targetMinutes == null) return <span className="text-xs font-medium text-amber-600 dark:text-amber-400">girilmemiş</span>;
  return <span className="text-sm tabular-nums">{row.targetMinutes} dk</span>;
}

function EditableTarget({ row }: { row: ReasonPreset }) {
  const qc = useQueryClient();
  const saved = row.targetMinutes != null ? String(row.targetMinutes) : "";
  const [text, setText] = useState(saved);
  useEffect(() => setText(saved), [saved]);
  const parsed = parseStopTarget(text);
  const save = useMutation({
    mutationFn: (targetMinutes: number | null) => reasonPresetService.update(row.id, { targetMinutes }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["reason-presets"] });
      toast.success("Hedef süre kaydedildi", { description: "Yalnız bundan sonraki duruşları etkiler." });
    },
    onError: () => setText(saved),
  });
  const commit = () => {
    if (parsed === undefined || parsed === (row.targetMinutes ?? null)) return;
    save.mutate(parsed);
  };
  return (
    <div className="flex items-center gap-1.5">
      <Input
        value={text}
        inputMode="numeric"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        disabled={save.isPending}
        placeholder="—"
        aria-label={`${row.label} — hedef süre (dk)`}
        aria-invalid={parsed === undefined}
        className={cn("h-8 w-16 text-right tabular-nums", parsed === undefined && "border-destructive")}
      />
      <span className="text-xs text-muted-foreground">dk</span>
    </div>
  );
}

/** Satırın hedef süre hücresi (sabit genişlik — sütun hizası). */
export function StopTargetCell({ row, canEdit }: { row: ReasonPreset; canEdit: boolean }) {
  return (
    <div className="flex w-28 shrink-0 justify-end" data-testid="stop-target-cell">
      {canEdit && tracksTarget(row) ? <EditableTarget row={row} /> : <ReadOnlyTarget row={row} />}
    </div>
  );
}
