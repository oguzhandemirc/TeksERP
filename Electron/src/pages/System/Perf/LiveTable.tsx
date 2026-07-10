import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { PerfRoute } from "./perfService";

/** p95 için basit renk skalası — göz tek bakışta yavaş ucu bulsun. */
function p95Class(ms: number): string {
  if (ms >= 2_000) return "text-destructive font-semibold";
  if (ms >= 500) return "text-amber-600 font-medium";
  return "";
}

export function LiveTable({ routes }: { routes: PerfRoute[] }) {
  if (routes.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Henüz ölçüm yok — sunucu yeni başlamış veya sayaçlar sıfırlanmış olabilir.
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Endpoint</TableHead>
          <TableHead className="text-right">İstek</TableHead>
          <TableHead className="text-right">Hata (5xx)</TableHead>
          <TableHead className="text-right">p50</TableHead>
          <TableHead className="text-right">p95</TableHead>
          <TableHead className="text-right">max</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {routes.map((r) => (
          <TableRow key={r.route}>
            <TableCell className="font-mono text-xs">{r.route}</TableCell>
            <TableCell className="text-right tabular-nums">{r.count.toLocaleString("tr-TR", { useGrouping: false })}</TableCell>
            <TableCell
              className={cn("text-right tabular-nums", r.errCount > 0 && "text-destructive font-medium")}
            >
              {r.errCount}
            </TableCell>
            <TableCell className="text-right tabular-nums">{r.p50Ms} ms</TableCell>
            <TableCell className={cn("text-right tabular-nums", p95Class(r.p95Ms))}>
              {r.p95Ms} ms
            </TableCell>
            <TableCell className="text-right tabular-nums">{r.maxMs} ms</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
