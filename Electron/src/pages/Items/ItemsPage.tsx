import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { CrudPage } from "@/components/layout/CrudPage";
import { LabeledSelect } from "@/components/forms/LabeledSelect";
import { itemColumns } from "./columns";
import { itemService } from "./service";
import { ItemFormDialog } from "./ItemFormDialog";
import {
  ITEM_FILTER_ALL,
  ITEM_STATUS_DEFAULT,
  ITEM_STATUS_OPTIONS,
  ITEM_STATUS_PARAM,
  ITEM_URL_FILTERS,
  itemStatusFilters,
  itemUrlFilterParam,
  parseItemStatus,
  type ItemStatusFilter,
} from "./itemsFilters";
import type { Item } from "./types";

// "Ürünler" (2026-09-17): aynı `Item` tablosunda kumaş · iplik · sarf birlikte; sayfa adı
// tür ayrımını taşımaz, tür alanı/süzgeci taşır. Süzgeç planı `itemsFilters.ts`.
export function ItemsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const status = parseItemStatus(searchParams.get(ITEM_STATUS_PARAM));
  const extraFilters = useMemo(() => itemStatusFilters(status), [status]);
  const setParam = (name: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (value === null) next.delete(name);
    else next.set(name, value);
    setSearchParams(next, { replace: true });
  };
  return (
    <CrudPage<Item>
      title="Ürünler"
      description="Ürün kataloğu (kumaş · iplik · sarf) — izinli renk ve özellik listesi opsiyoneldir."
      entityName="Ürün"
      mergeEntity="item"
      importEntity="item"
      queryKey="items"
      service={itemService}
      columns={itemColumns}
      writePermission="item:write"
      searchPlaceholder="Kod veya ad ara..."
      inactiveToggle={false}
      extraFilters={extraFilters}
      filterBar={
        <>
          {ITEM_URL_FILTERS.map((f) => (
            <LabeledSelect
              key={f.key}
              label={f.label}
              options={f.options}
              value={searchParams.get(itemUrlFilterParam(f.key)) ?? ITEM_FILTER_ALL}
              onChange={(v) => setParam(itemUrlFilterParam(f.key), v === ITEM_FILTER_ALL ? null : v)}
            />
          ))}
          <LabeledSelect
            label="Durum"
            options={ITEM_STATUS_OPTIONS}
            value={status}
            onChange={(v) => setParam(ITEM_STATUS_PARAM, v === ITEM_STATUS_DEFAULT ? null : (v as ItemStatusFilter))}
          />
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
  );
}
