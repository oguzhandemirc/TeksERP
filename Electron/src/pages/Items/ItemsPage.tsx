import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CrudPage } from "@/components/layout/CrudPage";
import { SelectChip } from "@/components/data-table/filter-row/SelectChip";
import { ITEM_CATALOG_HINT } from "@/components/forms/itemPicker";
import { useItemPickerCatalogs } from "@/components/forms/useItemPickerData";
import { itemColumns } from "./columns";
import { itemService } from "./service";
import { ItemFormDialog } from "./ItemFormDialog";
import { ItemLifecycleDialog } from "./ItemLifecycleDialog";
import {
  ITEM_FILTER_ALL,
  ITEM_STATUS_DEFAULT,
  ITEM_STATUS_OPTIONS,
  ITEM_STATUS_PARAM,
  ITEM_URL_FILTERS,
  ITEM_CATALOG_KEYS,
  itemCatalogAxisApplies,
  itemCatalogFilterDefs,
  itemTypeChangeParams,
  itemListFilters,
  itemUrlFilterParam,
  parseItemStatus,
  type ItemStatusFilter,
  type ItemUrlFilterDef,
} from "./itemsFilters";
import type { Item } from "./types";
import { useFabricTypeFilter } from "./useFabricTypeFilter";

// "Ürün Kartları": aynı `Item` tablosunda kumaş · iplik · sarf birlikte (hizmet kartı ayrı tablo); sayfa adı
// tür ayrımını taşımaz, tür alanı/süzgeci taşır. Süzgeç planı `itemsFilters.ts`.
export function ItemsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const status = parseItemStatus(searchParams.get(ITEM_STATUS_PARAM));
  const extraFilters = useMemo(() => itemListFilters(status, searchParams), [status, searchParams]);
  const [lifecycleItem, setLifecycleItem] = useState<Item | null>(null);
  // Renk/Özellik kataloğu ürün seçici modalıyla aynı sorgu anahtarından (tek yükleyici).
  const catalogFilters = itemCatalogFilterDefs(useItemPickerCatalogs(true));
  // Renk ekseni yalnız Kumaş/Tümü (modalla aynı yüklem). Paylaşılan bağlantı iplik + renk taşıyorsa
  // renk anahtarı sessizce sunucuya gitmesin: eksen kapalıyken URL'den düşürülür.
  const colorAxis = itemCatalogAxisApplies(searchParams);
  const fabricTypeFilter = useFabricTypeFilter(); // K8: kumaş ekseni (Kumaş/Tümü), tür değişince URL'den düşer

  useEffect(() => {
    if (colorAxis || !ITEM_CATALOG_KEYS.some((k) => searchParams.has(itemUrlFilterParam(k)))) return;
    const next = new URLSearchParams(searchParams);
    for (const k of ITEM_CATALOG_KEYS) next.delete(itemUrlFilterParam(k));
    setSearchParams(next, { replace: true });
  }, [colorAxis, searchParams, setSearchParams]);
  const setParam = (name: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (value === null) next.delete(name);
    else next.set(name, value);
    setSearchParams(next, { replace: true });
  };
  /** URL `filter[key]` ile bağlı seçici; "Tümü" = anahtar silinir, sunucuya gitmez. */
  // Seçenek listesi "Tümü"yü (ALL) zaten taşır → `resetValue` ALL; ✕ da ALL'a döner.
  const setUrlFilter = (key: ItemUrlFilterDef["key"], v: string) =>
    key === "itemType" ? setSearchParams(itemTypeChangeParams(searchParams, v), { replace: true }) : setParam(itemUrlFilterParam(key), v === ITEM_FILTER_ALL ? null : v);
  const urlSelect = (f: ItemUrlFilterDef, title?: string) => (
    <span key={f.key} title={title} className="contents">
      <SelectChip id={`item-${f.key}`} label={f.label} options={f.options} resetValue={ITEM_FILTER_ALL} value={searchParams.get(itemUrlFilterParam(f.key)) ?? ITEM_FILTER_ALL} onChange={(v) => setUrlFilter(f.key, v ?? ITEM_FILTER_ALL)} />
    </span>
  );
  return (
    <>
    <CrudPage<Item>
      title="Ürün Kartları"
      description="Ürün kataloğu (kumaş · iplik · sarf) — renk kartelası ve uygulanabilir özellik listesi opsiyoneldir. Hizmetler kendi ekranındadır (Tanımlar › Hizmet Kartları)."
      entityName="Ürün"
      mergeEntity="item"
      importEntity="item"
      queryKey="items"
      service={itemService}
      columns={itemColumns}
      writePermission="item:write"
      searchHint="Kod veya ad"
      inactiveToggle={false}
      extraFilters={extraFilters}
      onRemove={setLifecycleItem}
      removeLabel="Kullanımdan kaldır"
      onRestore={setLifecycleItem}
      restoreLabel="Yeniden kullanıma al"
      filterBar={
        <>
          {/* Sıra kullanıcı listesi: Tür · Durum · Birim · Renk · Özellik. */}
          {urlSelect(ITEM_URL_FILTERS[0]!)}
          <SelectChip<ItemStatusFilter>
            id="item-status"
            label="Durum"
            options={ITEM_STATUS_OPTIONS}
            resetValue={ITEM_STATUS_DEFAULT}
            value={status}
            onChange={(v) => setParam(ITEM_STATUS_PARAM, v === null || v === ITEM_STATUS_DEFAULT ? null : v)}
          />
          {urlSelect(ITEM_URL_FILTERS[1]!)}
          {colorAxis && fabricTypeFilter && urlSelect(fabricTypeFilter)}
          {colorAxis && catalogFilters.map((f) => (f.options === null ? null : urlSelect({ ...f, options: f.options }, ITEM_CATALOG_HINT)))}
        </>
      }
      renderForm={({ open, onOpenChange, initial, onSubmit, isSubmitting }) => (
        <ItemFormDialog
          open={open}
          onOpenChange={onOpenChange}
          initial={initial}
          isSubmitting={isSubmitting}
          onSubmit={(payload) => onSubmit(payload as unknown as Partial<Item>)}
        />
      )}
    />
    {lifecycleItem && <ItemLifecycleDialog item={lifecycleItem} onClose={() => setLifecycleItem(null)} />}
    </>
  );
}
