// Muayene listesi — süzgeç + özet şeridi + cursor "Daha fazla yükle". Şerit ve tablo AYNI yanıttan (tek where);
// süzgeç değişince cursor başa döner (sorgu anahtarı süzgeçten türer). İstemci satır süzmez, toplamaz.
import { useInfiniteQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { inspectionService, type InspectionListRow, type InspectionSummary } from "./service";
import { NONE_TEXT, PHASE_LABEL, STATE_LABEL, inspectionState, isInspectionFilterDirty, numText, toListParams, type InspectionFilterState } from "./inspectionRules";
import { InspectionFilters } from "./InspectionFilters";
import { InspectionExportButton } from "./InspectionExportButton";
import { ListBody, ListFooter, ListMessage, ListToolbar } from "@/components/layout/ListPage";

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

  return (
    <>
      <ListToolbar>
        {summary && <SummaryStrip s={summary} />}
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1"><InspectionFilters f={f} onChange={onFilters} /></div>
          <InspectionExportButton params={params} disabled={!summary || summary.total === 0} />
        </div>
      </ListToolbar>
      <ListBody>
        {q.isLoading ? (
          <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>
        ) : q.isError ? (
          <ListMessage>
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
              <p className="font-medium text-destructive">Muayeneler yüklenemedi.</p>
              <p className="mt-1 text-muted-foreground">Bu bir “muayene yok” cevabı değildir — istek sunucuya ulaşamadı ya da reddedildi.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => void q.refetch()}>Tekrar dene</Button>
            </div>
          </ListMessage>
        ) : rows.length === 0 ? (
          <ListMessage>
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              {isInspectionFilterDirty(f) ? "Bu süzgeçlere uyan muayene yok." : "Henüz muayene yok. Tablette KK1/kalite istasyonundan ya da “Kâğıttan muayene” ile girilir."}
            </div>
          </ListMessage>
        ) : (
          <InspectionTable rows={rows} onOpen={onOpen} onPickOperator={pick} />
        )}
      </ListBody>
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

function Cell({ label, value, tone }: { label: string; value: string | number; tone?: "warn" | "bad" }) {
  return (
    <div className={`rounded-md border px-3 py-1.5 text-xs ${tone === "bad" ? "border-destructive/40" : tone === "warn" ? "border-amber-500/40" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className={`ml-2 text-sm font-semibold tabular-nums ${tone === "bad" ? "text-destructive" : tone === "warn" ? "text-amber-600 dark:text-amber-400" : ""}`}>{value}</span>
    </div>
  );
}

/** Yalnız sunucu özetini çizer — sayı istemcide toplanmaz (sayfalı listeyle ayrışmasın). */
export function SummaryStrip({ s }: { s: InspectionSummary }) {
  return (
    <div className="flex flex-wrap gap-2" data-testid="inspection-summary">
      <Cell label="Top" value={s.total} />
      <Cell label="Ort. puan / 100 m²" value={numText(s.avgPointsPer100M2)} />
      {s.grades.map((g) => <Cell key={`grade-${g.code}`} label={g.code ? `Derece ${g.code}` : "Derecesiz"} value={g.count} />)}
      <Cell label="Uyumsuz" value={s.mismatch} tone={s.mismatch > 0 ? "bad" : undefined} />
      <Cell label="En yok" value={s.widthUnknown ?? "—"} tone={(s.widthUnknown ?? 0) > 0 ? "warn" : undefined} />
    </div>
  );
}

function InspectionTable({ rows, onOpen, onPickOperator }: { rows: InspectionListRow[]; onOpen: (id: string) => void; onPickOperator: (u: InspectionListRow["inspectedBy"]) => void }) {
  return (
    <table className="w-full min-w-[56rem] text-sm">
      <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
        <tr>
          <th className="p-3 text-left">Top</th><th className="p-3 text-left">Kumaş</th><th className="p-3 text-left">Aşama</th>
          <th className="p-3 text-right">Uzunluk m</th><th className="p-3 text-right">En cm</th><th className="p-3 text-right">Hata</th>
          <th className="p-3 text-right">Puan</th><th className="p-3 text-right">/100 m²</th><th className="p-3 text-left">Derece</th>
          <th className="p-3 text-left">Muayene</th><th className="p-3 text-left">Durum</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const st = inspectionState(r);
          return (
            <tr key={r.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => onOpen(r.id)}>
              <td className="whitespace-nowrap p-3 font-mono text-xs">{r.roll.barcode ?? "—"}{r.revision > 1 && <span className="ml-1 text-muted-foreground">r{r.revision}</span>}</td>
              <td className="max-w-[14rem] truncate p-3">{r.roll.item?.name ?? "—"}</td>
              <td className="p-3">{PHASE_LABEL[r.phase]}</td>
              <td className="p-3 text-right tabular-nums">{numText(r.inspectedLengthM)}</td>
              <td className="p-3 text-right tabular-nums">{r.widthSource === "UNKNOWN" ? <Badge variant="outline">En yok</Badge> : numText(r.widthCm)}</td>
              <td className="p-3 text-right tabular-nums">{r.defectCount}</td>
              <td className="p-3 text-right tabular-nums">{r.totalPoints}</td>
              <td className="p-3 text-right font-medium tabular-nums">{numText(r.pointsPer100M2)}</td>
              <td className="whitespace-nowrap p-3">
                {r.suggestedGradeCode ?? "—"}
                {r.gradeMismatch && <Badge variant="destructive" className="ml-1" title={`Topun kalitesi: ${r.roll.qualityGrade ?? NONE_TEXT}`}>Uyumsuz</Badge>}
              </td>
              <td className="whitespace-nowrap p-3 text-xs">
                <div>{fmtFactoryDateTime(r.inspectedAt)}</div>
                <div className="text-muted-foreground">
                  {r.inspectedBy ? (
                    <button type="button" className="underline-offset-2 hover:underline" title="Bu operatörün muayeneleri" onClick={(e) => { e.stopPropagation(); onPickOperator(r.inspectedBy); }}>{r.inspectedBy.fullName}</button>
                  ) : "—"}{r.station ? ` · ${r.station.name}` : ""}
                </div>
              </td>
              <td className="p-3"><Badge variant={st === "ACTIVE" ? "outline" : st === "VOIDED" ? "destructive" : "secondary"}>{STATE_LABEL[st]}</Badge></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
