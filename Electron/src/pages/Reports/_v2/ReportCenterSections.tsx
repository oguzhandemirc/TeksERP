import { Link } from "react-router-dom";
import { ArrowRight, ChevronRight, History, Star } from "lucide-react";
import type { ReportCatalogEntry } from "@/lib/report-catalog";
import type { LegacyCard, LegacyGroup } from "./legacy-model";

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

/** "Eski raporlar (geçiş dönemi)" — v1 raporlar eski kategorileriyle; her kartta yeni hâline yol. */
export function LegacyReportsSection({ groups }: { groups: readonly LegacyGroup[] }) {
  const total = groups.reduce((n, g) => n + g.cards.length, 0);
  return (
    <section aria-label="Eski raporlar (geçiş dönemi)" className="rounded-lg border border-dashed p-4">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold">
        <History className="h-4 w-4" /> Eski raporlar (geçiş dönemi) <span className="font-normal text-muted-foreground">({total})</span>
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Önceki rapor ekranları geçiş boyunca açık kalır; yeni hâli hazır olanların kartında yolu yazar.
      </p>
      <div className="mt-3 flex flex-col gap-4">
        {groups.map((g) => (
          <div key={g.key} role="group" aria-label={g.title}>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</h3>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {g.cards.map((c) => (
                <LegacyCardItem key={c.entry.key} card={c} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function LegacyCardItem({ card }: { card: LegacyCard }) {
  const { entry, to, banner, expert } = card;
  return (
    <li className="flex min-w-0 flex-col gap-1 rounded-md border bg-card px-3 py-2">
      <Link to={to} className="group flex items-start justify-between gap-2 text-sm font-medium hover:text-primary">
        <span className="min-w-0">{entry.baslik}</span>
        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
      </Link>
      {banner?.kind === "merged" ? (
        <Link to={banner.to} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
          Yeni hâli: {banner.targetTitle} <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      ) : banner?.kind === "moved" ? (
        <Link to={banner.to} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
          Yeni yeri: {banner.hostLabel} <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      ) : expert ? (
        <span className="text-xs text-muted-foreground">Muhasebe aracı olarak kalır</span>
      ) : (
        <span className="text-xs text-muted-foreground">Yeni hâli hazırlanıyor</span>
      )}
    </li>
  );
}
