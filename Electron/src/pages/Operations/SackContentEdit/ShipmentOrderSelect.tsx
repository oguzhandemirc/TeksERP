import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { safeFormat } from "@/lib/format";
import { sackHubService } from "./service";

const fmtM = (n: number) => `${Math.round(Number(n))}m`;

interface Props {
  customerId: string;
  branchId: string | null;
  selectedIds: Set<string>;
  onToggle: (orderId: string) => void;
}

/** Sevkiyata sayılacak açık siparişleri seç (çoklu). Boş bırakılırsa siparişsiz sevk. */
export function ShipmentOrderSelect({ customerId, branchId, selectedIds, onToggle }: Props) {
  const q = useQuery({
    queryKey: ["packing", "open-orders", customerId, branchId ?? null],
    queryFn: () => sackHubService.listOpenOrders({ customerId, branchId: branchId ?? undefined }),
    staleTime: 15_000,
  });
  const orders = useMemo(() => q.data?.data ?? [], [q.data]);

  if (q.isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Açık siparişler yükleniyor…
      </div>
    );
  }
  if (orders.length === 0) {
    return <p className="py-3 text-center text-xs text-muted-foreground">Bu müşterinin açık siparişi yok — siparişsiz devam edin.</p>;
  }

  return (
    <ul className="max-h-52 space-y-1 overflow-auto">
      {orders.map((o) => {
        const checked = selectedIds.has(o.order.id);
        const openSum = o.lines.reduce((s, l) => s + Math.max(0, Number(l.openQty)), 0);
        return (
          <li key={o.order.id}>
            <label
              className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors",
                checked ? "border-primary/60 bg-primary/5" : "hover:bg-muted/50",
              )}
            >
              <Checkbox checked={checked} onCheckedChange={() => onToggle(o.order.id)} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2">
                  <span className="font-mono font-medium">{o.order.orderNumber}</span>
                  <span className="text-xs text-muted-foreground">{o.lines.length} kalem · {fmtM(openSum)} açık</span>
                  {o.order.deadline && (
                    <span className="text-xs text-muted-foreground">termin {safeFormat(o.order.deadline, "dd.MM.yyyy")}</span>
                  )}
                </div>
                {/* Bizdeki ad — sevk kurma akışının geri kalanı (çuval/top listeleri)
                    bizdeki adı bastığından müşteri override'ı burada kullanılmaz. */}
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {o.lines
                    .slice(0, 2)
                    .map((l) => `${l.item.name}${l.color ? ` · ${l.color.name}` : ""}`)
                    .join(" · ")}
                  {o.lines.length > 2 ? ` +${o.lines.length - 2}` : ""}
                </div>
              </div>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
