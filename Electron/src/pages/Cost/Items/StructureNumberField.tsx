// Yapı sekmesinin kısa sayı alanı: dar ızgara hücresi; boşken gerçek varsayılan değer gri yer tutucuda (B12/2),
// varsayılan bilinmiyorsa nedeni etiketin yanındaki ⓘ'de (B18/9).
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { FinishingRate } from "../FinishingRates/service";
import { costParamService } from "../Parameters/service";
import { Input } from "@/components/ui/input";
import { InfoPopover } from "@/components/ui/info-popover";
import { cn } from "@/lib/utils";
import type { CostInputSnap } from "../shared/cost-types";
import { STRUCTURE_FIELDS } from "./schema";
import type { StructureKey } from "./service";
import { structureHint, type HintContext } from "./structure-defaults";

/**
 * Varsayılan bağlamı: aktif parametre seti + formda SEÇİLİ tarife. Tarife listesi yüklenmediyse ya da kod aktif
 * değilse seçim bilinmiyor (undefined) → yer tutucu girdi anlık görüntüsüne bakar.
 */
export function useStructureHintContext(rateCode: string, rates: FinishingRate[] | undefined): HintContext {
  const params = useQuery({ queryKey: ["cost-params", "active"], queryFn: costParamService.active });
  return { params: params.data, rate: rateCode ? rates?.find((r) => r.code === rateCode) : null };
}

/** Kısa sayı alanları için ortak dar ızgara (geniş-form): hücre 9–12rem, kart genişliğine göre sarar. */
export const NARROW_GRID = "grid gap-x-4 gap-y-3 grid-cols-[repeat(auto-fill,minmax(9rem,12rem))]";

interface Props {
  k: StructureKey;
  value: string;
  onChange: (v: string) => void;
  girdi: CostInputSnap | undefined;
  disabled: boolean;
  flagged: boolean;
  /** Kart bağlı değilken varsayılan zinciri (parametre seti, seçili tarife). */
  ctx?: HintContext;
  /** Alanın altında ek satır (ör. ölçülmüş fire önerisi). */
  footer?: ReactNode;
}

export function StructureNumberField({ k, value, onChange, girdi, disabled, flagged, ctx, footer }: Props) {
  const fd = STRUCTURE_FIELDS.find((x) => x.key === k)!;
  const hint = structureHint(girdi, k, ctx);
  return (
    <div className="text-sm" data-field={k}>
      <span className="flex items-center gap-1">
        <label htmlFor={`structure-${k}`} className="truncate font-medium text-foreground/80">
          {fd.label} <span className="font-normal text-muted-foreground">({fd.unit})</span>
        </label>
        {hint.info && <InfoPopover desc={hint.info} label={`${fd.label} varsayılanı`} />}
      </span>
      <Input id={`structure-${k}`} aria-label={`${fd.label} (${fd.unit})`} disabled={disabled} inputMode="decimal" placeholder={hint.placeholder}
        className={cn("mt-1 text-right tabular-nums placeholder:text-muted-foreground/70", flagged && "ring-2 ring-destructive")}
        value={value} onChange={(e) => onChange(e.target.value)} />
      {footer}
    </div>
  );
}
