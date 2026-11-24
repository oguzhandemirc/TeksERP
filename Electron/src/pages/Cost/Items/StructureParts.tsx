// Yapı sekmesi parçaları: terbiye/ek kalem kartı ve kaydırma bölgesinin dibine yapışık kaydet çubuğu (B12/4).
// Çubuğun `bottom` değeri PageBody dolgusu kadar eksi: yapışkan konum kaydırıcının dolgusunu düşer, yoksa altta şerit kalır.
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { InfoPopover } from "@/components/ui/info-popover";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/ui/section-card";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { finishingBasisUnit, type FinishingRate } from "../FinishingRates/service";
import { fmtDecFull } from "../shared/format";
import { STRUCTURE_MAX } from "./schema";

export const FIELD_LABEL = "block font-medium text-foreground/80";
const RAW_SALE = "__raw";

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
        <div className="block text-sm" data-field="finishingRateCode">
          <span className={FIELD_LABEL}>Fason tarifesi</span>
          {/* Ortak seçici (B18/13); Radix boş değer taşımaz → "ham satış" belirteçle. */}
          <Select value={rateCode || RAW_SALE} onValueChange={(v) => onRateCode(v === RAW_SALE ? "" : v)} disabled={disabled}>
            <SelectTrigger aria-label="Fason tarifesi" className={cn("mt-1", flagged && "ring-2 ring-destructive")}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={RAW_SALE}>Ham satış (terbiye yok)</SelectItem>
              {rates.map((r) => <SelectItem key={r.id} value={r.code}>{r.code} — {r.name} ({fmtDecFull(r.pricePerM)} {r.currency}/{finishingBasisUnit(r.basis)})</SelectItem>)}
              {rateCode && !rates.some((r) => r.code === rateCode) && <SelectItem value={rateCode}>{rateCode} (aktif değil)</SelectItem>}
            </SelectContent>
          </Select>
        </div>
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
