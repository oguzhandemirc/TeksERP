// Ürün penceresi > Genel: ad · tip · birim (sarfta seçilir) · (iplikte numara/alım birimi/fire/filament/kat/büküm/parlaklık) ·
// (kumaşta tür/yanmazlık/kompozisyon) · renkler/özellikler · ölçüler ve gramaj · top ve sipariş · (iplik/sarf) stok · stok kodu. Çözgü/atkı/desen kendi sekmelerinde (B19). Sıra bilinçli: ÖNCE ad; stok kodu EN ALTTA kapalı satır (2026-08-17).
import { useMemo } from "react";
import { Controller, type UseFormReturn } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { Palette, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/forms/FormField";
import { EnumSelect } from "@/components/forms/EnumSelect";
import { SimilarNamesWarning } from "@/components/forms/SimilarNamesWarning";
import { ItemType, itemTypeLabels, type ProductItemType } from "@/types/enums";
import { colorService } from "@/pages/Colors/service";
import { fabricPropertyService } from "@/pages/FabricProperties/service";
import { loadAllForPicker } from "@/lib/picker-loader";
import type { Item } from "./types";
import type { ItemFormValues } from "./schema";
import { ItemYarnWasteField } from "./ItemYarnWasteField";
import { ItemYarnFields } from "./ItemYarnFields";
import { ItemWeavingDetails } from "./ItemWeavingDetails";
import { LockedValue, PickerTrigger, StockCodeRow } from "./ItemFormParts";
import { ItemFabricTradeSection, ItemMinStockSection, ItemUnitField, ItemYarnSpecFields } from "./ItemCardExtraFields";
import { carriesMinStock } from "./cardExtra.payload";
import { FabricClassFields } from "./FabricClassFields";
import { ItemCompositionField } from "./ItemCompositionField";
import { ItemFiberFields } from "./ItemFiberFields";
import { itemTypeScope } from "./itemTypeScope";

interface Props {
  form: UseFormReturn<ItemFormValues>;
  open: boolean;
  initial: Item | null | undefined;
  allowedTypes?: readonly ItemType[];
  derivedUnit: string;
  /** Mamul en alanı: Kalite Güvence ya da dokuma modülü açıkken. */
  widthVisible: boolean;
  yarnWasteVisible: boolean;
  carriesLists: boolean;
  staleLists: boolean;
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
  const typeScope = itemTypeScope(isEdit ? null : p.allowedTypes);
  const typeLocked = isEdit || typeScope.locked;

  return (
    <>
      {/* Geniş form (2026-11-19): kısa alanlar tek ızgarada yan yana; uzun açıklamalar ⓘ balonunda.
          Üretim tekniği çizilmez: kullanılabilir tek teknik Dokuma (K10; Örme K12 bekliyor), kumaş sunucuda Dokuma doğar. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label="Ad" htmlFor="name" error={errors.name} required className="sm:col-span-2">
          <Input id="name" placeholder="ör. Patos" {...form.register("name")} />
          {/* Canlı veride "ACTIVO" ve "ACTİVO" iki ayrı kumaş olarak duruyordu (i/İ tuzağı) — uyarı yazarken görünsün. */}
          <SimilarNamesWarning entity="items" name={form.watch("name") ?? ""} excludeId={initial?.id} />
        </FormField>
        <FormField label="Tip" htmlFor={typeLocked ? "itemTypeLocked" : undefined} error={errors.itemType} required={!typeLocked} info={isEdit ? "Tip kayıttan sonra değiştirilemez." : typeScope.info}>
          {typeLocked ? (
            <LockedValue id="itemTypeLocked" text={itemTypeLabels[itemType]} />
          ) : (
            <Controller
              control={form.control}
              name="itemType"
              render={({ field }) => <EnumSelect<ProductItemType> value={field.value} onChange={field.onChange} labels={typeScope.labels} />}
            />
          )}
        </FormField>
        <ItemUnitField form={form} derivedUnit={p.derivedUnit} />
        {itemType === ItemType.FABRIC && <FabricClassFields form={form} />}
        {/* Denye + alım birimi yalnız iplikte (SY-a); zorunlu DEĞİL — çözgü/atkı kartı açarken sunucu anlaşılır 400 verir. */}
        {itemType === ItemType.YARN && <ItemYarnFields form={form} />}
        {p.yarnWasteVisible && <ItemYarnWasteField form={form} />}
        {itemType === ItemType.YARN && <ItemYarnSpecFields form={form} />}
        {itemType === ItemType.FABRIC && <div className="sm:col-span-2"><ItemCompositionField form={form} itemId={initial?.id ?? null} /></div>}
      </div>
      {itemType === ItemType.YARN && <ItemFiberFields form={form} />}

      {p.carriesLists && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Renkler (kartela)" info="Bu kumaş için seçilebilir renkler. Boş bırakılırsa bütün aktif renkler serbest. (Eski adı: İzinli Renkler)">
            <PickerTrigger
              icon={<Palette className="h-4 w-4 text-muted-foreground" />}
              count={allowedColorIds.length}
              emptyText="Tüm aktif renkler serbest"
              previews={selectedColors.slice(0, 6).map((c) => ({ key: c.id, label: c.name, swatch: c.hex ?? null }))}
              extra={selectedColors.length - 6}
              onClick={p.onOpenColors}
            />
          </FormField>
          <FormField label="Uygulanabilir özellikler" info="Bu kumaşa uygulanabilecek özellikler. Boş bırakılırsa bütün aktif özellikler serbest. (Eski adı: İzinli Özellikler)">
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

      {/* K2/K3: en ve gramaj kumaşın günlük bilgisi — tek bölüm, açık. */}
      {itemType === ItemType.FABRIC && <ItemWeavingDetails form={form} itemId={initial?.id ?? null} widthVisible={p.widthVisible} />}
      {itemType === ItemType.FABRIC && <ItemFabricTradeSection form={form} unit={p.derivedUnit} />}
      {carriesMinStock(itemType) && <ItemMinStockSection form={form} unit={form.watch("unit")} saved={initial} />}

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
