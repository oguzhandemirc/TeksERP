// =============================================================================
// MALİYET › EK MALİYET FORMÜLLERİ (SY-C1) — `cost:read` görür, `cost:settings` yazar.
// Fabrikanın kendi kalemi (pul işçiliği, ambalaj payı…) metre başı formülle; standart maliyete genel giderden önce girer.
// =============================================================================
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FunctionSquare, Plus } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageShell } from "@/components/layout/PageShell";
import { ListBody, ListFooter, ListMessage, ListToolbar } from "@/components/layout/ListPage";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { useLocalTable } from "@/hooks/useLocalTable";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { RefreshButton } from "@/components/RefreshButton";
import { CostQueryError } from "../shared/CostQueryState";
import { formulaColumns } from "./columns";
import { FormulaDialog } from "./FormulaDialog";
import { FormulaHistorySheet } from "./FormulaHistorySheet";
import { costFormulaService, type CostFormula } from "./service";
import { ListSearchBox } from "@/components/data-table/ListSearchBox";
import { useListSearch } from "@/hooks/useListSearch";

export function FormulasPage() {
  const { search, setSearch, term } = useListSearch();
  const q = useQuery({ queryKey: ["cost-formulas", "active", term ?? ""], queryFn: () => costFormulaService.listActive(term) });
  const [edit, setEdit] = useState<{ row: CostFormula | null } | null>(null);
  const [history, setHistory] = useState<CostFormula | null>(null);
  const rows = q.data ?? [];
  const columns = useMemo(() => formulaColumns({ onEdit: (row) => setEdit({ row }), onHistory: setHistory }), []);
  const table = useLocalTable({ tableKey: "cost:formulas", data: rows, columns, getRowId: (r) => r.id });
  return (
    <PageShell>
      <PageHeader
        title="Maliyet Formülleri"
        description="Fabrikaya özel ek maliyet kalemleri (pul işçiliği, ambalaj payı…) — metre başına formülle hesaplanır, genel giderden önce maliyete eklenir. Değişiklik yeni sürümdür."
        actions={
          <div className="flex gap-2">
            <RefreshButton queryKey={["cost-formulas"]} />
            <PermissionGate permission="cost:settings">
              <Button onClick={() => setEdit({ row: null })}><Plus className="mr-1 h-4 w-4" />Yeni formül</Button>
            </PermissionGate>
          </div>
        }
      />
      <ListToolbar className="flex-row items-center justify-end gap-1.5">
        <ListSearchBox value={search} onSearchChange={setSearch} searchHint="Formül kodu, adı ya da ifadesi ara" />
        <DataTableTools table={table} compact exportName="Maliyet formülleri" />
      </ListToolbar>
      {!q.isLoading && !q.isError && rows.length > 0 ? (
        <DataTable table={table} exportName="Maliyet formülleri" />
      ) : (
        <ListBody>
          {q.isLoading ? (
            <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>
          ) : q.isError ? (
            <ListMessage>
              <CostQueryError error={q.error} what="Formüller" onRetry={() => void q.refetch()} />
            </ListMessage>
          ) : term ? (
            <ListMessage className="text-sm text-muted-foreground">Aramaya uyan kayıt yok.</ListMessage>
          ) : (
            <ListMessage>
              <EmptyState icon={FunctionSquare} title="Henüz ek formül yok" description={'Maliyet bugünkü kalemlerle hesaplanır. Fabrikanıza özel bir kalem için "Yeni formül" ile ifadeyi yazın (ör. atkiSikligi * 0,02).'} />
            </ListMessage>
          )}
        </ListBody>
      )}
      <ListFooter loaded={rows.length} />
      {edit && <FormulaDialog current={edit.row} onClose={() => setEdit(null)} />}
      {history && <FormulaHistorySheet row={history} onClose={() => setHistory(null)} />}
    </PageShell>
  );
}
