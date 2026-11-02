// =============================================================================
// İE formu — rotadaki KURŞUN adımının kartında gramaj + makine önerisi (Gülkesim 2026-11-02)
// =============================================================================
// Gramaj eskiden rotanın altında ayrı alandı; artık kurşun adımının kartında. Saklama
// bugünkü gibi WorkOrderTargetValue (İE'de tek kurşun adımı). Makine yalnız ÖNERİ.
// =============================================================================
import { useEffect, useRef } from "react";
import { GramajChoiceButtons } from "@/components/kursun/GramajChoiceButtons";
import { PlannedMachineButtons } from "@/components/kursun/PlannedMachineButtons";
import { defaultGramajId, type GramajOption } from "@/lib/kursun-gramaj";
import type { DesignerStep } from "./RouteDesignerDialog";

/** Kurşun adımı = PROCESS_QC türündeki istasyon (Kurşun + KK2). */
export function isKursunStep(step: Pick<DesignerStep, "stationKind">): boolean {
  return step.stationKind === "PROCESS_QC";
}

/**
 * Hedef gramajı kurşun adımının varlığına bağlar: adım ROTAYA GİRİNCE varsayılan ön seçilir
 * (kullanıcı seçimi ezilmez), adım ÇIKINCA hedef temizlenir.
 */
export function useKursunGramajBinding(params: {
  enabled: boolean;
  hasKursun: boolean;
  options: readonly GramajOption[];
  value: string | null;
  setValue: (id: string | null) => void;
}): void {
  const { enabled, hasKursun, options, value, setValue } = params;
  const seeded = useRef(false);
  const defaultId = defaultGramajId(options);
  useEffect(() => {
    if (!enabled) return;
    if (!hasKursun) {
      seeded.current = false;
      if (value !== null) setValue(null);
      return;
    }
    if (seeded.current || !defaultId) return;
    seeded.current = true;
    if (value === null) setValue(defaultId);
  }, [enabled, hasKursun, defaultId, value, setValue]);
}

interface Props {
  step: DesignerStep;
  /** Gramaj yalnız yeni İE'de (düzenlemede detaydaki "Kurşun Gramajı" kartı, ayrı uç). */
  showGramaj: boolean;
  gramajOptions: readonly GramajOption[];
  gramajValue: string | null;
  onGramaj: (id: string | null) => void;
  onMachine: (machineId: string | null) => void;
}

export function KursunStepFields({ step, showGramaj, gramajOptions, gramajValue, onGramaj, onMachine }: Props) {
  if (!isKursunStep(step) || !step.stationId) return null;
  return (
    <div className="space-y-2 rounded-md border border-dashed p-2" data-testid="kursun-step-fields">
      {showGramaj && gramajOptions.length > 0 && (
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">
            Gramaj — basılan farklıysa kartta turuncu görünür; üretim durmaz
          </label>
          <GramajChoiceButtons options={gramajOptions} value={gramajValue} onChange={onGramaj} emptyLabel="Hedef yok" />
        </div>
      )}
      <div className="space-y-1">
        <label className="text-[11px] text-muted-foreground">Makine (öneri — fiilî makine tabletten)</label>
        <PlannedMachineButtons stationId={step.stationId} value={step.plannedMachineId ?? null} onChange={onMachine} />
      </div>
    </div>
  );
}
