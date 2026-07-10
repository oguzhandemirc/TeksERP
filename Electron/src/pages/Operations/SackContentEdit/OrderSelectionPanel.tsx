import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { packingService } from "./service";
import { OpenOrdersQueue } from "./OpenOrdersQueue";
import { OngoingShipmentsBoard, type OngoingShipment } from "./OngoingShipmentsBoard";
import type { OpenOrder } from "./types";

interface Props {
  onStarted: (shipmentId: string) => void;
}

const groupKey = (o: OpenOrder) => `${o.order.customer.id}|${o.order.branch?.id ?? "_"}`;

/**
 * Sipariş seçim / paketleme giriş ekranı — iki pane: SOL açık sipariş kuyruğu
 * (arama · aciliyet · depo karşılanma%), SAĞ devam eden sevkiyat panosu (çuval/
 * top/metraj ilerlemeli). Tek müşteri+şube seçip yeni sevkiyat başlatılır
 * (createShipment → PREPARING); devam eden "Sürdür" ile açılır.
 */
export function OrderSelectionPanel({ onStarted }: Props) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const q = useQuery({
    queryKey: ["packing", "open-orders"],
    queryFn: () => packingService.listOpenOrders(),
    staleTime: 15_000,
  });
  const orders = useMemo(() => q.data?.data ?? [], [q.data]);

  // Devam eden sevkiyatlar (sipariş→aktif sevkiyat) — distinct.
  const inProgress = useMemo(() => {
    const m = new Map<string, OngoingShipment>();
    for (const o of orders) {
      const s = o.order.activeShipment;
      if (s && !m.has(s.id)) {
        m.set(s.id, { id: s.id, shipmentNo: s.shipmentNo, status: s.status, customer: o.order.customer.name });
      }
    }
    return [...m.values()];
  }, [orders]);

  // Açık siparişler (aktif sevkiyatı olmayan) — gruplama/arama kuyrukta.
  const openOrders = useMemo(() => orders.filter((o) => !o.order.activeShipment), [orders]);

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
    <div className="flex h-full flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-hidden p-6 lg:grid-cols-[1.7fr_1fr]">
        <OpenOrdersQueue
          openOrders={openOrders}
          search={search}
          onSearchChange={setSearch}
          selected={selected}
          selectedGroup={selectedGroup}
          onToggle={toggle}
        />
        <OngoingShipmentsBoard shipments={inProgress} onOpen={onStarted} className="lg:border-l lg:pl-6" />
      </div>

      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-3 border-t bg-card px-6 py-3 shadow-lg">
          <span className="text-sm text-muted-foreground">{selected.size} sipariş seçildi</span>
          <Button disabled={createMut.isPending} onClick={() => createMut.mutate()}>
            <PackagePlus className="mr-1 h-4 w-4" /> Paketlemeye Başla
          </Button>
        </div>
      )}
    </div>
  );
}
