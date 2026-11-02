// =============================================================================
// MALİYET › FASON / TERBİYE TARİFELERİ (MAL-3) — `cost:read` görür, `cost:write` değiştirir.
// Tarife bazı HAM ya da MAMUL metre (plan §2.2 iki formül); tipik boy çekmesi yapıda yoksa kullanılır.
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
import { CostQueryError } from "../shared/CostQueryState";
import { fmtDecFull, fmtPct } from "../shared/format";
import { FinishingRateDialog } from "./FinishingRateDialog";
import { FinishingRateHistorySheet } from "./FinishingRateHistorySheet";
import { FINISHING_BASIS_LABEL, finishingBasisUnit, finishingRateService, type FinishingRate } from "./service";
import { RefreshButton } from "@/components/RefreshButton";

export function FinishingRatesPage() {
  const q = useQuery({ queryKey: ["cost-finishing-rates", "active"], queryFn: finishingRateService.listActive });
  const [edit, setEdit] = useState<{ row: FinishingRate | null } | null>(null);
  const [history, setHistory] = useState<FinishingRate | null>(null);
  const rows = q.data ?? [];
  return (
    <PageShell>
      <PageHeader
        title="Fason Tarifeleri"
        description="Terbiye/boya/apre fason ücretleri — kumaşın maliyet yapısı tarifeyi koduyla çağırır. Değişiklik yeni sürümdür."
        actions={
          <div className="flex gap-2">
            <RefreshButton queryKey={["cost-finishing-rates"]} />
            <PermissionGate permission="cost:write">
              <Button onClick={() => setEdit({ row: null })}><Plus className="mr-1 h-4 w-4" />Yeni tarife</Button>
            </PermissionGate>
          </div>
        }
      />
      <ListBody>
        {q.isLoading ? (
          <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>
        ) : q.isError ? (
          <ListMessage>
            <CostQueryError error={q.error} what="Tarifeler" onRetry={() => void q.refetch()} />
          </ListMessage>
        ) : rows.length === 0 ? (
          <ListMessage>
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Henüz tarife yok — ham satılan kumaş için tarife gerekmez; terbiyeye giden kumaş için "Yeni tarife" ile fason ücretini yazın.
            </div>
          </ListMessage>
        ) : (
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Kod / Ad</th><th className="px-3 py-2">Fason firma</th><th className="px-3 py-2">Baz</th>
                <th className="px-3 py-2 text-right">Fiyat</th><th className="px-3 py-2 text-right">Tipik çekme</th>
                <th className="px-3 py-2">Tarih</th><th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2"><span className="font-medium">{r.code}</span> <span className="text-muted-foreground">{r.name}</span></td>
                  <td className="px-3 py-2">{r.subcontractor?.name ?? "—"}</td>
                  <td className="px-3 py-2">{FINISHING_BASIS_LABEL[r.basis]}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtDecFull(r.pricePerM)} {r.currency}/{finishingBasisUnit(r.basis)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPct(r.typicalShrinkPct)}</td>
                  <td className="px-3 py-2">{fmtFactoryDate(r.createdAt)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <PermissionGate permission="cost:write"><Button size="sm" variant="outline" onClick={() => setEdit({ row: r })}>Fiyat değiştir</Button></PermissionGate>
                    <Button size="sm" variant="ghost" onClick={() => setHistory(r)} aria-label="Geçmiş"><History className="h-4 w-4" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ListBody>
      <ListFooter loaded={rows.length} />
      {edit && <FinishingRateDialog current={edit.row} onClose={() => setEdit(null)} />}
      {history && <FinishingRateHistorySheet row={history} onClose={() => setHistory(null)} />}
    </PageShell>
  );
}
