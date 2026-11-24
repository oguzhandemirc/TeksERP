// Yapı sekmesinin kısa sayı alanı: dar ızgara hücresi; boşken gerçek varsayılan değer gri yer tutucuda (B12/2).
import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { CostInputSnap } from "../shared/cost-types";
import { STRUCTURE_FIELDS } from "./schema";
import type { StructureKey } from "./service";
import { defaultPlaceholder, structureDefault } from "./structure-defaults";

/** Kısa sayı alanları için ortak dar ızgara (geniş-form): hücre 9–12rem, kart genişliğine göre sarar. */
export const NARROW_GRID = "grid gap-x-4 gap-y-3 grid-cols-[repeat(auto-fill,minmax(9rem,12rem))]";

interface Props {
  k: StructureKey;
  value: string;
  onChange: (v: string) => void;
  girdi: CostInputSnap | undefined;
  disabled: boolean;
  flagged: boolean;
  /** Alanın altında ek satır (ör. ölçülmüş fire önerisi). */
  footer?: ReactNode;
}

export function StructureNumberField({ k, value, onChange, girdi, disabled, flagged, footer }: Props) {
  const fd = STRUCTURE_FIELDS.find((x) => x.key === k)!;
  const placeholder = k === "extraCostPerMTry" ? "yok" : defaultPlaceholder(structureDefault(girdi, k));
  return (
    <label className="text-sm" data-field={k}>
      <span className="block truncate font-medium text-foreground/80">{fd.label} <span className="font-normal text-muted-foreground">({fd.unit})</span></span>
      <Input aria-label={`${fd.label} (${fd.unit})`} disabled={disabled} inputMode="decimal" placeholder={placeholder}
        className={cn("mt-1 text-right tabular-nums placeholder:text-muted-foreground/70", flagged && "ring-2 ring-destructive")}
        value={value} onChange={(e) => onChange(e.target.value)} />
      {footer}
    </label>
  );
}
