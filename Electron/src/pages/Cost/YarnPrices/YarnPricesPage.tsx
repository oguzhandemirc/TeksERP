// =============================================================================
// MALİYET › İPLİK MALİYET FİYATLARI (MAL-3) — `cost:read` görür, `cost:write` değiştirir.
// Fiyatın yaşı > 90 gün amber (motorun PRICE_STALE eşiği); geçmiş damgalı satırlar çekmecede.
// =============================================================================
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, Plus } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { ListBody, ListFooter, ListMessage } from "@/components/layout/ListPage";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { fmtFactoryDate } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
import { CostQueryError } from "../shared/CostQueryState";
import { STALE_DAYS, ageDays, fmtDecFull } from "../shared/format";
import { YarnPriceDialog } from "./YarnPriceDialog";
import { YarnPriceHistorySheet } from "./YarnPriceHistorySheet";
import { YARN_PRICE_SOURCE_LABEL, yarnPriceService, type YarnCostPrice } from "./service";
import { RefreshButton } from "@/components/RefreshButton";

export function YarnPricesPage() {
  const q = useQuery({ queryKey: ["cost-yarn-prices", "active"], queryFn: yarnPriceService.listActive });
  const [edit, setEdit] = useState<{ row: YarnCostPrice | null } | null>(null);
  const [history, setHistory] = useState<YarnCostPrice | null>(null);
  const rows = q.data ?? [];
  return (
    <PageShell>
      <PageHeader
        title="İplik Maliyet Fiyatları"
        description="Maliyet hesabında kullanılan kg fiyatı. Değişiklik yeni satır yazar, eski fiyat damgalı kalır; kayıtlı standart maliyetler değişmez."
        actions={
          <div className="flex gap-2">
            <RefreshButton queryKey={["cost-yarn-prices"]} />
            <PermissionGate permission="cost:write">
              <Button onClick={() => setEdit({ row: null })}><Plus className="mr-1 h-4 w-4" />Fiyat gir</Button>
            </PermissionGate>
          </div>
        }
      />
      <ListBody>
        {q.isLoading ? (
          <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>
        ) : q.isError ? (
          <ListMessage>
            <CostQueryError error={q.error} what="İplik fiyatları" onRetry={() => void q.refetch()} />
          </ListMessage>
        ) : rows.length === 0 ? (
          <ListMessage>
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Henüz iplik maliyet fiyatı yok — "Fiyat gir" ile çözgü ve atkı ipliklerinin kg fiyatını yazın; fiyatı olmayan iplik maliyette eksik sayılır.
            </div>
          </ListMessage>
        ) : (
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">İplik</th>
                <th className="px-3 py-2 text-right">Denye</th>
                <th className="px-3 py-2 text-right">Fiyat</th>
                <th className="px-3 py-2">Kaynak</th>
                <th className="px-3 py-2">Tarih</th>
                <th className="px-3 py-2 text-right">Yaş</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>{rows.map((r) => <PriceRow key={r.id} r={r} onEdit={() => setEdit({ row: r })} onHistory={() => setHistory(r)} />)}</tbody>
          </table>
        )}
      </ListBody>
      <ListFooter loaded={rows.length} />
      {edit && <YarnPriceDialog open onOpenChange={(o) => !o && setEdit(null)} current={edit.row} />}
      {history && <YarnPriceHistorySheet row={history} onClose={() => setHistory(null)} />}
    </PageShell>
  );
}

function PriceRow({ r, onEdit, onHistory }: { r: YarnCostPrice; onEdit: () => void; onHistory: () => void }) {
  const age = ageDays(r.createdAt);
  const stale = age > STALE_DAYS;
  return (
    <tr className="border-t">
      <td className="px-3 py-2"><span className="font-medium">{r.yarnItem.code}</span> <span className="text-muted-foreground">{r.yarnItem.name}</span></td>
      <td className="px-3 py-2 text-right tabular-nums">{fmtDecFull(r.yarnItem.linearDensityDen, 2)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{fmtDecFull(r.pricePerKg)} {r.currency}/kg</td>
      <td className="px-3 py-2">{YARN_PRICE_SOURCE_LABEL[r.source] ?? r.source}</td>
      <td className="px-3 py-2">{fmtFactoryDate(r.createdAt)}</td>
      <td className={cn("px-3 py-2 text-right tabular-nums", stale && "font-medium text-amber-600 dark:text-amber-400")} title={stale ? "90 günden eski — maliyette PRICE_STALE uyarısı" : undefined}>
        {age} gün
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <PermissionGate permission="cost:write"><Button size="sm" variant="outline" onClick={onEdit}>Fiyat değiştir</Button></PermissionGate>
        <Button size="sm" variant="ghost" onClick={onHistory} aria-label="Geçmiş"><History className="h-4 w-4" /></Button>
      </td>
    </tr>
  );
}
