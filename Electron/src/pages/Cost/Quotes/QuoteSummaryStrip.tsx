// Özet şeridi: sayılar SUNUCUNUN `ozet`i (durum süzgecinden önceki küme) — çip tıklaması süzgeci sunucuya taşır.
import { cn } from "@/lib/utils";
import { QUOTE_STATUS_LABEL } from "./labels";
import { QUOTE_STATUSES, type QuoteFilter, type QuoteStatus, type QuoteSummary } from "./quote-types";

interface Props { summary: QuoteSummary; filter: QuoteFilter; onChange: (f: QuoteFilter) => void }

function Chip({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn("rounded-full border px-3 py-1 text-xs transition-colors", active ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}
    >
      {label} <span className="font-semibold tabular-nums">{count}</span>
    </button>
  );
}

export function QuoteSummaryStrip({ summary, filter, onChange }: Props) {
  const pick = (status: QuoteStatus | "") => onChange({ ...filter, status, expired: false });
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Durum özeti">
      <Chip active={!filter.status && !filter.expired} label="Hepsi" count={summary.toplam} onClick={() => pick("")} />
      {QUOTE_STATUSES.filter((s) => (summary[s] ?? 0) > 0 || filter.status === s).map((s) => (
        <Chip key={s} active={filter.status === s} label={QUOTE_STATUS_LABEL[s]} count={summary[s] ?? 0} onClick={() => pick(s)} />
      ))}
      <Chip
        active={filter.expired}
        label="Süresi dolan"
        count={summary.suresiDoldu}
        onClick={() => onChange({ ...filter, status: "", expired: !filter.expired })}
      />
    </div>
  );
}
