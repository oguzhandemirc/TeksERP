import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { RELEASE_ENTRIES, type ReleaseEntry } from "@/lib/surum-notlari";
import { cn } from "@/lib/utils";
import {
  SCOPE_LABEL,
  TYPE_ORDER,
  TYPE_VIEW,
  countByType,
  formatReleaseDate,
  type ScopeFilter,
} from "./release-notes-view";

const SCOPE_OPTIONS: { value: ScopeFilter; label: string }[] = [
  { value: "all", label: "Tümü" },
  { value: "panel", label: "Panel" },
  { value: "tablet", label: "Tablet" },
];

/** Sol sütun — arama, kapsam süzgeci ve yayın listesi. */
export function ReleaseList({
  entries,
  selectedId,
  installed,
  query,
  onQuery,
  scope,
  onScope,
  onSelect,
}: {
  entries: ReleaseEntry[];
  selectedId: string | null;
  installed: string | null;
  query: string;
  onQuery: (v: string) => void;
  scope: ScopeFilter;
  onScope: (v: ScopeFilter) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="flex min-h-0 flex-col rounded-lg border bg-card shadow-sm md:w-80 md:shrink-0">
      <div className="space-y-2 border-b p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Notlarda ara"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
        </div>
        <div className="flex gap-1 rounded-md bg-muted p-1">
          {SCOPE_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => onScope(o.value)}
              className={cn(
                "flex-1 rounded px-2 py-1 text-xs font-medium transition-colors",
                scope === o.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-2">
        {entries.length === 0 ? (
          <li className="px-2 py-8 text-center text-sm text-muted-foreground">Eşleşen not yok.</li>
        ) : (
          entries.map((e) => (
            <li key={e.id}>
              <ReleaseRow
                entry={e}
                active={selectedId === e.id}
                isInstalled={installed !== null && e.surumler.panel === installed}
                onClick={() => onSelect(e.id)}
              />
            </li>
          ))
        )}
      </ul>
      <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">
        {entries.length} / {RELEASE_ENTRIES.length} güncelleme
      </p>
    </aside>
  );
}

function VersionBadges({ entry }: { entry: ReleaseEntry }) {
  return (
    <>
      {entry.surumler.panel && (
        <Badge variant="outline" className="font-mono text-[10px]">
          Panel {entry.surumler.panel}
        </Badge>
      )}
      {entry.surumler.tablet && (
        <Badge variant="outline" className="font-mono text-[10px]">
          Tablet {entry.surumler.tablet}
        </Badge>
      )}
    </>
  );
}

function ReleaseRow({
  entry,
  active,
  isInstalled,
  onClick,
}: {
  entry: ReleaseEntry;
  active: boolean;
  isInstalled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "w-full rounded-md border-l-2 px-3 py-2.5 text-left transition-colors",
        active ? "border-l-primary bg-primary/10" : "border-l-transparent hover:bg-muted/60",
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{formatReleaseDate(entry.id)}</span>
        {isInstalled && (
          <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
            Kurulu
          </Badge>
        )}
      </div>
      <p className={cn("line-clamp-2 text-sm leading-snug", active && "font-medium")}>{entry.baslik}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <VersionBadges entry={entry} />
        <span className="ml-auto text-[11px] text-muted-foreground">{entry.maddeler.length} madde</span>
      </div>
    </button>
  );
}

/** Sağ sütun — seçili yayın, maddeler türe göre gruplu. */
export function ReleaseDetail({ entry, installed }: { entry: ReleaseEntry; installed: string | null }) {
  const counts = countByType(entry);
  return (
    <article className="p-6">
      <header className="mb-6 space-y-3 border-b pb-5">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{formatReleaseDate(entry.id)}</span>
          <VersionBadges entry={entry} />
          {installed !== null && entry.surumler.panel === installed && (
            <Badge variant="secondary" className="text-[10px]">
              Kurulu sürüm
            </Badge>
          )}
        </div>
        <h2 className="text-lg font-semibold leading-snug">{entry.baslik}</h2>
        <div className="flex flex-wrap gap-2">
          {TYPE_ORDER.filter((t) => counts[t] > 0).map((t) => {
            const view = TYPE_VIEW[t];
            const Icon = view.icon;
            return (
              <span
                key={t}
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs"
              >
                <Icon className={cn("h-3.5 w-3.5", view.className)} />
                {counts[t]} {view.lower}
              </span>
            );
          })}
        </div>
      </header>

      <div className="space-y-8">
        {TYPE_ORDER.map((type) => {
          const items = entry.maddeler.filter((m) => m.tip === type);
          if (items.length === 0) return null;
          const view = TYPE_VIEW[type];
          const Icon = view.icon;
          return (
            <section key={type}>
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Icon className={cn("h-4 w-4", view.className)} />
                {view.plural}
                <span className="font-normal text-muted-foreground">({items.length})</span>
              </h3>
              <ul className="space-y-2">
                {items.map((m, i) => (
                  <li key={i} className="flex gap-3 rounded-md border bg-muted/20 px-3 py-2.5">
                    <p className="min-w-0 flex-1 text-sm leading-relaxed">{m.metin}</p>
                    <span className="shrink-0 self-start rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {SCOPE_LABEL[m.kapsam]}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </article>
  );
}
