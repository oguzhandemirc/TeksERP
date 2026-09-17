// =============================================================================
// MAL KABUL — İPLİK satırı (EK 5): İplik · Lot · Kg · Bobin · Birim Fiyat · Adet (renk/en/kat/özellik/top sınıfı YOK)
// =============================================================================
// Hücre etiketleri `YARN_COLUMNS` sırasından (`cellLabel("YARN", i)`). Lot: irsaliyedeki metin olduğu gibi (ayrıştırılmaz);
// C8: doğrulama hatası (`issue`) lot kutusunda kırmızı + role="alert".
// =============================================================================
import { Input } from "@/components/ui/input";
import { ItemSelect } from "@/components/forms/ItemSelect";
import { cellLabel, receiptLineGridCols } from "./receiptLineColumns";
import { RowActions, type RowProps } from "./ReceiptFabricRow";

const L = (i: number) => cellLabel("YARN", i);

interface YarnProps extends RowProps {
  /** C8: satır hata metni (yerel lot doğrulaması ya da sunucu 400). */
  issue?: string;
}

export function ReceiptYarnRow({ line: l, onPatch, onDuplicate, onRemove, removeDisabled, issue }: YarnProps) {
  return (
    <div className={`grid ${receiptLineGridCols("YARN")} items-center gap-2`} data-testid="receipt-line-yarn">
      <ItemSelect value={l.itemId || null} onChange={(v) => onPatch({ itemId: v ?? "" })} placeholder="İplik ara..." aria-label={L(0)} allowedTypes={["YARN"]} />
      <div className="min-w-0">
        <Input placeholder="Lot no (irsaliye)" maxLength={64} aria-label={L(1)} aria-invalid={issue ? true : undefined} className={issue ? "border-destructive" : undefined} value={l.lotNo ?? ""} onChange={(e) => onPatch({ lotNo: e.target.value || null })} />
        {issue && <p role="alert" className="mt-1 text-[11px] text-destructive">{issue}</p>}
      </div>
      <Input type="number" min={0} step="0.01" placeholder="0" aria-label={L(2)} title="İplikte miktar KG'dir" value={l.initialQty || ""} onChange={(e) => onPatch({ initialQty: Number(e.target.value) })} />
      <Input type="number" min={1} step={1} placeholder="—" aria-label={L(3)} title="Bobin adedi (bilgi — bakiye değil)" value={l.bobbinCount ?? ""} onChange={(e) => onPatch({ bobbinCount: e.target.value ? Math.max(1, Math.trunc(Number(e.target.value))) : null })} />
      <Input type="number" min={0} step="0.0001" placeholder="—" aria-label={L(4)} value={l.unitPrice ?? ""} onChange={(e) => onPatch({ unitPrice: e.target.value ? Number(e.target.value) : null })} />
      <Input type="number" min={1} step="1" className="text-center font-medium" aria-label={L(5)} title="Kaç ayrı iplik defter satırı doğsun (her biri bu kg'de)" value={l.count} onChange={(e) => onPatch({ count: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
      <RowActions onDuplicate={onDuplicate} onRemove={onRemove} removeDisabled={removeDisabled} />
    </div>
  );
}
