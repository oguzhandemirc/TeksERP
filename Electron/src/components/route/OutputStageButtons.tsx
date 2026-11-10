import { Button } from "@/components/ui/button";
import { RollStage, rollStageLabels } from "@/types/enums";

/** Adım çıktı aşaması: null = otomatik (sunucu kararı). */
export type OutputStageValue = RollStage | null;

/** Yardım metni tek kaynak — rota şablonu ve iş emri adımı aynı cümleyi gösterir. */
export const OUTPUT_STAGE_HELP = "Otomatik: ara adımda atanın aşaması, son adımda ve depoya inişte Bitmiş";

const OPTIONS: Array<{ value: OutputStageValue; label: string }> = [
  { value: null, label: "Otomatik" },
  { value: RollStage.RAW, label: rollStageLabels.RAW },
  { value: RollStage.SEMI_FINISHED, label: rollStageLabels.SEMI_FINISHED },
  { value: RollStage.FINISHED, label: rollStageLabels.FINISHED },
];

/** Salt-okunur özet ("Otomatik" / "Bitmiş"…). */
export function outputStageLabel(v: OutputStageValue | undefined): string {
  return v ? rollStageLabels[v] : "Otomatik";
}

interface Props {
  value: OutputStageValue;
  onChange: (v: OutputStageValue) => void;
  disabled?: boolean;
}

/**
 * Adımda doğan / adımdan çıkan topun aşaması (2026-11-10) — etiket türü buradan türer.
 * Dört seçenek: düğme dizisi (UI tercihi: combobox yok).
 */
export function OutputStageButtons({ value, onChange, disabled }: Props) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">Çıktı aşaması</label>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Çıktı aşaması">
        {OPTIONS.map((o) => (
          <Button
            key={o.value ?? "AUTO"}
            type="button"
            size="sm"
            role="radio"
            aria-checked={value === o.value}
            variant={value === o.value ? "default" : "outline"}
            disabled={disabled}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </Button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">{OUTPUT_STAGE_HELP}</p>
    </div>
  );
}
