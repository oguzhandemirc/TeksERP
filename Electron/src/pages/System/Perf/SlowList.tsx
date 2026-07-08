import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SlowRequest } from "./perfService";

/** Yavaş istek defteri (≥1sn, son 50 — en yenisi başta). 499 = istemci bekledi
 *  ama vazgeçti (timeout/pencere kapandı) — çoğu zaman EN önemli satırlar. */
export function SlowList({ items }: { items: SlowRequest[] }) {
  if (items.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Yavaş istek yok (≥1sn eşiği) — güzel haber.
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Zaman</TableHead>
          <TableHead>Endpoint</TableHead>
          <TableHead className="text-right">Durum</TableHead>
          <TableHead className="text-right">Süre</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((s, i) => (
          <TableRow key={`${s.at}-${i}`}>
            <TableCell className="whitespace-nowrap text-xs tabular-nums">
              {new Date(s.at).toLocaleString("tr-TR")}
            </TableCell>
            <TableCell className="font-mono text-xs">
              {s.method} {s.route}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {s.status === 499 ? "499 (istemci vazgeçti)" : s.status}
            </TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              {(s.ms / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} sn
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
