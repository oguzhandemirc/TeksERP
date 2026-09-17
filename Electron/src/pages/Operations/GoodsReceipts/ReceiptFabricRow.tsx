// =============================================================================
// MAL KABUL — KUMAŞ satırı (EK 5/7): Kumaş · Renk · Metre (top başına) · En · Kg · Kat · Birim Fiyat · Özellik · Sınıf · Adet
// =============================================================================
// Hücre etiketleri `FABRIC_COLUMNS` sırasından (`cellLabel("FABRIC", i)`). Top sınıfı SATIR BAZLI ve ÜÇLÜ (EK 7):
// Ham · Yarı mamul · Bitmiş; fiş kutusu YOK, yeni satır bir öncekini miras alır (`inheritedLineClass`).
// =============================================================================
import { Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ItemSelect } from "@/components/forms/ItemSelect";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { colorService } from "@/pages/Colors/service";
import type { Color } from "@/pages/Colors/types";
import { cn } from "@/lib/utils";
import { LinePropertiesButton } from "./LinePropertiesButton";
import { cellLabel, receiptLineGridCols } from "./receiptLineColumns";
import { DEFAULT_LINE_CLASS, LINE_CLASS_LABEL, RECEIPT_LINE_CLASSES, type DraftLine, type ReceiptLineClass } from "./receiptLineTypes";

const L = (i: number) => cellLabel("FABRIC", i);

export interface RowProps {
  line: DraftLine;
  onPatch: (p: Partial<DraftLine>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  removeDisabled: boolean;
}

interface FabricProps extends RowProps {
  foldValues: ReadonlyArray<{ code: string; name: string }>;
}

const CLASS_ACTIVE: Record<ReceiptLineClass, string> = {
  RAW: "bg-amber-200 text-amber-950 dark:bg-amber-900 dark:text-amber-100",
  SEMI_FINISHED: "bg-sky-200 text-sky-950 dark:bg-sky-900 dark:text-sky-100",
  FINISHED: "bg-emerald-200 text-emerald-950 dark:bg-emerald-900 dark:text-emerald-100",
};

/** Üç durumlu anahtar: Ham · Yarı mamul · Bitmiş — `aria-label="Top sınıfı"`, basılı durum `aria-pressed`. */
function LineClassToggle({ value, onChange }: { value: ReceiptLineClass; onChange: (cls: ReceiptLineClass) => void }) {
  return (
    <div role="group" aria-label={L(8)} title="Ham: işlenmek üzere alınan mal (Ham Stok). Yarı mamul: dışarıda işlenmiş, burada bitirilecek (Yarı Mamul sekmesi). Bitmiş: satılabilir depo. Yeni satır bir öncekini devralır." className="flex h-9 items-center gap-0.5 rounded-md border p-0.5">
      {RECEIPT_LINE_CLASSES.map((cls) => (
        <button
          key={cls}
          type="button"
          aria-pressed={value === cls}
          className={cn("h-8 flex-1 rounded-sm px-1 text-[11px] font-medium transition-colors", value === cls ? CLASS_ACTIVE[cls] : "text-muted-foreground hover:bg-muted")}
          onClick={() => onChange(cls)}
        >
          {LINE_CLASS_LABEL[cls]}
        </button>
      ))}
    </div>
  );
}

export function ReceiptFabricRow({ line: l, onPatch, onDuplicate, onRemove, removeDisabled, foldValues }: FabricProps) {
  return (
    <div className={`grid ${receiptLineGridCols("FABRIC")} items-center gap-2`} data-testid="receipt-line-fabric">
      <ItemSelect value={l.itemId || null} onChange={(v) => onPatch({ itemId: v ?? "" })} placeholder="Kumaş ara..." aria-label={L(0)} allowedTypes={["FABRIC"]} />
      <ReferenceSelect<Color> value={l.colorId} onChange={(v) => onPatch({ colorId: v })} service={colorService} queryKey="colors" getLabel={(c) => c.name} placeholder="Renk..." aria-label={L(1)} />
      <Input type="number" min={0} step="0.01" placeholder="0" aria-label={L(2)} title="Top başına metre — adetle çarpılmaz" value={l.initialQty || ""} onChange={(e) => onPatch({ initialQty: Number(e.target.value) })} />
      <Input type="number" min={0} placeholder="—" aria-label={L(3)} value={l.width ?? ""} onChange={(e) => onPatch({ width: e.target.value ? Number(e.target.value) : null })} />
      <Input type="number" min={0} step="0.01" placeholder="—" aria-label={L(4)} value={l.weightKg ?? ""} onChange={(e) => onPatch({ weightKg: e.target.value ? Number(e.target.value) : null })} />
      {/* KAT opsiyonel ve KATALOGDAN — boş katalogda seçici hiç çizilmez. */}
      {foldValues.length > 0 ? (
        <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" aria-label={L(5)} value={l.foldType ?? ""} onChange={(e) => onPatch({ foldType: e.target.value || null })}>
          <option value="">—</option>
          {foldValues.map((f) => (
            <option key={f.code} value={f.code}>{f.name}</option>
          ))}
        </select>
      ) : (
        <span className="text-center text-xs text-muted-foreground" aria-label={L(5)} title="Kat kataloğu boş">—</span>
      )}
      <Input type="number" min={0} step="0.0001" placeholder="—" aria-label={L(6)} value={l.unitPrice ?? ""} onChange={(e) => onPatch({ unitPrice: e.target.value ? Number(e.target.value) : null })} />
      <LinePropertiesButton aria-label={L(7)} itemId={l.itemId} value={l.propertyIds} onChange={(v) => onPatch({ propertyIds: v })} />
      <LineClassToggle value={l.lineClass ?? DEFAULT_LINE_CLASS} onChange={(v) => onPatch({ lineClass: v })} />
      <Input type="number" min={1} step="1" className="text-center font-medium" aria-label={L(9)} title="Kaç top doğsun (her biri bu metrede)" value={l.count} onChange={(e) => onPatch({ count: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
      <RowActions onDuplicate={onDuplicate} onRemove={onRemove} removeDisabled={removeDisabled} />
    </div>
  );
}

/** Kopyala + sil — silme YIKICI: kırmızı zemin (saha isteği). */
export function RowActions({ onDuplicate, onRemove, removeDisabled }: Pick<RowProps, "onDuplicate" | "onRemove" | "removeDisabled">) {
  return (
    <div className="flex items-center justify-end gap-1">
      <Button variant="ghost" size="icon" title="Satırı kopyala" onClick={onDuplicate}>
        <Copy className="h-4 w-4" />
      </Button>
      <Button size="icon" title="Satırı sil" className="bg-destructive text-white hover:bg-destructive/90 disabled:opacity-40" disabled={removeDisabled} onClick={onRemove}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
