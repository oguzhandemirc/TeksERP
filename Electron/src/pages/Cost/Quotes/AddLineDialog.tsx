// "Kalem ekle" — sunucu kalemin maliyetini kurar ve fiyatı önerir (kaynağıyla); kullanıcı isterse kesin fiyatı
// (2 hane) baştan yazar. Kâr % yalnız maliyet görebilene sorulur (maliyet tabanı ticari sırdır).
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { buildLineBody, emptyLineForm, type LineForm, type PendingLine } from "./line-body";
import { LineSourceFields } from "./LineSourceFields";
import { checkUnitPrice } from "./price-input";
import { quoteService } from "./service";
import { useQuoteMutation } from "./useQuoteMutation";

interface Props { quoteId: string; customerId: string; currency: string; open: boolean; onOpenChange: (o: boolean) => void; pending?: PendingLine | null }

function Num({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <label className="text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Input aria-label={label} inputMode="decimal" className="mt-1 text-right tabular-nums" value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function AddLineDialog({ quoteId, customerId, currency, open, onOpenChange, pending }: Props) {
  const { hasPermission } = useRoleAccess();
  const [f, setF] = useState<LineForm>(() => emptyLineForm(pending));
  const up = (patch: Partial<LineForm>) => setF((x) => ({ ...x, ...patch }));
  const body = buildLineBody(f);
  const price = f.unitPrice.trim() ? checkUnitPrice(f.unitPrice) : null;
  const add = useQuoteMutation({
    quoteId,
    fn: () => quoteService.addLine(quoteId, body!),
    onDone: () => {
      setF(emptyLineForm());
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Kalem ekle</DialogTitle>
          <DialogDescription>Fiyatı boş bırakırsanız sunucu önerir (müşteri listesi › genel liste › ürün fiyatı › maliyet + kâr). Kalem yalnız metre (m) birimlidir.</DialogDescription>
        </DialogHeader>
        <LineSourceFields value={f} onChange={up} customerId={customerId} />
        <div className="grid gap-3 sm:grid-cols-4">
          <Num label="En (cm)" value={f.width} onChange={(width) => up({ width })} />
          <Num label="Miktar (m) *" value={f.quantity} onChange={(quantity) => up({ quantity })} />
          <Num label={`Kesin fiyat (${currency}/m)`} value={f.unitPrice} onChange={(unitPrice) => up({ unitPrice })} hint="Boş: öneri" />
          {hasPermission("cost:read") && <Num label="Kâr %" value={f.markupPct} onChange={(markupPct) => up({ markupPct })} hint="Boş: parametre seti" />}
        </div>
        {price && !price.ok && <p role="alert" className="text-sm text-destructive">{price.error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Vazgeç</Button>
          <Button disabled={!body || (price !== null && !price.ok) || add.isPending} onClick={() => add.mutate()} data-testid="line-add">
            {add.isPending ? "Fiyatlanıyor…" : "Ekle"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
