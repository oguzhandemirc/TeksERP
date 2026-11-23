// Sertifika listesi — tek satır süzgeç + tablo (sonsuz kaydırma) + alt çubukta özet. Özet ve tablo AYNI sunucu
// yanıtından (tek where); "süresi dolan/dolmak üzere" süzgeci sunucuda `certificateExpiryWhere`'den.
import { useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ListSearchBox } from "@/components/data-table/ListSearchBox";
import { SelectChip } from "@/components/data-table/filter-row/SelectChip";
import { certificateService, type CertificateStatusFilter, type CertificateSummary } from "./service";
import { certificateColumns } from "./certificateColumns";
export { ExpiryPill } from "./certificateColumns";
import { BandStats, ListFooter, ListToolbar } from "@/components/layout/ListPage";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { useLocalTable } from "@/hooks/useLocalTable";
import {
  EMPTY_CERTIFICATE_FILTERS, STATUS_FILTER_LABEL, certificateEmptyMessage,
  isCertificateFilterDirty, type CertificateFilterState,
} from "./certificateRules";

const PAGE = 50;
const STATUS_OPTIONS = (Object.keys(STATUS_FILTER_LABEL) as CertificateStatusFilter[]).map((k) => ({ value: k, label: STATUS_FILTER_LABEL[k] }));
const HOLDER_OPTIONS = [
  { value: "OWN", label: "Yalnız fabrika" },
  { value: "PARTNER", label: "Yalnız iş ortakları" },
] as const;

export function CertificateList({ onOpen }: { onOpen: (id: string) => void }) {
  const [f, setF] = useState<CertificateFilterState>(EMPTY_CERTIFICATE_FILTERS);
  const set = <K extends keyof CertificateFilterState>(k: K, v: CertificateFilterState[K]) => setF((x) => ({ ...x, [k]: v }));
  const query = { ...f, q: useDebouncedValue(f.q), days: useDebouncedValue(f.days) };
  const q = useInfiniteQuery({
    queryKey: ["certificates", "list", query],
    queryFn: ({ pageParam }) => certificateService.list({ ...query, cursor: pageParam, limit: PAGE }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = (q.data?.pages ?? []).flatMap((p) => p.items);
  const summary = q.data?.pages[0]?.summary;
  const soonDays = summary?.days ?? f.days;
  const table = useLocalTable({ tableKey: "certificates", data: rows, columns: useMemo(() => certificateColumns(soonDays), [soonDays]), getRowId: (r) => r.id });

  return (
    <>
      <ListToolbar className="flex-row flex-wrap items-center">
        <ListSearchBox value={f.q} onSearchChange={(v) => set("q", v)} searchHint="Sertifika no, standart, kuruluş ya da iş ortağı" />
        {/* Varsayılan "Etkin" — boş değer yok; ✕ varsayılana döndürür. */}
        <SelectChip id="cert-status" label="Durum" value={f.status} resetValue="active" options={STATUS_OPTIONS} onChange={(v) => set("status", v ?? "active")} />
        <SelectChip id="cert-holder" label="Sahip" value={f.holder || null} allLabel="Fabrika + iş ortakları" options={HOLDER_OPTIONS} onChange={(v) => set("holder", v ?? "")} />
        <label className="flex h-8 items-center gap-1.5 text-xs text-muted-foreground" title="Bu kadar gün içinde süresi dolacak sertifikalar uyarı sayılır">
          Uyarı eşiği
          <Input type="number" min={0} max={3650} aria-label="Uyarı eşiği (gün)" className="h-8 w-16 text-xs" value={f.days}
            onChange={(e) => set("days", Math.min(3650, Math.max(0, Math.trunc(Number(e.target.value) || 0))))} />
          gün
        </label>
        {isCertificateFilterDirty(f) && (
          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setF(EMPTY_CERTIFICATE_FILTERS)}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Temizle
          </Button>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <DataTableTools table={table} compact exportName="Sertifikalar" />
        </div>
      </ListToolbar>
      <DataTable
        table={table}
        onRowClick={(r) => onOpen(r.id)}
        exportName="Sertifikalar"
        isLoading={q.isLoading}
        isError={q.isError}
        errorText="Sertifikalar yüklenemedi."
        onRetry={() => void q.refetch()}
        emptyText={certificateEmptyMessage(f)}
        loadMore={{ hasMore: Boolean(q.hasNextPage), isFetchingMore: q.isFetchingNextPage, onLoadMore: () => q.fetchNextPage() }}
      />
      <ListFooter
        loaded={rows.length}
        hasMore={rows.length > 0 ? Boolean(q.hasNextPage) : undefined}
        isFetchingMore={q.isFetchingNextPage}
        summary={summary ? <SummaryStrip s={summary} /> : undefined}
      />
    </>
  );
}

/** Yalnız sunucu özetini çizer; süzmek için Durum kutusu kullanılır. */
function SummaryStrip({ s }: { s: CertificateSummary }) {
  return (
    <div data-testid="certificate-summary">
      <BandStats
        label="Sertifika özeti"
        items={[
          { key: "active", label: "Etkin", value: s.active },
          { key: "expiring", label: `${s.days} gün içinde dolacak`, value: s.expiring, tone: s.expiring > 0 ? "warn" : undefined },
          { key: "expired", label: "Süresi dolmuş", value: s.expired, tone: s.expired > 0 ? "danger" : undefined },
          { key: "revoked", label: "İptal", value: s.revoked },
        ]}
      />
    </div>
  );
}
