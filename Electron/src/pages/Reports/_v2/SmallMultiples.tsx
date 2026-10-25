import { useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { comparisonText, formatFigure, toneClass } from "./figures";
import type { VaryantBlok, VaryantHucresi } from "./sunum";
import { cellFilterSearch } from "./variant-model";

interface Props {
  block: VaryantBlok;
  /** Kıyas döneminin etiketi ("Eylül 2026") — hücre kıyas satırı ana kartla aynı metin. */
  comparisonLabel?: string;
}

/** Ortak eksen: hücrelerin şimdiki ve kıyas değerlerinin en büyüğü (çubuklar birbirine kıyaslanabilsin). */
function axisMax(cells: readonly VaryantHucresi[]): number {
  let max = 0;
  for (const c of cells) {
    for (const v of [c.anaSayi.deger, c.anaSayi.kiyas?.deger ?? null]) if (v !== null && Number.isFinite(v) && v > max) max = v;
  }
  return max;
}

/** İki çubuklu mini grafik (önceki · şimdi), SVG — PDF'e de aynı yoldan basılabilir; ölçülemeyen çubuk çizilmez. */
function MiniBars({ now, before, max }: { now: number | null; before: number | null; max: number }) {
  const w = (v: number | null) => (v === null || max <= 0 || v < 0 ? 0 : Math.max(1, (v / max) * 100));
  return (
    <svg viewBox="0 0 100 18" preserveAspectRatio="none" className="h-5 w-full" role="img" aria-hidden="true">
      {before !== null ? <rect x="0" y="1" width={w(before)} height="6" rx="1" className="fill-muted-foreground/30" /> : null}
      {now !== null ? <rect x="0" y="10" width={w(now)} height="7" rx="1" className="fill-primary" /> : null}
    </svg>
  );
}

/**
 * Küçük çoklular (plan §3.2): seçili boyutun en büyük ≤6 değeri, her hücre o değerle süzülmüş ana sayı.
 * Hücreye tık → o değerle süzülmüş tek rapor (süzgeç URL'e yazılır, varyant kalkar). Dar ekranda tek sütun.
 */
export function SmallMultiples({ block, comparisonLabel }: Props) {
  const [search, setSearch] = useSearchParams();
  const cells = block.hucreler ?? [];
  if (cells.length === 0) return null;
  const max = axisMax(cells);
  return (
    <section className="rounded-lg border p-4" aria-label={`${block.boyutEtiketi} kırılımı`}>
      <h2 className="mb-3 text-sm font-semibold">
        {block.boyutEtiketi} kırılımı <span className="font-normal text-muted-foreground">· en büyük {cells.length}</span>
      </h2>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cells.map((c) => {
          const next = cellFilterSearch(search, block, c);
          const cmp = comparisonText(c.anaSayi, comparisonLabel);
          const body = (
            <>
              <span className="block truncate text-xs text-muted-foreground" title={c.ad}>
                {c.ad}
              </span>
              <span className={cn("block text-xl font-semibold tabular-nums", c.anaSayi.deger === null && "text-base text-muted-foreground")}>
                {formatFigure(c.anaSayi.deger, c.anaSayi.birim)}
              </span>
              <MiniBars now={c.anaSayi.deger} before={c.anaSayi.kiyas?.deger ?? null} max={max} />
              {cmp ? <span className={cn("block text-xs", toneClass(c.anaSayi.kiyas?.durum))}>{cmp}</span> : null}
            </>
          );
          return (
            <li key={c.deger} className="min-w-0">
              {next ? (
                <button
                  type="button"
                  className="flex h-full w-full flex-col gap-1 rounded-md border bg-card p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setSearch(next, { replace: false })}
                  title={`${c.ad} için raporu aç`}
                >
                  {body}
                </button>
              ) : (
                <div className="flex h-full flex-col gap-1 rounded-md border bg-card p-3">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
