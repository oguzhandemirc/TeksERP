import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardList, PackagePlus, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { safeFormat } from "@/lib/format";
import { packingService } from "./service";
import { shipmentStatusLabels, type OpenOrder, type ShipmentStatus } from "./types";

interface Props {
  onStarted: (shipmentId: string) => void;
}

const groupKey = (o: OpenOrder) => `${o.order.customer.id}|${o.order.branch?.id ?? "_"}`;

/**
 * Sipariş seçim ekranı (mobil TartiPaket aynası). Devam eden sevkiyatları "Sürdür"
 * ile açar; açık siparişlerden TEK müşteri+şube seçip yeni sevkiyat başlatır
 * (createShipment → PREPARING). Karşılanma depo bazlı (covered rozetı).
 */
export function OrderSelectionPanel({ onStarted }: Props) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["packing", "open-orders"],
    queryFn: () => packingService.listOpenOrders(),
    staleTime: 15_000,
  });
  const orders = useMemo(() => q.data?.data ?? [], [q.data]);

  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Devam eden sevkiyatlar (sipariş→aktif sevkiyat) — distinct.
  const inProgress = useMemo(() => {
    const m = new Map<string, { id: string; shipmentNo: string; status: ShipmentStatus; customer: string }>();
    for (const o of orders) {
      const s = o.order.activeShipment;
      if (s && !m.has(s.id)) {
        m.set(s.id, { id: s.id, shipmentNo: s.shipmentNo, status: s.status, customer: o.order.customer.name });
      }
    }
    return [...m.values()];
  }, [orders]);

  // Açık siparişler (aktif sevkiyatı olmayan) — müşteri+şube grupları.
  const groups = useMemo(() => {
    const m = new Map<string, { label: string; orders: OpenOrder[] }>();
    for (const o of orders) {
      if (o.order.activeShipment) continue;
      const k = groupKey(o);
      const label = `${o.order.customer.name}${o.order.branch ? ` · ${o.order.branch.name}` : ""}`;
      if (!m.has(k)) m.set(k, { label, orders: [] });
      m.get(k)!.orders.push(o);
    }
    return [...m.entries()].map(([key, v]) => ({ key, ...v }));
  }, [orders]);

  const selectedGroup = useMemo(() => {
    const first = orders.find((o) => selected.has(o.order.id));
    return first ? groupKey(first) : null;
  }, [orders, selected]);

  const toggle = (o: OpenOrder) => {
    const k = groupKey(o);
    if (selectedGroup && k !== selectedGroup && !selected.has(o.order.id)) {
      toast.info("Tek seferde tek müşteri+şube — önce diğer seçimi kaldırın.");
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(o.order.id)) next.delete(o.order.id);
      else next.add(o.order.id);
      return next;
    });
  };

  const createMut = useMutation({
    mutationFn: () => packingService.createShipment([...selected]),
    onSuccess: (res) => {
      toast.success(`Sevkiyat açıldı: ${res.data.shipmentNo}`);
      void qc.invalidateQueries({ queryKey: ["packing", "open-orders"] });
      void qc.invalidateQueries({ queryKey: ["shipments"] });
      setSelected(new Set());
      onStarted(res.data.id);
    },
  });

  if (q.isLoading) {
    return (
      <div className="space-y-2 p-6">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {inProgress.length > 0 && (
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <PlayCircle className="h-4 w-4 text-primary" /> Devam Eden Sevkiyatlar
          </h3>
          <div className="grid gap-2 lg:grid-cols-2">
            {inProgress.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onStarted(s.id)}
                className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
              >
                <span>
                  <span className="font-mono font-semibold">{s.shipmentNo}</span>
                  <span className="ml-2 text-muted-foreground">{s.customer}</span>
                </span>
                <Badge variant="outline" className="text-[10px]">
                  {shipmentStatusLabels[s.status]}
                </Badge>
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <ClipboardList className="h-4 w-4" /> Açık Siparişler
        </h3>
        {groups.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Paketlenecek açık sipariş yok.
          </p>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => {
              const dimmed = selectedGroup !== null && g.key !== selectedGroup;
              return (
                <div key={g.key} className={cn("rounded-lg border", dimmed && "opacity-50")}>
                  <div className="border-b bg-muted/40 px-3 py-1.5 text-xs font-medium">{g.label}</div>
                  <ul className="divide-y">
                    {g.orders.map((o) => {
                      const checked = selected.has(o.order.id);
                      const allCovered = o.lines.every((l) => l.covered);
                      return (
                        <li key={o.order.id}>
                          <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggle(o)}
                              className="h-4 w-4"
                            />
                            <span className="flex-1">
                              <span className="font-mono font-medium">{o.order.orderNumber}</span>
                              <span className="ml-2 text-xs text-muted-foreground">
                                {o.lines.length} kalem
                                {o.order.deadline
                                  ? ` · termin ${safeFormat(o.order.deadline, "dd.MM.yyyy")}`
                                  : ""}
                              </span>
                            </span>
                            <Badge variant={allCovered ? "secondary" : "outline"} className="text-[10px]">
                              {allCovered ? "depoda var" : "kısmi/eksik"}
                            </Badge>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {selected.size > 0 && (
        <div className="sticky bottom-0 flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 shadow-lg">
          <span className="text-sm text-muted-foreground">{selected.size} sipariş seçildi</span>
          <Button disabled={createMut.isPending} onClick={() => createMut.mutate()}>
            <PackagePlus className="mr-1 h-4 w-4" /> Paketlemeye Başla
          </Button>
        </div>
      )}
    </div>
  );
}
