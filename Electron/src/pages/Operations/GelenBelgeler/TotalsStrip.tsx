// Toplam fark şeridi (canlı): onay kapısının hükmü backend `totalsCheck`ten — panel yeniden hesaplamaz; satır yazımı
// detay sorgusunu tazeler, şerit onunla değişir. Eski backend alanı göndermezse şerit çizilmez.
import { blockSummary, describeDiff } from "./reviewView";
import type { TotalsCheck } from "./reviewTypes";

const HEAD = {
  ok: { cls: "border-emerald-500 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300", text: "Toplamlar tutuyor" },
  bad: { cls: "border-destructive bg-destructive/10 text-destructive", text: "Toplamlar tutmuyor — onayda fark gerekçesi istenir" },
  none: { cls: "bg-muted/40 text-muted-foreground", text: "Belgede toplam beyanı yok — doğrulanamaz" },
} as const;

export function TotalsStrip({ check }: { check: TotalsCheck | undefined }) {
  if (!check) return null;
  const head = check.ok === true ? HEAD.ok : check.ok === false ? HEAD.bad : HEAD.none;
  return (
    <div className="flex flex-col gap-2" data-testid="totals-strip" data-ok={check.ok === null ? "unknown" : String(check.ok)}>
      <div className={`rounded-md border px-3 py-2 text-sm font-medium ${head.cls}`} data-testid="totals-verdict">
        {head.text}
      </div>
      <div className="flex flex-wrap gap-2">
        {check.blocks.map((b, i) => (
          <div
            key={`${b.blockNo}-${i}`}
            data-testid={`block-${b.blockNo}`}
            data-ok={b.ok === null ? "unknown" : String(b.ok)}
            className={`rounded-md border px-3 py-2 text-xs ${b.ok === false ? "border-destructive bg-destructive/10" : b.ok ? "border-emerald-500 bg-emerald-500/10" : "bg-muted/40"}`}
          >
            <div className="font-medium">Blok {b.blockNo}</div>
            <div className="tabular-nums">{blockSummary(b)}</div>
            {b.ok === null && <div className="text-muted-foreground">Beyan yok — doğrulanamaz</div>}
            {b.ok === true && <div className="text-emerald-700 dark:text-emerald-400">Beyanla tutuyor</div>}
            {b.diffs.map((d) => (
              <div key={d.field} className="text-destructive tabular-nums">
                {describeDiff(d)}
              </div>
            ))}
          </div>
        ))}
        {check.warnings.map((w) => (
          <div key={w} className="rounded-md border border-amber-500 bg-amber-500/10 px-3 py-2 text-xs">
            {w} (uyarı)
          </div>
        ))}
      </div>
    </div>
  );
}
