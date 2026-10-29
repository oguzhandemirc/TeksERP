// Toplam şeridi (canlı): blok başına Σ satır ↔ beyan; tutmayan blok kırmızı, beyansız blok "doğrulanamaz".
import { blockTotals, formatQty } from "./totals";
import type { DeliveryNoteDetail } from "./types";

export function TotalsStrip({ note }: { note: Pick<DeliveryNoteDetail, "lines" | "totalsDeclared" | "declaredTopCount"> }) {
  const totals = blockTotals(note.lines, note.totalsDeclared?.blocks);
  const live = note.lines.filter((l) => l.status !== "SKIPPED").length;
  return (
    <div className="flex flex-wrap gap-2" data-testid="totals-strip">
      {totals.map((t) => (
        <div
          key={t.blockNo}
          data-testid={`block-${t.blockNo}`}
          data-ok={t.ok === null ? "unknown" : String(t.ok)}
          className={`rounded-md border px-3 py-2 text-xs ${t.ok === false ? "border-destructive bg-destructive/10" : t.ok ? "border-emerald-500 bg-emerald-500/10" : "bg-muted/40"}`}
        >
          <div className="font-medium">Blok {t.blockNo}</div>
          <div className="tabular-nums">
            {t.count} top · {formatQty(t.m)} m{t.kg > 0 ? ` · ${formatQty(t.kg)} kg` : ""}
          </div>
          {t.ok === null && <div className="text-muted-foreground">Beyan yok — doğrulanamaz</div>}
          {t.ok === true && <div className="text-emerald-700 dark:text-emerald-400">Beyanla tutuyor</div>}
          {t.mismatches.map((m) => (
            <div key={m} className="text-destructive">
              {m}
            </div>
          ))}
        </div>
      ))}
      {note.declaredTopCount != null && note.declaredTopCount !== live && (
        <div className="rounded-md border border-amber-500 bg-amber-500/10 px-3 py-2 text-xs">
          Belgede {note.declaredTopCount} top yazıyor, satır {live} (uyarı)
        </div>
      )}
    </div>
  );
}
