// =============================================================================
// SİPARİŞ KALEMLERİ EDİTÖRÜ — tablo gibi hizalı grid (⑤), geçici kumaş uyarısı (③), Miktar+Birim grubu (④)
// =============================================================================
// Satır `OrderLineRow`, başlık satırı bir kez (aynı grid şablonu). Kalıcı "Önce kumaş seçin" şeridi/rozeti
// YOK — uyarı tetiklenir ve söner (`useTransientFlag`): renk kutusu · "Özellik isteği ekle" · submit'in zod
// "Kumaş seçilmeli" hatası. Kural: kalıcı ön koşul metni formda kalmaz; kullanıcı eylemi tetikler.
// =============================================================================
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { usePricingEnabled } from "@/hooks/usePricingEnabled";
import { usePulseSync } from "@/hooks/usePulseSync";
import { useTransientFlag } from "@/hooks/useTransientFlag";
import { itemService } from "@/pages/Items/service";
import type { Item, ItemCreatePayload } from "@/pages/Items/types";
import { ItemFormDialog } from "@/pages/Items/ItemFormDialog";
import { newLineClientId, type OrderLineFormValues } from "./schema";
import { LINE_HEADERS, OrderLineRow, lineGridCols } from "./OrderLineRow";
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

export const ITEM_WARNING_MS = 3000;

interface Props {
  value: OrderLineFormValues[];
  onChange: (next: OrderLineFormValues[]) => void;
  error?: string;
  lineErrors?: OrderLineErrors;
  /** Müşterinin aliası — alias suggest için; fiyat önerisinde müşteri istisnası. */
  customerId: string | null;
  /** Siparişin para birimi — SATIŞ fiyat önerisinin anahtarı; verilmezse öneri isteği atılmaz. */
  currency?: string;
}

export function OrderLinesEditor({ value, onChange, error, lineErrors, customerId, currency }: Props) {
  const qc = useQueryClient();
  const pricingEnabled = usePricingEnabled();
  const [quickAddForLine, setQuickAddForLine] = useState<string | null>(null);
  // Kesim notu varsayılan olarak GİZLİ — "Not ekle" ile açılır. Dolu notu olan satır otomatik açık gelir.
  const [noteOpenIds, setNoteOpenIds] = useState<Set<string>>(new Set());
  const isNoteOpen = (line: OrderLineFormValues) => noteOpenIds.has(line.clientId) || Boolean(line.cutNote?.trim());

  // ③ Geçici kumaş uyarısı: hangi satırda (clientId) ve yanıyor mu — tek bayrak, tek zamanlayıcı.
  const [warnLineId, setWarnLineId] = useState<string | null>(null);
  const [warnOn, fireWarn] = useTransientFlag(ITEM_WARNING_MS);
  const warnItem = (clientId: string) => {
    setWarnLineId(clientId);
    fireWarn();
  };
  // Submit'in zod hatası ("Kumaş seçilmeli") da aynı geçici uyarıyla gösterilir — ilk hatalı satır.
  const firstItemErrorId = value.find((_, i) => lineErrors?.[i]?.itemId?.message)?.clientId ?? null;
  useEffect(() => {
    if (firstItemErrorId) warnItem(firstItemErrorId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstItemErrorId, lineErrors]);

  // Tüm pulse vurguları TEK paylaşılan saatten beslenir ([[usePulseSync]]).
  const dim = usePulseSync();
  const breath = `transition-all duration-700 ${dim ? "opacity-50" : "opacity-100"}`;
  const pulseClass = (active: boolean) => (active ? `border-primary shadow-lg shadow-primary/50 ring-2 ring-primary/30 ${breath}` : "");

  const createItemMutation = useMutation({
    mutationFn: (payload: ItemCreatePayload) => itemService.create(payload as unknown as Partial<Item>),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["items"] });
      const created = res.data;
      if (quickAddForLine && created?.id) {
        updateLine(quickAddForLine, { itemId: created.id });
        toast.success(`Kumaş oluşturuldu: ${created.code}`);
      }
      setQuickAddForLine(null);
    },
  });

  const updateLine = (clientId: string, patch: Partial<OrderLineFormValues>) =>
    onChange(value.map((l) => (l.clientId === clientId ? { ...l, ...patch } : l)));
  const removeLine = (clientId: string) => onChange(value.filter((l) => l.clientId !== clientId));
  const addLine = () =>
    onChange([...value, { clientId: newLineClientId(), itemId: "", colorId: null, quantity: 0, width: null, unitPrice: "", customerItemName: "", customerColorName: "", requiredPropertyIds: [], cutNote: "" }]);
  const closeNote = (clientId: string) => {
    updateLine(clientId, { cutNote: "" });
    setNoteOpenIds((prev) => {
      const next = new Set(prev);
      next.delete(clientId);
      return next;
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sipariş Kalemleri ({value.length})</div>
        <Button
          type="button"
          size="sm"
          onClick={addLine}
          className={cn(
            "gap-1.5 transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0",
            value.length === 0 ? cn("border-primary shadow-md shadow-primary/40 ring-2 ring-primary/30 hover:shadow-primary/50", breath) : "shadow-sm hover:shadow-primary/40",
          )}
        >
          <Plus className="h-3.5 w-3.5" /> Sipariş Kalemi Ekle
        </Button>
      </div>

      {value.length > 0 && (
        // ⑤ Başlık satırı bir kez — kalem satırlarıyla aynı grid şablonu (tablo gibi hizalı).
        <div className={cn(lineGridCols(pricingEnabled), "hidden px-2 text-[11px] font-medium uppercase text-muted-foreground lg:grid")} data-testid="order-line-headers">
          {LINE_HEADERS.base.map((h) => (
            <span key={h}>{h}</span>
          ))}
          {pricingEnabled && <span>{LINE_HEADERS.price}</span>}
          <span />
        </div>
      )}

      <ul className="space-y-1.5">
        {value.map((line, idx) => (
          <OrderLineRow
            key={line.clientId}
            line={line}
            index={idx}
            pricingEnabled={pricingEnabled}
            customerId={customerId}
            currency={currency ?? null}
            itemError={lineErrors?.[idx]?.itemId?.message}
            quantityError={lineErrors?.[idx]?.quantity?.message}
            itemWarning={warnOn && warnLineId === line.clientId}
            onWarnItem={() => warnItem(line.clientId)}
            pulseClass={pulseClass}
            noteOpen={isNoteOpen(line)}
            onOpenNote={() => setNoteOpenIds((prev) => new Set(prev).add(line.clientId))}
            onCloseNote={() => closeNote(line.clientId)}
            onQuickAddItem={() => setQuickAddForLine(line.clientId)}
            onPatch={(patch) => updateLine(line.clientId, patch)}
            onRemove={() => removeLine(line.clientId)}
          />
        ))}
      </ul>

      {error && <p className="text-xs text-destructive">{error}</p>}

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
