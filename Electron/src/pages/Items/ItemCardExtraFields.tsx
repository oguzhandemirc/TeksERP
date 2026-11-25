// =============================================================================
// ÜRÜN FORMU — D4b alanları (Seyitoğlu ürün kartı denetimi, 2026-11-25)
// =============================================================================
// Birim (sarfta seçilir, K9) · iplik teknik alanları (Genel ızgarasında, iplik bilgilerinin yanında) ·
// kumaş "Top ve sipariş" bölümü (ölçüler ve gramajın altında) · iplik/sarf "Stok" bölümü. Hepsi isteğe bağlı.
// =============================================================================
import { Controller, type UseFormReturn } from "react-hook-form";
import { FormField } from "@/components/forms/FormField";
import { EnumSelect } from "@/components/forms/EnumSelect";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ItemType } from "@/types/enums";
import { unitLabel } from "@/lib/item-unit";
import type { ItemFormValues } from "./schema";
import { LockedValue } from "./ItemFormParts";
import { LUSTER_OPTIONS, TWIST_OPTIONS } from "./cardExtra.schema";

type Form = UseFormReturn<ItemFormValues>;

const CONSUMABLE_UNIT_LABELS = { ADET: "Adet", KG: "Kilogram (kg)", MT: "Metre (m)" } as const;
type ConsumableUnit = keyof typeof CONSUMABLE_UNIT_LABELS;

/** Birim: sarfta seçilir (boya/kimyasal kg, şerit/bant metre, ambalaj adet); kumaş ve iplikte tipten türer, kilitli. */
export function ItemUnitField({ form, derivedUnit }: { form: Form; derivedUnit: string }) {
  if (form.watch("itemType") !== ItemType.CONSUMABLE) {
    return (
      <FormField label="Birim" htmlFor="itemUnitLocked" info="Seçilen tipe göre otomatik atanır.">
        <LockedValue id="itemUnitLocked" text={unitLabel(derivedUnit)} />
      </FormField>
    );
  }
  return (
    <FormField
      label="Birim"
      htmlFor="itemUnit"
      error={form.formState.errors.unit}
      info="Sarfın stokta ve tüketimde sayıldığı birim: boya/kimyasal kg, şerit/bant metre, ambalaj adet. Stok hareketi ya da tüketim normu oluştuktan sonra değiştirilemez."
    >
      <Controller
        control={form.control}
        name="unit"
        render={({ field }) => (
          <EnumSelect<ConsumableUnit> id="itemUnit" value={field.value as ConsumableUnit} onChange={field.onChange} labels={CONSUMABLE_UNIT_LABELS} />
        )}
      />
    </FormField>
  );
}

type TwistKey = "UNSET" | (typeof TWIST_OPTIONS)[number]["value"];
type LusterKey = "UNSET" | (typeof LUSTER_OPTIONS)[number]["value"];
const TWIST_LABELS = { UNSET: "Belirtilmemiş", ...Object.fromEntries(TWIST_OPTIONS.map((o) => [o.value, o.label])) } as Record<TwistKey, string>;
const LUSTER_LABELS = { UNSET: "Belirtilmemiş", ...Object.fromEntries(LUSTER_OPTIONS.map((o) => [o.value, o.label])) } as Record<LusterKey, string>;

/** İplik teknik alanları — Genel ızgarasında hücre hücre (fragment); bugün iplik adına gömülü bilgiler. */
export function ItemYarnSpecFields({ form }: { form: Form }) {
  const err = form.formState.errors;
  return (
    <>
      <FormField label="Filament sayısı" htmlFor="yarnFilamentCount" error={err.yarnFilamentCount} info="İpliği oluşturan lif (filament) sayısı; '68/24' yazımında 24. Boş bırakılabilir.">
        <Input id="yarnFilamentCount" inputMode="numeric" placeholder="ör. 24" {...form.register("yarnFilamentCount")} />
      </FormField>
      <FormField label="Kat" htmlFor="yarnPly" error={err.yarnPly} info="Kaç ipliğin katlanarak birleştirildiği (tek kat = 1, iki katlı = 2).">
        <Input id="yarnPly" inputMode="numeric" placeholder="ör. 2" {...form.register("yarnPly")} />
      </FormField>
      <FormField label="Büküm (tur/m)" htmlFor="yarnTwistTpm" error={err.yarnTwistTpm} info="Metre başına büküm turu (TPM). Bükümsüz (flat) iplikte 0 yazılır; bilinmiyorsa boş bırakın.">
        <Input id="yarnTwistTpm" inputMode="numeric" placeholder="ör. 800" {...form.register("yarnTwistTpm")} />
      </FormField>
      <FormField label="Büküm yönü" error={err.yarnTwistDirection} info="S büküm (sola) ya da Z büküm (sağa). Boş = belirtilmemiş.">
        <Controller
          control={form.control}
          name="yarnTwistDirection"
          render={({ field }) => (
            <EnumSelect<TwistKey> value={(field.value || "UNSET") as TwistKey} onChange={(v) => field.onChange(v === "UNSET" ? "" : v)} labels={TWIST_LABELS} />
          )}
        />
      </FormField>
      <FormField label="Parlaklık" error={err.yarnLuster} info="Parlak, yarı mat ya da mat. Boş = belirtilmemiş.">
        <Controller
          control={form.control}
          name="yarnLuster"
          render={({ field }) => (
            <EnumSelect<LusterKey> value={(field.value || "UNSET") as LusterKey} onChange={(v) => field.onChange(v === "UNSET" ? "" : v)} labels={LUSTER_LABELS} />
          )}
        />
      </FormField>
    </>
  );
}

/** Kumaş "Top ve sipariş" bölümü — standart top boyu, asgari sipariş (kartın biriminde), bakım talimatı. */
export function ItemFabricTradeSection({ form, unit }: { form: Form; unit: string }) {
  const err = form.formState.errors;
  return (
    <section className="space-y-3 border-t pt-3" aria-labelledby="item-trade-title">
      <h3 id="item-trade-title" className="text-sm font-medium text-muted-foreground">Top ve sipariş</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label="Top boyu (m)" htmlFor="standardRollLengthM" error={err.standardRollLengthM} info="Bu kumaşın standart top metrajı (ör. 50 m). Sevk ve etikette referans; boş bırakılabilir.">
          <Input id="standardRollLengthM" inputMode="decimal" placeholder="ör. 50" {...form.register("standardRollLengthM")} />
        </FormField>
        <FormField label={`Asgari sipariş (${unitLabel(unit)})`} htmlFor="minOrderQty" error={err.minOrderQty} info="Bu kumaş için kabul edilen en az sipariş miktarı (kartın biriminde). Teklif ve siparişte referans.">
          <Input id="minOrderQty" inputMode="decimal" placeholder="ör. 1000" {...form.register("minOrderQty")} />
        </FormField>
        <FormField label="Bakım talimatı" htmlFor="careInstructions" error={err.careInstructions} className="sm:col-span-2" info="Yıkama, ütü, kuru temizleme talimatı (ör. 30 °C hassas yıkama, düşük ısı ütü). Teknik föy ve müşteri etiketinde kullanılır.">
          <Textarea id="careInstructions" rows={1} maxLength={500} placeholder="ör. 30 °C hassas yıkama · düşük ısı ütü · kuru temizleme yapılabilir" {...form.register("careInstructions")} />
        </FormField>
      </div>
    </section>
  );
}

/** İplik/sarf "Stok" bölümü — asgari stok (kartın biriminde); boş = uyarı yok. */
export function ItemMinStockSection({ form, unit }: { form: Form; unit: string }) {
  return (
    <section className="space-y-3 border-t pt-3" aria-labelledby="item-stock-title">
      <h3 id="item-stock-title" className="text-sm font-medium text-muted-foreground">Stok</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label={`Asgari stok (${unitLabel(unit)})`} htmlFor="minStockQty" error={form.formState.errors.minStockQty} info="Stok bu miktarın altına düşünce yeniden sipariş zamanı gelmiştir. Boş bırakılırsa eşik yok.">
          <Input id="minStockQty" inputMode="decimal" placeholder="ör. 500" {...form.register("minStockQty")} />
        </FormField>
      </div>
    </section>
  );
}
