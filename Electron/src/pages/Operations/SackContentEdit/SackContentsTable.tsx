import { useState } from "react";
import { getCoreRowModel, useReactTable, type RowSelectionState } from "@tanstack/react-table";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRightLeft, PackageOpen, SplitSquareHorizontal } from "lucide-react";
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
  /** Kaynak çuvalın müşterisi — hedef seçicide "farklı müşteri" uyarısı için. */
  sourceCustomerId: string | null;
  sourceCustomerName: string | null;
}

/**
 * Çuval içeriği (top) — seçilebilir DataTable. Seçim çubuğundan toplu aksiyon:
 * "Depoya Çıkar" (dağıt) ve "Başka Çuvala Aktar". Kilitli çuvalda seçim kapalı.
 */
export function SackContentsTable({ sackId, rolls, locked, sourceCustomerId, sourceCustomerName }: Props) {
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

  // Böl: seçilenlerden YENİ çuval. Backend atomik (çuval aç + taşı + kg sıfırla)
  // → istemcide openSack+move iki-çağrısı yapılmaz (yarım kalırsa boş çuval kalırdı).
  const splitMut = useMutation({
    mutationFn: (rollIds: string[]) => sackHubService.splitSack(sackId, rollIds),
    onSuccess: (res) => {
      toast.success(res.message ?? `Yeni çuval: ${res.data.sackNo}`);
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
              {/* Hedef listesi DİYALOĞUN İÇİNDE aranır → burada "hedef var mı?"
                  ön-kontrolü YOK. Eskiden hedefler müşteri havuzundan geliyordu ve
                  müşterisiz çuvalda liste hep boş kaldığı için buton kalıcı pasifti. */}
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5"
                title="Seçili topları başka depo çuvalına aktar"
                onClick={() => setMoveRollIds(selected.map((r) => r.id))}
              >
                <ArrowRightLeft className="h-3.5 w-3.5" /> Başka Çuvala Aktar
              </Button>
              {/* Böl — hedef çuval GEREKMEZ, yenisi açılır. Hepsi seçiliyken pasif:
                  kaynakta en az bir top kalmalı (backend de 400 verir). */}
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5"
                disabled={splitMut.isPending || selected.length >= rolls.length}
                title={
                  selected.length >= rolls.length
                    ? "Tüm toplar seçili — bölmek için en az bir top çuvalda kalmalı"
                    : "Seçilenleri yeni bir çuvala ayır"
                }
                onClick={() => splitMut.mutate(selected.map((r) => r.id))}
              >
                <SplitSquareHorizontal className="h-3.5 w-3.5" /> Seçilenlerden Yeni Çuval
              </Button>
            </>
          )
        }
      />
      <MoveRollsDialog
        sackId={sackId}
        rollIds={moveRollIds}
        sourceCustomerId={sourceCustomerId}
        sourceCustomerName={sourceCustomerName}
        onOpenChange={(o) => !o && setMoveRollIds(null)}
        onDone={() => table.resetRowSelection()}
      />
    </>
  );
}
