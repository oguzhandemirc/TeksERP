// İçerideki İşler tablosu + toplam şeridi — sayfadan ayrıldı (liste standardı: şerit üst bantta, tablo ListBody'de).
import { type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import { TERIM } from "@/lib/terim";
import { type ConsignedBucket, type ConsignedOwnerRow, type ConsignedWorkSummary } from "./service";
import { rollsLinkFor, type ConsignedBucketKey } from "./consigned-links";
import { Badge } from "@/components/ui/badge";
import { CariHoldBadge } from "@/pages/Finance/CariHold/CariHoldBadge";
import { READY_WORKS_PATH, type ReadyWorkRow } from "@/pages/Operations/ReadyWorks/service";
import { STATE_LABEL } from "@/pages/Operations/ReadyWorks/ready-works-view";

export type ReadinessStatus = "loading" | "error" | "ok";

function ReadinessCell({ row, status }: { row: ReadyWorkRow | undefined; status: ReadinessStatus }) {
  // Yükleniyor / hata, "hazırlık satırı yok" ile aynı görünmemeli (Sevke Hazır İşler'deki ayrımın aynası).
  if (!row && status === "loading") return <span className="text-muted-foreground" aria-label="Hazırlık yükleniyor">…</span>;
  if (!row && status === "error") return <span className="text-destructive" title="Hazırlık yüklenemedi">yüklenemedi</span>;
  if (!row) return <span className="text-muted-foreground">—</span>;
  return (
    <Link to={`${READY_WORKS_PATH}?tab=customer`} onClick={(e) => e.stopPropagation()} className="inline-flex flex-col items-end rounded px-1 leading-tight hover:bg-muted">
      <Badge variant={row.state === "READY" ? "default" : row.state === "PARTIAL" ? "secondary" : "muted"} className="whitespace-nowrap">
        {STATE_LABEL[row.state]}
      </Badge>
      {row.readyMeters > 0 && <span className="text-xs text-muted-foreground tabular-nums">{fmtQty(row.readyMeters)} hazır</span>}
    </Link>
  );
}

const fmtQty = (q: number) => `${formatNumber(q, 1)} m`;

function BucketCell({ bucket, ownerId, kind }: { bucket: ConsignedBucket; ownerId: string; kind: ConsignedBucketKey | null }) {
  if (bucket.count === 0) return <span className="text-muted-foreground">—</span>;
  const body = (
    <span className="flex flex-col items-end whitespace-nowrap leading-tight">
      <span className="font-medium tabular-nums">{bucket.count} top</span>
      <span className="text-xs text-muted-foreground tabular-nums">{fmtQty(bucket.qty)}</span>
    </span>
  );
  if (!kind) return body;
  return (
    <Link to={rollsLinkFor(ownerId, kind)} onClick={(e) => e.stopPropagation()} className="inline-block rounded px-1 hover:bg-muted">
      {body}
    </Link>
  );
}

export function TotalsStrip({ totals }: { totals: ConsignedWorkSummary["totals"] }) {
  const cells: Array<[string, ConsignedBucket, string?]> = [
    ["İçeride (toplam)", totals.total],
    [
      "Bekliyor",
      { count: totals.waiting.count + totals.waitingSemi.count, qty: totals.waiting.qty + totals.waitingSemi.qty },
      "Rotaya girmemiş emanet (Ham Stok + Yarı Mamul)",
    ],
    ["İşlemde", totals.inProcess, `Bir ${TERIM.terbiyeIsEmri.tekilKucuk} adımında (Üretimde)`],
    ["Sevke hazır", totals.ready, "Depoda — Bitmiş Depo"],
  ];
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="İçerideki işler özeti">
      {cells.map(([label, b, hint]) => (
        <div key={label} className="min-w-0 rounded-md border bg-card px-3 py-2" title={hint}>
          <div className="truncate text-xs text-muted-foreground">{label}</div>
          <div className="text-lg font-semibold tabular-nums">{b.count} top</div>
          <div className="text-xs text-muted-foreground tabular-nums">{fmtQty(b.qty)}</div>
        </div>
      ))}
    </div>
  );
}

export function OwnersTable({
  rows,
  totals,
  onOpen,
  readiness,
  readinessStatus,
}: {
  rows: ConsignedOwnerRow[];
  totals: ConsignedWorkSummary["totals"];
  onOpen: (r: ConsignedOwnerRow) => void;
  /** null = kolon yok (sevk okuma izni yok); Map = müşteri id → hazırlık satırı. */
  readiness: Map<string, ReadyWorkRow> | null;
  readinessStatus: ReadinessStatus;
}) {
  // İki "bekliyor" sütunu ayrı sekmeye bağlanır (ham ↔ Ham Stok, yarı mamul ↔ Yarı Mamul); boş olan gizlenir,
  // ikisi de boşsa ham sütunu kalır. Gelen belge onayıyla doğan emanet yarı mamuldür.
  const showSemi = totals.waitingSemi.count > 0;
  const showRaw = totals.waiting.count > 0 || !showSemi;
  const onKey = (e: KeyboardEvent, row: ConsignedOwnerRow) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(row);
    }
  };
  return (
    <Table containerClassName="overflow-visible">
      <TableHeader>
        <TableRow>
          <TableHead>Müşteri</TableHead>
          {showRaw && <TableHead className="whitespace-nowrap text-right" title="Rotaya girmemiş ham emanet — Ham Stok">Bekliyor{showSemi ? " (ham)" : ""}</TableHead>}
          {showSemi && <TableHead className="whitespace-nowrap text-right" title="Rotaya girmemiş yarı mamul emanet — Yarı Mamul">Bekliyor{showRaw ? " (yarı mamul)" : ""}</TableHead>}
          <TableHead className="text-right">İşlemde</TableHead>
          <TableHead className="whitespace-nowrap text-right">Sevke hazır</TableHead>
          <TableHead className="text-right" title="İçeride ama üç durumun dışında (ör. adımsız fason/kartela)">Diğer</TableHead>
          <TableHead className="text-right">Toplam</TableHead>
          {readiness && <TableHead className="whitespace-nowrap text-right" title="Sevke hazırlık — Sevke Hazır İşler'in müşteri birimi (fabrika kuralıyla)">Hazırlık</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow
            key={r.ownerCustomerId}
            role="link"
            tabIndex={0}
            className="cursor-pointer"
            onClick={() => onOpen(r)}
            onKeyDown={(e) => onKey(e, r)}
            aria-label={`${r.ownerName} toplarını aç`}
          >
            <TableCell className="min-w-[9rem] font-medium">
              {r.ownerName}
              <CariHoldBadge view={r.hold} />
            </TableCell>
            {showRaw && <TableCell className="text-right"><BucketCell bucket={r.waiting} ownerId={r.ownerCustomerId} kind="waiting" /></TableCell>}
            {showSemi && <TableCell className="text-right"><BucketCell bucket={r.waitingSemi} ownerId={r.ownerCustomerId} kind="waitingSemi" /></TableCell>}
            <TableCell className="text-right"><BucketCell bucket={r.inProcess} ownerId={r.ownerCustomerId} kind="inProcess" /></TableCell>
            <TableCell className="text-right"><BucketCell bucket={r.ready} ownerId={r.ownerCustomerId} kind="ready" /></TableCell>
            <TableCell className="text-right"><BucketCell bucket={r.other} ownerId={r.ownerCustomerId} kind={null} /></TableCell>
            <TableCell className="text-right"><BucketCell bucket={r.total} ownerId={r.ownerCustomerId} kind={null} /></TableCell>
            {readiness && <TableCell className="text-right"><ReadinessCell row={readiness.get(r.ownerCustomerId)} status={readinessStatus} /></TableCell>}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
