import { useState } from "react";
import { getCoreRowModel, useReactTable, type RowSelectionState } from "@tanstack/react-table";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRightLeft, PackageOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table/DataTable";
import { sackHubService } from "./service";
import { invalidateSackHub } from "./useSackData";
import { sackContentsColumns } from "./sackContentsColumns";
import { MoveRollsDialog } from "./MoveRollsDialog";
import type { SackContentRoll } from "./types";

interface Props {
  sackId: string;
  rolls: SackContentRoll[];
  /** Sevkiyata atanmış çuval → salt-okunur (seçim kapalı). */
  locked: boolean;
  /** Taşıma hedefleri — aynı müşterinin diğer depo çuvalları. */
  targets: { id: string; sackNo: string }[];
}

/**
 * Çuval içeriği (top) — seçilebilir DataTable. Seçim çubuğundan toplu aksiyon:
 * "Depoya Çıkar" (dağıt) ve "Başka Çuvala Aktar". Kilitli çuvalda seçim kapalı.
 */
export function SackContentsTable({ sackId, rolls, locked, targets }: Props) {
  const qc = useQueryClient();
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [moveRollIds, setMoveRollIds] = useState<string[] | null>(null);

  const table = useReactTable({
    data: rolls,
    columns: sackContentsColumns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (r) => r.id,
    enableRowSelection: !locked,
    state: { rowSelection },
    onRowSelectionChange: setRowSelection,
  });

  const distributeMut = useMutation({
    mutationFn: (rollIds: string[]) => sackHubService.distributeSack(sackId, { rollIds }),
    onSuccess: (res, rollIds) => {
      toast.success(res.message ?? `${rollIds.length} top depoya çıkarıldı`);
      invalidateSackHub(qc);
      table.resetRowSelection();
    },
  });

  return (
    <>
      <DataTable<SackContentRoll>
        table={table}
        emptyText="Çuval boş. Yukarıdan top okutarak doldurun."
        selectionHint="Toplu işlem için topları seçin → depoya çıkar / başka çuvala aktar."
        bulkActions={(selected) =>
          selected.length === 0 ? null : (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5"
                disabled={distributeMut.isPending}
                onClick={() => distributeMut.mutate(selected.map((r) => r.id))}
              >
                <PackageOpen className="h-3.5 w-3.5" /> Depoya Çıkar
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5"
                disabled={targets.length === 0}
                title={targets.length === 0 ? "Aktarılacak başka çuval yok" : undefined}
                onClick={() => setMoveRollIds(selected.map((r) => r.id))}
              >
                <ArrowRightLeft className="h-3.5 w-3.5" /> Başka Çuvala Aktar
              </Button>
            </>
          )
        }
      />
      <MoveRollsDialog
        sackId={sackId}
        rollIds={moveRollIds}
        targets={targets}
        onOpenChange={(o) => !o && setMoveRollIds(null)}
        onDone={() => table.resetRowSelection()}
      />
    </>
  );
}
