import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DetailTable } from "./DetailTable";
import { fmtInt, fmtNum, fmtPercent } from "./formatters";

/** Backend `reports/_breakdown.BreakdownRow` ile birebir. */
export interface BreakdownRow {
  key: string;
  label: string;
  count: number;
  qty: number;
  prevCount?: number;
  prevQty?: number;
}

/**
 * Δ rozeti — yön RENKLE değil İŞARETLE de anlatılır (renk körlüğü + gri baskı).
 * `goodDirection` metriğe göre değişir: kalite artınca iyi, fire artınca kötü.
 */
export function DeltaBadge({
  now,
  prev,
  suffix = "",
  goodDirection = "up",
}: {
  now: number;
  prev: number | undefined;
  suffix?: string;
  goodDirection?: "up" | "down";
}) {
  if (prev === undefined) return null;
  const d = Math.round((now - prev) * 10) / 10;
  if (d === 0) return <span className="text-muted-foreground">±0</span>;
  const up = d > 0;
  const good = goodDirection === "up" ? up : !up;
  return (
    <span className={good ? "text-success" : "text-destructive"}>
      {up ? "▲" : "▼"} {fmtNum(Math.abs(d))}
      {suffix}
    </span>
  );
}

interface Props {
  title: string;
  description?: string;
  labelHeader: string;
  rows: BreakdownRow[];
  /** Metraj kolonunun toplamı — pay hesabı için (yüzde kolonu). */
  totalQty?: number;
  /** Metraj kolon başlığı — "Hurda", "İade", "Sevk"… */
  qtyHeader?: string;
  countHeader?: string;
  hasCompare?: boolean;
  /** Artışın iyi mi kötü mü olduğu — Δ rozetinin rengi. */
  goodDirection?: "up" | "down";
  isLoading?: boolean;
  emptyLabel?: string;
}

/**
 * Karnelerin ortak kırılım tablosu: etiket + adet + metraj (+ pay % + Δ).
 * Fire · İade · Fason · Sevk karneleri bunu paylaşır — her karnede yeniden
 * yazmak, aralarında sessiz biçim/yuvarlama farkı doğururdu.
 */
export function BreakdownTable({
  title,
  description,
  labelHeader,
  rows,
  totalQty,
  qtyHeader = "Metraj",
  countHeader = "Top",
  hasCompare = false,
  goodDirection = "up",
  isLoading,
  emptyLabel = "Bu dönemde kayıt yok",
}: Props) {
  const columns = useMemo<ColumnDef<BreakdownRow, unknown>[]>(() => {
    const cols: ColumnDef<BreakdownRow, unknown>[] = [
      { accessorKey: "label", header: labelHeader },
      {
        accessorKey: "count",
        header: () => <div className="text-right">{countHeader}</div>,
        cell: ({ getValue }) => <div className="text-right tabular-nums">{fmtInt(getValue() as number)}</div>,
      },
      {
        accessorKey: "qty",
        header: () => <div className="text-right">{qtyHeader}</div>,
        cell: ({ getValue }) => (
          <div className="text-right font-medium tabular-nums">{fmtNum(getValue() as number)} m</div>
        ),
      },
    ];
    // Pay kolonu yalnız toplam BİLİNİYORSA çizilir; bilinmeden yüzde basmak
    // ("neyin yüzdesi?") rakamı okunamaz yapar.
    if (totalQty !== undefined && totalQty > 0) {
      cols.push({
        id: "share",
        header: () => <div className="text-right">Pay</div>,
        cell: ({ row }) => (
          <div className="text-right tabular-nums text-muted-foreground">
            {fmtPercent(Math.round((row.original.qty / totalQty) * 1000) / 10)}
          </div>
        ),
      });
    }
    if (hasCompare) {
      cols.push({
        id: "prevQty",
        header: () => <div className="text-right">Önceki</div>,
        cell: ({ row }) => (
          <div className="text-right tabular-nums text-muted-foreground">
            {fmtNum(row.original.prevQty ?? 0)} m
          </div>
        ),
      });
      cols.push({
        id: "delta",
        header: () => <div className="text-right">Δ</div>,
        cell: ({ row }) => (
          <div className="text-right tabular-nums">
            <DeltaBadge
              now={row.original.qty}
              prev={row.original.prevQty}
              suffix=" m"
              goodDirection={goodDirection}
            />
          </div>
        ),
      });
    }
    return cols;
  }, [labelHeader, countHeader, qtyHeader, totalQty, hasCompare, goodDirection]);

  return (
    <DetailTable
      title={title}
      description={description}
      data={rows}
      columns={columns}
      isLoading={isLoading}
      emptyLabel={emptyLabel}
    />
  );
}
