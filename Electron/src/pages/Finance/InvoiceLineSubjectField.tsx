// =============================================================================
// FATURA SATIRI — konu hücresi: tür (Ürün / Hizmet / Açıklama) + türe göre MODAL seçici (combobox yok)
// =============================================================================
// Ürün → `ItemSelect` (stok türleri, `/api/items`); Hizmet → `ServiceItemSelect` (`/api/service-items`); Açıklama →
// seçici yok (kartsız satır). Tür değişince öteki türün kartı düşer (`withLineType`). Seçilen kartın adı çağırana
// gider: açıklama boşsa ön-dolum (`InvoiceLineRow`).
// =============================================================================
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ItemSelect } from "@/components/forms/ItemSelect";
import { ServiceItemSelect } from "@/components/forms/ServiceItemSelect";
import { cn } from "@/lib/utils";
import { INVOICE_LINE_TYPES, INVOICE_LINE_TYPE_LABEL, type InvoiceLineSubject, type InvoiceLineType } from "./invoiceLineSubject";

interface Props {
  subject: InvoiceLineSubject;
  onTypeChange: (t: InvoiceLineType) => void;
  /** Kart seçimi; `name` açıklama ön-dolumu içindir (seçim kaldırılınca null). */
  onPick: (patch: Partial<InvoiceLineSubject>, name: string | null) => void;
}

export function InvoiceLineSubjectField({ subject, onTypeChange, onPick }: Props) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex gap-0.5" role="radiogroup" aria-label="Satır türü">
        {INVOICE_LINE_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={subject.lineType === t}
            className={cn(
              "h-6 flex-1 rounded border px-1 text-[11px] leading-none",
              subject.lineType === t ? "border-primary bg-primary/10 font-medium text-primary" : "bg-background text-muted-foreground hover:bg-muted/50",
            )}
            onClick={() => onTypeChange(t)}
          >
            {INVOICE_LINE_TYPE_LABEL[t]}
          </button>
        ))}
      </div>
      {subject.lineType === "PRODUCT" && (
        <div className="flex min-w-0 items-center gap-1">
          <ItemSelect
            className="min-w-0 flex-1"
            value={subject.itemId}
            onChange={(id, row) => onPick({ itemId: id }, row?.name ?? null)}
            placeholder="Ürün kartı (ops.)"
            aria-label="Ürün kartı seç"
          />
          {subject.itemId && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-7 shrink-0"
              aria-label="Ürün seçimini temizle"
              title="Ürün seçimini temizle"
              onClick={() => onPick({ itemId: null }, null)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      )}
      {subject.lineType === "SERVICE" && (
        <>
          <ServiceItemSelect
            value={subject.serviceItemId}
            onChange={(id, row) => onPick({ serviceItemId: id }, row?.name ?? null)}
            placeholder="Hizmet kartı seç"
            nullable
            noneLabel="— (kartsız satır)"
            triggerClassName="h-9 py-1.5"
          />
          {/* Kartsız hizmet satırı sunucuya açıklama satırı (TEXT) olarak gider — sessiz dönüşüm olmasın. */}
          {!subject.serviceItemId && (
            <p className="text-[11px] leading-tight text-amber-700 dark:text-amber-400" role="status">
              Hizmet kartı seçilmedi; satır açıklama olarak kaydedilir.
            </p>
          )}
        </>
      )}
      {subject.lineType === "TEXT" && (
        <p className="flex h-9 items-center px-1 text-xs text-muted-foreground">Kartsız satır — yalnız açıklama</p>
      )}
    </div>
  );
}
