// Belgeden iş emri modalında TEK desen grubu: seçim kutusu, hedef değerler (aranabilir modalla değişir), toplar/metre.
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatNumber } from "@/lib/format";
import type { ChoiceProperty, PlanGroup, PlanTarget } from "./types";
import { TERIM } from "@/lib/terim";

interface Props {
  group: PlanGroup;
  targets: readonly PlanTarget[];
  properties: readonly ChoiceProperty[];
  checked: boolean;
  disabled: boolean;
  /** Bu grup için açılmış iş emri (başarılı gönderim sonrası). */
  doneNumber: string | null;
  onCheckedChange: (v: boolean) => void;
  onPickValue: (property: ChoiceProperty) => void;
  onClearValue: (propertyId: string) => void;
}

const SOURCE_LABEL: Record<PlanTarget["source"], string> = { ALIAS: "öğrenilmiş", PATTERN: "öneri", MANUAL: "seçildi" };

export function WorkOrderPlanGroupCard({ group, targets, properties, checked, disabled, doneNumber, onCheckedChange, onPickValue, onClearValue }: Props) {
  const blocked = group.rolls.filter((r) => !r.attachable);
  const liveNumbers = [...new Set(blocked.map((r) => r.liveWorkOrder?.workOrderNumber).filter(Boolean))];
  const title = targets.length > 0 ? targets.map((t) => t.valueName).join(" · ") : "Desensiz";
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3" data-testid="plan-group" data-patternless={group.patternless ? "1" : "0"}>
      <div className="flex flex-wrap items-center gap-2">
        <Checkbox
          checked={checked}
          disabled={disabled || group.attachableCount === 0 || !!doneNumber}
          onCheckedChange={(v) => onCheckedChange(v === true)}
          aria-label={`${title} grubunu seç`}
        />
        <span className="font-medium">{title}</span>
        {group.patternless && <Badge variant="outline">işlem değeri çözülemedi</Badge>}
        <span className="text-xs text-muted-foreground">{group.itemName}</span>
        <span className="ml-auto text-sm tabular-nums">
          {group.rolls.length} top · {formatNumber(Number(group.totalMeters), 1)} m
        </span>
      </div>
      {group.processText && <p className="text-xs text-muted-foreground">İşlem metni: “{group.processText}”</p>}
      <div className="flex flex-wrap gap-2">
        {properties.map((p) => {
          const t = targets.find((x) => x.propertyId === p.propertyId);
          return (
            <span key={p.propertyId} className="inline-flex items-center gap-1">
              <Button type="button" size="sm" variant="outline" disabled={disabled || !!doneNumber} onClick={() => onPickValue(p)} data-testid="plan-pick-value">
                {p.propertyName}: {t ? t.valueName : "—"}
                {t && <span className="ml-1 text-[10px] text-muted-foreground">({SOURCE_LABEL[t.source]})</span>}
              </Button>
              {t && !doneNumber && (
                <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={disabled} onClick={() => onClearValue(p.propertyId)} aria-label={`${p.propertyName} hedefini kaldır`}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </span>
          );
        })}
      </div>
      {blocked.length > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {blocked.length} top bağlanamaz (stokta değil{liveNumbers.length ? `; ${TERIM.terbiyeIsEmri.cekimKucuk.bulunma}: ${liveNumbers.join(", ")}` : ""}) — yalnız {group.attachableCount} top gönderilir.
        </p>
      )}
      {doneNumber && <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">{TERIM.terbiyeIsEmri.tekil} açıldı: {doneNumber}</p>}
    </div>
  );
}
