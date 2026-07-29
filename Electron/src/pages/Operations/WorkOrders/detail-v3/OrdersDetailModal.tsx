import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatNumber } from "@/lib/format";

export interface OrderDetailRow {
  id: string;
  customer: string;
  orderNumber: string;
  branch: string;
  qty: number;
  shipped: number;
}

/**
 * Bağlı siparişlerin detaylı listesi (modal) — müşteri, sipariş no, şube ve
 * talep/sevk/açık/karşılanma. KPI'daki "Siparişler" kutusundaki ⓘ'den açılır;
 * böylece çok sipariş olsa da KPI kutusu şişmez.
 */
export function OrdersDetailModal({
  open,
  onOpenChange,
  rows,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: OrderDetailRow[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Bağlı Siparişler ({rows.length})</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto">
          <Table containerClassName="overflow-visible">
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead>Müşteri</TableHead>
                <TableHead>Sipariş No</TableHead>
                <TableHead>Şube</TableHead>
                <TableHead className="text-right">Talep</TableHead>
                <TableHead className="text-right">Sevk</TableHead>
                <TableHead className="text-right">Açık</TableHead>
                <TableHead className="text-right">Karşılanma</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const open2 = Math.max(0, r.qty - r.shipped);
                const pct = r.qty > 0 ? Math.min(100, Math.round((r.shipped / r.qty) * 100)) : 0;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.customer}</TableCell>
                    <TableCell className="font-mono text-xs">{r.orderNumber}</TableCell>
                    <TableCell>{r.branch}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(r.qty, 0)} m</TableCell>
                    <TableCell className="text-right tabular-nums text-success">
                      {formatNumber(r.shipped, 0)} m
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-destructive">
                      {formatNumber(open2, 0)} m
                    </TableCell>
                    <TableCell className="text-right tabular-nums">%{pct}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
