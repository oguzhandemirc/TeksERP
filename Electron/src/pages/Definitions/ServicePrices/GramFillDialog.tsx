// "Gram fiyatından doldur": genel fiyatı olmayan gramajlı kademelere gram × gramaj önerisi. Önizleme satır satır
// seçilir; var olan fiyat EZİLMEZ (aday listesi yalnız boş kademeler).
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ServicePriceTable } from "./service";
import { formatPrice, gramFillCandidates, type GramFillCandidate } from "./servicePrices";
import type { useServicePriceMutations } from "./useServicePriceMutations";

interface Props {
  table: ServicePriceTable;
  validFromDay: string | null;
  mutations: ReturnType<typeof useServicePriceMutations>;
  onClose: () => void;
}

export function GramFillDialog({ table, validFromDay, mutations, onClose }: Props) {
  const candidates = useMemo(() => gramFillCandidates(table.tiers), [table.tiers]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(candidates.map((c) => c.valueId)));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);

  const apply = async () => {
    setBusy(true);
    let ok = 0;
    for (const c of candidates.filter((x) => picked.has(x.valueId))) {
      const saved = await mutations.save(`fill:${c.valueId}`, {
        itemId: table.item.id,
        propertyValueId: c.valueId,
        customerId: null,
        currency: table.currency,
        price: Number(c.price.toFixed(4)),
        validFromDay,
      });
      if (!saved) break; // hata toast'ı apiClient'te; kalanlar seçili kalır, yeniden denenebilir
      ok += 1;
      setDone(ok);
    }
    setBusy(false);
    if (ok === picked.size) onClose();
  };

  const toggle = (id: string, on: boolean) =>
    setPicked((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Gram fiyatından doldur</DialogTitle>
          <DialogDescription>
            Genel fiyatı olmayan kademelere gram fiyatı × gramaj yazılır. Kaydedilen fiyat artık “Genel
            kademe” olur; gram fiyatı değişse de bu kademe değişmez.
          </DialogDescription>
        </DialogHeader>
        {candidates.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            Doldurulacak kademe yok — gramajlı her kademenin zaten fiyatı var ya da gram fiyatı tanımlı değil.
          </p>
        ) : (
          <GramFillTable
            candidates={candidates}
            picked={picked}
            busy={busy}
            currency={table.currency}
            onToggle={toggle}
          />
        )}
        <DialogFooter>
          {busy && (
            <span className="mr-auto text-xs text-muted-foreground">
              {done}/{picked.size} yazıldı…
            </span>
          )}
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button onClick={() => void apply()} disabled={busy || picked.size === 0}>
            {picked.size} kademeye yaz
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GramFillTable({
  candidates,
  picked,
  busy,
  currency,
  onToggle,
}: {
  candidates: GramFillCandidate[];
  picked: Set<string>;
  busy: boolean;
  currency: string;
  onToggle: (id: string, on: boolean) => void;
}) {
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-muted-foreground">
        <tr>
          <th className="w-8" />
          <th className="py-1 text-left font-medium">Kademe</th>
          <th className="py-1 text-left font-medium">Hesap</th>
          <th className="py-1 text-right font-medium">Önerilen fiyat</th>
        </tr>
      </thead>
      <tbody>
        {candidates.map((c) => (
          <tr key={c.valueId} className="border-t">
            <td className="py-1.5">
              <Checkbox
                checked={picked.has(c.valueId)}
                disabled={busy}
                onCheckedChange={(v) => onToggle(c.valueId, v === true)}
                aria-label={`${c.name} seç`}
              />
            </td>
            <td className="py-1.5">{c.name}</td>
            <td className="py-1.5 text-xs text-muted-foreground">{c.formula}</td>
            <td className="py-1.5 text-right tabular-nums font-medium">
              {formatPrice(c.price)} {currency}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
