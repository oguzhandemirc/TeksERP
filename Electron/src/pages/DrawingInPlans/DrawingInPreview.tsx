// Tahar önizlemesi: satır = çerçeve, sütun = tel; dolu kare = tel o çerçevenin gücüsünden geçer.
// Yalnız görünüm; dizi geçersizse çizilmez. `compact` ürün kartındaki kısa şerit içindir.
import { threadingMatrix } from "@/components/weave/weave-drawdown";
import { cn } from "@/lib/utils";

const MAX_ENDS = 96;
const COMPACT_ENDS = 48;

export function DrawingInPreview({ frameCount, threading, compact = false }: { frameCount: number; threading: readonly number[]; compact?: boolean }) {
  if (frameCount < 1 || threading.length === 0 || threading.some((f) => f < 1 || f > frameCount)) return null;
  const limit = compact ? COMPACT_ENDS : MAX_ENDS;
  const shown = threading.slice(0, limit);
  const matrix = threadingMatrix(frameCount, shown.map((f) => f - 1));
  const cell = compact ? "h-2 w-2" : "h-3 w-3";
  return (
    <div className="space-y-1" data-testid="drawing-in-preview">
      <div className="overflow-x-auto rounded border bg-background p-1.5">
        {/* Çerçeve 1 en altta (tezgâh önü), dokuma çizimi geleneği. */}
        <div className="inline-flex flex-col-reverse gap-px">
          {matrix.map((row, f) => (
            <div key={f} className="flex items-center gap-px">
              {!compact && <span className="w-5 pr-1 text-right font-mono text-[10px] text-muted-foreground">{f + 1}</span>}
              {row.map((on, i) => (
                <span key={i} className={cn(cell, on ? "bg-foreground" : "bg-muted")} />
              ))}
            </div>
          ))}
        </div>
      </div>
      {threading.length > limit && (
        <p className="text-xs text-muted-foreground">İlk {limit} tel gösteriliyor (toplam {threading.length}).</p>
      )}
    </div>
  );
}
