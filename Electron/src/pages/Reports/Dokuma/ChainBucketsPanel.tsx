// Bağsız kayıtlar sekmesi — adıyla ve sayısıyla; satır ilgili listeyi açar. Ana listeye karışmaz, gizlenmez de.
import { DetailTable } from "../_components";
import { fmtInt } from "../_components/formatters";
import { DrillCell } from "./productionChainColumns";
import { bucketRows, type ChainReport } from "./productionChain";

type BucketRow = ReturnType<typeof bucketRows>[number];

export function ChainBucketsPanel({ c, isLoading }: { c: ChainReport | undefined; isLoading: boolean }) {
  return (
    <DetailTable<BucketRow>
      title="Bağsız kayıtlar"
      description="Sipariş satırı olmayan üretim ayrı sorudur: işsiz levent, siparişsiz dokuma işi, dışarıdan gelen top. Satıra tıklamak ilgili listeyi açar."
      data={c ? bucketRows(c) : []}
      columns={[
        { id: "ad", header: "Kova", cell: ({ row }) => <DrillCell to={row.original.yol} title="Listeyi aç">{row.original.ad}</DrillCell> },
        { id: "sayi", header: () => <div className="text-right">Sayı</div>, cell: ({ row }) => <div className="text-right font-medium tabular-nums">{fmtInt(row.original.sayi)}</div> },
      ]}
      isLoading={isLoading}
      emptyLabel="Bağsız kayıt yok"
    />
  );
}
