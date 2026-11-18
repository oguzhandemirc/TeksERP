// Fason kokpiti — "Devere gecikmeleri" bandı (D8b). Devere sevkleri yalnız iplik kalemli olduğundan kokpitin sevk
// listesine girmez; bu bant açık devere siparişlerini termin durumuyla gösterir. ⚠️ REJİM: devere modülü + `warping-order:read`
// (asıl sed backend `requireDevereEnabled`); kapalıyken hiç çizilmez ve istek atılmaz. Satır → sipariş sayfası.
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronRight, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDevereEnabled } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import {
  DEVERE_DELAY_QUERY_KEY, DEVERE_DELAY_STATES, devereChipLabel, devereDueText, devereEmptyText, devereProgressText, listDevereDelays,
  type DevereDelayRow, type DevereDelayState,
} from "./devere-delays";

export const DEVERE_DELAY_PERMISSION = "warping-order:read";
const COLLAPSED_ROWS = 5;

export function DevereDelayBand({ subcontractorId }: { subcontractorId: string | null }) {
  const devere = useDevereEnabled();
  const { hasPermission } = useRoleAccess();
  if (!devere || !hasPermission(DEVERE_DELAY_PERMISSION)) return null;
  return <DevereDelayBandInner subcontractorId={subcontractorId} />;
}

function DevereDelayBandInner({ subcontractorId }: { subcontractorId: string | null }) {
  const [state, setState] = useState<DevereDelayState>("OVERDUE");
  const [expanded, setExpanded] = useState(false);
  const q = useQuery({
    queryKey: [DEVERE_DELAY_QUERY_KEY, state, subcontractorId ?? ""],
    queryFn: () => listDevereDelays(state, subcontractorId),
    placeholderData: keepPreviousData,
  });
  const summary = q.data?.summary ?? null;
  const rows = q.data?.data ?? [];
  const shown = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);
  return (
    <section className="rounded-lg border bg-card px-3 py-2" aria-label="Devere gecikmeleri">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-medium">
          <Layers className="h-4 w-4 text-muted-foreground" aria-hidden />
          Devere gecikmeleri
        </h2>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Devere termin süzgeci">
          {DEVERE_DELAY_STATES.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={state === s ? "default" : "outline"}
              className={cn("h-7 px-2.5 text-xs", s === "OVERDUE" && state !== s && (summary?.overdueCount ?? 0) > 0 && "border-destructive/50 text-destructive")}
              aria-pressed={state === s}
              onClick={() => { setState(s); setExpanded(false); }}
            >
              {devereChipLabel(s, summary)}
            </Button>
          ))}
        </div>
      </div>
      {q.isError ? (
        <p className="mt-2 text-sm text-destructive">
          Devere gecikmeleri yüklenemedi.{" "}
          <button type="button" className="underline" onClick={() => void q.refetch()}>Tekrar dene</button>
        </p>
      ) : q.isLoading ? (
        <p className="mt-2 text-sm text-muted-foreground">Yükleniyor…</p>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{devereEmptyText(state)}</p>
      ) : (
        <>
          <ul className="mt-2 divide-y rounded-md border">
            {shown.map((r) => <DelayRow key={r.warpingOrderId} row={r} />)}
          </ul>
          {rows.length > COLLAPSED_ROWS ? (
            <Button variant="ghost" size="sm" className="mt-1 h-7 text-xs" onClick={() => setExpanded(!expanded)}>
              {expanded ? "Daha az göster" : `Tümünü göster (${rows.length})`}
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}

function DelayRow({ row }: { row: DevereDelayRow }) {
  const open = useOpenTarget();
  const href = `/operations/fason-devere/${row.warpingOrderId}`;
  const tone = row.state === "OVERDUE" ? "text-destructive" : row.state === "DUE_SOON" ? "text-warning" : "text-muted-foreground";
  return (
    <li>
      <a
        href={href}
        onClick={(e) => { e.preventDefault(); open(href, e); }}
        onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); open(href, e); } }}
        className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1.5 text-sm hover:bg-muted/50"
      >
        <span className="font-medium tabular-nums">{row.orderNo}</span>
        <span className="text-muted-foreground">{row.subcontractor.name}</span>
        <span className="text-muted-foreground">{row.warpSpec.code}</span>
        <span className={cn("font-medium", tone)}>{devereDueText(row)}</span>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">{devereProgressText(row)}</span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
      </a>
    </li>
  );
}
