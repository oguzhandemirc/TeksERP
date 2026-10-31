// İÇERİDEKİ İŞLER (ister 3.2) — müşteri başına içerideki emanet top/metre, durum kırılımıyla. Tek sunucu toplaması
// (`/api/consigned-work`); satır ya da hücre tıklaması Kumaş Stoğu'nu o sahibin süzgeciyle açar. Modül kapısı `ROUTE_MODULE`.
// Hazırlık kolonu (D4-J3) İKİNCİ HESAP DEĞİL: `ready-works?groupBy=customer` ucundan; `shipping:read` yoksa istek atılmaz.
import { useState, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { RefreshButton } from "@/components/RefreshButton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import { TERIM } from "@/lib/terim";
import { CONSIGNED_WORK_QUERY_KEY, getConsignedWork, type ConsignedBucket, type ConsignedOwnerRow, type ConsignedWorkSummary } from "./service";
import { primaryBucket, rollsLinkFor, type ConsignedBucketKey } from "./consigned-links";
import { Badge } from "@/components/ui/badge";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { getAllReadyWorks, READY_WORKS_PATH, READY_WORKS_QUERY_KEY, type ReadyWorkRow } from "@/pages/Operations/ReadyWorks/service";
import { STATE_LABEL } from "@/pages/Operations/ReadyWorks/ready-works-view";

type ReadinessStatus = "loading" | "error" | "ok";

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

function TotalsStrip({ totals }: { totals: ConsignedWorkSummary["totals"] }) {
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

function OwnersTable({
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
    <div className="overflow-x-auto rounded-md border">
      <Table>
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
              <TableCell className="min-w-[9rem] font-medium">{r.ownerName}</TableCell>
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
    </div>
  );
}

export function ConsignedWorkPage() {
  const navigate = useNavigate();
  const [onlyReady, setOnlyReady] = useState(false);
  const q = useQuery({ queryKey: [CONSIGNED_WORK_QUERY_KEY, onlyReady ? "ready" : "all"], queryFn: () => getConsignedWork(onlyReady) });
  const rows = q.data?.rows ?? [];
  const open = (row: ConsignedOwnerRow) => navigate(rollsLinkFor(row.ownerCustomerId, primaryBucket(row)));
  const canReadShipping = useRoleAccess().hasPermission("shipping:read");
  const readyQ = useQuery({
    queryKey: [READY_WORKS_QUERY_KEY, "customer-all"],
    queryFn: () => getAllReadyWorks("customer"),
    enabled: canReadShipping,
  });
  // Hazırlık ucu düşerse ana liste etkilenmez; hücre "yüklenemedi" der.
  const readinessStatus: ReadinessStatus = readyQ.isError ? "error" : readyQ.isPending ? "loading" : "ok";
  const readiness = canReadShipping ? new Map((readyQ.data ?? []).map((w) => [w.id, w])) : null;

  return (
    <PageShell>
      <PageHeader
        title="İçerideki İşler"
        description="Müşterilerin işlenmek üzere bıraktığı (emanet) mal — müşteri başına top ve metre. Sevk edilen, hurdaya ayrılan ve iptal/tüketilmiş toplar sayılmaz; fasondaki ve karteladaki emanet içeride sayılır (Diğer). Satıra tıklayınca toplar o müşterinin süzgeciyle açılır."
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={onlyReady ? "default" : "outline"}
              size="sm"
              aria-pressed={onlyReady}
              title="Yalnız sevke hazır (depoda) emaneti olan müşteriler; toplamlar da bu kapsamdan"
              onClick={() => setOnlyReady((v) => !v)}
            >
              Yalnız sevke hazır
            </Button>
            <RefreshButton queryKey={CONSIGNED_WORK_QUERY_KEY} />
          </div>
        }
      />
      <PageBody className="min-h-0 space-y-3 p-4 sm:p-6">
        {q.isLoading ? (
          <div className="text-sm text-muted-foreground">Yükleniyor…</div>
        ) : q.isError ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
            <p className="font-medium text-destructive">Liste yüklenemedi.</p>
            <p className="mt-1 text-muted-foreground">Bu bir “içeride iş yok” cevabı değildir — istek reddedildi ya da sunucuya ulaşılamadı.</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void q.refetch()}>
              Tekrar dene
            </Button>
          </div>
        ) : (
          <>
            {q.data && <TotalsStrip totals={q.data.totals} />}
            {rows.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                {onlyReady
                  ? "Sevke hazır emaneti olan müşteri yok."
                  : "İçeride emanet mal yok. Emanet top, girişte “Sahibi” seçilerek ya da gelen belge onayıyla doğar."}
              </div>
            ) : (
              q.data && <OwnersTable rows={rows} totals={q.data.totals} onOpen={open} readiness={readiness} readinessStatus={readinessStatus} />
            )}
          </>
        )}
      </PageBody>
    </PageShell>
  );
}
