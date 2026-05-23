import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { shipmentService } from "./service";

interface PickerRow {
  rollId: string;
  barcode: string | null;
  itemName: string;
  colorName?: string | null;
  rollStatus: string;
  qty: number;
  weightKg: number | null;
  width: number | null;
  /** Tahsisli ise sipariş numarası; fason ise null. */
  orderNumber: string | null;
  /** Fason ürünleri ayırt etmek için. */
  isFason: boolean;
}

interface Props {
  customerId: string;
  /** Sevkiyatta zaten ekli olan rollId'ler (tekrar gösterilmesin). */
  excludeRollIds: Set<string>;
  selected: Set<string>;
  onToggle: (rollId: string) => void;
  onToggleAll: (checked: boolean) => void;
}

export function ReadyRollsPicker({
  customerId,
  excludeRollIds,
  selected,
  onToggle,
  onToggleAll,
}: Props) {
  const ordersQ = useQuery({
    queryKey: ["ready-orders", customerId],
    queryFn: () => shipmentService.readyForCustomer(customerId),
  });

  const fasonQ = useQuery({
    queryKey: ["ready-fason"],
    queryFn: () => shipmentService.readyFason(),
  });

  const rows = useMemo<PickerRow[]>(() => {
    const out: PickerRow[] = [];

    for (const order of ordersQ.data?.data ?? []) {
      for (const line of order.lines) {
        for (const a of line.allocatedRolls) {
          if (excludeRollIds.has(a.rollId)) continue;
          out.push({
            rollId: a.rollId,
            barcode: a.barcode,
            itemName: line.itemName,
            rollStatus: a.rollStatus,
            qty: a.allocatedQty,
            weightKg: null,
            width: null,
            orderNumber: order.orderNumber,
            isFason: false,
          });
        }
      }
    }

    const fasonGroup = (fasonQ.data?.data ?? []).find((g) => g.customerId === customerId);
    if (fasonGroup) {
      for (const r of fasonGroup.rolls) {
        if (excludeRollIds.has(r.rollId)) continue;
        out.push({
          rollId: r.rollId,
          barcode: r.barcode,
          itemName: `${r.itemName}${r.colorName ? ` · ${r.colorName}` : ""}`,
          rollStatus: r.status,
          qty: r.currentQty,
          weightKg: r.weightKg,
          width: r.width,
          orderNumber: null,
          isFason: true,
        });
      }
    }

    return out;
  }, [ordersQ.data, fasonQ.data, customerId, excludeRollIds]);

  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.rollId));
  const someChecked = !allChecked && rows.some((r) => selected.has(r.rollId));

  if (ordersQ.isLoading || fasonQ.isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="text-muted-foreground flex h-24 items-center justify-center rounded-md border border-dashed text-sm">
        Bu müşteri için sevkiyata hazır top yok.
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30">
            <TableHead className="w-10">
              <Checkbox
                checked={allChecked || (someChecked && "indeterminate")}
                onCheckedChange={(v) => onToggleAll(v === true)}
                aria-label="Tümünü seç"
              />
            </TableHead>
            <TableHead>Barkod</TableHead>
            <TableHead>Ürün</TableHead>
            <TableHead>Kaynak</TableHead>
            <TableHead>Durum</TableHead>
            <TableHead className="text-right">Metre</TableHead>
            <TableHead className="text-right">Kg</TableHead>
            <TableHead className="text-right">En</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const checked = selected.has(r.rollId);
            return (
              <TableRow
                key={r.rollId}
                data-state={checked ? "selected" : undefined}
                onClick={() => onToggle(r.rollId)}
                className="cursor-pointer"
              >
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => onToggle(r.rollId)}
                    aria-label="Seç"
                  />
                </TableCell>
                <TableCell className="font-mono text-xs">{r.barcode}</TableCell>
                <TableCell>{r.itemName}</TableCell>
                <TableCell>
                  {r.orderNumber ? (
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {r.orderNumber}
                    </Badge>
                  ) : r.isFason ? (
                    <Badge variant="secondary" className="text-[10px]">
                      Fason
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-[10px]">
                    {r.rollStatus}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.qty.toFixed(1)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.weightKg != null ? r.weightKg.toFixed(1) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.width != null ? r.width : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
