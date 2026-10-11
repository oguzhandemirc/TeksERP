import { Button } from "@/components/ui/button";
import { DUTY_TIERS } from "./duty-model";
import type { DutyTier } from "./types";

export function TierToggle({ value, onChange }: { value: DutyTier; onChange: (t: DutyTier) => void }) {
  return (
    <div className="flex gap-2">
      {DUTY_TIERS.map((t) => (
        <Button key={t} type="button" size="sm" variant={value === t ? "default" : "outline"} onClick={() => onChange(t)}>
          Kademe {t}
        </Button>
      ))}
    </div>
  );
}
