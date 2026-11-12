// =============================================================================
// KG BAKİYE LİSTESİ (kalem × depo)
// =============================================================================
// ⚠️ EKSİ BAKİYE HATA GİBİ GÖSTERİLMEZ. Sayım/açılış girilmeden çıkış
// yazıldıysa defter GERÇEKTEN eksidir ve bu meşrudur; kırmızı "hata" rozeti
// operatörü olmayan bir arızayı aramaya gönderirdi. Ama gizlenmez ve sıfıra da
// kırpılmaz — nötr bir uyarı işareti (amber üçgen + "eksi bakiye" ibaresi) ile
// GÖRÜNÜR yapılır. ⚠️ Renk tek başına bilgi taşımaz (renk körlüğü + eldivenli
// hızlı bakış): ibare her zaman METİN olarak da basılır.
//
// ⚠️ SATIRIN TIKLANMASI HAREKET DÖKÜMÜNÜ AÇAR, bir şey DEĞİŞTİRMEZ. Bu ekranda
// tek yıkıcı olmayan-geri-alınamaz eylem hareket yazmaktır ve o, kendi
// düğmesinin arkasındadır (`yarn:write`).
//
// ⚠️ DEPO SÜTUNU tek depolu kurulumda çizilmez — "sıfır görünür fark" kuralının
// sütun ayağı (`useMultiWarehouse` tek kaynak; burada YENİDEN hesaplanmaz).
// =============================================================================
import { useMemo } from "react";
import type { ColumnDef, Table } from "@tanstack/react-table";
import { AlertTriangle, History, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { DataTable } from "@/components/data-table/DataTable";
import { useLocalTable } from "@/hooks/useLocalTable";
import { cn } from "@/lib/utils";
import { formatInstant, type YarnStockRow } from "./service";
import { isNegative, kg } from "./qty";

interface Handlers {
  onOpenMovements: (row: YarnStockRow) => void;
  onAddMovement: (row: YarnStockRow) => void;
}

const CODE_NAME: ColumnDef<YarnStockRow>[] = [
  { id: "code", header: "Stok Kodu", meta: { label: "Stok Kodu", exportValue: (r) => r.item.code }, cell: ({ row }) => <span className="font-mono text-xs">{row.original.item.code}</span> },
  { id: "name", header: "İplik", size: 240, meta: { label: "İplik", exportValue: (r) => r.item.name }, cell: ({ row }) => <span className="font-medium">{row.original.item.name}</span> },
];
const WAREHOUSE: ColumnDef<YarnStockRow> = {
  id: "warehouse",
  header: "Depo",
  meta: { label: "Depo", exportValue: (r) => r.warehouse.name },
  cell: ({ row }) => <span className="text-muted-foreground">{row.original.warehouse.name}</span>,
};
const BALANCE_UPDATED: ColumnDef<YarnStockRow>[] = [
  {
    id: "balance",
    header: "Bakiye",
    meta: { label: "Bakiye", align: "right", exportValue: (r) => kg(r.balanceKg) },
    cell: ({ row: { original: r } }) => {
      const negative = isNegative(r.balanceKg);
      return (
        <span className={cn("font-medium tabular-nums", negative && "text-amber-700 dark:text-amber-500")}>
          {negative && (
            <span className="mr-1.5 inline-flex items-center gap-1 text-[11px] font-normal">
              <AlertTriangle className="h-3 w-3" />
              eksi bakiye
            </span>
          )}
          {kg(r.balanceKg)}
        </span>
      );
    },
  },
  {
    id: "updatedAt",
    header: "Son Hareket",
    meta: { label: "Son Hareket", exportValue: (r) => formatInstant(r.updatedAt) },
    cell: ({ row }) => <span className="text-muted-foreground">{formatInstant(row.original.updatedAt)}</span>,
  },
];

function yarnActions({ onOpenMovements, onAddMovement }: Handlers): ColumnDef<YarnStockRow> {
  return {
    id: "actions",
    header: () => <span className="sr-only">Eylemler</span>,
    enableHiding: false,
    size: 90,
    meta: { label: "Eylemler", align: "right" },
    // Satır tıklaması dökümü zaten açıyor; düğmeler o davranışı GÖRÜNÜR kılar ve klavye ile erişilebilir tutar.
    // `stopPropagation` olmadan "Hareket Ekle" aynı anda dökümü de açar ve diyalog panelin altında kalırdı.
    cell: ({ row: { original: r } }) => (
      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        <Button variant="outline" size="icon" className="h-7 w-7" title="Hareket dökümü" onClick={() => onOpenMovements(r)}>
          <History className="h-4 w-4" />
        </Button>
        <PermissionGate permission="yarn:write">
          <Button variant="outline" size="icon" className="h-7 w-7" title="Bu iplik için hareket ekle" onClick={() => onAddMovement(r)}>
            <Plus className="h-4 w-4" />
          </Button>
        </PermissionGate>
      </div>
    ),
  };
}

/** Tablo sayfada kurulur; Depo sütunu tek depolu kurulumda HİÇ tanımlanmaz (menüde de çıkmaz). */
export function useYarnStockTable(rows: YarnStockRow[], showWarehouse: boolean, { onOpenMovements, onAddMovement }: Handlers) {
  const columns = useMemo(
    () => [...CODE_NAME, ...(showWarehouse ? [WAREHOUSE] : []), ...BALANCE_UPDATED, yarnActions({ onOpenMovements, onAddMovement })],
    [showWarehouse, onOpenMovements, onAddMovement],
  );
  return useLocalTable({ tableKey: "yarn:stocks", data: rows, columns });
}

export function YarnStockTable({ table, onOpenMovements }: { table: Table<YarnStockRow>; onOpenMovements: (row: YarnStockRow) => void }) {
  return <DataTable<YarnStockRow> table={table} onRowClick={onOpenMovements} exportName="İplik stoğu" />;
}
