// =============================================================================
// MALİYET › HİZMET SARF NORMLARI (D4-G1b) — `cost:read` görür, `cost:write` girer/değiştirir/kaldırır.
// Hizmet kalemi × sarf kalemi × metre başı miktar; kârlılıkta "İpe giden" bu normla hesaplanır (sunucuda).
// =============================================================================
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, Plus } from "lucide-react";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { fmtFactoryDate } from "@/lib/factory-time";
import { CostQueryError } from "../shared/CostQueryState";
import { fmtDecFull } from "../shared/format";
import { ConsumableNormDialog } from "./ConsumableNormDialog";
import { ConsumableNormHistorySheet } from "./ConsumableNormHistorySheet";
import { consumableNormService, type ConsumableNorm } from "./service";

export function ConsumableNormsPage() {
  const q = useQuery({ queryKey: ["cost-consumable-norms", "active"], queryFn: consumableNormService.listActive });
  const [edit, setEdit] = useState<{ current: ConsumableNorm | null } | null>(null);
  const [history, setHistory] = useState<ConsumableNorm | null>(null);
  const rows = q.data ?? [];
  return (
    <PageShell>
      <PageHeader
        title="Hizmet Sarf Normları"
        description="Bir hizmetin metresi için harcanan sarf (ip, kurşun…). Değişiklik şu andan itibaren geçerli yeni sürümdür; eski norm damgalı kalır."
        actions={
          // Kalem seçici /api/items ister (item:read); izinsiz rolde düğme 403'e açılmasın diye birlikte kapılı.
          <PermissionGate allOf={["cost:write", "item:read"]}>
            <Button onClick={() => setEdit({ current: null })}><Plus className="mr-1 h-4 w-4" />Norm gir</Button>
          </PermissionGate>
        }
      />
      <PageBody className="p-4 sm:p-6">
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : q.isError ? (
          <CostQueryError error={q.error} what="Sarf normları" onRetry={() => void q.refetch()} />
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Henüz sarf normu yok — normu olmayan hizmetin sarfı kârlılıkta görünmez.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Hizmet</th>
                  <th className="px-3 py-2">Sarf</th>
                  <th className="px-3 py-2 text-right">Metre başı</th>
                  <th className="px-3 py-2">Geçerli olduğu an</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-3 py-2"><span className="font-medium">{r.serviceItem.code}</span> <span className="text-muted-foreground">{r.serviceItem.name}</span></td>
                    <td className="px-3 py-2"><span className="font-medium">{r.consumableItem.code}</span> <span className="text-muted-foreground">{r.consumableItem.name}</span></td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtDecFull(r.qtyPerM, 6)} {r.unit}</td>
                    <td className="px-3 py-2">{fmtFactoryDate(r.createdAt)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <PermissionGate permission="cost:write">
                        <Button size="sm" variant="outline" onClick={() => setEdit({ current: r })}>Normu değiştir</Button>
                      </PermissionGate>
                      <Button size="sm" variant="ghost" onClick={() => setHistory(r)} aria-label="Geçmiş"><History className="h-4 w-4" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageBody>
      {edit && <ConsumableNormDialog onClose={() => setEdit(null)} current={edit.current} />}
      {history && <ConsumableNormHistorySheet row={history} onClose={() => setHistory(null)} />}
    </PageShell>
  );
}
