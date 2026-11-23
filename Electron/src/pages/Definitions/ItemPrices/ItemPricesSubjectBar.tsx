// Kalem Fiyatları üst şeridi: konu türü (Ürün / Hizmet) + türe göre MODAL seçici (combobox yok).
// Ürün → `ItemSelect` (stok türleri); Hizmet → `ServiceItemSelect` (`/api/service-items`).
import { Button } from "@/components/ui/button";
import { ItemSelect } from "@/components/forms/ItemSelect";
import { ServiceItemSelect } from "@/components/forms/ServiceItemSelect";
import { PRICE_SUBJECT_LABEL, type PriceSubjectKind } from "./priceSubject";

const KINDS: PriceSubjectKind[] = ["PRODUCT", "SERVICE"];

interface Props {
  kind: PriceSubjectKind;
  id: string | null;
  onKindChange: (k: PriceSubjectKind) => void;
  onIdChange: (id: string | null) => void;
}

export function ItemPricesSubjectBar({ kind, id, onKindChange, onIdChange }: Props) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-6 py-3">
      {/* Tek parçalı seçim (segment): iki ayrı düğme "iki eylem" gibi okunuyordu (T4). */}
      <div className="inline-flex h-9 items-center rounded-md border bg-muted/40 p-0.5" role="radiogroup" aria-label="Kart türü">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            className={`h-full rounded px-3 text-sm ${kind === k ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => kind !== k && onKindChange(k)}
          >
            {PRICE_SUBJECT_LABEL[k]}
          </button>
        ))}
      </div>
      <div className="w-96">
        {kind === "SERVICE" ? (
          <ServiceItemSelect value={id} onChange={(v) => onIdChange(v)} placeholder="Hizmet kartı seç (kod veya ad)…" />
        ) : (
          <ItemSelect value={id} onChange={(v) => onIdChange(v)} placeholder="Ürün kartı seç (kod veya ad)…" aria-label="Ürün kartı seç" />
        )}
      </div>
      {id && (
        <Button variant="ghost" size="sm" onClick={() => onIdChange(null)}>
          Başka kart seç
        </Button>
      )}
    </div>
  );
}
