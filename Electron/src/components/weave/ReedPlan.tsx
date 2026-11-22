// Tarak planı: sol kenardan bir örnek — her diş bir kutu, içinde dişe giren tel kadar kare. Kenar teli
// ayrı tonda, zemin telleri tel düzeni (sunucu `endsSequence`) sırasıyla boyanır. Sayılar özet satırında.
import { formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { WeaveGrid } from "./WeaveGrid";
import { YarnLegend } from "./YarnLegend";
import { yarnColor } from "./weave-palette";
import { reedSample, type WarpEndsSequenceView } from "./warp-ends";

export const SELVEDGE_COLOR = "hsl(var(--muted-foreground) / 0.55)";

export interface ReedPlanProps {
  endsPerDent: number | null | undefined;
  reedNo?: string | number | null;
  /** Toplam tel (kenar dahil). */
  totalEnds: number;
  /** Toplam kenar teli (iki yan); her yana yarısı. */
  selvedgeEnds?: number | null;
  endsSequence?: WarpEndsSequenceView | null;
  /** Örneğin sığacağı genişlik (px); çizilen diş adedi buna göre. Varsayılan 640. */
  maxWidth?: number;
  className?: string;
}

const CELL = 10;
const DENT_GAP = 8; // WeaveGrid blok aralığı: max(4, round(10 × 0.75))

/** Genişliğe sığan zemin dişi adedi (2 kenar dişi çizildiği varsayılır), 3–12. */
export function groundDentsFor(maxWidth: number, endsPerDent: number): number {
  const dent = endsPerDent * CELL + DENT_GAP;
  return Math.max(3, Math.min(12, Math.floor((maxWidth - 2 * dent) / dent)));
}

export function ReedPlan({ endsPerDent, reedNo, totalEnds, selvedgeEnds, endsSequence, maxWidth = 640, className }: ReedPlanProps) {
  const epdIn = endsPerDent && endsPerDent > 0 ? endsPerDent : 1;
  const s = reedSample({ endsPerDent, totalEnds, selvedgeEnds, repeat: endsSequence?.repeat, groundDentsShown: groundDentsFor(maxWidth, epdIn) });
  if (!s) {
    return <p className={cn("text-xs text-muted-foreground", className)} data-testid="reed-plan-empty">Tarak planı için “dişe tel” ve tel adedi girin.</p>;
  }
  const epd = endsPerDent!;
  const parts = [
    `Dişe ${formatQty(epd, 0)} tel`,
    reedNo != null && String(reedNo) !== "" ? `tarak no ${formatQty(reedNo, 2)}` : null,
    s.selvedgePerSide > 0 ? `kenar her yanda ${formatQty(s.selvedgePerSide, 0)} tel (${formatQty(s.selvedgeDents, 0)} diş)` : null,
    `≈ ${formatQty(s.totalDents, 0)} diş`,
  ].filter(Boolean);
  return (
    <figure className={cn("min-w-0 space-y-1.5", className)} data-testid="reed-plan">
      <div className="w-fit max-w-full overflow-x-auto rounded-md border bg-background p-1.5">
        <WeaveGrid
          rows={1} cols={s.cells.length} cell={CELL} rowLabel={false}
          ariaLabel={`Tarak planı örneği: dişe ${epd} tel, sol kenardan ilk ${s.dentStarts.length} diş`}
          colGapsBefore={s.dentStarts}
          fill={(_r, c) => (s.cells[c] === 0 ? SELVEDGE_COLOR : yarnColor(s.cells[c]!))}
        />
      </div>
      <p className="text-xs tabular-nums" data-testid="reed-plan-summary">{parts.join(" · ")}</p>
      {s.shownSelvedgeDents > 0 && (
        <YarnLegend entries={[{ color: SELVEDGE_COLOR, label: s.shownSelvedgeDents < s.selvedgeDents ? `Kenar teli (ilk ${s.shownSelvedgeDents} diş)` : "Kenar teli" }]} />
      )}
    </figure>
  );
}
