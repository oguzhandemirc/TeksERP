// Sertifika listesi — süzgeçler + özet şeridi + cursor ile "Daha fazla yükle". Şerit ve tablo AYNI sunucu
// yanıtından (tek where); "süresi dolan/dolmak üzere" süzgeci sunucuda `certificateExpiryWhere`'den.
import { useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { RotateCcw, Search } from "lucide-react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { certificateService, type CertificateStatusFilter, type CertificateSummary } from "./service";
import { certificateColumns } from "./certificateColumns";
export { ExpiryPill } from "./certificateColumns";
import { QualityListState } from "../QualityListState";
import { ListBand, ListBody, ListFooter, ListToolbar } from "@/components/layout/ListPage";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { useLocalTable } from "@/hooks/useLocalTable";
import {
  EMPTY_CERTIFICATE_FILTERS, STATUS_FILTER_LABEL, certificateEmptyMessage,
  isCertificateFilterDirty, type CertificateFilterState,
} from "./certificateRules";

const PAGE = 50;
const SELECT = "h-9 rounded-md border bg-background px-2 text-sm";

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
      {summary && (
        <ListBand>
          <SummaryStrip s={summary} active={f.status} onPick={(s) => set("status", s)} />
        </ListBand>
      )}
      <ListToolbar>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="Ara…" title="Sertifika no, standart, kuruluş ya da iş ortağı" aria-label="Sertifika ara: sertifika no, standart, kuruluş ya da iş ortağı" value={f.q} onChange={(e) => set("q", e.target.value)} />
          </div>
          <select aria-label="Durum" className={SELECT} value={f.status} onChange={(e) => set("status", e.target.value as CertificateStatusFilter)}>
            {(Object.keys(STATUS_FILTER_LABEL) as CertificateStatusFilter[]).map((k) => <option key={k} value={k}>{STATUS_FILTER_LABEL[k]}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            Uyarı eşiği
            <Input type="number" min={0} max={3650} aria-label="Uyarı eşiği (gün)" className="h-9 w-20" value={f.days}
              onChange={(e) => set("days", Math.min(3650, Math.max(0, Math.trunc(Number(e.target.value) || 0))))} />
            gün
          </label>
          <select aria-label="Sahip" className={SELECT} value={f.holder} onChange={(e) => set("holder", e.target.value as CertificateFilterState["holder"])}>
            <option value="">Fabrika + iş ortakları</option>
            <option value="OWN">Yalnız fabrika</option>
            <option value="PARTNER">Yalnız iş ortakları</option>
          </select>
          {isCertificateFilterDirty(f) && (
            <Button variant="ghost" size="sm" onClick={() => setF(EMPTY_CERTIFICATE_FILTERS)}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" /> Süzgeçleri temizle
            </Button>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <DataTableTools table={table} compact exportName="Sertifikalar" />
          </div>
        </div>
      </ListToolbar>

      {!q.isLoading && !q.isError && rows.length > 0 ? (
        <DataTable table={table} onRowClick={(r) => onOpen(r.id)} exportName="Sertifikalar" />
      ) : (
      <ListBody>
        <QualityListState isLoading={q.isLoading} isError={q.isError} errorTitle="Sertifikalar yüklenemedi." noneText="sertifika yok" emptyText={certificateEmptyMessage(f)} onRetry={() => void q.refetch()} />
      </ListBody>
      )}
      {/* [EL-09] sapması devralındı: elle "Daha fazla yükle" (davranış korunarak alt şeride taşındı). */}
      <ListFooter loaded={rows.length}>
        {q.hasNextPage && (
          <Button variant="outline" size="sm" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
            {q.isFetchingNextPage ? "Yükleniyor…" : "Daha fazla yükle"}
          </Button>
        )}
      </ListFooter>
    </>
  );
}

function SummaryStrip({ s, active, onPick }: { s: CertificateSummary; active: CertificateStatusFilter; onPick: (v: CertificateStatusFilter) => void }) {
  const items: Array<{ key: CertificateStatusFilter; label: string; n: number; cls?: string }> = [
    { key: "active", label: "Etkin", n: s.active },
    { key: "expiring", label: `Süresi dolan / ${s.days} gün içinde dolacak`, n: s.expiring, cls: "text-amber-700 dark:text-amber-300" },
    { key: "expired", label: "Süresi dolmuş", n: s.expired, cls: "text-destructive dark:text-red-400" },
    { key: "revoked", label: "İptal", n: s.revoked },
  ];
  return (
    <div className="flex flex-wrap gap-2" data-testid="certificate-summary">
      {items.map((i) => (
        <button key={i.key} type="button" onClick={() => onPick(i.key)}
          className={cn("rounded-md border px-3 py-1.5 text-left text-xs", active === i.key && "border-primary bg-primary/5")}>
          <span className="text-muted-foreground">{i.label}</span>
          <span className={cn("ml-2 text-sm font-semibold tabular-nums", i.n > 0 && i.cls)}>{i.n}</span>
        </button>
      ))}
    </div>
  );
}
