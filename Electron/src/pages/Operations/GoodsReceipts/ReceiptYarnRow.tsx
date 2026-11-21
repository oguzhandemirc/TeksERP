// =============================================================================
// MAL KABUL — İPLİK satırı (EK 5): Tedarikçi kodu · İplik · Lot · Kg · Bobin · Birim Fiyat · Adet (renk/en/kat/özellik/top sınıfı YOK)
// =============================================================================
// Hücre etiketleri `YARN_COLUMNS` sırasından (`cellLabel("YARN", i)`). Lot: irsaliyedeki metin olduğu gibi (ayrıştırılmaz);
// C8: doğrulama hatası (`issue`) lot kutusunda kırmızı + role="alert". Seyitoğlu d5: tedarikçi kodu yazılıp kutudan
// çıkılınca eşli iplik kartı ÖNERİLİR — kart boşsa doldurulur, doluysa "Eşli kartı kullan" düğmesi çıkar (ezmez).
// =============================================================================
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { ItemSelect } from "@/components/forms/ItemSelect";
import { cellLabel, receiptLineGridCols } from "./receiptLineColumns";
import { RowActions, type RowProps } from "./ReceiptFabricRow";
import { supplierItemCodeService, type SupplierItemCodeMatch } from "./supplierItemCodeService";

const L = (i: number) => cellLabel("YARN", i);

interface YarnProps extends RowProps {
  /** C8: satır hata metni (yerel lot doğrulaması ya da sunucu 400). */
  issue?: string;
  /** Fişin cari tedarikçisi (fason bacağında null → öneri sorulmaz; kod yine iz olarak gider). */
  supplierId?: string | null;
}

export function ReceiptYarnRow({ line: l, onPatch, onDuplicate, onRemove, removeDisabled, issue, supplierId }: YarnProps) {
  const [hint, setHint] = useState<SupplierItemCodeMatch | null>(null);

  const lookup = async () => {
    const code = l.supplierItemCode?.trim();
    setHint(null);
    if (!supplierId || !code) return;
    const res = await supplierItemCodeService.suggest(supplierId, code).catch(() => null);
    const match = res?.data?.match ?? null;
    if (!match) return;
    if (!l.itemId) onPatch({ itemId: match.itemId });
    else if (l.itemId !== match.itemId) setHint(match);
  };

  return (
    <>
      <div className={`grid ${receiptLineGridCols("YARN")} items-center gap-2`} data-testid="receipt-line-yarn">
        <Input
          placeholder="İrsaliyedeki kod"
          maxLength={64}
          aria-label={L(0)}
          title="Tedarikçinin kalem kodu — eşliyse iplik kartı kendiliğinden gelir; kayıtta eşleme öğrenilir"
          value={l.supplierItemCode ?? ""}
          onChange={(e) => onPatch({ supplierItemCode: e.target.value || null })}
          onBlur={() => void lookup()}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void lookup(); } }}
        />
        <ItemSelect value={l.itemId || null} onChange={(v) => { setHint(null); onPatch({ itemId: v ?? "" }); }} placeholder="İplik ara..." aria-label={L(1)} allowedTypes={["YARN"]} />
        <div className="min-w-0">
          <Input placeholder="Lot no (irsaliye)" maxLength={64} aria-label={L(2)} aria-invalid={issue ? true : undefined} className={issue ? "border-destructive" : undefined} value={l.lotNo ?? ""} onChange={(e) => onPatch({ lotNo: e.target.value || null })} />
          {issue && <p role="alert" className="mt-1 text-[11px] text-destructive">{issue}</p>}
        </div>
        <Input type="number" min={0} step="0.01" placeholder="0" aria-label={L(3)} title="İplikte miktar KG'dir" value={l.initialQty || ""} onChange={(e) => onPatch({ initialQty: Number(e.target.value) })} />
        <Input type="number" min={1} step={1} placeholder="—" aria-label={L(4)} title="Bobin adedi (bilgi — bakiye değil)" value={l.bobbinCount ?? ""} onChange={(e) => onPatch({ bobbinCount: e.target.value ? Math.max(1, Math.trunc(Number(e.target.value))) : null })} />
        <Input type="number" min={0} step="0.0001" placeholder="—" aria-label={L(5)} value={l.unitPrice ?? ""} onChange={(e) => onPatch({ unitPrice: e.target.value ? Number(e.target.value) : null })} />
        <Input type="number" min={1} step="1" className="text-center font-medium" aria-label={L(6)} title="Kaç ayrı iplik defter satırı doğsun (her biri bu kg'de)" value={l.count} onChange={(e) => onPatch({ count: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
        <RowActions onDuplicate={onDuplicate} onRemove={onRemove} removeDisabled={removeDisabled} />
      </div>
      {hint && (
        <p className="mt-1 text-[11px] text-muted-foreground" data-testid="supplier-code-hint">
          Bu kod daha önce <span className="font-medium text-foreground">{hint.itemName}</span> kartına eşlendi.{" "}
          <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => { onPatch({ itemId: hint.itemId }); setHint(null); }}>
            Eşli kartı kullan
          </button>
        </p>
      )}
    </>
  );
}
