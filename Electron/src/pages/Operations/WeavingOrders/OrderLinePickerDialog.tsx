// =============================================================================
// SİPARİŞ SATIRI SEÇİCİ — dokuma işine bağlanacak açık kalemler (çoklu seçim, tek ekleme)
// =============================================================================
// Kaynak MEVCUT uç `GET /api/orders/order-lines/available?itemId=` (Z2; yeni uç yok). Yalnız
// formda seçili kumaşın (ve varsa rengin) açık kalemleri listelenir; zaten bağlı satırlar
// listeden düşer. Kalıp `WorkOrders/LinkOrderDialog` tablosu (Sipariş/Müşteri · Kumaş/Renk · Açık · Termin).
// =============================================================================
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link2, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { listAvailableOrderLines, num, type AvailableOrderLine } from "@/pages/Operations/Orders/availableLines";
import { formatDay } from "./types";

const fmt = (n: number | null) => (n === null ? "ölçülmüyor" : `${n.toLocaleString("tr-TR", { maximumFractionDigits: 0 })} m`);

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId: string;
  colorId: string | null;
  /** Formda zaten bağlı satırlar — listeden düşer. */
  excludeIds: ReadonlySet<string>;
  onAdd: (rows: AvailableOrderLine[]) => void;
}

function LineRow({ l, checked, onToggle }: { l: AvailableOrderLine; checked: boolean; onToggle: () => void }) {
  return (
    <tr className="cursor-pointer border-t transition-colors hover:bg-accent/40" onClick={onToggle} data-testid={`ol-row-${l.lineId}`}>
      <td className="p-2" onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={checked} onCheckedChange={onToggle} aria-label={`${l.orderNumber} seç`} />
      </td>
      <td className="p-2">
        <div className="font-mono text-xs">{l.orderNumber}</div>
        <div className="text-xs text-muted-foreground">{l.customerName}</div>
      </td>
      <td className="p-2">
        <div>{l.itemName}</div>
        <div className="text-xs text-muted-foreground">
          {l.colorName ?? "renksiz"}
          {num(l.width) != null ? ` · ${num(l.width)} cm` : ""}
        </div>
      </td>
      <td className="p-2 text-right tabular-nums">
        <div className="font-medium">{fmt(num(l.netOpenQty ?? l.openQty))}</div>
        <div className="text-[11px] text-muted-foreground">{fmt(num(l.quantity))} istendi</div>
        {l.hasWorkOrder && <Badge variant="muted" className="mt-0.5 text-[10px]">iş emri var</Badge>}
      </td>
      <td className="p-2 text-xs">{formatDay(l.deadline)}</td>
    </tr>
  );
}

export function OrderLinePickerDialog({ open, onOpenChange, itemId, colorId, excludeIds, onAdd }: Props) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const q = useQuery({
    queryKey: ["order-lines-available", itemId, colorId ?? "", search],
    queryFn: () => listAvailableOrderLines({ itemId, colorId, search: search.trim() || undefined, limit: 100 }),
    enabled: open && itemId !== "",
    staleTime: 15_000,
  });
  const lines = useMemo(() => (q.data?.data ?? []).filter((l) => !excludeIds.has(l.lineId)), [q.data, excludeIds]);
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4" /> Sipariş satırı ekle
          </DialogTitle>
          <DialogDescription>Yalnız bu işin kumaşına (ve seçiliyse rengine) ait AÇIK sipariş kalemleri. Bağ tahsis değildir; tahsis metresi sonra, isteğe bağlı.</DialogDescription>
        </DialogHeader>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Sipariş no veya müşteri ara…" aria-label="Sipariş ara" />
        <div className="max-h-[48vh] overflow-auto rounded-md border">
          {q.isLoading ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
            </div>
          ) : q.isError ? (
            <div className="p-6 text-center text-sm text-destructive">Liste yüklenemedi — bu bir “açık sipariş yok” cevabı DEĞİLDİR.</div>
          ) : lines.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Bu kumaş için açık sipariş kalemi yok.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/60 text-xs">
                <tr>
                  <th className="w-9 p-2" />
                  <th className="p-2 text-left font-medium">Sipariş / Müşteri</th>
                  <th className="p-2 text-left font-medium">Kumaş / Renk</th>
                  <th className="p-2 text-right font-medium">Açık</th>
                  <th className="p-2 text-left font-medium">Termin</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <LineRow key={l.lineId} l={l} checked={selected.has(l.lineId)} onToggle={() => toggle(l.lineId)} />
                ))}
              </tbody>
            </table>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Vazgeç</Button>
          <Button disabled={selected.size === 0} onClick={() => onAdd(lines.filter((l) => selected.has(l.lineId)))} data-testid="ol-ekle">
            Ekle{selected.size > 0 ? ` (${selected.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
