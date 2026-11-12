import {
  Banknote,
  Clock,
  Gauge,
  Hash,
  Layers,
  Package,
  Percent,
  Ruler,
  ShoppingCart,
  Star,
  Weight,
  type LucideIcon,
} from "lucide-react";
import { IconTile, type IconTileTone } from "@/components/ui/icon-tile";
import { cn } from "@/lib/utils";
import { SIDE_FIGURE_LIMIT, type AnaSayi, type Birim, type ComparisonTone } from "./sunum";
import { comparisonText, formatFigure, toneClass } from "./figures";

interface Props {
  headline: AnaSayi;
  sideFigures: AnaSayi[];
  /** Kıyas döneminin etiketi ("Eylül 2026"); yoksa "önceki". */
  comparisonLabel?: string;
}

/** Birimden simge — kart dili (simge karesi) için; değer ve metin sunucudan. */
const UNIT_ICON: Readonly<Record<Birim, LucideIcon>> = {
  m: Ruler,
  kg: Weight,
  top: Package,
  adet: Hash,
  siparis: ShoppingCart,
  levent: Layers,
  parti: Layers,
  yuzde: Percent,
  puan: Star,
  gun: Clock,
  dakika: Clock,
  saat: Clock,
  TRY: Banknote,
  USD: Banknote,
  EUR: Banknote,
};

/** Kart sırasına göre ton: ana sayı birincil, yanlar belirlenimli palet. */
const SIDE_TONES: readonly IconTileTone[] = ["sky", "teal", "amber"];

/** Kıyas hapı zemini — renk sunucunun `durum`undan (istemci yeniden yorumlamaz). */
function pillClass(tone: ComparisonTone | undefined): string {
  if (tone === "iyi") return "bg-success-soft";
  if (tone === "kotu") return "bg-destructive/10";
  return "bg-muted";
}

/** "▲ %12 (Eylül 2026: 9.800 m)" → hap "▲ %12" + soluk kuyruk; METİN `comparisonText`in aynısı (PDF ile eş). */
function splitComparison(text: string): [string, string] {
  const i = text.indexOf(" (");
  return i < 0 ? [text, ""] : [text.slice(0, i), text.slice(i)];
}

function FigureCard({ figure, comparisonLabel, tone, primary }: { figure: AnaSayi; comparisonLabel?: string; tone: IconTileTone; primary: boolean }) {
  const compare = comparisonText(figure, comparisonLabel);
  const notMeasured = figure.deger === null;
  const [head, tail] = compare ? splitComparison(compare) : ["", ""];
  return (
    <div
      className={cn(
        "@container flex min-w-0 gap-3 rounded-xl border border-card-border bg-card p-4 shadow-card",
        primary && "ring-1 ring-primary/20 bg-gradient-to-br from-primary/[0.06] to-card",
      )}
      data-testid={primary ? "headline-card" : "side-figure"}
    >
      <IconTile icon={UNIT_ICON[figure.birim] ?? Gauge} tone={tone} size="md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-muted-foreground" title={figure.ad}>
          {figure.ad}
        </p>
        <p
          className={
            notMeasured
              ? "mt-0.5 text-lg font-semibold text-muted-foreground"
              : cn("mt-0.5 whitespace-nowrap font-bold leading-tight tabular-nums", primary ? "text-[clamp(1.25rem,12cqi,2rem)]" : "text-[clamp(1.1rem,10cqi,1.5rem)]")
          }
          data-testid={primary ? "headline-value" : undefined}
          title={figure.olculemedi}
        >
          {formatFigure(figure.deger, figure.birim)}
        </p>
        {notMeasured && figure.olculemedi ? <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{figure.olculemedi}</p> : null}
        {compare ? (
          <p className={cn("mt-1.5 text-xs font-medium", toneClass(figure.kiyas?.durum))} data-testid={primary ? "headline-compare" : undefined} title={compare}>
            <span className={cn("rounded-md px-1.5 py-0.5 tabular-nums", pillClass(figure.kiyas?.durum))}>{head}</span>
            {tail ? <span className="mt-1 block truncate font-normal text-muted-foreground">{tail}</span> : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Sayı kartları şeridi: TEK ana sayı (vurgulu) + en çok `SIDE_FIGURE_LIMIT` yan sayı, StatCard dili
 * (simge karesi, büyük değer, kıyas hapı). "Ölçülemedi" sayıya çökertilmez; neden altta yazılır.
 */
export function HeadlineCard({ headline, sideFigures, comparisonLabel }: Props) {
  const sides = sideFigures.slice(0, SIDE_FIGURE_LIMIT);
  return (
    <section className="grid h-full auto-rows-fr grid-cols-1 gap-3 sm:grid-cols-2" aria-label="Ana sayı">
      <FigureCard figure={headline} comparisonLabel={comparisonLabel} tone="primary" primary />
      {sides.map((f, i) => (
        <FigureCard key={f.olcu} figure={f} comparisonLabel={comparisonLabel} tone={SIDE_TONES[i % SIDE_TONES.length]!} primary={false} />
      ))}
    </section>
  );
}
