// İÇERİDEKİ İŞLER (ister 3.2) — müşteri başına içerideki emanet top/metre, durum kırılımıyla. Tek sunucu toplaması
// (`/api/consigned-work`); satır ya da hücre tıklaması Kumaş Stoğu'nu o sahibin süzgeciyle açar. Modül kapısı `ROUTE_MODULE`.
import type { KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { RefreshButton } from "@/components/RefreshButton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import { CONSIGNED_WORK_QUERY_KEY, getConsignedWork, type ConsignedBucket, type ConsignedOwnerRow, type ConsignedWorkSummary } from "./service";
import { primaryBucket, rollsLinkFor, type ConsignedBucketKey } from "./consigned-links";

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
    ["Bekliyor", totals.waiting, "Rotaya girmemiş ham emanet (Ham Stok / Yarı Mamul)"],
    ["İşlemde", totals.inProcess, "Bir iş emri adımında (Üretimde)"],
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

export function ConsignedWorkPage() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: [CONSIGNED_WORK_QUERY_KEY], queryFn: getConsignedWork });
  const rows = q.data?.rows ?? [];
  const open = (row: ConsignedOwnerRow) => navigate(rollsLinkFor(row.ownerCustomerId, primaryBucket(row)));
  const onKey = (e: KeyboardEvent, row: ConsignedOwnerRow) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open(row);
    }
  };

  return (
    <PageShell>
      <PageHeader
        title="İçerideki İşler"
        description="Müşterilerin işlenmek üzere bıraktığı (emanet) mal — müşteri başına top ve metre. Sevk edilen, fire ve iptal toplar sayılmaz. Satıra tıklayınca toplar o müşterinin süzgeciyle açılır."
        actions={<RefreshButton queryKey={CONSIGNED_WORK_QUERY_KEY} />}
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
                İçeride emanet mal yok. Emanet top, girişte “Sahibi” seçilerek ya da gelen belge onayıyla doğar.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Müşteri</TableHead>
                      <TableHead className="text-right">Bekliyor</TableHead>
                      <TableHead className="text-right">İşlemde</TableHead>
                      <TableHead className="whitespace-nowrap text-right">Sevke hazır</TableHead>
                      <TableHead className="text-right" title="İçeride ama üç durumun dışında (ör. adımsız fason/kartela)">Diğer</TableHead>
                      <TableHead className="text-right">Toplam</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow
                        key={r.ownerCustomerId}
                        role="link"
                        tabIndex={0}
                        className="cursor-pointer"
                        onClick={() => open(r)}
                        onKeyDown={(e) => onKey(e, r)}
                        aria-label={`${r.ownerName} toplarını aç`}
                      >
                        <TableCell className="min-w-[9rem] font-medium">{r.ownerName}</TableCell>
                        <TableCell className="text-right"><BucketCell bucket={r.waiting} ownerId={r.ownerCustomerId} kind="waiting" /></TableCell>
                        <TableCell className="text-right"><BucketCell bucket={r.inProcess} ownerId={r.ownerCustomerId} kind="inProcess" /></TableCell>
                        <TableCell className="text-right"><BucketCell bucket={r.ready} ownerId={r.ownerCustomerId} kind="ready" /></TableCell>
                        <TableCell className="text-right"><BucketCell bucket={r.other} ownerId={r.ownerCustomerId} kind={null} /></TableCell>
                        <TableCell className="text-right"><BucketCell bucket={r.total} ownerId={r.ownerCustomerId} kind={null} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </PageBody>
    </PageShell>
  );
}
