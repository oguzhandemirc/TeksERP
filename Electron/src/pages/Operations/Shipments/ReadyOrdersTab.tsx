import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DeadlineBadge } from "@/components/operations/DeadlineBadge";
import { shipmentService, type ReadyOrder } from "./service";

interface OrderSummary {
  order: ReadyOrder;
  rollCount: number;
  totalQty: number;
}

function summarize(o: ReadyOrder): OrderSummary {
  let rollCount = 0;
  let totalQty = 0;
  for (const line of o.lines) {
    for (const a of line.allocatedRolls) {
      rollCount++;
      totalQty += a.allocatedQty;
    }
  }
  return { order: o, rollCount, totalQty };
}

export function ReadyOrdersTab() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: ["ready-orders", "list", search],
    queryFn: () => shipmentService.readyOrders(search || undefined),
  });

  const rows = useMemo<OrderSummary[]>(
    () => (query.data?.data ?? []).map(summarize),
    [query.data]
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          Tabletten paketlenmiş veya doğrudan üretimden hazır toplari olan açık siparişler.
          Tek tıkta sevk et — müşteri/şube/toplar otomatik gelir.
        </p>
        <Input
          className="h-8 max-w-64"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Sipariş no / müşteri ara..."
        />
      </div>

      {query.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="text-muted-foreground flex h-32 items-center justify-center rounded-md border border-dashed text-sm">
          Sevk edilebilir sipariş yok.
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Sipariş</TableHead>
                <TableHead>Müşteri</TableHead>
                <TableHead>Şube</TableHead>
                <TableHead>Termin</TableHead>
                <TableHead className="text-right">Top</TableHead>
                <TableHead className="text-right">Hazır Metre</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ order, rollCount, totalQty }) => (
                <TableRow key={order.orderId}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold">
                        {order.orderNumber}
                      </span>
                      <Badge variant="outline" className="px-1 text-[9px]">
                        {order.status}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>{order.customerName}</TableCell>
                  <TableCell className="text-sm">
                    {order.branch ? (
                      <span>
                        {order.branch.name}
                        {order.branch.city && (
                          <span className="text-muted-foreground"> · {order.branch.city}</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <DeadlineBadge deadline={order.deadline} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{rollCount}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {totalQty.toFixed(0)} m
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      className="w-full gap-1.5"
                      onClick={() =>
                        navigate(`/operations/shipments/from-order/${order.orderId}`)
                      }
                    >
                      <Send className="h-3.5 w-3.5" /> Sevk Et
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
