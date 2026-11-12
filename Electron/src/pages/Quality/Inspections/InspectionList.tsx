// Muayene listesi — süzgeç + özet şeridi + cursor "Daha fazla yükle". Şerit ve tablo AYNI yanıttan (tek where);
// süzgeç değişince cursor başa döner (sorgu anahtarı süzgeçten türer). İstemci satır süzmez, toplamaz.
import { useEffect, useMemo, useRef } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { useLocalTable } from "@/hooks/useLocalTable";
import { Button } from "@/components/ui/button";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { inspectionService, type InspectionListRow, type InspectionSummary } from "./service";
import { isInspectionFilterDirty, numText, toListParams, type InspectionFilterState } from "./inspectionRules";
import { inspectionColumns } from "./inspectionColumns";
import { InspectionFilters } from "./InspectionFilters";
import { InspectionExportButton } from "./InspectionExportButton";
import { QualityListState } from "../QualityListState";
import { BandStats, ListBand, ListBody, ListFooter, ListToolbar } from "@/components/layout/ListPage";

const PAGE = 50;

interface Props { f: InspectionFilterState; onFilters: (f: InspectionFilterState) => void; onOpen: (id: string) => void }

export function InspectionList({ f, onFilters, onOpen }: Props) {
  // Metin süzgeçleri yazarken her tuşta istek atmasın.
  const params = toListParams({ ...f, q: useDebouncedValue(f.q), minScore: useDebouncedValue(f.minScore), maxScore: useDebouncedValue(f.maxScore) });
  const q = useInfiniteQuery({
    queryKey: ["quality-inspections", "list", params],
    queryFn: ({ pageParam }) => inspectionService.list({ ...params, cursor: pageParam, limit: PAGE }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = (q.data?.pages ?? []).flatMap((p) => p.items);
  const summary = q.data?.pages[0]?.summary;
  const pick = (u: InspectionListRow["inspectedBy"]) => u && onFilters({ ...f, inspectedById: u.id, inspectedByLabel: u.fullName });
  const pickRef = useRef(pick);
  useEffect(() => { pickRef.current = pick; });
  const columns = useMemo(() => inspectionColumns((u) => pickRef.current(u)), []);
  const table = useLocalTable({ tableKey: "quality-inspections", data: rows, columns });

  return (
    <>
      {summary && (
        <ListBand>
          <SummaryStrip s={summary} />
        </ListBand>
      )}
      <ListToolbar>
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1"><InspectionFilters f={f} onChange={onFilters} /></div>
          <InspectionExportButton params={params} disabled={!summary || summary.total === 0} />
          <DataTableTools table={table} compact exportName="Muayeneler" />
        </div>
      </ListToolbar>
      {!q.isLoading && !q.isError && rows.length > 0 ? (
        <DataTable table={table} onRowClick={(r) => onOpen(r.id)} exportName="Muayeneler" />
      ) : (
      <ListBody>
        <QualityListState isLoading={q.isLoading} isError={q.isError} errorTitle="Muayeneler yüklenemedi." noneText="muayene yok" emptyText={isInspectionFilterDirty(f) ? "Bu süzgeçlere uyan muayene yok." : "Henüz muayene yok. Tablette KK1/kalite istasyonundan ya da “Kâğıttan muayene” ile girilir."} onRetry={() => void q.refetch()} />
      </ListBody>
      )}
      {/* [EL-09] sapması devralındı: elle "Daha fazla yükle" (davranış korunarak alt şeride taşındı). */}
      <ListFooter loaded={rows.length} total={summary?.total}>
        {q.hasNextPage && (
          <Button variant="outline" size="sm" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
            {q.isFetchingNextPage ? "Yükleniyor…" : "Daha fazla yükle"}
          </Button>
        )}
      </ListFooter>
    </>
  );
}

/** Yalnız sunucu özetini çizer — sayı istemcide toplanmaz (sayfalı listeyle ayrışmasın). */
export function SummaryStrip({ s }: { s: InspectionSummary }) {
  return (
    <div data-testid="inspection-summary">
      <BandStats
        label="Muayene özeti"
        items={[
          { key: "total", label: "Top", value: s.total },
          { key: "avg", label: "Ort. puan / 100 m²", value: numText(s.avgPointsPer100M2) },
          ...s.grades.map((g) => ({ key: `grade-${g.code}`, label: g.code ? `Derece ${g.code}` : "Derecesiz", value: g.count })),
          { key: "mismatch", label: "Uyumsuz", value: s.mismatch, tone: s.mismatch > 0 ? ("danger" as const) : undefined },
          { key: "width", label: "En yok", value: s.widthUnknown ?? "—", tone: (s.widthUnknown ?? 0) > 0 ? ("warn" as const) : undefined },
        ]}
      />
    </div>
  );
}
