import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { PackageOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { loadAllForPicker } from "@/lib/picker-loader";
import { customerService } from "@/pages/Customers/service";
import { packingService } from "./service";
import { OpenOrdersQueue } from "./OpenOrdersQueue";
import type { PackingTarget } from "./PackingWorkspace";
import type { OpenOrder } from "./types";

interface Props {
  onStarted: (target: PackingTarget) => void;
}

const groupKey = (o: OpenOrder) => `${o.order.customer.id}|${o.order.branch?.id ?? "_"}`;

/**
 * Paketleme giriş ekranı — SOL açık sipariş kuyruğu (tek müşteri+şube seç → o müşteriye
 * paketle), SAĞ doğrudan müşteri seçimi (siparişsiz stok paketleme). İkisi de aynı
 * müşteri-bazlı workspace'e iner.
 */
export function OrderSelectionPanel({ onStarted }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [directCustomer, setDirectCustomer] = useState<string | undefined>();

  const q = useQuery({
    queryKey: ["packing", "open-orders"],
    queryFn: () => packingService.listOpenOrders(),
    staleTime: 15_000,
  });
  const orders = useMemo(() => q.data?.data ?? [], [q.data]);

  const customersQ = useQuery({
    queryKey: ["customers", "picker"],
    queryFn: () => loadAllForPicker(customerService),
    staleTime: 60_000,
  });
  const customers = (customersQ.data?.data ?? []) as Array<{ id: string; name?: string; code?: string }>;

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

  const startFromOrders = () => {
    const first = orders.find((o) => selected.has(o.order.id));
    if (!first) return;
    onStarted({
      customerId: first.order.customer.id,
      customerName: first.order.customer.name,
      branchId: first.order.branch?.id ?? null,
      branchName: first.order.branch?.name ?? null,
    });
  };

  const startFromCustomer = () => {
    const c = customers.find((x) => x.id === directCustomer);
    if (!c) return;
    onStarted({ customerId: c.id, customerName: c.name ?? c.code ?? c.id });
  };

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
          openOrders={orders}
          search={search}
          onSearchChange={setSearch}
          selected={selected}
          selectedGroup={selectedGroup}
          onToggle={toggle}
        />
        <div className="flex flex-col gap-3 lg:border-l lg:pl-6">
          <h3 className="text-sm font-semibold">Doğrudan müşteriye çuvalla</h3>
          <p className="text-xs text-muted-foreground">
            Siparişten bağımsız (stok / fazla mal) paketleme için müşteri seç.
          </p>
          <Select value={directCustomer} onValueChange={setDirectCustomer}>
            <SelectTrigger>
              <SelectValue placeholder="Müşteri seç…" />
            </SelectTrigger>
            <SelectContent>
              {customers.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name ?? c.code ?? c.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button disabled={!directCustomer} onClick={startFromCustomer}>
            <PackageOpen className="mr-1 h-4 w-4" /> Bu Müşteriye Paketle
          </Button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-3 border-t bg-card px-6 py-3 shadow-lg">
          <span className="text-sm text-muted-foreground">{selected.size} sipariş seçildi (rehber)</span>
          <Button onClick={startFromOrders}>
            <PackageOpen className="mr-1 h-4 w-4" /> Bu Müşteriye Paketlemeye Başla
          </Button>
        </div>
      )}
    </div>
  );
}
