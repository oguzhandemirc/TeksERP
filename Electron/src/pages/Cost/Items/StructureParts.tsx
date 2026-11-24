// Yapı sekmesi parçaları: terbiye/ek kalem kartı ve kaydırma bölgesinin dibine yapışık kaydet çubuğu (B12/4).
// Çubuğun `bottom` değeri PageBody dolgusu kadar eksi: yapışkan konum kaydırıcının dolgusunu düşer, yoksa altta şerit kalır.
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { InfoPopover } from "@/components/ui/info-popover";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/ui/section-card";
import { cn } from "@/lib/utils";
import type { FinishingRate } from "../FinishingRates/service";
import { fmtDecFull } from "../shared/format";
import { STRUCTURE_MAX } from "./schema";

export const FIELD_LABEL = "block font-medium text-foreground/80";

interface FinishingProps {
  rateCode: string;
  onRateCode: (v: string) => void;
  label: string;
  onLabel: (v: string) => void;
  rates: FinishingRate[];
  disabled: boolean;
  flagged: boolean;
  /** Ek kalem (TL/m) sayı alanı — StructureNumberField. */
  extraField: ReactNode;
}

export function FinishingCard({ rateCode, onRateCode, label, onLabel, rates, disabled, flagged, extraField }: FinishingProps) {
  return (
    <SectionCard title="Terbiye ve ek kalem"
      titleExtra={<InfoPopover label="Terbiye ve ek kalem açıklaması" desc="Fason tarifesi seçilmezse kumaş ham satılır (terbiye maliyeti yok). Ek kalem metre başına sabit TL tutardır; etiket dökümde satır adı olur." />}>
      <div className="space-y-3">
        <label className="block text-sm" data-field="finishingRateCode">
          <span className={FIELD_LABEL}>Fason tarifesi</span>
          <select aria-label="Fason tarifesi" disabled={disabled} value={rateCode} onChange={(e) => onRateCode(e.target.value)}
            className={cn("mt-1 h-9 w-full rounded-md border bg-background px-2", flagged && "ring-2 ring-destructive")}>
            <option value="">Ham satış (terbiye yok)</option>
            {rates.map((r) => <option key={r.id} value={r.code}>{r.code} — {r.name} ({fmtDecFull(r.pricePerM)} {r.currency}/m)</option>)}
            {rateCode && !rates.some((r) => r.code === rateCode) && <option value={rateCode}>{rateCode} (aktif değil)</option>}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-[minmax(9rem,12rem)_1fr]">
          {extraField}
          <label className="text-sm"><span className={FIELD_LABEL}>Ek kalem etiketi</span>
            <Input className="mt-1" disabled={disabled} maxLength={STRUCTURE_MAX.extraCostLabel} placeholder="ör. Ambalaj" value={label} onChange={(e) => onLabel(e.target.value)} /></label>
        </div>
      </div>
    </SectionCard>
  );
}

export function StructureSaveBar({ dirty, pending, onSave }: { dirty: boolean; pending: boolean; onSave: () => void }) {
  return (
    <div className="sticky -bottom-4 z-10 -mx-4 -mb-4 mt-auto flex sm:-bottom-6 items-center justify-end gap-3 border-t border-card-border bg-card px-4 py-3 sm:-mx-6 sm:-mb-6 sm:px-6">
      <span className={cn("text-xs", dirty ? "font-medium text-warning-soft-foreground" : "text-muted-foreground")}>
        {dirty ? "Kaydedilmemiş değişiklik var" : "Değişiklik yok"}
      </span>
      <Button onClick={onSave} disabled={pending}>Yapıyı kaydet</Button>
    </div>
  );
}
