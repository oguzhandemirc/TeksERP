// Stok & Ölü Stok — "Kalem bazında" sekmesi: Ham (kumaş) ve Bitmiş (kumaş+en+renk+kat)
// tabloları; alt toplam satırı sunucunun toplamıdır (Excel'le aynı rakam).
import type { ColumnDef } from "@tanstack/react-table";
import { DetailTable } from "../_components";
import { fmtInt, fmtNum } from "../_components/formatters";
import { widthText, type StockKalem, type StockKalemBitmisRow, type StockKalemHamRow } from "./stockKalem";

const right = (text: string, strong = false) => (
  <div className={`text-right tabular-nums ${strong ? "font-medium" : ""}`}>{text}</div>
);
function numCols<T extends { count: number; qty: number }>(): ColumnDef<T, unknown>[] {
  return [
    { accessorKey: "count", header: () => right("Top"), cell: ({ getValue }) => right(fmtInt(getValue() as number)) },
    { accessorKey: "qty", header: () => right("Metre"), cell: ({ getValue }) => right(`${fmtNum(getValue() as number)} m`, true) },
  ];
}

const hamColumns: ColumnDef<StockKalemHamRow, unknown>[] = [
  { accessorKey: "itemName", header: "Kumaş" },
  ...numCols<StockKalemHamRow>(),
];

const bitmisColumns: ColumnDef<StockKalemBitmisRow, unknown>[] = [
  { accessorKey: "itemName", header: "Kumaş" },
  { accessorKey: "width", header: "En", cell: ({ getValue }) => <span className="tabular-nums">{widthText(getValue() as number | null)}</span> },
  { accessorKey: "colorName", header: "Renk", cell: ({ getValue }) => (getValue() as string | null) ?? "—" },
  { accessorKey: "foldName", header: "Kat", cell: ({ getValue }) => (getValue() as string | null) ?? "—" },
  ...numCols<StockKalemBitmisRow>(),
];

interface Props {
  data: StockKalem | undefined;
  isLoading: boolean;
  /** Satır tavanı uyarısı (sunucu) — toplamlar yine tam kümedir. */
  warnings?: string[];
  /** Yükleme hatası cümlesi (`kalemErrorText`); varsa tablolar yerine yalnız o basılır. */
  errorText?: string;
}

export function StockKalemTab({ data, isLoading, warnings, errorText }: Props) {
  const t = data?.totals;
  if (errorText) {
    return (
      <p role="alert" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
        {errorText}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {warnings?.map((w) => (
        <p key={w} className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          {w}
        </p>
      ))}
      <DetailTable
        title="Ham"
        description="Kumaş başına rafta bekleyen ham top ve metre. Dışarıdan alınan yarı mamul dahil değil."
        data={data?.ham ?? []}
        columns={hamColumns}
        isLoading={isLoading}
        emptyLabel="Rafta ham kumaş yok"
        totalRow={t ? ["Toplam", right(fmtInt(t.hamCount)), right(`${fmtNum(t.hamQty)} m`, true)] : undefined}
      />
      <DetailTable
        title="Bitmiş"
        description="Kumaş, en, renk ve kat başına depodaki bitmiş top ve metre."
        data={data?.bitmis ?? []}
        columns={bitmisColumns}
        isLoading={isLoading}
        emptyLabel="Rafta bitmiş mal yok"
        totalRow={t ? ["Toplam", "", "", "", right(fmtInt(t.bitmisCount)), right(`${fmtNum(t.bitmisQty)} m`, true)] : undefined}
      />
    </div>
  );
}
