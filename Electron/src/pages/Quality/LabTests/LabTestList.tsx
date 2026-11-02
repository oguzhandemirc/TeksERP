// Lab testleri listesi — süzgeçler + özet şeridi + cursor ile "Daha fazla yükle". Şerit ve tablo AYNI
// sunucu yanıtından (tek where); süzgeç değişince cursor başa döner (sorgu anahtarı süzgeçten türer).
import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { RotateCcw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateRangeInput } from "@/components/forms/DateRangeInput";
import { fmtCalendarDay } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
import { labTestService, labTestTypeService, type LabSummary, type LabTestListRow } from "./service";
import { EMPTY_LAB_FILTERS, STATUS_BADGE, STATUS_LABEL, isLabFilterDirty, labEmptyMessage, type LabFilterState } from "./labTestRules";
import { ListBody, ListFooter, ListMessage, ListToolbar } from "@/components/layout/ListPage";

const PAGE = 50;
const SELECT = "h-9 rounded-md border bg-background px-2 text-sm";

export function LabTestList({ onOpen }: { onOpen: (id: string) => void }) {
  const [f, setF] = useState<LabFilterState>(EMPTY_LAB_FILTERS);
  const set = <K extends keyof LabFilterState>(k: K, v: LabFilterState[K]) => setF((x) => ({ ...x, [k]: v }));
  const types = useQuery({ queryKey: ["lab-test-types", "all"], queryFn: () => labTestTypeService.list(false), staleTime: 60_000 });
  // Metin süzgeçleri yazarken her tuşta istek atmasın; seçim süzgeçleri anında.
  const query = { ...f, q: useDebouncedValue(f.q), batchNo: useDebouncedValue(f.batchNo) };
  const q = useInfiniteQuery({
    queryKey: ["lab-tests", "list", query],
    queryFn: ({ pageParam }) => labTestService.list({ ...query, cursor: pageParam, limit: PAGE }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = (q.data?.pages ?? []).flatMap((p) => p.items);
  const summary = q.data?.pages[0]?.summary;

  return (
    <>
      <ListToolbar>
        {summary && <SummaryStrip s={summary} active={f.status} onPick={(s) => set("status", s)} />}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="Test no, numune, top barkodu…" value={f.q} onChange={(e) => set("q", e.target.value)} />
          </div>
          <Input className="w-full sm:w-36" placeholder="Parti no" aria-label="Parti no" value={f.batchNo} onChange={(e) => set("batchNo", e.target.value)} />
          <select aria-label="Test türü" className={SELECT} value={f.testTypeId} onChange={(e) => set("testTypeId", e.target.value)}>
            <option value="">Tüm test türleri</option>
            {(types.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select aria-label="Sonuç" className={SELECT} value={f.verdict} onChange={(e) => set("verdict", e.target.value as LabFilterState["verdict"])}>
            <option value="">Tüm sonuçlar</option>
            <option value="FAIL">Kalan sonucu var</option>
            <option value="PASS">Hepsi geçti</option>
          </select>
          <select aria-label="Durum" className={SELECT} value={f.status} onChange={(e) => set("status", e.target.value as LabFilterState["status"])}>
            <option value="">Tüm durumlar</option>
            <option value="DRAFT">Taslak</option>
            <option value="APPROVED">Onaylı</option>
            <option value="VOIDED">İptal</option>
          </select>
          <DateRangeInput from={f.from} to={f.to} onFrom={(v) => set("from", v)} onTo={(v) => set("to", v)} inputClassName="h-9 w-[9.5rem]" />
          {isLabFilterDirty(f) && (
            <Button variant="ghost" size="sm" onClick={() => setF(EMPTY_LAB_FILTERS)}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" /> Süzgeçleri temizle
            </Button>
          )}
        </div>
      </ListToolbar>
      <ListBody>
        {q.isLoading ? (
          <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>
        ) : q.isError ? (
          <ListMessage>
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
              <p className="font-medium text-destructive">Lab testleri yüklenemedi.</p>
              <p className="mt-1 text-muted-foreground">Bu bir “test yok” cevabı değildir — istek sunucuya ulaşamadı ya da reddedildi.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => void q.refetch()}>Tekrar dene</Button>
            </div>
          </ListMessage>
        ) : rows.length === 0 ? (
          <ListMessage>
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{labEmptyMessage(f)}</div>
          </ListMessage>
        ) : (
          <LabTable rows={rows} onOpen={onOpen} />
        )}
      </ListBody>
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

function SummaryStrip({ s, active, onPick }: { s: LabSummary; active: string; onPick: (v: LabFilterState["status"]) => void }) {
  const items: Array<{ key: LabFilterState["status"]; label: string; n: number }> = [
    { key: "", label: "Toplam", n: s.total },
    { key: "DRAFT", label: "Taslak", n: s.draft },
    { key: "APPROVED", label: "Onaylı", n: s.approved },
    { key: "VOIDED", label: "İptal", n: s.voided },
  ];
  return (
    <div className="flex flex-wrap gap-2" data-testid="lab-summary">
      {items.map((i) => (
        <button key={i.label} type="button" onClick={() => onPick(i.key)}
          className={cn("rounded-md border px-3 py-1.5 text-left text-xs", active === i.key && "border-primary bg-primary/5")}>
          <span className="text-muted-foreground">{i.label}</span>
          <span className="ml-2 text-sm font-semibold tabular-nums">{i.n}</span>
        </button>
      ))}
      <div className="rounded-md border border-destructive/30 px-3 py-1.5 text-xs">
        <span className="text-muted-foreground">Kalan sonucu olan</span>
        <span className="ml-2 text-sm font-semibold tabular-nums text-destructive">{s.failing}</span>
      </div>
    </div>
  );
}

function LabTable({ rows, onOpen }: { rows: LabTestListRow[]; onOpen: (id: string) => void }) {
  return (
    <table className="w-full min-w-[720px] text-sm">
      <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
        <tr>
          <th className="p-3 text-left">Test No</th>
          <th className="p-3 text-left">Test tarihi</th>
          <th className="p-3 text-left">Konu</th>
          <th className="p-3 text-left">Kumaş</th>
          <th className="p-3 text-left">Numune · Lab</th>
          <th className="p-3 text-left">Sonuç</th>
          <th className="p-3 text-left">Durum</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => onOpen(r.id)}>
            <td className="p-3 font-mono text-xs">{r.testNo}</td>
            <td className="p-3">{fmtCalendarDay(r.testedOn)}</td>
            <td className="whitespace-nowrap p-3">{r.roll ? <>Top <span className="font-mono">{r.roll.barcode ?? "—"}</span></> : <>Parti <span className="font-mono">{r.batch?.batchNumber ?? "—"}</span></>}</td>
            <td className="p-3">{r.item?.name ?? "—"}</td>
            <td className="p-3 text-xs text-muted-foreground">{[r.sampleCode, r.labName].filter(Boolean).join(" · ") || "—"}</td>
            <td className="whitespace-nowrap p-3">
              {r.resultCount === 0 ? <span className="text-xs text-muted-foreground">Sonuç yok</span>
                : r.hasFail ? <Badge variant="destructive">Kalan var · {r.resultCount}</Badge>
                : <Badge variant="outline">Geçti · {r.resultCount}</Badge>}
            </td>
            <td className="whitespace-nowrap p-3"><Badge variant={STATUS_BADGE[r.status]}>{STATUS_LABEL[r.status]}</Badge></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
