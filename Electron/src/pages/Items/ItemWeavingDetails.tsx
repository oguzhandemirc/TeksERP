// =============================================================================
// ÜRÜN FORMU — "Dokuma ayrıntıları" katlanır bölümü (Seyitoğlu temel)
// =============================================================================
// Yalnız KUMAŞ kartında; ham en + ham/mamul gramaj girişi ve kayıtlı kartta hesaplanan gramaj satırı.
// Hesaplanamayan değer gösterilmez (0 ya da tahmin YOK); uç yoksa/hata verirse satır sessizce gizlenir.
// =============================================================================
import type { UseFormReturn } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { FormField } from "@/components/forms/FormField";
import { CollapsibleFormSection } from "@/components/forms/CollapsibleFormSection";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import type { ItemFormValues } from "./schema";
import type { ItemComputedGsm } from "./types";
import { itemService } from "./service";
import { FABRIC_DETAIL_KEYS } from "./itemPayload.helper";
import { qtyFormatter } from "@/lib/format";

/** Girilen ham gramaj hesaplanandan bu oranı (mutlak) AŞARSA uyarı çıkar. */
export const GSM_DIFF_WARN_PCT = 10;

const fmt = qtyFormatter(1);
const num = (n: number | null): string => (n == null || !Number.isFinite(n) ? "—" : fmt.format(n));

export function ItemWeavingDetails({
  form,
  itemId,
  hasSavedValues,
}: {
  form: UseFormReturn<ItemFormValues>;
  /** Kayıtlı kartın kimliği — yalnız düzenlemede hesap satırı istenir. */
  itemId: string | null;
  /** Kartta dolu dokuma ayrıntısı var → bölüm açık gelir. */
  hasSavedValues: boolean;
}) {
  const err = form.formState.errors;
  const hasError = FABRIC_DETAIL_KEYS.some((k) => Boolean(err[k]));
  return (
    <CollapsibleFormSection title="Dokuma ayrıntıları" defaultOpen={hasSavedValues} forceOpen={hasError} testId="item-weaving-details">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FormField label="Ham en (cm)" htmlFor="rawWidthCm" error={err.rawWidthCm}>
          <Input id="rawWidthCm" inputMode="decimal" placeholder="300" {...form.register("rawWidthCm")} />
        </FormField>
        <FormField label="Ham gramaj (g/m²)" htmlFor="rawGsm" error={err.rawGsm}>
          <Input id="rawGsm" inputMode="decimal" placeholder="85" {...form.register("rawGsm")} />
        </FormField>
        <FormField label="Mamul gramaj (g/m²)" htmlFor="finishedGsm" error={err.finishedGsm}>
          <Input id="finishedGsm" inputMode="decimal" placeholder="90" {...form.register("finishedGsm")} />
        </FormField>
      </div>
      {itemId && <ComputedGsmRow itemId={itemId} />}
    </CollapsibleFormSection>
  );
}

function ComputedGsmRow({ itemId }: { itemId: string }) {
  const q = useQuery({
    queryKey: ["item-computed-gsm", itemId],
    queryFn: () => itemService.computedGsm(itemId),
    retry: false,
    staleTime: 0,
  });
  return <ComputedGsmView data={q.isSuccess ? q.data : null} />;
}

/** Saf görünüm: `gsm` bilinmiyorsa hiçbir şey çizmez. */
export function ComputedGsmView({ data }: { data: ItemComputedGsm | null | undefined }) {
  if (!data || data.gsm == null || !Number.isFinite(data.gsm)) return null;
  const diff = data.diffPct;
  const warn = diff != null && Number.isFinite(diff) && Math.abs(diff) > GSM_DIFF_WARN_PCT;
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground tabular-nums" data-testid="item-computed-gsm">
        Hesaplanan: çözgü {num(data.warpGPerM)} g/m · atkı {num(data.weftGPerM)} g/m · toplam {num(data.totalGPerM)} g/m ·{" "}
        <span className="font-medium text-foreground">{num(data.gsm)} g/m²</span>
      </p>
      {warn && (
        <Callout tone="warning">Girilen gramaj hesaplanandan %{num(Math.abs(diff))} farklı</Callout>
      )}
    </div>
  );
}
