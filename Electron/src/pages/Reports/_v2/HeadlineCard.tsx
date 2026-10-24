import { SIDE_FIGURE_LIMIT, type AnaSayi } from "./sunum";
import { comparisonText, formatFigure, toneClass } from "./figures";

interface Props {
  headline: AnaSayi;
  sideFigures: AnaSayi[];
  /** Kıyas döneminin etiketi ("Eylül 2026"); yoksa "önceki". */
  comparisonLabel?: string;
}

/** TEK ana sayı + kıyas oku; altında en çok `SIDE_FIGURE_LIMIT` yan sayı. */
export function HeadlineCard({ headline, sideFigures, comparisonLabel }: Props) {
  const compare = comparisonText(headline, comparisonLabel);
  const notMeasured = headline.deger === null;
  return (
    <section className="flex h-full flex-col gap-3 rounded-lg border bg-card p-4" aria-label="Ana sayı">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{headline.ad}</p>
        <p
          className={notMeasured ? "mt-1 text-2xl font-semibold text-muted-foreground" : "mt-1 text-4xl font-bold tabular-nums"}
          data-testid="headline-value"
        >
          {formatFigure(headline.deger, headline.birim)}
        </p>
        {notMeasured && headline.olculemedi ? <p className="mt-1 text-xs text-muted-foreground">{headline.olculemedi}</p> : null}
        {compare ? (
          <p className={`mt-1 text-sm font-medium ${toneClass(headline.kiyas?.durum)}`} data-testid="headline-compare">
            {compare}
          </p>
        ) : null}
      </div>
      {sideFigures.length > 0 ? (
        <dl className="space-y-1.5 border-t pt-3 text-sm">
          {sideFigures.slice(0, SIDE_FIGURE_LIMIT).map((f) => (
            <div key={f.olcu} className="flex items-baseline justify-between gap-3">
              <dt className="text-muted-foreground">{f.ad}</dt>
              <dd className={f.deger === null ? "text-muted-foreground" : "font-semibold tabular-nums"} title={f.olculemedi}>
                {formatFigure(f.deger, f.birim)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
