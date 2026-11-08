// =============================================================================
// FATURA SATIRI — konu hücresi: tür (Ürün / Hizmet / Açıklama) + türe göre MODAL seçici (combobox yok)
// =============================================================================
// Ürün → `ItemSelect` (stok türleri, `/api/items`); Hizmet → `ServiceItemSelect` (`/api/service-items`); Açıklama →
// seçici yok (kartsız satır). Tür değişince öteki türün kartı düşer (`withLineType`). Seçilen kartın adı çağırana
// gider: açıklama boşsa ön-dolum (`InvoiceLineRow`).
// =============================================================================
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
        <ItemSelect
          value={subject.itemId}
          onChange={(id, row) => onPick({ itemId: id }, row?.name ?? null)}
          placeholder="Ürün kartı (ops.)"
          aria-label="Ürün kartı seç"
        />
      )}
      {subject.lineType === "SERVICE" && (
        <ServiceItemSelect
          value={subject.serviceItemId}
          onChange={(id, row) => onPick({ serviceItemId: id }, row?.name ?? null)}
          placeholder="Hizmet kartı seç"
          nullable
          noneLabel="— (kartsız satır)"
          triggerClassName="h-9 py-1.5"
        />
      )}
      {subject.lineType === "TEXT" && (
        <p className="flex h-9 items-center px-1 text-xs text-muted-foreground">Kartsız satır — yalnız açıklama</p>
      )}
    </div>
  );
}
