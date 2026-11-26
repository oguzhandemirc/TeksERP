// Çözgü tel düzeni şeridi (çözgü raporu): bir rapor boyunca her tel bir kare, iplik harfinin rengiyle;
// rapor sınırı kalın çizgi, altında "rapor × tekrar = toplam tel". Açılım SUNUCUDAN (`endsSequence`);
// yoksa / düzenleniyorsa iplik başına tel payı kadar oransal blok çizilir (istemci notu açmaz).
import { AlertTriangle } from "lucide-react";
import { formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { WeaveGrid } from "./WeaveGrid";
import { YarnLegend } from "./YarnLegend";
import { yarnColor, yarnLetter } from "./weave-palette";
import { slotOf } from "./shared-palette";
import {
  endsPerYarnFromSequence, proportionalSegments, repeatsToShow, stripCell, type WarpEndsSequenceView,
} from "./warp-ends";

export interface WarpEndsStripYarn {
  /** İplik adı (lejantta harfin yanında). */
  label: string;
  /** Kart satırındaki tel. */
  endsCount: number;
}

export interface WarpEndsStripProps {
  /** Kart iplik satırları, kart sırasıyla (A, B, C…). */
  yarns: readonly WarpEndsStripYarn[];
  /** Sunucu açılımı; null/undefined → oransal bloklar. */
  endsSequence?: WarpEndsSequenceView | null;
  /** Dizilim notu ("2A 1B") — açılım yoksa "çözülemedi" ile "girilmemiş"i ayırır. */
  sequenceNote?: string | null;
  /** Kartın toplam tel kolonu; açılımın toplamıyla uyuşmazsa uyarılır. */
  cardEnds?: number | null;
  /** Form düzenleniyor: kayıtlı açılım eskidir → oransal blok + "kaydedince çözülür". */
  pending?: boolean;
  /** Oransal blok altındaki notu ezer (ör. "Dizilim yükleniyor…"). */
  fallbackHint?: string;
  /** Şerit başlığı (ör. "Zemin · UA6007-Ç"). */
  title?: string;
  /** Mini hâl: lejant, not ve uyarı satırları çizilmez. */
  compact?: boolean;
  /** Şeridin sığacağı genişlik (px); kare boyu ve gösterilen rapor adedi buna göre seçilir. Varsayılan 640. */
  maxWidth?: number;
  /** Ortak palet yuvaları (satır i → yuva; `shared-palette`); yoksa kartın kendi sırası (A = 1. satır). */
  slots?: readonly number[] | null;
  className?: string;
}

/** Kart satırı (1-tabanlı) → harf + renk; ortak palette aynı iplik her kartta aynı harf/renk. */
interface RowMark { color: (row1: number) => string; letter: (row1: number) => string }
const rowMark = (slots: readonly number[] | null | undefined): RowMark => ({
  color: (row1) => yarnColor(slotOf(slots, row1)),
  letter: (row1) => yarnLetter(slotOf(slots, row1) - 1),
});

function fallbackNote(pending: boolean | undefined, note: string | null | undefined): string {
  if (pending) return "Kaydedince çözgü raporu tel tel çözülür; şimdilik ipliklerin tel payı gösteriliyor.";
  if (note && note.trim()) return `Çözgü raporu “${note.trim()}” okunamadı; ipliklerin tel payı gösteriliyor.`;
  return "Çözgü raporu girilmemiş; ipliklerin tel payı gösteriliyor.";
}

export function WarpEndsStrip(props: WarpEndsStripProps) {
  const { yarns, endsSequence, sequenceNote, cardEnds, pending, fallbackHint, title, compact, maxWidth = 640, slots, className } = props;
  const seq = !pending && endsSequence && endsSequence.repeat.length > 0 ? endsSequence : null;
  if (!seq && !yarns.some((y) => y.endsCount > 0)) {
    return <p className={cn("text-xs text-muted-foreground", className)} data-testid="warp-ends-empty">Tel sayısı girilince görünür.</p>;
  }
  const mark = rowMark(slots);
  const legend = yarns.map((y, i) => ({
    color: mark.color(i + 1), mark: mark.letter(i + 1), label: y.label, note: `${formatQty(y.endsCount, 0)} tel`,
  }));
  return (
    <figure className={cn("min-w-0 space-y-1.5", className)} data-testid="warp-ends-strip">
      {title && <figcaption className="text-xs font-medium text-muted-foreground">{title}</figcaption>}
      {seq ? <SequenceBand seq={seq} yarns={yarns} cardEnds={cardEnds} compact={compact} maxWidth={maxWidth} mark={mark} />
        : <ProportionalBand yarns={yarns} mark={mark} />}
      {!compact && !seq && <p className="text-xs text-muted-foreground" data-testid="warp-ends-fallback">{fallbackHint ?? fallbackNote(pending, sequenceNote)}</p>}
      {!compact && <YarnLegend entries={legend} />}
    </figure>
  );
}

function SequenceBand({ seq, yarns, cardEnds, compact, maxWidth, mark }: {
  seq: WarpEndsSequenceView; yarns: readonly WarpEndsStripYarn[]; cardEnds?: number | null; compact?: boolean; maxWidth: number; mark: RowMark;
}) {
  const len = seq.repeat.length;
  // Tekrarın görünmesi için rapor en az 6 px'lik karelerle 2–3 kez sığmalı; sığmazsa tek rapor.
  const shown = repeatsToShow(len, Math.floor(maxWidth / 6));
  const cols = len * shown;
  const cell = compact ? Math.min(8, stripCell(cols, maxWidth)) : stripCell(cols, maxWidth);
  const byYarn = endsPerYarnFromSequence(seq, yarns.length);
  const yarnMismatch = !seq.matchesYarnEnds;
  const cardMismatch = cardEnds != null && cardEnds > 0 && cardEnds !== seq.totalEnds;
  return (
    <>
      <div className="w-fit max-w-full overflow-x-auto rounded-md border bg-background p-1.5">
        <WeaveGrid
          rows={1} cols={cols} cell={cell} rowLabel={false}
          ariaLabel={`Tel düzeni: ${len} tellik rapor, ${shown} rapor gösteriliyor`}
          fill={(_r, c) => mark.color(seq.repeat[c % len]!)}
          colLabel={cell >= 10 ? (c) => mark.letter(seq.repeat[c % len]!) : undefined}
          colBandEvery={shown > 1 ? len : undefined}
        />
      </div>
      <p className="text-xs tabular-nums" data-testid="warp-ends-summary">
        <span className="font-medium">Çözgü raporu {formatQty(len, 0)} tel</span>
        {" × "}{formatQty(seq.repeatCount, 0)} tekrar
        {seq.remainder > 0 && <> + {formatQty(seq.remainder, 0)} tel</>}
        {" = "}<span className="font-medium">{formatQty(seq.totalEnds, 0)} tel</span>
        {shown > 1 && !compact && <span className="text-muted-foreground"> · şeritte {shown} rapor</span>}
      </p>
      {!compact && (yarnMismatch || cardMismatch) && (
        <div role="alert" className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs" data-testid="warp-ends-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
          <div className="space-y-0.5">
            {yarnMismatch && (
              <p>Çözgü raporu iplik satırlarındaki telleri tutmuyor:{" "}
                {yarns.map((y, i) => `${mark.letter(i + 1)} raporda ${formatQty(byYarn[i] ?? 0, 0)} / kartta ${formatQty(y.endsCount, 0)}`).join(" · ")}
              </p>
            )}
            {cardMismatch && <p>Kartın toplam teli {formatQty(cardEnds, 0)}, iplik satırlarının toplamı {formatQty(seq.totalEnds, 0)}.</p>}
          </div>
        </div>
      )}
    </>
  );
}

function ProportionalBand({ yarns, mark }: { yarns: readonly WarpEndsStripYarn[]; mark: RowMark }) {
  const segs = proportionalSegments(yarns.map((y) => y.endsCount));
  return (
    <div className="flex h-6 w-full overflow-hidden rounded-md border" role="img"
      aria-label={`Tel payı: ${segs.map((s) => `${mark.letter(s.yarn)} ${formatQty(s.ends, 0)} tel`).join(", ")}`}
      data-testid="warp-ends-proportional">
      {segs.map((s) => (
        <div key={s.yarn} className="flex min-w-0 items-center justify-center overflow-hidden border-r border-background text-[11px] font-semibold text-background last:border-r-0"
          style={{ width: `${s.pct}%`, background: mark.color(s.yarn) }} title={`${mark.letter(s.yarn)} · ${formatQty(s.ends, 0)} tel`}>
          {s.pct >= 8 && <span className="truncate px-1">{mark.letter(s.yarn)}</span>}
        </div>
      ))}
    </div>
  );
}
