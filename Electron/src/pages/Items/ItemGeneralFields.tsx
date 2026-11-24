// Ürün penceresi > Genel: ad · tip · birim · (iplikte denye/birim/fire) · (kumaşta en) · izinli renk/özellik · dokuma ayrıntıları ·
// stok kodu. Çözgü/atkı/örgü kendi sekmelerinde (B19). Sıra bilinçli: ÖNCE ad; stok kodu EN ALTTA kapalı satır (2026-08-17).
import { useMemo } from "react";
import { Controller, type UseFormReturn } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { Palette, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/forms/FormField";
import { EnumSelect } from "@/components/forms/EnumSelect";
import { SimilarNamesWarning } from "@/components/forms/SimilarNamesWarning";
import { ItemType, itemTypeLabels, productItemTypeLabels, type ProductItemType } from "@/types/enums";
import { colorService } from "@/pages/Colors/service";
import { fabricPropertyService } from "@/pages/FabricProperties/service";
import { loadAllForPicker } from "@/lib/picker-loader";
import type { Item } from "./types";
import type { ItemFormValues } from "./schema";
import { ItemYarnWasteField } from "./ItemYarnWasteField";
import { ItemYarnFields } from "./ItemYarnFields";
import { ItemWeavingDetails } from "./ItemWeavingDetails";
import { PickerTrigger, StockCodeRow } from "./ItemFormParts";

interface Props {
  form: UseFormReturn<ItemFormValues>;
  open: boolean;
  initial: Item | null | undefined;
  derivedUnit: string;
  kaliteGuvenceEnabled: boolean;
  yarnWasteVisible: boolean;
  carriesLists: boolean;
  staleLists: boolean;
  hasSavedWeavingValues: boolean;
  manualCode: boolean;
  onManualCodeChange: (next: boolean) => void;
  onOpenColors: () => void;
  onOpenProps: () => void;
}

export function ItemGeneralFields(p: Props) {
  const { form, initial } = p;
  const isEdit = Boolean(initial);
  const itemType = form.watch("itemType");
  const allowedColorIds = form.watch("allowedColorIds");
  const allowedPropertyIds = form.watch("allowedPropertyIds");
  const errors = form.formState.errors;
  // Trigger önizlemesi için seçili kayıtların isim/swatch'ini getir.
  const colorsQ = useQuery({
    queryKey: ["colors", "all-active"],
    queryFn: () => loadAllForPicker(colorService, { sortBy: "name", sortOrder: "asc", filters: { isActive: "true" } }),
    staleTime: 60_000,
    enabled: p.open,
  });
  const propsQ = useQuery({
    queryKey: ["fabric-properties", "all-active"],
    queryFn: () => loadAllForPicker(fabricPropertyService, { sortBy: "sortOrder", sortOrder: "asc", filters: { isActive: "true" } }),
    staleTime: 60_000,
    enabled: p.open,
  });
  const selectedColors = useMemo(() => {
    const all = colorsQ.data?.data ?? [];
    return allowedColorIds.map((id) => all.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => Boolean(c));
  }, [allowedColorIds, colorsQ.data?.data]);
  const selectedProperties = useMemo(() => {
    const all = propsQ.data?.data ?? [];
    return allowedPropertyIds.map((id) => all.find((x) => x.id === id)).filter((x): x is NonNullable<typeof x> => Boolean(x));
  }, [allowedPropertyIds, propsQ.data?.data]);
  const fabricWidth = itemType === ItemType.FABRIC && p.kaliteGuvenceEnabled;

  return (
    <>
      {/* Geniş form (2026-11-19): kısa alanlar tek ızgarada yan yana; uzun açıklamalar ⓘ balonunda. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label="Ad" htmlFor="name" error={errors.name} required className={fabricWidth ? "sm:col-span-2 lg:col-span-1" : "sm:col-span-2"}>
          <Input id="name" placeholder="Patos" {...form.register("name")} />
          {/* Canlı veride "ACTIVO" ve "ACTİVO" iki ayrı kumaş olarak duruyordu (i/İ tuzağı) — uyarı yazarken görünsün. */}
          <SimilarNamesWarning entity="items" name={form.watch("name") ?? ""} excludeId={initial?.id} />
        </FormField>
        <FormField label="Tip" error={errors.itemType} required={!isEdit} info={isEdit ? "Tip kayıttan sonra değiştirilemez." : undefined}>
          <Controller
            control={form.control}
            name="itemType"
            render={({ field }) => (
              <EnumSelect<ProductItemType> value={field.value} onChange={field.onChange} labels={productItemTypeLabels} disabled={isEdit} />
            )}
          />
        </FormField>
        <FormField label="Birim" info="Seçilen tipe göre otomatik atanır.">
          <Input value={p.derivedUnit} readOnly tabIndex={-1} className="bg-muted font-mono text-center cursor-not-allowed" />
        </FormField>
        {/* Denye + satın alma birimi yalnız iplikte (SY-a); zorunlu DEĞİL — çözgü/atkı kartı açarken sunucu anlaşılır 400 verir. */}
        {itemType === ItemType.YARN && <ItemYarnFields form={form} />}
        {p.yarnWasteVisible && <ItemYarnWasteField form={form} />}
        {/* K4P: ürün kartı eni — muayene puan/100 m² kaynağı #1; modül kapalıyken alan hiç yok (bugünkü form). */}
        {fabricWidth && (
          <FormField label="En (cm)" htmlFor="widthCm" error={errors.widthCm} info="4 puan muayenesinde puan/100 m² bu enden hesaplanır; boşsa KK1'de ölçülen en kullanılır">
            <Input id="widthCm" inputMode="decimal" placeholder="280" {...form.register("widthCm")} />
          </FormField>
        )}
      </div>

      {p.carriesLists && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="İzinli Renkler">
            <PickerTrigger
              icon={<Palette className="h-4 w-4 text-muted-foreground" />}
              count={allowedColorIds.length}
              emptyText="Tüm aktif renkler serbest"
              previews={selectedColors.slice(0, 6).map((c) => ({ key: c.id, label: c.name, swatch: c.hex ?? null }))}
              extra={selectedColors.length - 6}
              onClick={p.onOpenColors}
            />
          </FormField>
          <FormField label="İzinli Özellikler">
            <PickerTrigger
              icon={<Sparkles className="h-4 w-4 text-muted-foreground" />}
              count={allowedPropertyIds.length}
              emptyText="Tüm aktif özellikler serbest"
              previews={selectedProperties.slice(0, 6).map((x) => ({ key: x.id, label: x.name, swatch: x.color ?? null }))}
              extra={selectedProperties.length - 6}
              onClick={p.onOpenProps}
            />
          </FormField>
        </div>
      )}

      {p.staleLists && (
        <p role="note" className="text-xs text-amber-700 dark:text-amber-300">
          {itemTypeLabels[itemType]} kartında renk/özellik listesi tutulmaz, kaydedince kaldırılır.
        </p>
      )}

      {/* Az kullanılan dokuma alanları katlanır bölümde, kapalı gelir (dolu değer varsa açık). */}
      {itemType === ItemType.FABRIC && <ItemWeavingDetails form={form} itemId={initial?.id ?? null} hasSavedValues={p.hasSavedWeavingValues} />}

      <StockCodeRow
        isEdit={isEdit}
        code={initial?.code ?? null}
        manual={p.manualCode}
        onManualChange={p.onManualCodeChange}
        error={errors.code}
        register={form.register}
      />
    </>
  );
}
