// =============================================================================
// İE formu — rotadaki KURŞUN adımının kartında gramaj + makine önerisi (Gülkesim 2026-11-02)
// =============================================================================
// Gramaj eskiden rotanın altında ayrı alandı; artık kurşun adımının kartında. Saklama
// bugünkü gibi WorkOrderTargetValue (İE'de tek kurşun adımı). Makine yalnız ÖNERİ.
// =============================================================================
import { useEffect, useRef } from "react";
import { GramajChoiceButtons } from "@/components/kursun/GramajChoiceButtons";
import { PlannedMachineButtons } from "@/components/kursun/PlannedMachineButtons";
import { customerGramajId, type GramajOption, type KursunCustomerDefaults } from "@/lib/kursun-gramaj";
import type { DesignerStep } from "./RouteDesignerDialog";

/** Kurşun adımı = sunucunun `isKursunStation`ı (StationProperty KURSUN/AUTO); alan yoksa (eski sunucu / WO detayı) PROCESS_QC türü. */
export function isKursunStep(step: Pick<DesignerStep, "stationKind" | "isKursunStation">): boolean {
  return step.isKursunStation ?? step.stationKind === "PROCESS_QC";
}

/**
 * Hedef gramajı kurşun adımının varlığına bağlar: adım ROTAYA GİRİNCE varsayılan ön seçilir
 * (kullanıcı seçimi ezilmez), adım ÇIKINCA hedef temizlenir. S3: varsayılan = müşterinin cari kartındaki
 * gramaj, yoksa istasyonunki; müşteri değişince değer hâlâ son ön seçimse yenisine geçer (elle seçim kalır).
 */
export function useKursunGramajBinding(params: {
  enabled: boolean;
  hasKursun: boolean;
  options: readonly GramajOption[];
  value: string | null;
  setValue: (id: string | null) => void;
  customerId?: string | null;
  customerDefaults?: KursunCustomerDefaults;
}): void {
  const { enabled, hasKursun, options, value, setValue, customerId, customerDefaults } = params;
  // undefined = henüz ön seçilmedi; aksi halde son OTOMATİK seçilen değer.
  const seeded = useRef<string | undefined>(undefined);
  const target = customerGramajId(options, customerDefaults ?? NO_DEFAULTS, customerId);
  useEffect(() => {
    if (!enabled) return;
    if (!hasKursun) {
      seeded.current = undefined;
      if (value !== null) setValue(null);
      return;
    }
    if (!target) return;
    if (seeded.current === undefined) {
      seeded.current = target;
      if (value === null) setValue(target);
      return;
    }
    if (target !== seeded.current && value === seeded.current) {
      seeded.current = target;
      setValue(target);
    }
  }, [enabled, hasKursun, target, value, setValue]);
}

const NO_DEFAULTS: KursunCustomerDefaults = Object.freeze({});

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
