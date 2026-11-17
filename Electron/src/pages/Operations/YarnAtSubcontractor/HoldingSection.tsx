// Kart bölümü iskeleti (iplik kartı · fasoncu kartı): başlık + toplam + "tümünü gör" bağı + satırlar.
// Tablo DEĞİL (liste standardı bekçisi kart içi <table>'ı ölçer); satırlar ızgara. Hata ≠ "yok" ayrı cümle.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { kg } from "../Yarn/qty";

export interface HoldingLine {
  key: string;
  main: ReactNode;
  sub?: ReactNode;
  kg: string | number;
  note?: ReactNode;
}

export function HoldingSection({ title, totalKg, href, hrefLabel, lines, loading, error, emptyText, className }: {
  title: string;
  totalKg: number;
  href?: string;
  hrefLabel?: string;
  lines: HoldingLine[];
  loading: boolean;
  error: boolean;
  emptyText: string;
  className?: string;
}) {
  return (
    <section aria-label={title} className={cn("rounded-md border p-3", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {title}
          {!loading && !error && lines.length > 0 && <span className="ml-2 font-normal tabular-nums text-muted-foreground">{kg(totalKg)}</span>}
        </h3>
        {href && (
          <Link to={href} className="text-xs text-primary underline-offset-4 hover:underline">
            {hrefLabel ?? "Tümünü gör"}
          </Link>
        )}
      </div>
      {loading ? (
        <p className="mt-2 text-xs text-muted-foreground">Yükleniyor…</p>
      ) : error ? (
        <p className="mt-2 text-xs text-destructive">Yüklenemedi — bu “iplik yok” demek değildir; sonra tekrar bakın.</p>
      ) : lines.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="mt-2 max-h-56 divide-y overflow-y-auto text-sm">
          {lines.map((l) => (
            <li key={l.key} className="flex items-start justify-between gap-3 py-1.5">
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{l.main}</span>
                {l.sub && <span className="text-xs text-muted-foreground">{l.sub}</span>}
                {l.note}
              </span>
              <span className="shrink-0 font-medium tabular-nums">{kg(l.kg)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
