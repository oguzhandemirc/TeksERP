import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, CheckCircle2, Loader2, Wrench } from "lucide-react";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { useLocalTable } from "@/hooks/useLocalTable";
import { Button } from "@/components/ui/button";
import type { RepairableShipment } from "./service";
import { factoryLocaleDateString } from "@/lib/factory-time";

const LINK_CLS = "cursor-pointer underline decoration-dotted underline-offset-4 hover:text-primary";

/** Üstteki özet şeridi — "ne kadar mal defterde yok" tek bakışta. */
export function RepairSummary({
  shipmentCount,
  gap,
  repairableCount,
  gain,
}: {
  shipmentCount: number;
  gap: number;
  repairableCount: number;
  gain: number;
}) {
  if (shipmentCount === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm dark:border-emerald-800 dark:bg-emerald-950/40">
        <CheckCircle2 className="h-5 w-5" />
        <span>Siparişe yazılamayan sevkiyat yok — defter temiz.</span>
      </div>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/40">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <AlertTriangle className="h-4 w-4" /> Deftere işlenmemiş
        </div>
        <div className="mt-1 text-2xl font-semibold">{Math.round(gap)} m</div>
        <div className="text-xs text-muted-foreground">{shipmentCount} sevkiyatta</div>
      </div>
      <div className="rounded-md border bg-muted/40 px-4 py-3">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Wrench className="h-4 w-4" /> Bugün onarılabilir
        </div>
        <div className="mt-1 text-2xl font-semibold">{Math.round(gain)} m</div>
        <div className="text-xs text-muted-foreground">{repairableCount} sevkiyatta</div>
      </div>
    </div>
  );
}

/**
 * Sipariş numaraları — id GELDİYSE tıklanabilir, gelmediyse düz metin.
 *
 * ⚠️ Eski sunucu `orders` alanını göndermez; o zaman numara okunur ama açılmaz.
 * Numaradan id'yi arayarak "yine de tıklanabilir yapmak" mükerrer numarada
 * YANLIŞ siparişi açardı — sessiz yanlış, görünür eksikten kötüdür.
 */
function OrderNumberLinks({
  row,
  onOrder,
}: {
  row: RepairableShipment;
  onOrder: (orderId: string) => void;
}) {
  if (row.orders?.length) {
    return (
      <span className="text-xs">
        {row.orders.map((o, i) => (
          <span key={o.id}>
            {i > 0 && ", "}
            <button type="button" className={LINK_CLS} onClick={() => onOrder(o.id)} title="Sipariş detayını aç">
              {o.orderNumber}
            </button>
          </span>
        ))}
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">{row.orderNumbers.join(", ") || "—"}</span>;
}

interface RowActions {
  onSelect: (s: RepairableShipment) => void;
  onOrder: (orderId: string) => void;
  onShipment: (shipmentId: string) => void;
  busyId?: string;
}

const right = (label: string) => ({ label, align: "right" as const });

function repairColumns({ onSelect, onOrder, onShipment, busyId }: RowActions): ColumnDef<RepairableShipment>[] {
  return [
    {
      id: "shipment",
      header: "Sevkiyat",
      enableHiding: false,
      meta: { label: "Sevkiyat", exportValue: (s) => s.shipmentNo },
      accessorFn: (s) => s.shipmentNo,
      cell: ({ row: { original: s } }) => (
        <span className="font-medium">
          <button type="button" className={LINK_CLS} onClick={(e) => { e.stopPropagation(); onShipment(s.shipmentId); }} title="Sevkiyat detayını aç">
            {s.shipmentNo}
          </button>
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">{s.dispatchedAt ? factoryLocaleDateString(s.dispatchedAt, "tr-TR") : "—"}</span>
        </span>
      ),
    },
    { id: "customer", header: "Müşteri", meta: { label: "Müşteri" }, accessorFn: (s) => s.customer?.name ?? "—" },
    { id: "orders", header: "Sipariş", meta: { label: "Sipariş", exportValue: (s) => s.orderNumbers.join(", ") }, cell: ({ row }) => <OrderNumberLinks row={row.original} onOrder={onOrder} /> },
    { id: "out", header: "Çıkan", meta: right("Çıkan"), accessorFn: (s) => Math.round(s.icerikMetraj) },
    { id: "written", header: "Yazılan", meta: right("Yazılan"), accessorFn: (s) => Math.round(s.yazilanMetraj) },
    {
      id: "gap",
      header: "Eksik",
      meta: right("Eksik"),
      accessorFn: (s) => Math.round(s.bosluk),
      cell: ({ row }) => <span className="font-semibold text-amber-700 dark:text-amber-400">{Math.round(row.original.bosluk)}</span>,
    },
    {
      id: "repairable",
      header: "Onarılabilir",
      meta: right("Onarılabilir"),
      accessorFn: (s) => Math.round(s.onarilabilirMetraj),
      cell: ({ row: { original: s } }) =>
        s.onarilabilirMetraj > 0.001 ? (
          <span className="font-semibold text-emerald-700 dark:text-emerald-400">{Math.round(s.onarilabilirMetraj)}</span>
        ) : (
          <span className="font-semibold text-muted-foreground">0</span>
        ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      enableHiding: false,
      meta: { label: "İşlem", align: "right" },
      cell: ({ row: { original: s } }) => {
        const repairable = s.onarilabilirMetraj > 0.001;
        return (
          <Button
            size="sm"
            variant={repairable ? "default" : "outline"}
            disabled={!repairable || busyId === s.shipmentId}
            onClick={() => onSelect(s)}
            title={repairable ? "Ne yazılacağını göster" : "Bugün de yazılamıyor — sipariş dolu ya da kumaş/renk/en tutmuyor"}
            className="h-7 gap-1.5"
          >
            {busyId === s.shipmentId && <Loader2 className="h-4 w-4 animate-spin" />}
            İncele
          </Button>
        );
      },
    },
  ];
}

/** Sevkiyat listesi — onarılabilir olanlar üstte (ilk sıra; başlıktan yeniden sıralanabilir). */
export function RepairShipmentTable({ rows, onSelect, onOrder, onShipment, busyId }: RowActions & { rows: RepairableShipment[] }) {
  const sorted = useMemo(() => [...rows].sort((a, b) => b.onarilabilirMetraj - a.onarilabilirMetraj), [rows]);
  const columns = useMemo(() => repairColumns({ onSelect, onOrder, onShipment, busyId }), [onSelect, onOrder, onShipment, busyId]);
  const table = useLocalTable({ tableKey: "allocation-repair", data: sorted, columns, getRowId: (s) => s.shipmentId });
  if (sorted.length === 0) return null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 justify-end px-4 py-1.5">
        <DataTableTools table={table} compact exportName="Siparişe yazılamayan sevkiyatlar" />
      </div>
      <DataTable table={table} exportName="Siparişe yazılamayan sevkiyatlar" />
    </div>
  );
}
