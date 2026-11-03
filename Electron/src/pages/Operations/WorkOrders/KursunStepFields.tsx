// =============================================================================
// İE formu — rotadaki KURŞUN adımının kartında gramaj + makine önerisi (Gülkesim 2026-11-02)
// =============================================================================
// Gramaj eskiden rotanın altında ayrı alandı; artık kurşun adımının kartında. Saklama
// bugünkü gibi WorkOrderTargetValue (İE'de tek kurşun adımı). Makine yalnız ÖNERİ.
// K20: "işlem + işlem parametresi" — Kurşun (özellik = yapılan iş) + gramaj (parametre) + makine (kaynak)
// adım kartında TEK "Kurşun ayarları" kutusunda; seçim adım çipinde ve önizlemede yazar. Veri modeli aynı.
// =============================================================================
import type { ReactNode } from "react";
import { GramajChoiceButtons } from "@/components/kursun/GramajChoiceButtons";
import { PlannedMachineButtons, usePlannedMachines } from "@/components/kursun/PlannedMachineButtons";
import type { GramajOption } from "@/lib/kursun-gramaj";
import type { DesignerStep } from "./RouteDesignerDialog";

/** Kurşun adımı = sunucunun `isKursunStation`ı (StationProperty KURSUN/AUTO); alan yoksa (eski sunucu / WO detayı) PROCESS_QC türü. */
export function isKursunStep(step: Pick<DesignerStep, "stationKind" | "isKursunStation">): boolean {
  return step.isKursunStation ?? step.stationKind === "PROCESS_QC";
}

// Gramajın rota adımına bağı (adım girince ön seçim, çıkınca temizlik) K22 ile genellendi: `stepDefaultTargets.ts`.

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
    <div className="space-y-2.5" data-testid="kursun-step-fields">
      {showGramaj && gramajOptions.length > 0 && (
        <ParamRow label="Gramaj" hint="işlemin ayarı (gr/m) — basılan farklıysa kartta turuncu görünür; üretim durmaz">
          <GramajChoiceButtons options={gramajOptions} value={gramajValue} onChange={onGramaj} emptyLabel="Hedef yok" />
        </ParamRow>
      )}
      <ParamRow label="Makine" hint="hangi makinede — öneri; fiilî makine tabletten">
        <PlannedMachineButtons stationId={step.stationId} value={step.plannedMachineId ?? null} onChange={onMachine} />
      </ParamRow>
    </div>
  );
}

/** Kurşun ayarları kutusunun satırı: kısa ad + açıklama, altında seçim. */
export function ParamRow({ label, hint, aside, children }: { label: string; hint: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline gap-x-1.5 text-[11px]">
        <span className="font-semibold">{label}</span>
        <span className="text-muted-foreground">— {hint}</span>
        {aside && <span className="ml-auto">{aside}</span>}
      </div>
      {children}
    </div>
  );
}

export const KURSUN_SETTINGS_TITLE = "Kurşun ayarları";

/**
 * Seçilen gramaj + makinenin metni. "Hedef yok" (null) ve "Öneri yok" yazılmaz; ikisi de boşsa null.
 * `short` (adım çipi) makine KODU, `long` (önizleme) makine ADI.
 */
export function kursunDetailText(
  gramaj: { name: string } | null | undefined,
  machine: { code?: string | null; name: string } | null | undefined,
  mode: "short" | "long",
): string | null {
  const parts: string[] = [];
  if (gramaj) parts.push(gramaj.name);
  if (machine) parts.push(mode === "short" ? machine.code?.trim() || machine.name : machine.name);
  return parts.length > 0 ? parts.join(" · ") : null;
}

interface SummaryProps {
  step: DesignerStep;
  gramajOptions: readonly GramajOption[];
  /** Gösterilmeyen gramaj (düzenleme kipi) için null geç — metne girmez. */
  gramajValue: string | null;
  mode: "short" | "long";
  className?: string;
  /** Metnin önüne (ör. çipte "· "); seçim yoksa o da çizilmez. */
  prefix?: string;
  /** Metni saran yerleşim (ör. önizleme satırı); seçim yoksa sarmalayıcı da çizilmez. */
  wrap?: (node: ReactNode) => ReactNode;
}

/** Kurşun adımının seçim özeti (adım çipi + İE önizlemesi); kurşun adımı değilse ya da seçim yoksa çizilmez. */
export function KursunStepSummary({ step, gramajOptions, gramajValue, mode, className, prefix = "", wrap }: SummaryProps) {
  const kursun = isKursunStep(step) && Boolean(step.stationId);
  const machines = usePlannedMachines(kursun ? step.stationId : null);
  if (!kursun) return null;
  const gramaj = gramajValue ? gramajOptions.find((o) => o.id === gramajValue) : null;
  const machine = step.plannedMachineId ? machines.find((m) => m.id === step.plannedMachineId) : null;
  const text = kursunDetailText(gramaj, machine, mode);
  if (!text) return null;
  const node = <span className={className} data-testid={`kursun-summary-${mode}`}>{prefix}{text}</span>;
  return wrap ? <>{wrap(node)}</> : node;
}
