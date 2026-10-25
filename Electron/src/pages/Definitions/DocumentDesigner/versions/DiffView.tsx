import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { diffStats, foldUnchanged, lineDiff } from "./lineDiff";

const ROW = { same: "", del: "bg-red-500/10 text-red-800 dark:text-red-300", add: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300" } as const;
const SIGN = { same: " ", del: "-", add: "+" } as const;

/** Kaynak satır farkı (salt-okunur): eski → yeni, ortak uzun bloklar katlanır. */
export function DiffView({ oldText, newText, label }: { oldText: string; newText: string; label: string }) {
  const lines = useMemo(() => lineDiff(oldText, newText), [oldText, newText]);
  const stats = diffStats(lines);
  const folded = useMemo(() => foldUnchanged(lines), [lines]);
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid={`fark-${label}`}>
      <p className="mb-1 text-xs text-muted-foreground">
        {label}: <span className="text-emerald-700 dark:text-emerald-400">+{stats.added}</span> · <span className="text-red-700 dark:text-red-400">-{stats.removed}</span> satır
      </p>
      <div className="min-h-0 flex-1 overflow-auto rounded border bg-card font-mono text-[11px] leading-4">
        {stats.added + stats.removed === 0 && <p className="p-2 font-sans text-xs text-muted-foreground">Fark yok.</p>}
        {stats.added + stats.removed > 0 &&
          folded.map((l, i) =>
            l.kind === "fold" ? (
              <div key={`f${i}`} className="bg-muted/60 px-2 text-muted-foreground">⋯ {l.count} değişmeyen satır</div>
            ) : (
              <div key={i} className={cn("flex whitespace-pre-wrap break-all", ROW[l.kind])}>
                <span className="w-9 shrink-0 select-none pr-1 text-right text-muted-foreground">{l.oldNo ?? ""}</span>
                <span className="w-9 shrink-0 select-none pr-1 text-right text-muted-foreground">{l.newNo ?? ""}</span>
                <span className="w-3 shrink-0 select-none">{SIGN[l.kind]}</span>
                <span className="min-w-0">{l.text}</span>
              </div>
            ),
          )}
      </div>
    </div>
  );
}
