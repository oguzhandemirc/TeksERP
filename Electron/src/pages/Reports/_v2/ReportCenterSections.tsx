import { Link } from "react-router-dom";
import { ChevronRight, History, Star } from "lucide-react";
import type { ReportCatalogEntry } from "@/lib/report-catalog";
import type { ReportTile } from "../tile-config";

export function FavoritesStrip({ entries }: { entries: readonly ReportCatalogEntry[] }) {
  return (
    <section aria-label="Favorilerim">
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        <Star className="h-4 w-4 fill-amber-400 text-amber-500" /> Favorilerim
      </h2>
      <div className="flex flex-wrap gap-2">
        {entries.map((e) => (
          <Link key={e.key} to={`/${e.panelYolu}`} className="rounded-full border bg-card px-3 py-1 text-sm hover:bg-muted">
            {e.baslik}
          </Link>
        ))}
      </div>
    </section>
  );
}

interface GroupProps {
  title: string;
  entries: readonly ReportCatalogEntry[];
}

export function ReportGroupSection({ title, entries }: GroupProps) {
  return (
    <section aria-label={title}>
      <h2 className="mb-2 text-sm font-semibold">
        {title} <span className="font-normal text-muted-foreground">({entries.length})</span>
      </h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((e) => (
          <Link key={e.key} to={`/${e.panelYolu}`} className="group flex items-start justify-between gap-2 rounded-lg border bg-card p-3 hover:border-primary/50 hover:bg-muted/40">
            <span>
              <span className="block text-sm font-medium">{e.baslik}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{e.soru}</span>
            </span>
            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
          </Link>
        ))}
      </div>
    </section>
  );
}

/** "Eski raporlar" yer tutucusu — içeriği R0-GECIS rapor bazlı listeyle değiştirir. */
export function LegacyReportsSection({ tiles }: { tiles: readonly ReportTile[] }) {
  return (
    <section aria-label="Eski raporlar (geçiş dönemi)" className="rounded-lg border border-dashed p-4">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold">
        <History className="h-4 w-4" /> Eski raporlar (geçiş dönemi)
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">Önceki rapor ekranları geçiş boyunca kendi yerlerinde açık kalır.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {tiles.map((t) => (
          <Link key={t.key} to={t.to} className="rounded-md border px-2.5 py-1 text-xs hover:bg-muted">
            {t.title}
          </Link>
        ))}
      </div>
    </section>
  );
}
