import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { useAppVersion } from "@/hooks/useAppVersion";
import { RELEASE_ENTRIES } from "@/lib/surum-notlari";
import { filterReleases, type ScopeFilter } from "./release-notes-view";
import { ReleaseDetail, ReleaseList } from "./ReleaseNotesParts";

/**
 * SÜRÜM NOTLARI — solda yayın listesi, sağda seçili yayının maddeleri (türe göre
 * gruplu). Eski "Tümünü gör" penceresi bütün yayınları tek kaydırmada döküyordu;
 * burada bir seferde tek yayın okunur.
 *
 * Route kapısız: operatör de kendi programında neyin değiştiğini okuyabilmeli.
 * Seçim `?id=` ile URL'de durur ki derin bağlantı / sekme geri dönüşü korunsun.
 */
export function ReleaseNotesPage() {
  const installed = useAppVersion();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<ScopeFilter>("all");

  const entries = useMemo(() => filterReleases(RELEASE_ENTRIES, scope, query), [scope, query]);
  const selectedId = searchParams.get("id");
  const selected = entries.find((e) => e.id === selectedId) ?? entries[0] ?? null;

  const select = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("id", id);
    setSearchParams(next, { replace: true });
  };

  return (
    <PageShell>
      <PageHeader
        title="Sürüm Notları"
        description={`Güncellemelerde neyin değiştiği${installed ? ` · kurulu panel sürümü ${installed}` : ""}`}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-6 md:flex-row">
        <ReleaseList
          entries={entries}
          selectedId={selected?.id ?? null}
          installed={installed}
          query={query}
          onQuery={setQuery}
          scope={scope}
          onScope={setScope}
          onSelect={select}
        />
        <section className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-card shadow-sm">
          {selected ? (
            <ReleaseDetail entry={selected} installed={installed} />
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">Gösterilecek sürüm notu yok.</p>
          )}
        </section>
      </div>
    </PageShell>
  );
}
