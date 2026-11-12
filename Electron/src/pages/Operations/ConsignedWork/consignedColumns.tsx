// İçerideki İşler — müşteri satırı sütunları (ortak DataTable). Kova hücresi kovanın top sekmesine bağlanır.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { CariHoldBadge } from "@/pages/Finance/CariHold/CariHoldBadge";
import { READY_WORKS_PATH, type ReadyWorkRow } from "@/pages/Operations/ReadyWorks/service";
import { STATE_LABEL } from "@/pages/Operations/ReadyWorks/ready-works-view";
import type { ConsignedBucket, ConsignedOwnerRow, ConsignedWorkSummary } from "./service";
import { rollsLinkFor, type ConsignedBucketKey } from "./consigned-links";

export type ReadinessStatus = "loading" | "error" | "ok";

const fmtQty = (q: number) => `${formatNumber(q, 1)} m`;
const bucketText = (b: ConsignedBucket) => (b.count === 0 ? "—" : `${b.count} top · ${fmtQty(b.qty)}`);

function ReadinessCell({ row, status }: { row: ReadyWorkRow | undefined; status: ReadinessStatus }) {
  // Yükleniyor / hata, "hazırlık satırı yok" ile aynı görünmemeli (Sevke Hazır İşler'deki ayrımın aynası).
  if (!row && status === "loading") return <span className="text-muted-foreground" aria-label="Hazırlık yükleniyor">…</span>;
  if (!row && status === "error") return <span className="text-destructive" title="Hazırlık yüklenemedi">yüklenemedi</span>;
  if (!row) return <span className="text-muted-foreground">—</span>;
  return (
    <Link to={`${READY_WORKS_PATH}?tab=customer`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1.5 rounded px-1 hover:bg-muted">
      <Badge variant={row.state === "READY" ? "default" : row.state === "PARTIAL" ? "secondary" : "muted"} className="whitespace-nowrap">
        {STATE_LABEL[row.state]}
      </Badge>
      {row.readyMeters > 0 && <span className="text-xs text-muted-foreground tabular-nums">{fmtQty(row.readyMeters)} hazır</span>}
    </Link>
  );
}

function BucketCell({ bucket, ownerId, kind }: { bucket: ConsignedBucket; ownerId: string; kind: ConsignedBucketKey | null }) {
  if (bucket.count === 0) return <span className="text-muted-foreground">—</span>;
  const body = (
    <span className="whitespace-nowrap tabular-nums">
      <span className="font-medium">{bucket.count} top</span>
      <span className="ml-1.5 text-xs text-muted-foreground">{fmtQty(bucket.qty)}</span>
    </span>
  );
  if (!kind) return body;
  return (
    <Link to={rollsLinkFor(ownerId, kind)} onClick={(e) => e.stopPropagation()} className="inline-block rounded px-1 hover:bg-muted">
      {body}
    </Link>
  );
}

type BucketField = "waiting" | "waitingSemi" | "inProcess" | "ready" | "other" | "total";
const hinted = (text: string, title?: string): (() => ReactNode) => () => <span title={title}>{text}</span>;

function bucketColumn(field: BucketField, label: string, kind: ConsignedBucketKey | null, title?: string): ColumnDef<ConsignedOwnerRow> {
  return {
    id: field,
    header: hinted(label, title),
    meta: { label, align: "right", exportValue: (r) => bucketText(r[field]) },
    accessorFn: (r) => r[field].qty,
    cell: ({ row: { original: r } }) => <BucketCell bucket={r[field]} ownerId={r.ownerCustomerId} kind={kind} />,
  };
}

export interface OwnerColumnsOpts {
  totals: ConsignedWorkSummary["totals"];
  /** null = kolon yok (sevk okuma izni yok); Map = müşteri id → hazırlık satırı. */
  readiness: Map<string, ReadyWorkRow> | null;
  readinessStatus: ReadinessStatus;
  onStatement?: (r: ConsignedOwnerRow) => void;
}

const OWNER_COLUMN: ColumnDef<ConsignedOwnerRow> = {
  id: "owner",
  header: "Müşteri",
  enableHiding: false,
  meta: { label: "Müşteri" },
  accessorFn: (r) => r.ownerName,
  cell: ({ row: { original: r } }) => (
    <span className="font-medium">
      {r.ownerName}
      <CariHoldBadge view={r.hold} />
    </span>
  ),
};

export function ownerColumns({ totals, readiness, readinessStatus, onStatement }: OwnerColumnsOpts): ColumnDef<ConsignedOwnerRow>[] {
  // İki "bekliyor" sütunu ayrı sekmeye bağlanır (ham ↔ Ham Stok, yarı mamul ↔ Yarı Mamul); boş olan gizlenir,
  // ikisi de boşsa ham sütunu kalır. Gelen belge onayıyla doğan emanet yarı mamuldür.
  const showSemi = totals.waitingSemi.count > 0;
  const showRaw = totals.waiting.count > 0 || !showSemi;
  const cols: ColumnDef<ConsignedOwnerRow>[] = [OWNER_COLUMN];
  if (showRaw) cols.push(bucketColumn("waiting", `Bekliyor${showSemi ? " (ham)" : ""}`, "waiting", "Rotaya girmemiş ham emanet — Ham Stok"));
  if (showSemi) cols.push(bucketColumn("waitingSemi", `Bekliyor${showRaw ? " (yarı mamul)" : ""}`, "waitingSemi", "Rotaya girmemiş yarı mamul emanet — Yarı Mamul"));
  cols.push(
    bucketColumn("inProcess", "İşlemde", "inProcess"),
    bucketColumn("ready", "Sevke hazır", "ready"),
    bucketColumn("other", "Diğer", null, "İçeride ama üç durumun dışında (ör. adımsız fason/kartela)"),
    bucketColumn("total", "Toplam", null),
  );
  if (readiness) {
    cols.push({
      id: "readiness",
      header: hinted("Hazırlık", "Sevke hazırlık — Sevke Hazır İşler'in müşteri birimi (fabrika kuralıyla)"),
      meta: { label: "Hazırlık", align: "right", exportValue: (r) => { const w = readiness.get(r.ownerCustomerId); return w ? STATE_LABEL[w.state] : "—"; } },
      cell: ({ row }) => <ReadinessCell row={readiness.get(row.original.ownerCustomerId)} status={readinessStatus} />,
    });
  }
  if (onStatement) {
    cols.push({
      id: "actions",
      header: () => <span className="sr-only">Ekstre</span>,
      enableSorting: false,
      enableHiding: false,
      meta: { label: "Ekstre", align: "right" },
      cell: ({ row: { original: r } }) => (
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1" aria-label={`${r.ownerName} emanet ekstresi`}
          onClick={(e) => { e.stopPropagation(); onStatement(r); }} onKeyDown={(e) => e.stopPropagation()}>
          <FileText className="h-3.5 w-3.5" /> Ekstre
        </Button>
      ),
    });
  }
  return cols;
}
