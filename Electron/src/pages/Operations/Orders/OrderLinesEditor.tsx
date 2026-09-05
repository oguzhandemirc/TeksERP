import { useRef, useState } from "react";
import { Plus, Trash2, PackagePlus, Package, Info, StickyNote, X } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { usePricingEnabled } from "@/hooks/usePricingEnabled";
import { useItemPriceSuggestion, describeSuggestion } from "@/hooks/useItemPriceSuggestion";
import { usePulseSync } from "@/hooks/usePulseSync";
import { itemService } from "@/pages/Items/service";
import type { Item, ItemCreatePayload } from "@/pages/Items/types";
import { ItemFormDialog } from "@/pages/Items/ItemFormDialog";
import { LineRequiredPropertiesEditor } from "./LineRequiredPropertiesEditor";
import { OrderLineColorPicker } from "./OrderLineColorPicker";
import { OrderLineAliasFields } from "./OrderLineAliasFields";
import { OrderLineAtpHint } from "./OrderLineAtpHint";
import { newLineClientId, type OrderLineFormValues } from "./schema";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type LineFieldError = { message?: string } | undefined;
type LineError = { itemId?: LineFieldError; quantity?: LineFieldError } | undefined;

/**
 * Satır hatalarının bu bileşenin OKUDUĞU dar biçimi. Dışa açık, çünkü çağıran
 * (`OrderFormDialog`) RHF'in geniş `FieldErrors` birleşimini buna daraltır —
 * `any` yerine adı olan bir hedef tipe.
 */
export type OrderLineErrors = (LineError | undefined)[] | undefined;

interface Props {
  value: OrderLineFormValues[];
  onChange: (next: OrderLineFormValues[]) => void;
  error?: string;
  lineErrors?: OrderLineErrors;
  /** Müşterinin aliası — alias suggest için; fiyat önerisinde müşteri istisnası. */
  customerId: string | null;
  /**
   * Siparişin para birimi — SATIŞ fiyat önerisinin (`resolveItemPrice` SALE)
   * anahtarı. Verilmezse (ya da serbest metinse — alan max 8 karakter serbest)
   * öneri isteği HİÇ atılmaz; fiyat alanı bugünkü gibi elle kalır.
   */
  currency?: string;
}

/**
 * Birim fiyat hücresi — kalem seçilince satış fiyatı önerisi (D2/F2).
 *
 * Ayrı bileşen, süs değil: öneri kancası satır başınadır ve kancalar `map`
 * içinde çağrılamaz. Yazma kuralı ortak saf yüklemde (`shouldApplySuggestion`):
 * boşken doldur · kullanıcının yazdığını ASLA ezme · kaynak değişince yalnız
 * bizim yazdığımız değeri tazele. `financeEnabled` kapısı kancanın içindedir —
 * fabrika görünümünde istek HİÇ atılmaz (403 üretirdi).
 */
function OrderLinePriceField({
  line, customerId, currency, onPatch,
}: {
  line: OrderLineFormValues;
  customerId: string | null;
  currency: string | null;
  onPatch: (patch: Partial<OrderLineFormValues>) => void;
}) {
  const patchRef = useRef(onPatch);
  patchRef.current = onPatch;
  const suggestion = useItemPriceSuggestion({
    itemId: line.itemId || null,
    kind: "SALE",
    currency,
    customerId,
    current: line.unitPrice ?? "",
    // Sipariş formu fiyatı STRING tutar (schema.ts) — sayı string'e çevrilir,
    // temizlik boş string yazar.
    onApply: (p) => patchRef.current({ unitPrice: p === null ? "" : String(p) }),
  });
  const helper = describeSuggestion({
    price: suggestion.price,
    source: suggestion.source,
    message: suggestion.message,
    current: line.unitPrice ?? "",
  });

  return (
    <div className="col-span-4 sm:col-span-2">
      <Input
        className="text-sm w-full"
        type="number"
        step="0.01"
        min={0}
        placeholder="Birim fiyat"
        value={line.unitPrice ?? ""}
        onChange={(e) => onPatch({ unitPrice: e.target.value })}
      />
      {helper && <p className="mt-1 text-[10px] text-muted-foreground">{helper}</p>}
    </div>
  );
}

export function OrderLinesEditor({ value, onChange, error, lineErrors, customerId, currency }: Props) {
  const qc = useQueryClient();
  const pricingEnabled = usePricingEnabled();
  const [quickAddForLine, setQuickAddForLine] = useState<string | null>(null);
  // Kesim notu varsayılan olarak GİZLİ — "Not ekle" ile açılır. Dolu notu olan
  // satır (düzenleme) otomatik açık gelir; boş nota kullanıcı el ile açmadıkça kapalı.
  const [noteOpenIds, setNoteOpenIds] = useState<Set<string>>(new Set());
  const isNoteOpen = (line: OrderLineFormValues) =>
    noteOpenIds.has(line.clientId) || Boolean(line.cutNote?.trim());
  const openNote = (clientId: string) =>
    setNoteOpenIds((prev) => new Set(prev).add(clientId));
  const closeNote = (clientId: string) => {
    updateLine(clientId, { cutNote: "" });
    setNoteOpenIds((prev) => {
      const next = new Set(prev);
      next.delete(clientId);
      return next;
    });
  };

  // Tüm pulse vurguları TEK paylaşılan saatten beslenir ([[usePulseSync]]) — modaldaki
  // her yer (müşteri seçici, kalem alanları, "Kalem Ekle" butonu) aynı hız + aynı fazda yanıp söner.
  const dim = usePulseSync();
  const breath = `transition-all duration-700 ${dim ? "opacity-50" : "opacity-100"}`;
  const pulseClass = (active: boolean) =>
    active ? `border-primary shadow-lg shadow-primary/50 ring-2 ring-primary/30 ${breath}` : "";

  const createItemMutation = useMutation({
    mutationFn: (payload: ItemCreatePayload) =>
      itemService.create(payload as unknown as Partial<Item>),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["items"] });
      const created = res.data;
      if (quickAddForLine && created?.id) {
        updateLine(quickAddForLine, { itemId: created.id });
        toast.success(`Kumaş oluşturuldu: ${created.code}`);
      }
      setQuickAddForLine(null);
    },
  });

  const updateLine = (clientId: string, patch: Partial<OrderLineFormValues>) => {
    onChange(value.map((l) => (l.clientId === clientId ? { ...l, ...patch } : l)));
  };

  const removeLine = (clientId: string) => {
    onChange(value.filter((l) => l.clientId !== clientId));
  };

  const addLine = () => {
    onChange([
      ...value,
      {
        clientId: newLineClientId(),
        itemId: "",
        colorId: null,
        quantity: 0,
        width: null,
        unitPrice: "",
        customerItemName: "",
        customerColorName: "",
        requiredPropertyIds: [],
        cutNote: "",
      },
    ]);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Sipariş Kalemleri ({value.length})
        </div>
        <Button
          type="button"
          size="sm"
          onClick={addLine}
          className={cn(
            "gap-1.5 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 transition-[transform,box-shadow] duration-150",
            value.length === 0
              ? cn("border-primary shadow-md shadow-primary/40 ring-2 ring-primary/30 hover:shadow-primary/50", breath)
              : "shadow-sm hover:shadow-primary/40"
          )}
        >
          <Plus className="h-3.5 w-3.5" /> Sipariş Kalemi Ekle
        </Button>
      </div>

      <ul className="space-y-1.5">
        {value.map((line, idx) => (
          <li key={line.clientId} className="rounded-md border p-2.5">
            <div className="flex items-start gap-2">
              <Badge variant="muted" className="mt-1 h-6 w-6 justify-center font-mono">
                {idx + 1}
              </Badge>
              <div className="grid flex-1 grid-cols-12 gap-2">
                <div
                  className={`col-span-12 flex gap-1 ${
                    pricingEnabled ? "sm:col-span-3" : "sm:col-span-5"
                  }`}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <EntityPickerModal<Item>
                      value={line.itemId || null}
                      onChange={(v) =>
                        updateLine(line.clientId, {
                          itemId: v ?? "",
                          colorId: null,
                          requiredPropertyIds: [],
                        })
                      }
                      service={itemService}
                      queryKey="order-line-item"
                      getLabel={(i) => i.name}
                      getSubLabel={(i) => i.code}
                      icon={Package}
                      iconClassName="text-primary"
                      title="Kumaş Seç"
                      description="Kumaş seç veya aramayla daralt — tüm katalog sunucuda aranır."
                      placeholder="Kumaş seç..."
                      triggerClassName={
                        lineErrors?.[idx]?.itemId?.message
                          ? "h-9 border-destructive"
                          : `h-9 ${pulseClass(!line.itemId)}`
                      }
                    />
                    {lineErrors?.[idx]?.itemId?.message && (
                      <p className="text-xs text-destructive">{lineErrors[idx]!.itemId!.message}</p>
                    )}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="default"
                    className="h-9 shrink-0 gap-1.5 text-xs shadow-sm hover:shadow-primary/40 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 transition-all duration-150"
                    onClick={() => setQuickAddForLine(line.clientId)}
                  >
                    <PackagePlus className="h-4 w-4" />
                    Yeni Kumaş
                  </Button>
                </div>
                <div className="relative z-10 col-span-12 sm:col-span-3">
                  <OrderLineColorPicker
                    itemId={line.itemId}
                    value={line.colorId ?? null}
                    customerId={customerId}
                    onChange={(v) => updateLine(line.clientId, { colorId: v })}
                    triggerClassName={`h-9 ${pulseClass(Boolean(line.itemId && !line.colorId))}`}
                  />
                </div>
                <div className="col-span-4 sm:col-span-2 space-y-1">
                  <Input
                    className={`text-sm w-full ${lineErrors?.[idx]?.quantity?.message ? "border-destructive" : pulseClass(Boolean(line.itemId && !line.quantity))}`}
                    type="number"
                    step="0.1"
                    min={0}
                    placeholder="Miktar"
                    value={line.quantity || ""}
                    onChange={(e) => updateLine(line.clientId, { quantity: Number(e.target.value) || 0 })}
                  />
                  {lineErrors?.[idx]?.quantity?.message && (
                    <p className="text-xs text-destructive">{lineErrors[idx]!.quantity!.message}</p>
                  )}
                </div>
                <Input
                  className={`col-span-4 sm:col-span-2 text-sm ${pulseClass(Boolean(line.itemId && !line.width))}`}
                  type="number"
                  step="0.1"
                  min={0}
                  placeholder="En (cm)"
                  value={line.width ?? ""}
                  onChange={(e) =>
                    updateLine(line.clientId, {
                      width: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
                {pricingEnabled && (
                  <OrderLinePriceField
                    line={line}
                    customerId={customerId}
                    currency={currency ?? null}
                    onPatch={(p) => updateLine(line.clientId, p)}
                  />
                )}
                <div className="col-span-12">
                  <OrderLineAliasFields
                    customerId={customerId}
                    itemId={line.itemId}
                    colorId={line.colorId ?? null}
                    itemName={line.customerItemName ?? ""}
                    colorName={line.customerColorName ?? ""}
                    onChange={(patch) => updateLine(line.clientId, patch)}
                  />
                </div>
                <div className="col-span-12 -mt-1">
                  <OrderLineAtpHint
                    itemId={line.itemId}
                    colorId={line.colorId ?? null}
                    width={line.width ?? null}
                  />
                </div>
                <div className="col-span-12 -mt-1">
                  <LineRequiredPropertiesEditor
                    itemId={line.itemId}
                    value={line.requiredPropertyIds ?? []}
                    onChange={(ids) => updateLine(line.clientId, { requiredPropertyIds: ids })}
                    extraAction={
                      !isNoteOpen(line) ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => openNote(line.clientId)}
                          className="h-7 gap-1.5 text-xs border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/50"
                        >
                          <StickyNote className="h-3.5 w-3.5" />
                          Not ekle
                        </Button>
                      ) : null
                    }
                  />
                </div>
                {isNoteOpen(line) && (
                  <div className="col-span-12 flex items-center gap-1.5">
                    <Input
                      autoFocus
                      className="flex-1 text-sm"
                      placeholder="Kesim notu (ops.) — örn: 3 parça 200+200+100 m"
                      value={line.cutNote ?? ""}
                      onChange={(e) => updateLine(line.clientId, { cutNote: e.target.value })}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => closeNote(line.clientId)}
                      aria-label="Notu kaldır"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-destructive"
                onClick={() => removeLine(line.clientId)}
                aria-label="Sil"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {value.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Özellik isteği eklemek için önce o kalemin kumaşını seçmelisiniz.</span>
        </div>
      )}

      <ItemFormDialog
        open={quickAddForLine !== null}
        onOpenChange={(open) => {
          if (!open) setQuickAddForLine(null);
        }}
        isSubmitting={createItemMutation.isPending}
        onSubmit={async (payload) => {
          await createItemMutation.mutateAsync(payload);
        }}
      />
    </div>
  );
}
