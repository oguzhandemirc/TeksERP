// Cari özet blokları (yan panel): hesap — bakiye/vadesi geçmiş/risk PARA BİRİMİ BAŞINA; siparişler — açık adet/metre.
// Termin/gecikme sayacı YOK (kullanıcı kararı 2026-11-12: tekstilde termin bilgisinin önemi sıfır).
import type { UseQueryResult } from "@tanstack/react-query";
import { AlertTriangle, ClipboardList, Wallet } from "lucide-react";
import { IconTile } from "@/components/ui/icon-tile";
import { RecordSectionTitle } from "@/components/record/RecordBits";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CariRow } from "@/pages/Finance/service";
import type { OrderStats } from "@/pages/Operations/Orders/service";
import { balanceLines, overdueLines, riskUsage, SIDE_LABEL } from "./cari-finance";
import { metre } from "./cari-movements";

const OPEN_STATUSES = ["PENDING", "APPROVED", "PARTIAL_SHIPPED"] as const;
export const openOrderCount = (s: OrderStats) => OPEN_STATUSES.reduce((n, k) => n + (s.byStatus[k] ?? 0), 0);

const BOX = "rounded-xl border border-card-border bg-background/60 p-3";

export function CariFinanceBlock({ query }: { query: UseQueryResult<CariRow | null>; compact?: boolean }) {
  if (query.isLoading) return <div className="skeleton-shimmer h-24 rounded-xl bg-muted" />;
  if (query.isError) return <p className="text-sm text-destructive">Hesap bilgisi alınamadı.</p>;
  const acc = query.data;
  if (!acc) return <p className="text-sm text-muted-foreground">Bu kartın cari hesabı yok.</p>;
  const lines = balanceLines(acc);
  const overdue = overdueLines(acc);
  const risk = riskUsage(acc);
  return (
    <section>
      <RecordSectionTitle>Hesap</RecordSectionTitle>
      <div className={cn(BOX, "flex gap-3")}>
        <IconTile icon={Wallet} tone="violet" size="md" />
        <div className="min-w-0 flex-1 space-y-1">
          {lines.map((l) => (
            <p key={l.currency} className="flex flex-wrap items-baseline gap-x-2">
              <span className={cn("text-lg font-bold tabular-nums", l.side === "payable" && "text-destructive")}>{l.text}</span>
              <span className="text-xs text-muted-foreground">{SIDE_LABEL[l.side]}</span>
            </p>
          ))}
          {overdue.length > 0 && (
            <p className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Vadesi geçmiş: {overdue.map((o) => o.text).join(" · ")}
            </p>
          )}
          {risk && <RiskBar limit={risk.limit} pct={risk.pct} />}
          {acc.hold && <p className="text-xs font-medium text-destructive">Kilitli: {acc.hold.reasonLabel}</p>}
        </div>
      </div>
    </section>
  );
}

function RiskBar({ limit, pct }: { limit: string; pct: number | null }) {
  const p = Math.min(100, pct ?? 0);
  return (
    <div className="pt-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Risk limiti {limit}</span>
        <span className="tabular-nums">%{pct ?? 0}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", p >= 100 ? "bg-destructive" : p >= 80 ? "bg-warning" : "bg-success")} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

export function CariOrderBlock({ stats }: { stats: OrderStats; compact?: boolean }) {
  const open = openOrderCount(stats);
  return (
    <section>
      <RecordSectionTitle>Siparişler</RecordSectionTitle>
      <div className={cn(BOX, "flex items-center gap-3")}>
        <IconTile icon={ClipboardList} tone="blue" size="md" />
        <div className="grid flex-1 grid-cols-2 gap-2 text-sm">
          <Mini label="Açık" value={formatNumber(open, 0)} />
          <Mini label="Kalan metre" value={metre(stats.totalOpenQty) ?? "—"} />
        </div>
      </div>
    </section>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className="truncate font-bold tabular-nums">{value}</p>
    </div>
  );
}
