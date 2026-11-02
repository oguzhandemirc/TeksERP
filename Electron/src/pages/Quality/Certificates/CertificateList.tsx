// Sertifika listesi — süzgeçler + özet şeridi + cursor ile "Daha fazla yükle". Şerit ve tablo AYNI sunucu
// yanıtından (tek where); "süresi dolan/dolmak üzere" süzgeci sunucuda `certificateExpiryWhere`'den.
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { RotateCcw, Search, Paperclip } from "lucide-react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtCalendarDay } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
import { certificateService, type CertificateRow, type CertificateStatusFilter, type CertificateSummary } from "./service";
import { ListBody, ListFooter, ListMessage, ListToolbar } from "@/components/layout/ListPage";
import {
  EMPTY_CERTIFICATE_FILTERS, HOLDER_LABEL, STATUS_FILTER_LABEL, TONE_CLASS, certificateEmptyMessage, expiryBadge,
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

  return (
    <>
      <ListToolbar>
        {summary && <SummaryStrip s={summary} active={f.status} onPick={(s) => set("status", s)} />}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="Sertifika no, standart, kuruluş, iş ortağı…" value={f.q} onChange={(e) => set("q", e.target.value)} />
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
        </div>
      </ListToolbar>

      <ListBody>
        {q.isLoading ? (
          <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>
        ) : q.isError ? (
          <ListMessage>
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
              <p className="font-medium text-destructive">Sertifikalar yüklenemedi.</p>
              <p className="mt-1 text-muted-foreground">Bu bir “sertifika yok” cevabı değildir — istek sunucuya ulaşamadı ya da reddedildi.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => void q.refetch()}>Tekrar dene</Button>
            </div>
          </ListMessage>
        ) : rows.length === 0 ? (
          <ListMessage>
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{certificateEmptyMessage(f)}</div>
          </ListMessage>
        ) : (
          <CertificateTable rows={rows} soonDays={summary?.days ?? f.days} onOpen={onOpen} />
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

export function ExpiryPill({ row, soonDays }: { row: Parameters<typeof expiryBadge>[0]; soonDays: number }) {
  const b = expiryBadge(row, soonDays);
  return <span data-tone={b.tone} className={cn("inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", TONE_CLASS[b.tone])}>{b.text}</span>;
}

function CertificateTable({ rows, soonDays, onOpen }: { rows: CertificateRow[]; soonDays: number; onOpen: (id: string) => void }) {
  return (
    <table className="w-full min-w-[760px] text-sm">
      <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
        <tr>
          <th className="p-3 text-left">Standart</th>
          <th className="p-3 text-left">Sertifika No</th>
          <th className="p-3 text-left">Sahip</th>
          <th className="p-3 text-left">Veren kuruluş</th>
          <th className="p-3 text-left">Bitiş</th>
          <th className="p-3 text-left">Kalan</th>
          <th className="p-3 text-left">Belge</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => onOpen(r.id)}>
            <td className="p-3 font-medium">{r.standard}</td>
            <td className="p-3 font-mono text-xs">{r.certificateNo}</td>
            <td className="p-3">{r.holder === "OWN" ? HOLDER_LABEL.OWN : r.partner?.name ?? HOLDER_LABEL.PARTNER}</td>
            <td className="p-3 text-muted-foreground">{r.issuer ?? "—"}</td>
            <td className="whitespace-nowrap p-3 tabular-nums">{fmtCalendarDay(r.expiresOn)}</td>
            <td className="p-3"><ExpiryPill row={r} soonDays={soonDays} /></td>
            <td className="p-3 text-xs text-muted-foreground">
              {r.fileCount > 0 ? <span className="inline-flex items-center gap-1"><Paperclip className="h-3.5 w-3.5" />{r.fileCount}</span> : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
