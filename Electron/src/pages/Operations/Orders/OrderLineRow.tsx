// =============================================================================
// SİPARİŞ KALEMİ SATIRI — GRID (⑤): # · Kumaş · Renk · Miktar+Birim · En · [Fiyat] · sil; alt satırda
// Yeni Kumaş · Özellik isteği · Not ekle · alias · ATP. Kumaş uyarısı GEÇİCİ (③): kumaşsız renk/özellik/submit
// → kumaş seçiciye amber halka + `role="status"` "Önce kumaş seçin", 3 s sonra söner (`useTransientFlag`).
// =============================================================================
import { Trash2, PackagePlus, Package, StickyNote, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ItemSelect } from "@/components/forms/ItemSelect";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { pickableLifecycle } from "@/lib/item-lifecycle";
import type { AllowedItemTypes } from "@/components/forms/itemPicker";
import { cn } from "@/lib/utils";
import { LineRequiredPropertiesEditor } from "./LineRequiredPropertiesEditor";
import { OrderLineColorPicker } from "./OrderLineColorPicker";
import { OrderLineAliasFields } from "./OrderLineAliasFields";
import { OrderLineAtpHint } from "./OrderLineAtpHint";
import { OrderLinePriceField } from "./OrderLinePriceField";
import { OrderLineQuantityField } from "./OrderLineQuantityField";
import { PhaseOutLineNote } from "./PhaseOutLineNote";
import type { OrderLineFormValues } from "./schema";

export const ITEM_WARNING_TEXT = "Önce kumaş seçin";
/** Satış siparişi kalemi yalnız KUMAŞ alır (Tür seçicisi kilitli ve gizli). */
const ORDER_LINE_ITEM_TYPES: AllowedItemTypes = ["FABRIC"];

/** Grid şablonu — başlık satırı ve her kalem satırı AYNI şablonu okur; ≤ lg iki sütuna sarar. */
export function lineGridCols(pricing: boolean): string {
  return pricing
    ? "grid grid-cols-2 gap-2 lg:grid-cols-[2rem_minmax(0,2fr)_minmax(0,1.3fr)_11rem_6.5rem_8rem_2.5rem]"
    : "grid grid-cols-2 gap-2 lg:grid-cols-[2rem_minmax(0,2fr)_minmax(0,1.3fr)_11rem_6.5rem_2.5rem]";
}
export const LINE_HEADERS = { base: ["#", "Kumaş", "Renk", "Miktar", "En (cm)"], price: "Birim fiyat" } as const;

export interface OrderLineRowProps {
  line: OrderLineFormValues;
  index: number;
  pricingEnabled: boolean;
  customerId: string | null;
  currency: string | null;
  itemError?: string;
  quantityError?: string;
  /** ③ Bu satırın kumaş uyarısı yanıyor mu (editörün geçici bayrağı). */
  itemWarning: boolean;
  onWarnItem: () => void;
  pulseClass: (active: boolean) => string;
  noteOpen: boolean;
  onOpenNote: () => void;
  onCloseNote: () => void;
  onQuickAddItem: () => void;
  onPatch: (patch: Partial<OrderLineFormValues>) => void;
  onRemove: () => void;
}

export function OrderLineRow(p: OrderLineRowProps) {
  const { line, index, pricingEnabled, customerId, currency, itemError, quantityError, itemWarning, onWarnItem, pulseClass, onPatch } = p;
  const cols = lineGridCols(pricingEnabled);
  // Yeni satırda seçilebilir kartlar "Yeni sipariş" ayarından (§4.1); sunucu kayıtta yine karar verir.
  const lifecycle = pickableLifecycle("order", useFeatureFlags().data?.data);
  return (
    <li className="rounded-md border p-2" data-testid="order-line">
      <div className={cols}>
        <Badge variant="muted" className="mt-1.5 h-6 w-6 justify-center font-mono lg:mt-0">
          {index + 1}
        </Badge>
        <div className="min-w-0 space-y-1">
          {/* Ürün seçici MODALI (v3 kalıbı, 2026-09-17 EK 1): kapsam yalnız KUMAŞ (Tür seçicisi çizilmez), Renk/Özellik süzgeci
              kalır; kumaş değişince renk/özellik/birim sıfırlama davranışı aynen. */}
          <ItemSelect
            value={line.itemId || null}
            onChange={(v) => onPatch({ itemId: v ?? "", colorId: null, requiredPropertyIds: [], unit: undefined })}
            allowedTypes={ORDER_LINE_ITEM_TYPES}
            lifecycle={lifecycle}
            aria-label="Kumaş seç"
            placeholder="Kumaş seç..."
            triggerClassName={cn("h-9", itemError && "border-destructive", itemWarning ? "ring-2 ring-amber-500 ring-offset-1" : pulseClass(!line.itemId))}
          />
          {/* ③ Geçici uyarı: yanınca görünür, 3 s sonra söner; submit'in zod hatası da aynı görünümle */}
          <p role="status" aria-live="polite" className={cn("text-xs text-amber-700 transition-opacity duration-300 dark:text-amber-400", itemWarning ? "opacity-100" : "sr-only opacity-0")}>
            {itemWarning ? ITEM_WARNING_TEXT : ""}
          </p>
          <PhaseOutLineNote itemId={line.itemId || null} />
        </div>
        <div className="relative z-10 min-w-0">
          <OrderLineColorPicker
            itemId={line.itemId}
            value={line.colorId ?? null}
            customerId={customerId}
            onChange={(v) => onPatch({ colorId: v })}
            onMissingItem={onWarnItem}
            triggerClassName={`h-9 ${pulseClass(Boolean(line.itemId && !line.colorId))}`}
          />
        </div>
        <OrderLineQuantityField
          itemId={line.itemId}
          quantity={line.quantity}
          unit={line.unit}
          onQuantity={(q) => onPatch({ quantity: q })}
          onUnit={(u) => onPatch({ unit: u })}
          error={quantityError}
          className={quantityError ? "" : pulseClass(Boolean(line.itemId && !line.quantity))}
        />
        <Input
          className={cn("text-sm", pulseClass(Boolean(line.itemId && !line.width)))}
          type="number"
          step="0.1"
          min={0}
          placeholder="En (cm)"
          aria-label="En (cm)"
          value={line.width ?? ""}
          onChange={(e) => onPatch({ width: e.target.value === "" ? null : Number(e.target.value) })}
        />
        {pricingEnabled && <OrderLinePriceField line={line} customerId={customerId} currency={currency} onPatch={onPatch} />}
        <Button type="button" size="icon" variant="ghost" className="h-9 w-9 justify-self-end text-destructive" onClick={p.onRemove} aria-label="Sil">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <OrderLineExtras {...p} />
    </li>
  );
}

/** Alt satır: hızlı eylemler + alias + ATP + kesim notu — ana grid'in altında, ikon + kısa metin. */
function OrderLineExtras(p: OrderLineRowProps) {
  const { line, customerId, onWarnItem, onPatch } = p;
  return (
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 pl-0 lg:pl-10">
        <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={p.onQuickAddItem}>
          <PackagePlus className="h-3.5 w-3.5" /> Yeni Kumaş
        </Button>
        <LineRequiredPropertiesEditor
          itemId={line.itemId}
          value={line.requiredPropertyIds ?? []}
          onChange={(ids) => onPatch({ requiredPropertyIds: ids })}
          onMissingItem={onWarnItem}
          extraAction={
            !p.noteOpen ? (
              <Button type="button" size="sm" variant="outline" onClick={p.onOpenNote} className="h-7 gap-1 border-amber-300 bg-amber-50 text-xs text-amber-700 hover:bg-amber-100 hover:text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/50">
                <StickyNote className="h-3.5 w-3.5" /> Not ekle
              </Button>
            ) : null
          }
        />
        <div className="basis-full">
          <OrderLineAliasFields customerId={customerId} itemId={line.itemId} colorId={line.colorId ?? null} itemName={line.customerItemName ?? ""} colorName={line.customerColorName ?? ""} onChange={(patch) => onPatch(patch)} />
        </div>
        <div className="basis-full">
          <OrderLineAtpHint itemId={line.itemId} colorId={line.colorId ?? null} width={line.width ?? null} />
        </div>
        {p.noteOpen && (
          <div className="flex basis-full items-center gap-1.5">
            <Input autoFocus className="flex-1 text-sm" placeholder="Kesim notu (ops.) — örn: 3 parça 200+200+100 m" value={line.cutNote ?? ""} onChange={(e) => onPatch({ cutNote: e.target.value })} />
            <Button type="button" size="icon" variant="ghost" className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive" onClick={p.onCloseNote} aria-label="Notu kaldır">
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
  );
}
