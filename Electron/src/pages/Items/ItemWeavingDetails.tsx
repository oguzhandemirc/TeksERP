// =============================================================================
// ÜRÜN FORMU — "Ölçüler ve gramaj" bölümü (ürün kartı denetimi K2/K3)
// =============================================================================
// Yalnız KUMAŞ kartında ve AÇIK: ham en → mamul en yan yana (en çekmesi ikisinden), ardından ham/mamul gramaj;
// kayıtlı kartta türetilen satırlar. Hesaplanamayan değer gösterilmez (0 ya da tahmin YOK); uç hata verirse satır gizlenir.
// =============================================================================
import type { UseFormReturn } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { FormField } from "@/components/forms/FormField";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { InfoPopover } from "@/components/ui/info-popover";
import type { ItemFormValues } from "./schema";
import type { ItemComputedGsm } from "./types";
import { itemService } from "./service";
import { qtyFormatter } from "@/lib/format";

/** Girilen ham gramaj hesaplanandan bu oranı (mutlak) AŞARSA uyarı çıkar. */
export const GSM_DIFF_WARN_PCT = 10;

const fmt = qtyFormatter(1);
const num = (n: number | null): string => (n == null || !Number.isFinite(n) ? "—" : fmt.format(n));

export function ItemWeavingDetails({
  form,
  itemId,
  widthVisible,
}: {
  form: UseFormReturn<ItemFormValues>;
  /** Kayıtlı kartın kimliği — yalnız düzenlemede hesap satırı istenir. */
  itemId: string | null;
  /** Mamul en alanı: Kalite Güvence ya da dokuma modülü açıkken. */
  widthVisible: boolean;
}) {
  const err = form.formState.errors;
  return (
    <section className="space-y-3 border-t pt-3" data-testid="item-weaving-details" aria-labelledby="item-measures-title">
      <h3 id="item-measures-title" className="text-sm font-medium text-muted-foreground">Ölçüler ve gramaj</h3>
      <div className={widthVisible ? "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" : "grid grid-cols-1 gap-3 sm:grid-cols-3"}>
        <FormField label="Ham en (cm)" htmlFor="rawWidthCm" error={err.rawWidthCm} info="Tezgâhtan çıkan (terbiye öncesi) kumaşın eni.">
          <Input id="rawWidthCm" inputMode="decimal" placeholder="ör. 300" {...form.register("rawWidthCm")} />
        </FormField>
        {/* K4P: ürün kartı eni (= mamul en, dokuma.md) — muayene puan/100 m² kaynağı #1; iki modül de kapalıyken alan yok. */}
        {widthVisible && (
          <FormField label="Mamul en (cm)" htmlFor="widthCm" error={err.widthCm} info="Bitmiş kumaşın eni (satış eni). 4 puan muayenesinde puan/100 m² bu enden hesaplanır (boşsa KK1'de ölçülen en); ham en ile birlikte en çekmesini (terbiyede) verir.">
            <Input id="widthCm" inputMode="decimal" placeholder="ör. 280" {...form.register("widthCm")} />
          </FormField>
        )}
        <FormField label="Ham gramaj (g/m²)" htmlFor="rawGsm" error={err.rawGsm}>
          <Input id="rawGsm" inputMode="decimal" placeholder="ör. 85" {...form.register("rawGsm")} />
        </FormField>
        <FormField label="Mamul gramaj (g/m²)" htmlFor="finishedGsm" error={err.finishedGsm}>
          <Input id="finishedGsm" inputMode="decimal" placeholder="ör. 90" {...form.register("finishedGsm")} />
        </FormField>
      </div>
      {itemId && <ComputedGsmRow itemId={itemId} />}
    </section>
  );
}

function ComputedGsmRow({ itemId }: { itemId: string }) {
  const q = useQuery({
    queryKey: ["item-computed-gsm", itemId],
    queryFn: () => itemService.computedGsm(itemId),
    retry: false,
    staleTime: 0,
  });
  const data = q.isSuccess ? q.data : null;
  return (
    <>
      <WidthDerivedView data={data} />
      <ComputedGsmView data={data} />
    </>
  );
}

/** Kayıtlı enlerden türetilenler — metretül (g/mt), en çekmesi, en sırası uyarısı. Sayılar SUNUCUDAN; bilinmeyen "—". */
export function WidthDerivedView({ data }: { data: ItemComputedGsm | null | undefined }) {
  if (!data) return null;
  const known = (n: number | null | undefined): n is number => n != null && Number.isFinite(n);
  const hasAny = known(data.rawGPerMt) || known(data.finishedGPerMt) || known(data.widthShrinkPct);
  const warnings = data.widthWarnings ?? [];
  if (!hasAny && warnings.length === 0) return null;
  return (
    <div className="space-y-2">
      {hasAny && (
        <p className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground tabular-nums" data-testid="item-width-derived">
          Metretül: ham {num(data.rawGPerMt ?? null)} g/mt · mamul {num(data.finishedGPerMt ?? null)} g/mt
          {known(data.widthShrinkPct) && <> · <span className="font-medium text-foreground">En çekmesi (terbiyede) %{num(data.widthShrinkPct)}</span></>}
          <InfoPopover label="Metretül ve en çekmesi" desc="Kayıtlı değerlerden: g/mt = g/m² × en (m) — ham gramaj için ham en, mamul gramaj için mamul en. En çekmesi = (ham en − mamul en) ÷ ham en. Değiştirdiğiniz değerler kaydedince yansır." />
        </p>
      )}
      {warnings.map((w) => <Callout key={w.code} tone="warning">{w.message}</Callout>)}
    </div>
  );
}

/** Saf görünüm: `gsm` bilinmiyorsa hiçbir şey çizmez. */
export function ComputedGsmView({ data }: { data: ItemComputedGsm | null | undefined }) {
  if (!data || data.gsm == null || !Number.isFinite(data.gsm)) return null;
  const diff = data.diffPct;
  const warn = diff != null && Number.isFinite(diff) && Math.abs(diff) > GSM_DIFF_WARN_PCT;
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground tabular-nums" data-testid="item-computed-gsm">
        Hesaplanan metretül ağırlığı: çözgü {num(data.warpGPerM)} · atkı {num(data.weftGPerM)} · toplam {num(data.totalGPerM)} g/mt · gramaj{" "}
        <span className="font-medium text-foreground">{num(data.gsm)} g/m²</span>
      </p>
      {warn && (
        <Callout tone="warning">Girilen gramaj hesaplanandan %{num(Math.abs(diff))} farklı</Callout>
      )}
    </div>
  );
}
