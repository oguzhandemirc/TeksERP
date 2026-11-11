// Kayıt kalıbı — mini hareket listesi: tür rozeti · belge no + alt satır · miktar · zaman.
// Hedefi olan satır düğmedir (kaydına gider); hedefsiz satır düz metin — tıklanır görünüp gitmez.
import type { ReactNode } from "react";
import type { IconTileTone } from "@/components/ui/icon-tile";
import { cn } from "@/lib/utils";
import { ToneChip } from "./RecordBits";

export interface RecordActivityItem {
  key: string;
  kind: string;
  tone: IconTileTone;
  title: ReactNode;
  sub?: ReactNode;
  amount?: ReactNode;
  when?: ReactNode;
  onOpen?: (() => void) | null;
  /** Soluk satır (iptal edilmiş belge). */
  muted?: boolean;
}

export function RecordActivityList({ items, loading, error, emptyText, onRetry }: { items: RecordActivityItem[]; loading?: boolean; error?: boolean; emptyText: string; onRetry?: () => void }) {
  if (loading) {
    return <div className="space-y-2">{Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton-shimmer h-9 rounded-lg bg-muted" />)}</div>;
  }
  if (error) {
    return (
      <div className="py-4 text-center text-sm">
        <p className="font-medium text-destructive">Veri alınamadı.</p>
        {onRetry && <button type="button" onClick={onRetry} className="mt-1 text-xs font-medium text-primary hover:underline">Tekrar dene</button>}
      </div>
    );
  }
  if (items.length === 0) return <p className="py-4 text-center text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <ul className="-mx-2 divide-y divide-border/60">
      {items.map((h) => {
        const body = (
          <>
            <ToneChip tone={h.tone} className="w-[6.5rem] shrink-0 justify-center" title={h.kind}>{h.kind}</ToneChip>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate font-semibold tabular-nums">{h.title}</span>
              {h.sub && <span className="truncate text-xs text-muted-foreground">{h.sub}</span>}
            </span>
            {h.amount != null && <span className="shrink-0 text-right font-semibold tabular-nums">{h.amount}</span>}
            {h.when != null && <span className="w-[4.5rem] shrink-0 text-right text-xs tabular-nums text-muted-foreground">{h.when}</span>}
          </>
        );
        const cls = cn("flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm", h.muted && "opacity-60");
        return (
          <li key={h.key}>
            {h.onOpen ? (
              <button type="button" onClick={h.onOpen} className={cn(cls, "transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none")}>{body}</button>
            ) : (
              <div className={cls}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
