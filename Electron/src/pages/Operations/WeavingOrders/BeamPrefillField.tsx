// =============================================================================
// DOKUMA İŞ EMRİ FORMU — "Levent" (isteğe bağlı ÖN DOLDURMA kaynağı; gövdeye GİRMEZ)
// =============================================================================
// Seçim form değeri değildir (allowlist'e yeni alan yok, sözleşme değişmez): seçilen leventin çözgü
// kartı + fasoncusu forma TEK SEFER yazılır. Hedef metre YAZILMAZ — levent çözgü metresi, iş emri
// kumaş metresidir; kartta take-up varsa yalnız "öneri: ~N m" ipucu çıkar (`PlannedMSuggestion`).
// `/api/warp-beams` devere modülü arkasında: çağıran yalnız devere açıkken çizer.
// =============================================================================
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { UseFormReturn } from "react-hook-form";
import { Layers } from "lucide-react";
import { toast } from "sonner";
import { FormField } from "@/components/forms/FormField";
import { Button } from "@/components/ui/button";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import type { CrudService } from "@/services/crudService";
import { warpBeamService } from "@/pages/Operations/WarpBeams/service";
import type { WarpBeam } from "@/pages/Operations/WarpBeams/types";
import { warpSpecService } from "@/pages/WarpSpecs/service";
import type { WeavingOrderFormValues } from "./schema";
import { beamPrefillForOrder, fabricSuggestionM } from "./prefill";

type Form = UseFormReturn<WeavingOrderFormValues>;

/** Hedef metre ipucu — yalnız kartta take-up varken üretilir. */
export interface PlannedMSuggestion {
  beamNo: string;
  warpM: number;
  takeUpPct: number;
  suggestedM: number;
}

const beamPicker = warpBeamService as unknown as CrudService<WarpBeam>;
/** Canlı leventler (bitmiş/hurda/iptal dışı). */
const LIVE_BEAMS = { status: "PLANNED,READY,SHIPPED_OUT,MOUNTED" } as const;
const fmtM = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 0 });

export function BeamPrefillField({ form, onSuggestion }: { form: Form; onSuggestion: (s: PlannedMSuggestion | null) => void }) {
  const qc = useQueryClient();
  const [beamId, setBeamId] = useState("");
  const [filled, setFilled] = useState<string | null>(null);

  async function pick(id: string | null) {
    setBeamId(id ?? "");
    setFilled(null);
    onSuggestion(null);
    if (!id) return;
    const beam = (await qc.fetchQuery({ queryKey: ["warp-beams", "prefill", id], queryFn: () => warpBeamService.getById(id) })).data;
    const fill = beamPrefillForOrder(beam);
    form.setValue("warpSpecId", fill.warpSpecId, { shouldDirty: true });
    if (fill.executionKind && fill.subcontractorId) {
      form.setValue("executionKind", fill.executionKind, { shouldDirty: true });
      form.setValue("subcontractorId", fill.subcontractorId, { shouldDirty: true, shouldValidate: true });
    }
    setFilled(fill.subcontractorId ? "Çözgü kartı ve fasoncu leventten dolduruldu" : "Çözgü kartı leventten dolduruldu");
    const spec = (await qc.fetchQuery({ queryKey: ["warp-specs", "prefill", beam.warpSpecId], queryFn: () => warpSpecService.getById(beam.warpSpecId) })).data;
    const suggestedM = fabricSuggestionM(beam.plannedLengthM, spec?.takeUpPct);
    if (suggestedM !== null) onSuggestion({ beamNo: beam.beamNo, warpM: Number(beam.plannedLengthM), takeUpPct: Number(spec?.takeUpPct), suggestedM });
  }

  return (
    <FormField label="Levent" hint={filled ? `${filled} — değiştirebilirsiniz. Levent bu formda bağlanmaz; bağ levent formundan kurulur.` : "İsteğe bağlı — seçilirse çözgü kartı ve fasoncu ondan dolar. Kaydedilmez."}>
      <EntityPickerModal<WarpBeam>
        value={beamId || null}
        onChange={(id) => void pick(id).catch(() => toast.error("Levent bilgisi okunamadı — alanları elle doldurun."))}
        service={beamPicker}
        queryKey="warp-beams-weaving-prefill"
        filters={{ ...LIVE_BEAMS }}
        getLabel={(b) => b.beamNo}
        getSubLabel={(b) => `${b.warpSpec.name} · ${fmtM(Number(b.plannedLengthM))} m çözgü${b.subcontractor ? ` · ${b.subcontractor.name}` : ""}`}
        icon={Layers}
        nullable
        noneLabel="Levent yok"
        title="Levent seç (ön doldurma)"
        placeholder="Levent seç (isteğe bağlı)"
      />
    </FormField>
  );
}

/** "Öneri: ~N m" + tek tıkla uygula. Alanı KENDİ doldurmaz (kural: metre çevrimi yapılmaz, öneri gösterilir). */
export function PlannedMHint({ suggestion, onApply }: { suggestion: PlannedMSuggestion | null; onApply: (m: number) => void }) {
  if (!suggestion) return null;
  const { beamNo, warpM, takeUpPct, suggestedM } = suggestion;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-sky-300 bg-sky-50 px-2 py-1 text-xs text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200" data-testid="wo-plannedM-oneri">
      <span>
        Öneri: ~{fmtM(suggestedM)} m <span className="text-muted-foreground">({beamNo} {fmtM(warpM)} m çözgü × (1 − %{takeUpPct.toLocaleString("tr-TR")} take-up))</span>
      </span>
      <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => onApply(suggestedM)} data-testid="wo-plannedM-uygula">
        Uygula
      </Button>
    </div>
  );
}
